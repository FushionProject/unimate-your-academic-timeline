importScripts("config.local.js");

const config = self.UNIMATE_COMPANION_CONFIG || {};
const STORAGE_KEY = "unimateCompanionSession";
const PRIVACY_CONSENT_KEY = "unimateCompanionPrivacyConsent";
const PRIVACY_CONSENT_VERSION = 1;
const MAX_HISTORY = 10;
const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY_ITEM_CHARS = 4000;
const MAX_ANSWER_CHARS = 12000;
const MAX_RATE_LIMIT_RETRY_MS = 5000;
const AUTH_TIMEOUT_MS = 8000;
const ENTITLEMENT_TIMEOUT_MS = 8000;
const PERSISTENCE_TIMEOUT_MS = 8000;
const AI_TIMEOUT_MS = 45000;
const completedChatRequests = new Map();
const pendingChatPersistence = new Map();
const MAX_REQUEST_CACHE = 100;

class CompanionError extends Error {
  constructor(message, { code = "COMPANION_ERROR", phase = "runtime", retryAfterMs = 0 } = {}) {
    super(message);
    this.name = "CompanionError";
    this.code = code;
    this.phase = phase;
    this.retryAfterMs = retryAfterMs;
  }
}

const jsonHeaders = (accessToken) => ({
  apikey: config.SUPABASE_ANON_KEY,
  "Content-Type": "application/json",
  ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
});

function configured() {
  return Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY && config.UNIMATE_API_URL);
}

async function readSession() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || null;
}

async function writeSession(session) {
  if (session) await chrome.storage.local.set({ [STORAGE_KEY]: session });
  else await chrome.storage.local.remove(STORAGE_KEY);
}

async function privacyConsentState() {
  const result = await chrome.storage.local.get(PRIVACY_CONSENT_KEY);
  const record = result[PRIVACY_CONSENT_KEY];
  return {
    accepted: record?.accepted === true && record?.version === PRIVACY_CONSENT_VERSION,
    version: PRIVACY_CONSENT_VERSION,
  };
}

async function setPrivacyConsent(accepted) {
  if (accepted === true) {
    await chrome.storage.local.set({
      [PRIVACY_CONSENT_KEY]: {
        accepted: true,
        version: PRIVACY_CONSENT_VERSION,
        acceptedAt: new Date().toISOString(),
      },
    });
  } else {
    await chrome.storage.local.remove(PRIVACY_CONSENT_KEY);
  }
  return privacyConsentState();
}

async function requirePrivacyConsent() {
  const consent = await privacyConsentState();
  if (!consent.accepted) {
    throw new CompanionError("Review and accept the page-context privacy notice first.", {
      code: "PRIVACY_CONSENT_REQUIRED",
      phase: "privacy",
    });
  }
}

function retryAfterMs(response) {
  const raw = response.headers?.get?.("retry-after");
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

async function parseResponse(response, phase = "network") {
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text || `Request failed (${response.status})` };
  }
  if (!response.ok) {
    const retryMs = retryAfterMs(response);
    if (response.status === 429) {
      const wait =
        retryMs > 0 ? ` Try again in about ${Math.max(1, Math.ceil(retryMs / 1000))} seconds.` : "";
      throw new CompanionError(`UniMate is temporarily rate limited.${wait}`, {
        code: "AI_RATE_LIMITED",
        phase,
        retryAfterMs: retryMs,
      });
    }
    throw new CompanionError(
      body.error || body.message || `UniMate request failed (${response.status}).`,
      {
        code: response.status >= 500 ? "BACKEND_UNAVAILABLE" : "BACKEND_REQUEST_FAILED",
        phase,
      },
    );
  }
  return body;
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));

async function fetchWithTimeout(url, options, timeoutMs, timeoutError) {
  const controller = new AbortController();
  const upstreamSignal = options?.signal;
  let timedOut = false;
  const forwardAbort = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) forwardAbort();
  else upstreamSignal?.addEventListener?.("abort", forwardAbort, { once: true });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetch(url, { ...options, signal: controller.signal }), timeout]);
  } catch (error) {
    if (timedOut) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener?.("abort", forwardAbort);
  }
}

async function fetchBackendWithBoundedRetry(url, options, phase) {
  const timeoutError = () =>
    new CompanionError("UniMate’s AI request timed out. Please try again.", {
      code: "AI_TIMEOUT",
      phase,
    });
  let response = await fetchWithTimeout(url, options, AI_TIMEOUT_MS, timeoutError());
  if (response.status !== 429) return response;
  const waitMs = retryAfterMs(response);
  // Retry only when the server explicitly asks for a short wait. Long or
  // missing retry windows are surfaced immediately instead of tying up the
  // MV3 service worker or multiplying requests under sustained rate limiting.
  if (!(waitMs > 0 && waitMs <= MAX_RATE_LIMIT_RETRY_MS)) return response;
  await delay(waitMs);
  response = await fetchWithTimeout(url, options, AI_TIMEOUT_MS, timeoutError());
  return response;
}

async function refreshSession(session) {
  if (!session?.refresh_token) return null;
  const response = await fetchWithTimeout(
    `${config.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    },
    AUTH_TIMEOUT_MS,
    new CompanionError("UniMate session validation timed out.", {
      code: "AUTH_TIMEOUT",
      phase: "auth",
    }),
  );
  if (!response.ok) {
    await writeSession(null);
    return null;
  }
  const next = await response.json();
  await writeSession(next);
  return next;
}

async function getValidSession() {
  let session = await readSession();
  if (!session) return null;
  const expiresAtMs = Number(session.expires_at || 0) * 1000;
  if (!expiresAtMs || expiresAtMs < Date.now() + 60000) session = await refreshSession(session);
  if (!session?.access_token) return null;

  const authTimeout = () =>
    new CompanionError("UniMate session validation timed out.", {
      code: "AUTH_TIMEOUT",
      phase: "auth",
    });
  const response = await fetchWithTimeout(
    `${config.SUPABASE_URL}/auth/v1/user`,
    { headers: jsonHeaders(session.access_token) },
    AUTH_TIMEOUT_MS,
    authTimeout(),
  );
  if (response.status === 401) {
    session = await refreshSession(session);
    if (!session) return null;
    const retried = await fetchWithTimeout(
      `${config.SUPABASE_URL}/auth/v1/user`,
      { headers: jsonHeaders(session.access_token) },
      AUTH_TIMEOUT_MS,
      authTimeout(),
    );
    if (!retried.ok) {
      await writeSession(null);
      return null;
    }
    session.user = await retried.json();
    await writeSession(session);
  } else if (response.ok) {
    session.user = await response.json();
    await writeSession(session);
  } else {
    throw new Error("Could not validate your UniMate session.");
  }
  return session;
}

async function getProfile(session) {
  const userId = session.user?.id;
  const response = await fetchWithTimeout(
    `${config.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=is_pro&limit=1`,
    { headers: jsonHeaders(session.access_token) },
    ENTITLEMENT_TIMEOUT_MS,
    new CompanionError("UniMate Pro verification timed out.", {
      code: "ENTITLEMENT_TIMEOUT",
      phase: "entitlement",
    }),
  );
  const rows = await parseResponse(response, "entitlement");
  return { isPro: rows[0]?.is_pro === true };
}

async function authState() {
  if (!configured()) {
    return {
      configured: false,
      authenticated: false,
      isPro: false,
      debug: Boolean(config.COMPANION_DEBUG),
    };
  }
  const session = await getValidSession();
  if (!session) {
    return {
      configured: true,
      authenticated: false,
      isPro: false,
      debug: Boolean(config.COMPANION_DEBUG),
    };
  }
  const profile = await getProfile(session);
  return {
    configured: true,
    authenticated: true,
    isPro: profile.isPro,
    email: session.user?.email || "",
    userId: session.user?.id,
    debug: Boolean(config.COMPANION_DEBUG),
  };
}

async function signIn(email, password) {
  if (!configured()) throw new Error("The extension has not been configured yet.");
  const existingSession = await getValidSession();
  const requestedEmail = String(email || "")
    .trim()
    .toLowerCase();
  const existingEmail = String(existingSession?.user?.email || "")
    .trim()
    .toLowerCase();
  if (existingSession && existingEmail && existingEmail !== requestedEmail) {
    throw new CompanionError(
      "This extension is already connected to another UniMate account. Sign out before connecting a different account.",
      { code: "ACCOUNT_SWITCH_REQUIRES_SIGN_OUT", phase: "auth" },
    );
  }
  const response = await fetchWithTimeout(
    `${config.SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ email, password }),
    },
    AUTH_TIMEOUT_MS,
    new CompanionError("UniMate sign-in timed out.", {
      code: "AUTH_TIMEOUT",
      phase: "auth",
    }),
  );
  const session = await parseResponse(response);
  await writeSession(session);
  return authState();
}

async function signOut() {
  const session = await readSession();
  if (session?.access_token) {
    await fetchWithTimeout(
      `${config.SUPABASE_URL}/auth/v1/logout`,
      {
        method: "POST",
        headers: jsonHeaders(session.access_token),
      },
      AUTH_TIMEOUT_MS,
      new CompanionError("UniMate sign-out timed out.", {
        code: "AUTH_TIMEOUT",
        phase: "auth",
      }),
    ).catch(() => undefined);
  }
  await writeSession(null);
  completedChatRequests.clear();
  pendingChatPersistence.clear();
  return {
    configured: configured(),
    authenticated: false,
    isPro: false,
    debug: Boolean(config.COMPANION_DEBUG),
  };
}

async function requireProSession() {
  const session = await getValidSession();
  if (!session) {
    throw new CompanionError("Please sign in with your UniMate account.", {
      code: "AUTH_REQUIRED",
      phase: "auth",
    });
  }
  const profile = await getProfile(session);
  if (!profile.isPro) {
    throw new CompanionError("UniMate Companion requires an active Pro profile.", {
      code: "PRO_REQUIRED",
      phase: "entitlement",
    });
  }
  return session;
}

async function ensureActiveConversation(session) {
  const preferenceResponse = await fetchWithTimeout(
    `${config.SUPABASE_URL}/rest/v1/companion_preferences?user_id=eq.${encodeURIComponent(session.user.id)}&select=active_conversation_id&limit=1`,
    { headers: jsonHeaders(session.access_token) },
    PERSISTENCE_TIMEOUT_MS,
    new CompanionError("Loading the selected browser chat timed out.", {
      code: "PERSISTENCE_TIMEOUT",
      phase: "persistence",
    }),
  );
  const preferences = await parseResponse(preferenceResponse, "persistence");
  if (preferences[0]?.active_conversation_id) return preferences[0].active_conversation_id;

  const conversationsResponse = await fetchWithTimeout(
    `${config.SUPABASE_URL}/rest/v1/companion_conversations?user_id=eq.${encodeURIComponent(session.user.id)}&select=id&order=updated_at.desc&limit=1`,
    { headers: jsonHeaders(session.access_token) },
    PERSISTENCE_TIMEOUT_MS,
    new CompanionError("Loading browser chats timed out.", {
      code: "PERSISTENCE_TIMEOUT",
      phase: "persistence",
    }),
  );
  const conversations = await parseResponse(conversationsResponse, "persistence");
  let conversationId = conversations[0]?.id;
  if (!conversationId) {
    const createResponse = await fetchWithTimeout(
      `${config.SUPABASE_URL}/rest/v1/companion_conversations`,
      {
        method: "POST",
        headers: { ...jsonHeaders(session.access_token), Prefer: "return=representation" },
        body: JSON.stringify({ user_id: session.user.id, title: "Browser chat" }),
      },
      PERSISTENCE_TIMEOUT_MS,
      new CompanionError("Creating a browser chat timed out.", {
        code: "PERSISTENCE_TIMEOUT",
        phase: "persistence",
      }),
    );
    const created = await parseResponse(createResponse, "persistence");
    conversationId = created[0]?.id;
  }
  if (!conversationId) {
    throw new CompanionError("UniMate could not choose a browser conversation.", {
      code: "CONVERSATION_UNAVAILABLE",
      phase: "persistence",
    });
  }
  const preferenceUpsert = await fetchWithTimeout(
    `${config.SUPABASE_URL}/rest/v1/companion_preferences?on_conflict=user_id`,
    {
      method: "POST",
      headers: {
        ...jsonHeaders(session.access_token),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        user_id: session.user.id,
        active_conversation_id: conversationId,
        updated_at: new Date().toISOString(),
      }),
    },
    PERSISTENCE_TIMEOUT_MS,
    new CompanionError("Selecting the browser chat timed out.", {
      code: "PERSISTENCE_TIMEOUT",
      phase: "persistence",
    }),
  );
  await parseResponse(preferenceUpsert, "persistence");
  return conversationId;
}

async function saveExchange(session, conversationId, userMessage, assistantMessage) {
  const userCreatedAt = new Date();
  const assistantCreatedAt = new Date(userCreatedAt.getTime() + 1);
  const response = await fetchWithTimeout(
    `${config.SUPABASE_URL}/rest/v1/companion_chats`,
    {
      method: "POST",
      headers: { ...jsonHeaders(session.access_token), Prefer: "return=representation" },
      body: JSON.stringify([
        {
          user_id: session.user.id,
          conversation_id: conversationId,
          message: userMessage,
          role: "user",
          created_at: userCreatedAt.toISOString(),
        },
        {
          user_id: session.user.id,
          conversation_id: conversationId,
          message: assistantMessage,
          role: "assistant",
          created_at: assistantCreatedAt.toISOString(),
        },
      ]),
    },
    PERSISTENCE_TIMEOUT_MS,
    new CompanionError("Saving this chat timed out.", {
      code: "PERSISTENCE_TIMEOUT",
      phase: "persistence",
    }),
  );
  const rows = await parseResponse(response);
  const user = rows.find((row) => row.role === "user");
  const assistant = rows.find((row) => row.role === "assistant");
  if (!user || !assistant) {
    throw new CompanionError("The complete chat exchange was not saved.", {
      code: "PERSISTENCE_INCOMPLETE",
      phase: "persistence",
    });
  }
  return { user, assistant };
}

async function loadMessages(session, requestedConversationId) {
  const conversationId = requestedConversationId || (await ensureActiveConversation(session));
  const response = await fetchWithTimeout(
    `${config.SUPABASE_URL}/rest/v1/companion_chats?conversation_id=eq.${encodeURIComponent(conversationId)}&select=id,message,role,created_at,conversation_id&order=created_at.desc,id.desc&limit=100`,
    { headers: jsonHeaders(session.access_token) },
    PERSISTENCE_TIMEOUT_MS,
    new CompanionError("Loading chat history timed out.", {
      code: "PERSISTENCE_TIMEOUT",
      phase: "persistence",
    }),
  );
  const rows = await parseResponse(response);
  return rows.reverse();
}

async function loadChatState(session) {
  const conversationId = await ensureActiveConversation(session);
  const [conversationResponse, messages] = await Promise.all([
    fetchWithTimeout(
      `${config.SUPABASE_URL}/rest/v1/companion_conversations?id=eq.${encodeURIComponent(conversationId)}&user_id=eq.${encodeURIComponent(session.user.id)}&select=id,title&limit=1`,
      { headers: jsonHeaders(session.access_token) },
      PERSISTENCE_TIMEOUT_MS,
      new CompanionError("Loading the selected chat timed out.", {
        code: "PERSISTENCE_TIMEOUT",
        phase: "persistence",
      }),
    ),
    loadMessages(session, conversationId),
  ]);
  const conversations = await parseResponse(conversationResponse, "persistence");
  const conversation = conversations[0];
  if (!conversation?.id) {
    throw new CompanionError("The selected browser chat is unavailable.", {
      code: "CONVERSATION_UNAVAILABLE",
      phase: "persistence",
    });
  }
  return {
    conversationId: conversation.id,
    conversationTitle: conversation.title || "Chat",
    messages,
  };
}

// Map the extractor's context into the labelled provenance fields the backend
// grounds on. These names must match the server's normalizeProvenance():
// SELECTED_TEXT / MATCHED_PAGE_TEXT / VISIBLE_PAGE_TEXT / PAGE_TITLE / PAGE_URL.
// The backend is the single source of truth for the grounding prompt — the
// extension only supplies clean, labelled evidence.
function companionProvenanceFields(pageContext) {
  const ctx = pageContext && typeof pageContext === "object" ? pageContext : {};
  const clip = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
  const visibleText = ctx.visiblePageText || "";
  return {
    selectedText: clip(ctx.highlightedText, 2000),
    matchedPageText: clip(ctx.nearbyText, 2500),
    visiblePageText: clip(visibleText, 3500),
    pageTitle: clip(ctx.pageTitle, 300),
    pageUrl: clip(ctx.pageUrl, 500),
  };
}

function normalizedStudentMessage(message, maxChars = MAX_MESSAGE_CHARS) {
  return String(message || "")
    .trim()
    .slice(0, maxChars);
}

function groundedChatHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-MAX_HISTORY)
    .filter((item) => item?.role === "user" || item?.role === "assistant")
    .map((item) => ({
      role: item.role,
      // Previous assistant messages are conversational context only. The
      // backend's companion grounding prompt explicitly prevents the model
      // from treating them as authoritative evidence about the current page.
      content: String(item.message || "").slice(0, MAX_HISTORY_ITEM_CHARS),
    }))
    .filter((item) => item.content.trim());
}

function validatedCompanionAnswer(body) {
  const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
  if (!answer) throw new Error("UniMate did not return an answer. Please try again.");
  // This is a final transport-level backstop. Normal response length is
  // controlled by the backend token budget; an unexpectedly huge response is
  // rejected instead of exposing a likely reconstructed passage in the panel.
  if (answer.length > MAX_ANSWER_CHARS) {
    throw new Error(
      "UniMate blocked an unusually long page-analysis response. Try again with the relevant text highlighted.",
    );
  }
  return answer;
}

function sanitizePageContext(pageContext, sender) {
  const context = pageContext && typeof pageContext === "object" ? pageContext : {};
  return {
    ...context,
    pageUrl: sender.tab?.url || context.pageUrl || "",
    pageTitle: sender.tab?.title || context.pageTitle || "",
  };
}

async function callTextChat(session, message, pageContext, history) {
  const response = await fetchBackendWithBoundedRetry(
    `${config.UNIMATE_API_URL.replace(/\/$/, "")}/api/dashboard-ai`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        // Dedicated companion type so the backend applies strict grounding +
        // hallucination guards without touching the web dashboard's "chat".
        type: "companion-chat",
        message: normalizedStudentMessage(message),
        pageContext: companionProvenanceFields(pageContext),
        chatHistory: groundedChatHistory(history),
      }),
    },
    "text-analysis",
  );
  const body = await parseResponse(response, "text-analysis");
  return {
    answer: validatedCompanionAnswer(body),
    pipelineDiagnostics: body.companionDiagnostics || null,
  };
}

async function callScreenshotChat(session, message, pageContext, imageDataUrl, history) {
  const response = await fetchBackendWithBoundedRetry(
    `${config.UNIMATE_API_URL.replace(/\/$/, "")}/api/analyze-screenshot`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      // The backend builds the grounded prompt from these labelled fields. We
      // send the student's raw question plus structured page provenance — no
      // free-text bundling that the model could mistake for source material.
      body: JSON.stringify({
        imageBase64: imageDataUrl,
        question: normalizedStudentMessage(message, 1400),
        pageContext: companionProvenanceFields(pageContext),
        chatHistory: groundedChatHistory(history),
      }),
    },
    "screenshot-analysis",
  );
  const body = await parseResponse(response, "screenshot-analysis");
  return {
    answer: validatedCompanionAnswer(body),
    pipelineDiagnostics: body.companionDiagnostics || null,
  };
}

async function captureActiveTab(sender) {
  const windowId = sender.tab?.windowId;
  const tabId = sender.tab?.id;
  const tabUrl = String(sender.tab?.url || "");
  if (!Number.isInteger(windowId) || !Number.isInteger(tabId)) {
    throw new CompanionError("Could not identify the active page to capture.", {
      code: "CAPTURE_TAB_UNAVAILABLE",
      phase: "capture",
    });
  }
  if (tabUrl && !/^(https?|file):/i.test(tabUrl)) {
    throw new CompanionError("Chrome does not allow screen capture on this restricted page.", {
      code: "CAPTURE_RESTRICTED_PAGE",
      phase: "capture",
    });
  }
  if (typeof chrome.tabs?.captureVisibleTab !== "function") {
    throw new CompanionError("Screen capture is unavailable in this extension runtime.", {
      code: "CAPTURE_API_UNAVAILABLE",
      phase: "capture",
    });
  }
  const assertStillActive = async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, windowId });
    if (activeTab?.id !== tabId) {
      throw new CompanionError("The active tab changed before capture. Return to it and retry.", {
        code: "CAPTURE_TAB_CHANGED",
        phase: "capture",
      });
    }
  };

  let captureUiPrepareAttempted = false;
  try {
    await assertStillActive();
    let prepareResponse;
    try {
      // From this point forward restoration is mandatory. The content script
      // may have hidden the host even if Chrome drops the response channel.
      captureUiPrepareAttempted = true;
      prepareResponse = await chrome.tabs.sendMessage(tabId, {
        type: "PREPARE_COMPANION_CAPTURE",
      });
    } catch (error) {
      throw new CompanionError("UniMate could not safely hide its interface before capture.", {
        code: "CAPTURE_UI_HIDE_FAILED",
        phase: "capture",
      });
    }
    if (!prepareResponse?.ok || prepareResponse.hidden !== true) {
      throw new CompanionError(
        prepareResponse?.error || "UniMate could not safely hide its interface before capture.",
        { code: "CAPTURE_UI_HIDE_FAILED", phase: "capture" },
      );
    }
    await assertStillActive();
    let image = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 65 });
    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      throw new Error("Chrome returned an invalid capture.");
    }
    if (image.length > 2_400_000) {
      await assertStillActive();
      image = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 35 });
    }
    if (image.length > 2_500_000) {
      throw new CompanionError(
        "This viewport is too large to analyze. Reduce zoom or window size and retry.",
        { code: "CAPTURE_TOO_LARGE", phase: "capture" },
      );
    }
    return image;
  } catch (error) {
    if (error instanceof CompanionError) throw error;
    const detail = String(error?.message || "");
    const permissionDenied = /permission|not allowed|cannot access|restricted/i.test(detail);
    throw new CompanionError(
      permissionDenied
        ? "Chrome denied screen capture on this page."
        : "Chrome could not capture the visible tab. Keep this tab active and retry.",
      {
        code: permissionDenied ? "CAPTURE_PERMISSION_DENIED" : "CAPTURE_FAILED",
        phase: "capture",
      },
    );
  } finally {
    if (captureUiPrepareAttempted) {
      try {
        const restoreResponse = await chrome.tabs.sendMessage(tabId, {
          type: "RESTORE_COMPANION_CAPTURE",
        });
        if (!restoreResponse?.ok || restoreResponse.restored !== true) {
          throw new Error("Restore was not confirmed.");
        }
      } catch {
        // Repair the extension-owned host without exposing any page-accessible
        // lifecycle hook. The content script also restores during disposal.
        try {
          await recoverContentScript(sender.tab);
        } catch {
          // The original capture result/error remains authoritative. Recovery
          // is best-effort because navigation may have invalidated the tab.
        }
      }
    }
  }
}

async function runtimeDiagnostics(sender) {
  const tab = sender.tab;
  let capturePermission = null;
  try {
    capturePermission = await chrome.permissions?.contains?.({ origins: ["<all_urls>"] });
  } catch {
    capturePermission = null;
  }
  let contentScriptConnected = false;
  if (Number.isInteger(tab?.id)) {
    const nonce = crypto.randomUUID();
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "COMPANION_PING",
        nonce,
      });
      contentScriptConnected = response?.ok === true && response?.nonce === nonce;
    } catch {
      contentScriptConnected = false;
    }
  }
  return {
    serviceWorkerConnected: true,
    contentScriptConnected,
    tabIdentified: Number.isInteger(tab?.id) && Number.isInteger(tab?.windowId),
    eligiblePage: /^(https?|file):/i.test(String(tab?.url || "")),
    captureApiAvailable: typeof chrome.tabs?.captureVisibleTab === "function",
    capturePermission,
    manifestVersion: chrome.runtime.getManifest?.().manifest_version || 3,
  };
}

async function sendChat(payload, sender) {
  await requirePrivacyConsent();
  const session = await requireProSession();
  const conversationId = await ensureActiveConversation(session);
  const requestId =
    typeof payload.requestId === "string" && payload.requestId.length <= 100
      ? payload.requestId
      : crypto.randomUUID();
  const requestKey = `${session.user.id}:${requestId}`;
  if (completedChatRequests.has(requestKey)) return completedChatRequests.get(requestKey);
  const history = Array.isArray(payload.history) ? payload.history : [];
  const pageContext = sanitizePageContext(payload.context, sender);
  let answer;
  let pipelineDiagnostics = null;
  let contextMode = "screenshot";
  try {
    try {
      const image = await captureActiveTab(sender);
      const result = await callScreenshotChat(
        session,
        payload.message,
        pageContext,
        image,
        history,
      );
      answer = result.answer;
      pipelineDiagnostics = result.pipelineDiagnostics;
      contextMode =
        pageContext.visiblePageText || pageContext.highlightedText
          ? payload.useScreenshot === false
            ? "screenshot+supporting-text"
            : "text+screenshot"
          : "screenshot";
    } catch (error) {
      // Screenshot capture itself can be prohibited on browser-owned pages.
      // Preserve a useful text-only fallback when supplemental text exists;
      // backend/AI failures remain visible and are never disguised as capture
      // problems or multiplied with a second model call.
      if (
        error?.phase !== "capture" ||
        error?.code === "CAPTURE_UI_HIDE_FAILED" ||
        !(pageContext.visiblePageText || pageContext.highlightedText)
      ) {
        throw error;
      }
      const result = await callTextChat(session, payload.message, pageContext, history);
      answer = result.answer;
      pipelineDiagnostics = result.pipelineDiagnostics;
      contextMode = "text-fallback";
    }
  } catch (error) {
    // Persistence begins only after accepted AI work completes, so capture or
    // model failures cannot leave an orphaned user row.
    throw error;
  }
  const now = new Date().toISOString();
  let userRow = {
    id: `pending-user-${requestId}`,
    user_id: session.user.id,
    message: payload.message,
    role: "user",
    created_at: now,
  };
  let assistantRow = {
    id: `pending-assistant-${requestId}`,
    user_id: session.user.id,
    message: answer,
    role: "assistant",
    created_at: now,
  };
  let persistenceWarning = "";
  try {
    const saved = await saveExchange(session, conversationId, payload.message, answer);
    userRow = saved.user;
    assistantRow = saved.assistant;
  } catch {
    persistenceWarning =
      "Your answer is ready, but UniMate could not save this exchange to chat history. You can retry saving from this session.";
    pendingChatPersistence.set(requestKey, {
      session,
      conversationId,
      userMessage: payload.message,
      assistantMessage: answer,
    });
  }
  const diagnostics = {
    activeTabUrl: pageContext.pageUrl || "",
    extractedBlockCount:
      pageContext.metrics?.extractedBlockCount || pageContext.blocks?.length || 0,
    selectedText: String(pageContext.highlightedText || "").slice(0, 300),
    matchedItem:
      pageContext.relevance?.matchedQuestionNumber || pageContext.relevance?.bestBlockId || null,
    contextCharacterCount: String(pageContext.visiblePageText || "").length,
    screenshotFallbackStatus:
      contextMode === "text-fallback" ? "capture unavailable; used text" : "captured",
    confidenceScore: Number(payload.contextConfidence ?? 1),
    ...(pipelineDiagnostics || {}),
  };
  const response = {
    user: userRow,
    assistant: assistantRow,
    contextMode,
    diagnostics,
    requestId,
    conversationId,
    ...(persistenceWarning ? { persistenceWarning } : {}),
  };
  completedChatRequests.set(requestKey, response);
  if (completedChatRequests.size > MAX_REQUEST_CACHE) {
    completedChatRequests.delete(completedChatRequests.keys().next().value);
  }
  return response;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const run = async () => {
    switch (request?.type) {
      case "AUTH_STATE":
        return authState();
      case "PRIVACY_CONSENT_STATE":
        return privacyConsentState();
      case "SET_PRIVACY_CONSENT":
        return setPrivacyConsent(request.accepted === true);
      case "SIGN_IN":
        return signIn(String(request.email || ""), String(request.password || ""));
      case "SIGN_OUT":
        return signOut();
      case "LOAD_MESSAGES": {
        const session = await requireProSession();
        return loadMessages(session);
      }
      case "LOAD_CHAT_STATE": {
        const session = await requireProSession();
        return loadChatState(session);
      }
      case "RUNTIME_DIAGNOSTICS":
        return runtimeDiagnostics(sender);
      case "SEND_CHAT":
        return sendChat(request, sender);
      case "RETRY_CHAT_PERSISTENCE": {
        const session = await requireProSession();
        const requestId = String(request.requestId || "");
        const requestKey = `${session.user.id}:${requestId}`;
        const pending = pendingChatPersistence.get(requestKey);
        if (!pending) return { saved: true, alreadyComplete: true };
        await saveExchange(
          session,
          pending.conversationId,
          pending.userMessage,
          pending.assistantMessage,
        );
        pendingChatPersistence.delete(requestKey);
        return { saved: true };
      }
      default:
        throw new Error("Unknown companion request.");
    }
  };

  run()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      const companionError =
        error instanceof CompanionError
          ? error
          : new CompanionError(error?.message || "Something went wrong.");
      sendResponse({
        ok: false,
        error: companionError.message,
        errorCode: companionError.code,
        errorPhase: companionError.phase,
        retryAfterMs: companionError.retryAfterMs || 0,
      });
    });
  return true;
});

function isInjectablePage(url) {
  return /^(https?|file):/i.test(String(url || ""));
}

async function showActionFailure(tab, title) {
  await chrome.action.setBadgeBackgroundColor({ color: "#9a3429", tabId: tab.id });
  await chrome.action.setBadgeText({ text: "!", tabId: tab.id });
  await chrome.action.setTitle({ title, tabId: tab.id });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "", tabId: tab.id }).catch(() => undefined);
    chrome.action
      .setTitle({ title: "Open UniMate Companion", tabId: tab.id })
      .catch(() => undefined);
  }, 5000);
}

async function recoverContentScript(tab) {
  if (!Number.isInteger(tab.id) || !isInjectablePage(tab.url)) {
    throw new CompanionError("UniMate cannot run on this Chrome-restricted page.", {
      code: "CONTENT_SCRIPT_RESTRICTED_PAGE",
      phase: "injection",
    });
  }
  if (typeof chrome.scripting?.executeScript !== "function") {
    throw new CompanionError("The extension cannot reconnect to this tab.", {
      code: "SCRIPTING_API_UNAVAILABLE",
      phase: "injection",
    });
  }

  // Current instances are disposed through extension-only messaging. If an
  // extension reload invalidated the old isolated world, it cannot receive
  // messages; removing its extension-owned host is the only safe stale cleanup
  // available and exposes no privileged page event.
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "DISPOSE_COMPANION_INSTANCE",
    });
    if (!response?.ok) throw new Error("Disposal was not confirmed.");
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        globalThis.__unimateCompanionPrivateDispose?.();
        document.getElementById("unimate-companion-host")?.remove();
      },
    });
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["context-extractor.js", "content.js"],
  });
}

chrome.runtime.onInstalled?.addListener(() => {
  // Manifest content scripts do not retroactively appear in tabs that were
  // already open when an unpacked extension was installed or reloaded.
  // Rehydrate eligible existing tabs once per install/update so users do not
  // need to refresh every tab. Failures are expected for pages Chrome protects.
  chrome.tabs
    .query({})
    .then((tabs) =>
      Promise.allSettled(
        tabs
          .filter((tab) => Number.isInteger(tab.id) && isInjectablePage(tab.url))
          .map((tab) => recoverContentScript(tab)),
      ),
    )
    .catch(() => undefined);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_COMPANION" });
  } catch {
    try {
      await recoverContentScript(tab);
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_COMPANION" });
    } catch (error) {
      const restricted = !isInjectablePage(tab.url);
      await showActionFailure(
        tab,
        restricted
          ? "UniMate cannot access this Chrome-restricted page. Open a regular web page."
          : "UniMate could not reconnect to this tab. Reload the extension or refresh the page.",
      );
    }
  }
});
