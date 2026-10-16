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
const CAPTURE_TIMEOUT_MS = 8000;
const CONTENT_PROTOCOL_VERSION = 2;
const completedChatRequests = new Map();
const inFlightChatRequests = new Map();
const pendingChatPersistence = new Map();
const captureFlights = new Map();
const conversationFlights = new Map();
const MAX_REQUEST_CACHE = 100;
const MAX_PENDING_PERSISTENCE = 100;
let sessionEpoch = 0;
let sessionValidationFlight = null;
let sessionWriteQueue = Promise.resolve();
const REQUEST_JOURNAL_PREFIX = "unimateCompanionRequest:";
const MAX_JOURNAL_BYTES = 4_000_000;
let journalQueue = Promise.resolve();

// Session storage survives MV3 worker suspension without keeping page/chat
// data on disk after the browser exits. Content scripts cannot read tokens.
chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);

async function readRequestJournal(requestKey) {
  if (!chrome.storage.session) return null;
  await journalQueue;
  const key = `${REQUEST_JOURNAL_PREFIX}${requestKey}`;
  const stored = await chrome.storage.session.get(key);
  return stored[key] || null;
}

function writeRequestJournal(requestKey, record, epoch) {
  const write = journalQueue.then(async () => {
    if (!chrome.storage.session || epoch !== sessionEpoch) return;
    const key = `${REQUEST_JOURNAL_PREFIX}${requestKey}`;
    // Only generated chat turns and their save IDs survive worker suspension.
    // Never journal screenshots, page context, diagnostics or session tokens.
    const { diagnostics: _diagnostics, ...response } = record.response;
    const entry = {
      response,
      ...(record.pending ? { pending: record.pending } : {}),
      updatedAt: Date.now(),
    };
    const stored = await chrome.storage.session.get(null);
    stored[key] = entry;
    let retainedBytes = 0;
    const expired = Object.keys(stored)
      .filter((entry) => entry.startsWith(REQUEST_JOURNAL_PREFIX))
      .sort((a, b) => (a === key ? -1 : b === key ? 1 : stored[b].updatedAt - stored[a].updatedAt))
      .filter((entry, index) => {
        // Three bytes per UTF-16 code unit safely overestimates UTF-8 JSON.
        retainedBytes += JSON.stringify(stored[entry]).length * 3;
        return index >= MAX_REQUEST_CACHE || retainedBytes > MAX_JOURNAL_BYTES;
      });
    if (expired.length) await chrome.storage.session.remove(expired);
    if (!expired.includes(key)) await chrome.storage.session.set({ [key]: entry });
  });
  // A storage quota failure must not discard an answer already produced.
  journalQueue = write.catch(() => undefined);
  return journalQueue;
}

async function clearRequestJournal() {
  await journalQueue;
  if (!chrome.storage.session) return;
  const stored = await chrome.storage.session.get(null);
  const keys = Object.keys(stored).filter((key) => key.startsWith(REQUEST_JOURNAL_PREFIX));
  if (keys.length) await chrome.storage.session.remove(keys);
}

class CompanionError extends Error {
  constructor(
    message,
    { code = "COMPANION_ERROR", phase = "runtime", retryAfterMs = 0, retryable } = {},
  ) {
    super(message);
    this.name = "CompanionError";
    this.code = code;
    this.phase = phase;
    this.retryAfterMs = retryAfterMs;
    this.retryable = retryable;
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

function isTrustedUniMatePage(sender) {
  try {
    const configuredOrigin = new URL(config.UNIMATE_API_URL).origin;
    const senderOrigin = new URL(String(sender.tab?.url || "")).origin;
    return configuredOrigin === senderOrigin;
  } catch {
    return false;
  }
}

function isTrustedSignInPage(sender) {
  return Boolean(
    chrome.runtime.id &&
    sender.id === chrome.runtime.id &&
    sender.url === chrome.runtime.getURL("signin.html") &&
    !(sender.frameId > 0),
  );
}

async function broadcastSessionChanged() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!Number.isInteger(tab.id) || !isInjectablePage(tab.url)) continue;
      // A page can navigate or close at any point. Don't wait for a content
      // script acknowledgement to finish authentication or local sign-out.
      chrome.tabs.sendMessage(tab.id, { type: "SESSION_CHANGED" }).catch(() => undefined);
    }
  } catch {
    // Existing panels also refresh authentication when opened again.
  }
}

async function readSession() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || null;
}

async function writeSession(session, epoch = sessionEpoch) {
  const write = sessionWriteQueue.then(async () => {
    if (epoch !== sessionEpoch) return;
    if (session) await chrome.storage.local.set({ [STORAGE_KEY]: session });
    else await chrome.storage.local.remove(STORAGE_KEY);
  });
  sessionWriteQueue = write.catch(() => undefined);
  await write;
}

function assertSessionEpoch(epoch) {
  if (epoch !== sessionEpoch) {
    throw new CompanionError("Your UniMate session changed. Please try again.", {
      code: "AUTH_REQUIRED",
      phase: "auth",
    });
  }
}

function privacyPolicyUrl() {
  try {
    const value = config.UNIMATE_API_URL;
    if (typeof value !== "string") return null;
    const url = new URL(value);
    // Configuration is extension-owned, never supplied by the current page.
    // Accept only a canonical origin: no credentials, path, query or fragment.
    if (value !== url.origin && value !== `${url.origin}/`) return null;
    const host = url.hostname;
    const development = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(host);
    const publicHttps =
      url.protocol === "https:" &&
      !url.port &&
      host.length <= 253 &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) &&
      !/(?:^|\.)(?:localhost|local|internal|invalid|test|example|home|lan|onion|arpa)$/.test(
        host,
      ) &&
      !/(?:^|\.)example\.(?:com|net|org)$/.test(host) &&
      !/your_|placeholder/i.test(host);
    if (!development && !publicHttps) return null;
    return `${url.origin}/privacy`;
  } catch {
    return null;
  }
}

async function privacyConsentState() {
  const result = await chrome.storage.local.get(PRIVACY_CONSENT_KEY);
  const record = result[PRIVACY_CONSENT_KEY];
  return {
    accepted: record?.accepted === true && record?.version === PRIVACY_CONSENT_VERSION,
    version: PRIVACY_CONSENT_VERSION,
    privacyPolicyUrl: privacyPolicyUrl(),
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
    if (
      ["AI_BILLING_UNAVAILABLE", "AI_CONFIGURATION_ERROR", "AI_NOT_CONFIGURED"].includes(body?.code)
    ) {
      throw new CompanionError(
        "AI help is temporarily unavailable while UniMate restores service.",
        {
          code: body.code,
          phase: "ai",
          retryable: false,
        },
      );
    }
    const authRequired = response.status === 401 || body?.code === "AUTH_REQUIRED";
    const proRequired =
      response.status === 402 || (response.status === 403 && body?.code === "PRO_REQUIRED");
    const retryMs = retryAfterMs(response);
    if (response.status === 429) {
      const wait =
        retryMs > 0 ? ` Try again in about ${Math.max(1, Math.ceil(retryMs / 1000))} seconds.` : "";
      throw new CompanionError(`UniMate is temporarily rate limited.${wait}`, {
        code: "AI_RATE_LIMITED",
        phase,
        retryAfterMs: retryMs,
        retryable: body?.retryable !== false,
      });
    }
    throw new CompanionError(
      body.error || body.message || `UniMate request failed (${response.status}).`,
      {
        code: authRequired
          ? "AUTH_REQUIRED"
          : proRequired
            ? "PRO_REQUIRED"
            : response.status >= 500
              ? "BACKEND_UNAVAILABLE"
              : "BACKEND_REQUEST_FAILED",
        phase: authRequired ? "auth" : proRequired ? "entitlement" : phase,
        retryable: body?.retryable === false ? false : undefined,
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
    const request = fetch(url, { ...options, signal: controller.signal }).then(async (response) => {
      // fetch resolves at headers. Keep the deadline active until the body is
      // received too, otherwise a stalled stream can leave the panel stuck.
      const body = await response.text();
      return new Response([204, 205, 304].includes(response.status) ? null : body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    });
    return await Promise.race([request, timeout]);
  } catch (error) {
    if (timedOut) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener?.("abort", forwardAbort);
  }
}

async function fetchBackendWithBoundedRetry(url, options, phase) {
  const epoch = sessionEpoch;
  const timeoutError = () =>
    new CompanionError("UniMate’s AI request timed out. Please try again.", {
      code: "AI_TIMEOUT",
      phase,
    });
  let response = await fetchWithTimeout(url, options, AI_TIMEOUT_MS, timeoutError());
  if (response.status !== 429) return response;
  const failure = await response
    .clone()
    .json()
    .catch(() => null);
  if (failure?.retryable === false) return response;
  const waitMs = retryAfterMs(response);
  // Retry only when the server explicitly asks for a short wait. Long or
  // missing retry windows are surfaced immediately instead of tying up the
  // MV3 service worker or multiplying requests under sustained rate limiting.
  if (!(waitMs > 0 && waitMs <= MAX_RATE_LIMIT_RETRY_MS)) return response;
  await delay(waitMs);
  assertSessionEpoch(epoch);
  await requirePrivacyConsent();
  assertSessionEpoch(epoch);
  response = await fetchWithTimeout(url, options, AI_TIMEOUT_MS, timeoutError());
  return response;
}

async function invalidateSession(epoch) {
  assertSessionEpoch(epoch);
  const invalidatedSessionEpoch = ++sessionEpoch;
  completedChatRequests.clear();
  pendingChatPersistence.clear();
  await writeSession(null, invalidatedSessionEpoch);
  await clearRequestJournal();
  assertSessionEpoch(invalidatedSessionEpoch);
  await broadcastSessionChanged();
  // Sign-in may continue after its own validation discovers expiration, but
  // only while this exact invalidation still owns the session generation.
  throw Object.assign(
    new CompanionError("Your UniMate session has ended. Sign in again to continue.", {
      code: "AUTH_REQUIRED",
      phase: "auth",
    }),
    { invalidatedSessionEpoch },
  );
}

async function refreshSession(session, epoch) {
  if (!session?.refresh_token) return invalidateSession(epoch);
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
  assertSessionEpoch(epoch);
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      return invalidateSession(epoch);
    }
    await parseResponse(response, "auth");
  }
  const next = await response.json();
  assertSessionEpoch(epoch);
  await writeSession(next, epoch);
  return next;
}

async function getValidSession() {
  const epoch = sessionEpoch;
  if (sessionValidationFlight?.epoch === epoch) return sessionValidationFlight.promise;
  const promise = validateSession(epoch);
  sessionValidationFlight = { epoch, promise };
  try {
    return await promise;
  } finally {
    if (sessionValidationFlight?.promise === promise) sessionValidationFlight = null;
  }
}

async function validateSession(epoch) {
  let session = await readSession();
  assertSessionEpoch(epoch);
  if (!session) return null;
  const expiresAtMs = Number(session.expires_at || 0) * 1000;
  if (!expiresAtMs || expiresAtMs < Date.now() + 60000)
    session = await refreshSession(session, epoch);
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
  assertSessionEpoch(epoch);
  if (response.status === 401) {
    session = await refreshSession(session, epoch);
    if (!session) return null;
    const retried = await fetchWithTimeout(
      `${config.SUPABASE_URL}/auth/v1/user`,
      { headers: jsonHeaders(session.access_token) },
      AUTH_TIMEOUT_MS,
      authTimeout(),
    );
    assertSessionEpoch(epoch);
    if (!retried.ok) {
      if (retried.status === 401) {
        return invalidateSession(epoch);
      }
      await parseResponse(retried, "auth");
    }
    session.user = await retried.json();
    await writeSession(session, epoch);
  } else if (response.ok) {
    session.user = await response.json();
    await writeSession(session, epoch);
  } else {
    // Keep auth outages and Retry-After typed on the initial request too;
    // only a definitive rejection should send the student back to sign-in.
    await parseResponse(response, "auth");
  }
  assertSessionEpoch(epoch);
  return session;
}

async function getProfile(session) {
  const response = await fetchWithTimeout(
    `${config.UNIMATE_API_URL.replace(/\/$/, "")}/api/billing-status?reconcile=false`,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
    },
    ENTITLEMENT_TIMEOUT_MS,
    new CompanionError("UniMate Pro verification timed out.", {
      code: "ENTITLEMENT_TIMEOUT",
      phase: "entitlement",
    }),
  );
  const billing = await parseResponse(response, "entitlement");
  return { isPro: billing.isPro === true };
}

async function authState() {
  const epoch = sessionEpoch;
  if (!configured()) {
    return {
      configured: false,
      authenticated: false,
      isPro: false,
      debug: Boolean(config.COMPANION_DEBUG),
    };
  }
  const session = await getValidSession();
  assertSessionEpoch(epoch);
  if (!session) {
    return {
      configured: true,
      authenticated: false,
      isPro: false,
      debug: Boolean(config.COMPANION_DEBUG),
    };
  }
  const profile = await getProfile(session);
  assertSessionEpoch(epoch);
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
  let epoch = sessionEpoch;
  let existingSession;
  try {
    existingSession = await getValidSession();
  } catch (error) {
    if (error?.invalidatedSessionEpoch !== sessionEpoch) throw error;
    epoch = sessionEpoch;
  }
  assertSessionEpoch(epoch);
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
  assertSessionEpoch(epoch);
  // Only one concurrent sign-in may establish an account.
  sessionEpoch += 1;
  await writeSession(session);
  await broadcastSessionChanged();
  return authState();
}

async function signOut() {
  const epoch = ++sessionEpoch;
  const session = await readSession();
  await writeSession(null, epoch);
  completedChatRequests.clear();
  pendingChatPersistence.clear();
  await broadcastSessionChanged();
  await clearRequestJournal();
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
  return {
    configured: configured(),
    authenticated: false,
    isPro: false,
    debug: Boolean(config.COMPANION_DEBUG),
  };
}

async function requireProSession() {
  const epoch = sessionEpoch;
  const session = await getValidSession();
  assertSessionEpoch(epoch);
  if (!session) {
    throw new CompanionError("Please sign in with your UniMate account.", {
      code: "AUTH_REQUIRED",
      phase: "auth",
    });
  }
  const profile = await getProfile(session);
  assertSessionEpoch(epoch);
  if (!profile.isPro) {
    throw new CompanionError("UniMate Companion requires an active Pro profile.", {
      code: "PRO_REQUIRED",
      phase: "entitlement",
    });
  }
  return session;
}

async function ensureActiveConversation(session, epoch = sessionEpoch) {
  assertSessionEpoch(epoch);
  const key = `${epoch}:${session.user.id}`;
  if (conversationFlights.has(key)) return conversationFlights.get(key);
  const flight = resolveActiveConversation(session, epoch);
  conversationFlights.set(key, flight);
  try {
    return await flight;
  } finally {
    conversationFlights.delete(key);
  }
}

async function resolveActiveConversation(session, epoch) {
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
  assertSessionEpoch(epoch);
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
  assertSessionEpoch(epoch);
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
    assertSessionEpoch(epoch);
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
  assertSessionEpoch(epoch);
  return conversationId;
}

async function saveExchange(session, conversationId, userMessage, assistantMessage, rowIds) {
  const userCreatedAt = new Date();
  const assistantCreatedAt = new Date(userCreatedAt.getTime() + 1);
  const response = await fetchWithTimeout(
    `${config.SUPABASE_URL}/rest/v1/companion_chats?on_conflict=id`,
    {
      method: "POST",
      headers: {
        ...jsonHeaders(session.access_token),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          id: rowIds.user,
          user_id: session.user.id,
          conversation_id: conversationId,
          message: userMessage,
          role: "user",
          created_at: userCreatedAt.toISOString(),
        },
        {
          id: rowIds.assistant,
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
  let rows = await parseResponse(response, "persistence");
  if (Array.isArray(rows) && rows.length < 2) {
    // A timed-out POST may already have committed. Reuse the same primary
    // keys and read the existing pair instead of inserting duplicate turns.
    const existing = await fetchWithTimeout(
      `${config.SUPABASE_URL}/rest/v1/companion_chats?id=in.(${rowIds.user},${rowIds.assistant})&user_id=eq.${encodeURIComponent(session.user.id)}&conversation_id=eq.${encodeURIComponent(conversationId)}&select=*`,
      { headers: jsonHeaders(session.access_token) },
      PERSISTENCE_TIMEOUT_MS,
      new CompanionError("Confirming the saved chat timed out.", {
        code: "PERSISTENCE_TIMEOUT",
        phase: "persistence",
      }),
    );
    rows = await parseResponse(existing, "persistence");
  }
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

async function loadMessages(session, requestedConversationId, epoch = sessionEpoch) {
  assertSessionEpoch(epoch);
  const conversationId =
    requestedConversationId || (await ensureActiveConversation(session, epoch));
  assertSessionEpoch(epoch);
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
  assertSessionEpoch(epoch);
  return rows.reverse();
}

async function loadChatState(session, epoch = sessionEpoch) {
  assertSessionEpoch(epoch);
  const conversationId = await ensureActiveConversation(session, epoch);
  assertSessionEpoch(epoch);
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
    loadMessages(session, conversationId, epoch),
  ]);
  const conversations = await parseResponse(conversationResponse, "persistence");
  assertSessionEpoch(epoch);
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
  let pageUrl = "";
  try {
    const url = new URL(sender.tab?.url || context.pageUrl || "");
    if (/^https?:$/.test(url.protocol)) {
      // Login callbacks, signed resources and searches often put secrets or
      // personal information in the query or fragment.
      pageUrl = `${url.origin}${url.pathname}`;
    }
  } catch {
    // Invalid and local-file URLs provide no useful public provenance.
  }
  return {
    ...context,
    pageUrl,
    pageTitle: sender.tab?.title || context.pageTitle || "",
  };
}

async function callTextChat(session, message, pageContext, history, requestId) {
  const epoch = sessionEpoch;
  await requirePrivacyConsent();
  assertSessionEpoch(epoch);
  const response = await fetchBackendWithBoundedRetry(
    `${config.UNIMATE_API_URL.replace(/\/$/, "")}/api/dashboard-ai`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        "X-UniMate-Request-Id": requestId,
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

async function callScreenshotChat(session, message, pageContext, imageDataUrl, history, requestId) {
  const epoch = sessionEpoch;
  await requirePrivacyConsent();
  assertSessionEpoch(epoch);
  const response = await fetchBackendWithBoundedRetry(
    `${config.UNIMATE_API_URL.replace(/\/$/, "")}/api/analyze-screenshot`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        "X-UniMate-Request-Id": requestId,
      },
      // The backend builds the grounded prompt from these labelled fields. We
      // send the student's raw question plus structured page provenance — no
      // free-text bundling that the model could mistake for source material.
      body: JSON.stringify({
        imageBase64: imageDataUrl,
        question: normalizedStudentMessage(message),
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
  const epoch = sessionEpoch;
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
  const key = sender.tab?.windowId;
  const previous = captureFlights.get(key) || Promise.resolve();
  const capture = captureStep(() => previous.catch(() => undefined), deadline, epoch).then(() => {
    assertSessionEpoch(epoch);
    return captureSenderTab(sender, epoch, deadline);
  });
  captureFlights.set(key, capture);
  try {
    return await capture;
  } finally {
    if (captureFlights.get(key) === capture) captureFlights.delete(key);
  }
}

function assertCaptureCurrent(deadline, epoch) {
  assertSessionEpoch(epoch);
  if (Date.now() >= deadline) {
    throw new CompanionError("Screen capture timed out. Keep this page active and retry.", {
      code: "CAPTURE_TIMEOUT",
      phase: "capture",
    });
  }
}

async function captureStep(operation, deadline, epoch) {
  assertCaptureCurrent(deadline, epoch);
  let timer;
  try {
    const expired = new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new CompanionError("Screen capture timed out. Keep this page active and retry.", {
              code: "CAPTURE_TIMEOUT",
              phase: "capture",
            }),
          ),
        Math.max(0, deadline - Date.now()),
      );
    });
    const result = await Promise.race([Promise.resolve().then(operation), expired]);
    // Native capture is not cancellable. A late result must never reach AI,
    // even after the independent content-side hiding lease has restored UI.
    assertCaptureCurrent(deadline, epoch);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function captureSenderTab(sender, epoch, deadline) {
  const windowId = sender.tab?.windowId;
  const tabId = sender.tab?.id;
  const tabUrl = String(sender.tab?.url || "");
  const documentId = sender.documentId;
  if (!Number.isInteger(windowId) || !Number.isInteger(tabId)) {
    throw new CompanionError("Could not identify the active page to capture.", {
      code: "CAPTURE_TAB_UNAVAILABLE",
      phase: "capture",
    });
  }
  if (typeof documentId !== "string" || !documentId || (sender.frameId || 0) !== 0) {
    throw new CompanionError("Could not identify the page document. Refresh this page and retry.", {
      code: "CAPTURE_DOCUMENT_UNAVAILABLE",
      phase: "capture",
    });
  }
  if (tabUrl && !/^(https?|file):/i.test(tabUrl)) {
    throw new CompanionError(
      "Your browser does not allow screen capture on this restricted page.",
      {
        code: "CAPTURE_RESTRICTED_PAGE",
        phase: "capture",
      },
    );
  }
  if (typeof chrome.tabs?.captureVisibleTab !== "function") {
    throw new CompanionError("Screen capture is unavailable in this extension runtime.", {
      code: "CAPTURE_API_UNAVAILABLE",
      phase: "capture",
    });
  }
  const assertStillActive = async () => {
    const [activeTab] = await captureStep(
      () => chrome.tabs.query({ active: true, windowId }),
      deadline,
      epoch,
    );
    if (activeTab?.id !== tabId) {
      throw new CompanionError("The active tab changed before capture. Return to it and retry.", {
        code: "CAPTURE_TAB_CHANGED",
        phase: "capture",
      });
    }
    if (tabUrl && activeTab.url && activeTab.url !== tabUrl) {
      throw new CompanionError(
        "This page changed before capture. Please retry on the current page.",
        {
          code: "CAPTURE_TAB_CHANGED",
          phase: "capture",
        },
      );
    }
    let documents;
    try {
      // Chrome 106+ reports the browser-owned document ID for the active main
      // frame. URL equality alone cannot distinguish a same-URL reload.
      documents = await captureStep(
        () =>
          chrome.scripting.executeScript({
            target: { tabId, frameIds: [0] },
            func: () => true,
            injectImmediately: true,
          }),
        deadline,
        epoch,
      );
    } catch (error) {
      if (error instanceof CompanionError) throw error;
      throw new CompanionError("The page document is no longer available. Refresh and retry.", {
        code: "CAPTURE_TAB_CHANGED",
        phase: "capture",
      });
    }
    if (documents?.[0]?.documentId !== documentId || documents?.[0]?.frameId !== 0) {
      throw new CompanionError(
        "This page changed before capture. Please retry on the current page.",
        {
          code: "CAPTURE_TAB_CHANGED",
          phase: "capture",
        },
      );
    }
  };

  const captureId = crypto.randomUUID();
  let captureUiPrepareAttempted = false;
  let image;
  try {
    await assertStillActive();
    let prepareResponse;
    try {
      // From this point forward restoration is mandatory. The content script
      // may have hidden the host even if Chrome drops the response channel.
      captureUiPrepareAttempted = true;
      prepareResponse = await captureStep(
        () =>
          chrome.tabs.sendMessage(
            tabId,
            {
              type: "PREPARE_COMPANION_CAPTURE",
              captureId,
              expiresAt: deadline,
            },
            { documentId },
          ),
        deadline,
        epoch,
      );
    } catch (error) {
      if (error instanceof CompanionError) throw error;
      throw new CompanionError("UniMate could not safely hide its interface before capture.", {
        code: "CAPTURE_UI_HIDE_FAILED",
        phase: "capture",
      });
    }
    if (
      !prepareResponse?.ok ||
      prepareResponse.hidden !== true ||
      prepareResponse.captureId !== captureId
    ) {
      throw new CompanionError(
        prepareResponse?.error || "UniMate could not safely hide its interface before capture.",
        { code: "CAPTURE_UI_HIDE_FAILED", phase: "capture" },
      );
    }
    await assertStillActive();
    await captureStep(requirePrivacyConsent, deadline, epoch);
    assertSessionEpoch(epoch);
    image = await captureStep(
      () => chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 65 }),
      deadline,
      epoch,
    );
    await assertStillActive();
    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      throw new Error("The browser returned an invalid capture.");
    }
    if (image.length > 2_400_000) {
      await assertStillActive();
      await captureStep(requirePrivacyConsent, deadline, epoch);
      assertSessionEpoch(epoch);
      image = await captureStep(
        () => chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 35 }),
        deadline,
        epoch,
      );
      await assertStillActive();
      if (typeof image !== "string" || !image.startsWith("data:image/")) {
        throw new Error("The browser returned an invalid capture.");
      }
    }
    if (image.length > 2_500_000) {
      throw new CompanionError(
        "This viewport is too large to analyze. Reduce zoom or window size and retry.",
        { code: "CAPTURE_TOO_LARGE", phase: "capture" },
      );
    }
  } catch (error) {
    if (error instanceof CompanionError) throw error;
    const permissionDenied = isRestrictedPageError(error);
    throw new CompanionError(
      permissionDenied
        ? "Your browser denied screen capture on this page."
        : "Your browser could not capture the visible tab. Keep this tab active and retry.",
      {
        code: permissionDenied ? "CAPTURE_PERMISSION_DENIED" : "CAPTURE_FAILED",
        phase: "capture",
      },
    );
  } finally {
    if (captureUiPrepareAttempted) {
      try {
        const restored = chrome.tabs
          .sendMessage(
            tabId,
            {
              type: "RESTORE_COMPANION_CAPTURE",
              captureId,
            },
            { documentId },
          )
          .catch(() => undefined);
        if (Date.now() < deadline) await captureStep(() => restored, deadline, epoch);
      } catch (error) {
        // A timer may fire just before Date.now reaches its wall-clock
        // deadline. Once the deadline race rejects, never admit its pixels
        // merely because the final clock check still reads one tick early.
        if (error?.code === "CAPTURE_TIMEOUT") throw error;
        // A scoped lease watchdog restores the host even if the worker dies
        // or the restore channel is lost. Never dispose a newer UI instance.
      }
    }
  }
  assertCaptureCurrent(deadline, epoch);
  return image;
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

async function executeChat(payload, sender, session, requestId, requestKey, epoch) {
  const journal = await readRequestJournal(requestKey);
  await requirePrivacyConsent();
  assertSessionEpoch(epoch);
  if (journal?.response) {
    completedChatRequests.set(requestKey, journal.response);
    if (journal.pending) pendingChatPersistence.set(requestKey, journal.pending);
    return journal.response;
  }
  const conversationId = await ensureActiveConversation(session, epoch);
  assertSessionEpoch(epoch);
  const history =
    payload.conversationId && payload.conversationId !== conversationId
      ? []
      : Array.isArray(payload.history)
        ? payload.history
        : [];
  const pageContext = sanitizePageContext(payload.context, sender);
  let answer;
  let pipelineDiagnostics = null;
  let contextMode = "screenshot";
  try {
    try {
      const image = await captureActiveTab(sender);
      assertSessionEpoch(epoch);
      const result = await callScreenshotChat(
        session,
        payload.message,
        pageContext,
        image,
        history,
        requestId,
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
        error?.code === "CAPTURE_TAB_CHANGED" ||
        error?.code === "CAPTURE_DOCUMENT_UNAVAILABLE" ||
        error?.code === "CAPTURE_TIMEOUT" ||
        !(pageContext.visiblePageText || pageContext.highlightedText)
      ) {
        throw error;
      }
      assertSessionEpoch(epoch);
      const result = await callTextChat(session, payload.message, pageContext, history, requestId);
      answer = result.answer;
      pipelineDiagnostics = result.pipelineDiagnostics;
      contextMode = "text-fallback";
    }
  } catch (error) {
    // Persistence begins only after accepted AI work completes, so capture or
    // model failures cannot leave an orphaned user row.
    throw error;
  }
  assertSessionEpoch(epoch);
  await requirePrivacyConsent();
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
  const pending = {
    conversationId,
    userMessage: payload.message,
    assistantMessage: answer,
    rowIds: { user: crypto.randomUUID(), assistant: crypto.randomUUID() },
  };
  const unsavedResponse = {
    user: userRow,
    assistant: assistantRow,
    contextMode,
    requestId,
    conversationId,
    persistenceWarning: "Your answer is ready. Retry saving it to sync chat history.",
  };
  // Journal before the POST: a worker restart or a lost response can recover
  // the answer and retry the exact same rows without repeating paid AI work.
  await writeRequestJournal(requestKey, { response: unsavedResponse, pending }, epoch);
  assertSessionEpoch(epoch);
  await requirePrivacyConsent();
  assertSessionEpoch(epoch);
  try {
    const saved = await saveExchange(
      session,
      conversationId,
      payload.message,
      answer,
      pending.rowIds,
    );
    userRow = saved.user;
    assistantRow = saved.assistant;
  } catch {
    persistenceWarning =
      "Your answer is ready, but UniMate could not save this exchange to chat history. You can retry saving from this session.";
    assertSessionEpoch(epoch);
    pendingChatPersistence.set(requestKey, pending);
    if (pendingChatPersistence.size > MAX_PENDING_PERSISTENCE) {
      pendingChatPersistence.delete(pendingChatPersistence.keys().next().value);
    }
  }
  const diagnostics = {
    activeTabUrl: pageContext.pageUrl || "",
    extractedBlockCount:
      pageContext.metrics?.extractedBlockCount || pageContext.blocks?.length || 0,
    selectedTextLength: String(pageContext.highlightedText || "").length,
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
  assertSessionEpoch(epoch);
  await writeRequestJournal(
    requestKey,
    { response, ...(persistenceWarning ? { pending } : {}) },
    epoch,
  );
  assertSessionEpoch(epoch);
  await requirePrivacyConsent();
  assertSessionEpoch(epoch);
  completedChatRequests.set(requestKey, response);
  if (completedChatRequests.size > MAX_REQUEST_CACHE) {
    completedChatRequests.delete(completedChatRequests.keys().next().value);
  }
  return response;
}

async function sendChat(payload, sender) {
  const epoch = sessionEpoch;
  const message = normalizedStudentMessage(payload.message);
  if (!message) throw new CompanionError("Enter a message first.", { code: "EMPTY_MESSAGE" });
  payload = { ...payload, message };
  await requirePrivacyConsent();
  const session = await requireProSession();
  await requirePrivacyConsent();
  assertSessionEpoch(epoch);
  const requestId =
    typeof payload.requestId === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(payload.requestId)
      ? payload.requestId
      : crypto.randomUUID();
  const requestKey = `${session.user.id}:${requestId}`;
  if (completedChatRequests.has(requestKey)) return completedChatRequests.get(requestKey);
  if (inFlightChatRequests.has(requestKey)) return inFlightChatRequests.get(requestKey);

  const request = executeChat(payload, sender, session, requestId, requestKey, epoch);
  inFlightChatRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    inFlightChatRequests.delete(requestKey);
  }
}

async function recoverChatRequest(requestId) {
  const epoch = sessionEpoch;
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) {
    throw new CompanionError("The original request could not be identified.", {
      code: "INVALID_REQUEST_ID",
      phase: "recovery",
    });
  }
  await requirePrivacyConsent();
  const session = await requireProSession();
  await requirePrivacyConsent();
  assertSessionEpoch(epoch);
  const key = `${session.user.id}:${requestId}`;
  if (completedChatRequests.has(key))
    return { status: "complete", response: completedChatRequests.get(key) };
  // Recovery never starts or joins paid work. Report pending immediately so
  // a lost transport can be retried explicitly with its original request ID.
  if (inFlightChatRequests.has(key)) return { status: "pending" };
  const journal = await readRequestJournal(key);
  await requirePrivacyConsent();
  assertSessionEpoch(epoch);
  const response = completedChatRequests.get(key) || journal?.response;
  if (response) return { status: "complete", response };
  return { status: inFlightChatRequests.has(key) ? "pending" : "not_found" };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const run = async () => {
    switch (request?.type) {
      case "AUTH_STATE":
        return authState();
      case "OPEN_UPGRADE": {
        if (!configured()) throw new Error("UniMate setup is not ready yet.");
        await chrome.tabs.create({ url: new URL("/upgrade", config.UNIMATE_API_URL).href });
        return { opened: true };
      }
      case "OPEN_ACCOUNT_HELP": {
        if (!configured()) throw new Error("UniMate setup is not ready yet.");
        await chrome.tabs.create({ url: new URL("/signin", config.UNIMATE_API_URL).href });
        return { opened: true };
      }
      case "PRIVACY_CONSENT_STATE":
        return privacyConsentState();
      case "SET_PRIVACY_CONSENT":
        return setPrivacyConsent(request.accepted === true);
      case "OPEN_SIGN_IN": {
        await chrome.windows.create({
          url: chrome.runtime.getURL("signin.html"),
          type: "popup",
          width: 440,
          height: 640,
        });
        return { opened: true };
      }
      case "SIGN_IN":
        if (!isTrustedSignInPage(sender)) {
          throw new CompanionError(
            "Open UniMate’s secure sign-in window to connect your account.",
            {
              code: "UNTRUSTED_SIGN_IN_PAGE",
              phase: "auth",
            },
          );
        }
        return signIn(String(request.email || ""), String(request.password || ""));
      case "SIGN_OUT":
        return signOut();
      case "WEBSITE_SIGN_OUT":
        if (!isTrustedUniMatePage(sender)) {
          throw new CompanionError("This page cannot control the UniMate session.", {
            code: "UNTRUSTED_WEBSITE",
            phase: "auth",
          });
        }
        return signOut();
      case "WEBSITE_ORIGIN_CHECK":
        return { trusted: isTrustedUniMatePage(sender) };
      case "LOAD_MESSAGES": {
        const epoch = sessionEpoch;
        const session = await requireProSession();
        assertSessionEpoch(epoch);
        return loadMessages(session, undefined, epoch);
      }
      case "LOAD_CHAT_STATE": {
        const epoch = sessionEpoch;
        const session = await requireProSession();
        assertSessionEpoch(epoch);
        return loadChatState(session, epoch);
      }
      case "RUNTIME_DIAGNOSTICS":
        return runtimeDiagnostics(sender);
      case "SEND_CHAT":
        return sendChat(request, sender);
      case "RECOVER_CHAT_REQUEST":
        return recoverChatRequest(request.requestId);
      case "RETRY_CHAT_PERSISTENCE": {
        const epoch = sessionEpoch;
        await requirePrivacyConsent();
        const session = await requireProSession();
        await requirePrivacyConsent();
        assertSessionEpoch(epoch);
        const requestId = String(request.requestId || "");
        const requestKey = `${session.user.id}:${requestId}`;
        const journal = await readRequestJournal(requestKey);
        await requirePrivacyConsent();
        assertSessionEpoch(epoch);
        const pending = pendingChatPersistence.get(requestKey) || journal?.pending;
        if (journal?.response && !completedChatRequests.has(requestKey)) {
          completedChatRequests.set(requestKey, journal.response);
        }
        if (!pending) {
          const completed = completedChatRequests.get(requestKey);
          if (completed && !completed.persistenceWarning)
            return { saved: true, alreadyComplete: true };
          throw new CompanionError(
            "This unsaved answer is no longer available to sync. Copy the answer from this panel to keep it.",
            { code: "PERSISTENCE_EXPIRED", phase: "persistence" },
          );
        }
        const saved = await saveExchange(
          session,
          pending.conversationId,
          pending.userMessage,
          pending.assistantMessage,
          pending.rowIds,
        );
        await requirePrivacyConsent();
        assertSessionEpoch(epoch);
        pendingChatPersistence.delete(requestKey);
        const completed = completedChatRequests.get(requestKey);
        if (completed) {
          delete completed.persistenceWarning;
          completed.user = saved.user;
          completed.assistant = saved.assistant;
          await writeRequestJournal(requestKey, { response: completed }, epoch);
        }
        await requirePrivacyConsent();
        assertSessionEpoch(epoch);
        return { saved: true, ...saved };
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
        retryable: companionError.retryable,
      });
    });
  return true;
});

function isInjectablePage(url) {
  return /^(https?|file):/i.test(String(url || ""));
}

function isRestrictedPageError(error) {
  // Error classification only: this never broadens the injection allowlist.
  return /(?:^|[\s"'(<])(?:chrome(?:-extension)?|edge(?:-extension)?|brave|opera|about|moz-extension|safari-web-extension):|web store|edge add-ons|opera addons|extensions gallery|permission|not allowed|cannot access|restricted/i.test(
    String(error?.message || ""),
  );
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

function compatibleContentResponse(response, nonce) {
  return (
    response?.ok === true &&
    (!nonce || response.nonce === nonce) &&
    response.protocolVersion === CONTENT_PROTOCOL_VERSION &&
    response.extensionVersion === chrome.runtime.getManifest().version
  );
}

async function hasCompatibleContentScript(tab) {
  const nonce = crypto.randomUUID();
  let timer;
  try {
    const response = await Promise.race([
      chrome.tabs.sendMessage(tab.id, { type: "COMPANION_PING", nonce }),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), 500);
      }),
    ]);
    return compatibleContentResponse(response, nonce);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function recoverContentScript(tab, { preserveCompatible = false } = {}) {
  if (!Number.isInteger(tab.id) || !isInjectablePage(tab.url)) {
    throw new CompanionError("UniMate cannot run on this browser-restricted page.", {
      code: "CONTENT_SCRIPT_RESTRICTED_PAGE",
      phase: "injection",
    });
  }

  if (preserveCompatible && (await hasCompatibleContentScript(tab))) return;
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
      ...(preserveCompatible
        ? {
            preserveIfCompatible: {
              protocolVersion: CONTENT_PROTOCOL_VERSION,
              extensionVersion: chrome.runtime.getManifest().version,
            },
          }
        : {}),
    });
    if (preserveCompatible && response?.preserved && compatibleContentResponse(response)) return;
    if (!response?.ok) throw new Error("Disposal was not confirmed.");
  } catch {
    if (preserveCompatible && (await hasCompatibleContentScript(tab))) return;
    // Install recovery leaves cleanup to content.js's synchronous generation
    // guard. A compatible instance can mount after the last failed PING;
    // deleting its host here would reintroduce a check/use race. Explicit
    // toolbar recovery still force-disposes a stale, unresponsive instance.
    if (!preserveCompatible) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          globalThis.__unimateCompanionPrivateDispose?.();
          document.getElementById("unimate-companion-host")?.remove();
        },
      });
    }
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
  // need to refresh every tab. Failures are expected for browser-protected pages.
  chrome.tabs
    .query({})
    .then((tabs) =>
      Promise.allSettled(
        tabs
          .filter((tab) => Number.isInteger(tab.id) && isInjectablePage(tab.url))
          .map((tab) => recoverContentScript(tab, { preserveCompatible: true })),
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
      const restricted = !isInjectablePage(tab.url) || isRestrictedPageError(error);
      await showActionFailure(
        tab,
        restricted
          ? "UniMate cannot access this browser-restricted page. Open a regular web page."
          : "UniMate could not reconnect to this tab. Reload the extension or refresh the page.",
      );
    }
  }
});
