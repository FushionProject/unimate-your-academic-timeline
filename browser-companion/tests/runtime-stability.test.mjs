import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const backgroundSource = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const contentSource = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function createHarness() {
  const session = {
    access_token: "access",
    refresh_token: "refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "student@example.test" },
  };
  const listeners = { runtime: null, action: null, installed: null };
  const state = {
    activeByWindow: new Map([
      [1, 11],
      [2, 22],
    ]),
    captures: [],
    sent: [],
    injected: [],
    failSendByTab: new Map(),
    dropPrepareAcknowledgement: false,
    captureError: null,
    captureUiHidden: false,
    visionResponses: [],
    requests: [],
  };
  const chrome = {
    storage: {
      local: {
        async get(key) {
          if (key === "unimateCompanionPrivacyConsent") {
            return { unimateCompanionPrivacyConsent: { accepted: true, version: 1 } };
          }
          return { unimateCompanionSession: session };
        },
        async set() {},
        async remove() {},
      },
    },
    tabs: {
      async query({ windowId } = {}) {
        if (windowId === undefined) {
          return [
            { id: 11, windowId: 1, url: "https://article.example/" },
            { id: 22, windowId: 2, url: "https://quiz.example/" },
            { id: 33, windowId: 1, url: "chrome://extensions/" },
          ];
        }
        const id = state.activeByWindow.get(windowId);
        return id ? [{ id, windowId }] : [];
      },
      async captureVisibleTab(windowId, options) {
        state.captures.push({ windowId, options, uiHidden: state.captureUiHidden });
        if (state.captureError) throw state.captureError;
        return `data:image/jpeg;base64,WINDOW_${windowId}`;
      },
      async sendMessage(tabId, request) {
        state.sent.push({ tabId, request });
        const failure = state.failSendByTab.get(tabId);
        if (failure) {
          state.failSendByTab.delete(tabId);
          throw failure;
        }
        if (request?.type === "PREPARE_COMPANION_CAPTURE") {
          state.captureUiHidden = true;
          if (state.dropPrepareAcknowledgement) {
            throw new Error("The message port closed before a response was received.");
          }
          return { ok: true, hidden: true };
        }
        if (request?.type === "RESTORE_COMPANION_CAPTURE") {
          state.captureUiHidden = false;
          return { ok: true, restored: true };
        }
        if (request?.type === "COMPANION_PING") {
          return { ok: true, nonce: request.nonce };
        }
        return { ok: true };
      },
    },
    scripting: {
      async executeScript(details) {
        state.injected.push(details);
        return [{ result: true }];
      },
    },
    runtime: {
      getManifest() {
        return manifest;
      },
      onMessage: {
        addListener(listener) {
          listeners.runtime = listener;
        },
      },
      onInstalled: {
        addListener(listener) {
          listeners.installed = listener;
        },
      },
    },
    permissions: {
      async contains(request) {
        return request?.origins?.includes("<all_urls>") || false;
      },
    },
    action: {
      onClicked: {
        addListener(listener) {
          listeners.action = listener;
        },
      },
      async setBadgeBackgroundColor() {},
      async setBadgeText() {},
      async setTitle() {},
    },
  };
  const context = vm.createContext({
    URL,
    Response,
    crypto,
    console: { log() {}, error() {}, warn() {} },
    importScripts() {},
    setTimeout,
    clearTimeout,
    AbortController,
    self: {
      UNIMATE_COMPANION_CONFIG: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "publishable",
        UNIMATE_API_URL: "https://unimate.example",
        COMPANION_DEBUG: true,
      },
    },
    chrome,
    fetch: async (url, options = {}) => {
      const href = String(url);
      state.requests.push({ href, options });
      if (href.endsWith("/auth/v1/user")) return json(session.user);
      if (href.includes("/api/billing-status")) return json({ isPro: true });
      if (href.includes("/rest/v1/companion_preferences")) {
        return options.method === "POST"
          ? json({}, 201)
          : json([{ active_conversation_id: "10000000-0000-0000-0000-000000000001" }]);
      }
      if (href.includes("/rest/v1/companion_conversations")) {
        return json([{ id: "10000000-0000-0000-0000-000000000001" }]);
      }
      if (href.includes("/rest/v1/companion_chats")) {
        const body = options.body ? JSON.parse(options.body) : {};
        const rows = Array.isArray(body) ? body : [body];
        return json(
          rows.map((row) => ({
            id: crypto.randomUUID(),
            ...row,
            created_at: row.created_at || new Date().toISOString(),
          })),
        );
      }
      if (href.endsWith("/api/analyze-screenshot")) {
        return (
          state.visionResponses.shift() ||
          json({
            answer: "screen answer",
          })
        );
      }
      if (href.endsWith("/api/dashboard-ai")) return json({ answer: "text answer" });
      throw new Error(`Unexpected request: ${href}`);
    },
  });
  vm.runInContext(
    `${backgroundSource}\nglobalThis.__runtimeExports = { captureActiveTab, sendChat, fetchWithTimeout, CompanionError };`,
    context,
  );
  return { context, listeners, state };
}

async function dispatch(listener, request, sender) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const keepPortOpen = listener(request, sender, (response) => {
      settled = true;
      resolve(response);
    });
    assert.equal(keepPortOpen, true, "async runtime listener must keep the message port open");
    setTimeout(() => {
      if (!settled) reject(new Error(`No response for ${request?.type}`));
    }, 100);
  });
}

// Manifest and injection contract.
assert.equal(manifest.manifest_version, 3);
assert.ok(
  manifest.content_scripts?.some(
    (entry) =>
      entry.run_at === "document_start" &&
      entry.js?.includes("context-extractor.js") &&
      entry.js?.includes("content.js"),
  ),
  "the extractor and UI must be declaratively injected at document_start",
);
assert.ok(
  manifest.host_permissions?.includes("<all_urls>"),
  "persistent all-site injection and capture require the declared all-URL host permission",
);
assert.ok(
  manifest.permissions?.includes("scripting"),
  "toolbar recovery on tabs opened before an extension reload requires scripting permission",
);

// Content messaging must never dereference an absent/invalidated runtime.
assert.match(contentSource, /function extensionRuntime\s*\(/);
assert.match(contentSource, /runtimeUnavailableError/);
assert.doesNotMatch(
  contentSource,
  /chrome\.runtime\.sendMessage\s*\(/,
  "content requests must go through the guarded runtime adapter",
);
assert.doesNotMatch(contentSource, /Connection diagnostics/);
assert.doesNotMatch(contentSource, /class="um-debug"/);
assert.doesNotMatch(
  contentSource,
  /unimate-companion:dispose/,
  "page-accessible lifecycle events must not control the extension",
);
assert.doesNotMatch(contentSource, /document\.(?:addEventListener|dispatchEvent).*companion/i);
assert.match(contentSource, /PREPARE_COMPANION_CAPTURE/);
assert.match(contentSource, /requestAnimationFrame\(\(\) => requestAnimationFrame/);
assert.match(contentSource, /DISPOSE_COMPANION_INSTANCE/);
assert.match(contentSource, /__unimateCompanionPrivateDispose/);
assert.match(contentSource, /location\.href === currentPageUrl/);
assert.match(contentSource, /state\.conversationStartIndex = state\.messages\.length/);
assert.match(contentSource, /refreshMessagesOnOpen/);
assert.match(contentSource, /type: "LOAD_MESSAGES"/);
assert.match(contentSource, /addEventListener\("popstate", updatePageBoundary\)/);
assert.match(contentSource, /mountObserver\.disconnect\(\)/);
assert.match(contentSource, /error\.code = response\?\.errorCode/);
assert.match(contentSource, /error\.phase = response\?\.errorPhase/);
assert.match(backgroundSource, /async function saveExchange/);
assert.doesNotMatch(
  backgroundSource,
  /async function saveMessage/,
  "a successful answer must persist its user and assistant rows atomically",
);

// Background message contract and screenshot capture isolation across tabs/windows.
{
  const { listeners, state } = createHarness();
  assert.equal(
    typeof listeners.runtime,
    "function",
    "background runtime listener was not registered",
  );
  for (const [tabId, windowId] of [
    [11, 1],
    [22, 2],
    [11, 1],
    [22, 2],
    [11, 1],
  ]) {
    const response = await dispatch(
      listeners.runtime,
      {
        type: "SEND_CHAT",
        message: `Analyze tab ${tabId}`,
        context: { visiblePageText: "short visual page", pageUrl: "https://spoofed.invalid" },
        useScreenshot: true,
        screenshotReason: "manual",
        history: [],
      },
      { tab: { id: tabId, windowId, url: `https://tab-${tabId}.example/`, title: `Tab ${tabId}` } },
    );
    assert.equal(response.ok, true);
    assert.equal(response.data.contextMode, "text+screenshot");
  }
  assert.deepEqual(
    state.captures.map(({ windowId }) => windowId),
    [1, 2, 1, 2, 1],
    "captures must remain bound to the sender's window across repeated tab use",
  );
  const visionRequests = state.requests.filter(({ href }) =>
    href.endsWith("/api/analyze-screenshot"),
  );
  assert.deepEqual(
    visionRequests.map(({ options }) => JSON.parse(options.body).pageContext.pageUrl),
    [
      "https://tab-11.example/",
      "https://tab-22.example/",
      "https://tab-11.example/",
      "https://tab-22.example/",
      "https://tab-11.example/",
    ],
    "backend provenance must use the sender tab URL, never stale or caller-supplied metadata",
  );
  assert.ok(
    state.captures.every(({ uiHidden }) => uiHidden),
    "the full UniMate host must be hidden before every capture",
  );
  assert.equal(state.captureUiHidden, false, "each successful capture must restore the UI");
}

// Every extension-side network boundary must settle with a typed timeout so
// the MV3 worker and panel cannot remain stuck on a never-resolving fetch.
{
  const { context } = createHarness();
  context.fetch = () => new Promise(() => {});
  const timeout = new context.__runtimeExports.CompanionError("Timed out", {
    code: "PERSISTENCE_TIMEOUT",
    phase: "persistence",
  });
  await assert.rejects(
    context.__runtimeExports.fetchWithTimeout(
      "https://example.supabase.co/rest/v1/companion_chats",
      {},
      5,
      timeout,
    ),
    (error) => error?.code === "PERSISTENCE_TIMEOUT" && error?.phase === "persistence",
  );
}

// A Groq/backend 429 occurs after capture and must remain an AI-analysis error,
// never a screen-capture failure. Long retry windows are surfaced immediately.
{
  const { listeners, state } = createHarness();
  state.visionResponses.push(
    new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "10" },
    }),
  );
  const response = await dispatch(
    listeners.runtime,
    {
      type: "SEND_CHAT",
      message: "Analyze this screen",
      context: { visiblePageText: "visible problem" },
      useScreenshot: true,
      screenshotReason: "manual",
      history: [],
    },
    { tab: { id: 11, windowId: 1, url: "https://quiz.example/" } },
  );
  assert.equal(state.captures.length, 1, "the screen should already have been captured");
  assert.equal(response.ok, false);
  assert.equal(response.errorCode, "AI_RATE_LIMITED");
  assert.equal(response.errorPhase, "screenshot-analysis");
  assert.equal(response.retryAfterMs, 10_000);
  assert.doesNotMatch(response.error, /screen capture unavailable/i);
}

// A short explicit Retry-After receives one bounded backend retry without
// recapturing the tab.
{
  const { listeners, state } = createHarness();
  state.visionResponses.push(
    new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "0.001" },
    }),
    json({ answer: "recovered screen answer" }),
  );
  const response = await dispatch(
    listeners.runtime,
    {
      type: "SEND_CHAT",
      message: "Analyze this screen",
      context: { visiblePageText: "visible problem" },
      useScreenshot: true,
      screenshotReason: "manual",
      history: [],
    },
    { tab: { id: 11, windowId: 1, url: "https://quiz.example/" } },
  );
  assert.equal(response.ok, true);
  assert.equal(state.captures.length, 1, "rate-limit retry must reuse the captured image");
  assert.equal(
    state.requests.filter(({ href }) => href.endsWith("/api/analyze-screenshot")).length,
    2,
    "rate-limit recovery must retry the analysis exactly once",
  );
}

// A retry is bounded to one attempt. A second 429 must be surfaced without
// recapturing or silently changing to the DOM-only endpoint.
{
  const { listeners, state } = createHarness();
  for (let index = 0; index < 2; index += 1) {
    state.visionResponses.push(
      new Response(JSON.stringify({ error: "Still rate limited" }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "0.001" },
      }),
    );
  }
  const response = await dispatch(
    listeners.runtime,
    {
      type: "SEND_CHAT",
      message: "Answer the visible question",
      context: { visiblePageText: "Question 2. What is 4 + 4?" },
      history: [],
    },
    { tab: { id: 11, windowId: 1, url: "https://quiz.example/" } },
  );
  assert.equal(response.ok, false);
  assert.equal(response.errorCode, "AI_RATE_LIMITED");
  assert.equal(state.captures.length, 1);
  assert.equal(
    state.requests.filter(({ href }) => href.endsWith("/api/analyze-screenshot")).length,
    2,
  );
  assert.equal(
    state.requests.filter(({ href }) => href.endsWith("/api/dashboard-ai")).length,
    0,
    "an AI failure must never trigger a second model route",
  );
}

// Missing Retry-After is not permission to retry immediately.
{
  const { listeners, state } = createHarness();
  state.visionResponses.push(
    new Response(JSON.stringify({ error: "Rate limited" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    }),
  );
  const response = await dispatch(
    listeners.runtime,
    {
      type: "SEND_CHAT",
      message: "Answer this",
      context: { visiblePageText: "Visible material" },
      history: [],
    },
    { tab: { id: 11, windowId: 1, url: "https://quiz.example/" } },
  );
  assert.equal(response.ok, false);
  assert.equal(response.retryAfterMs, 0);
  assert.equal(state.captures.length, 1);
  assert.equal(
    state.requests.filter(({ href }) => href.endsWith("/api/analyze-screenshot")).length,
    1,
  );
}

// A tab switch between Send and capture must fail closed instead of capturing another tab.
{
  const { context, state } = createHarness();
  state.activeByWindow.set(1, 99);
  await assert.rejects(
    context.__runtimeExports.captureActiveTab({ tab: { id: 11, windowId: 1 } }),
    /page changed|active|return to it/i,
  );
  assert.equal(state.captures.length, 0);
  assert.equal(state.captureUiHidden, false);
}

// A lost acknowledgement can happen after the content script has already
// hidden the host. Restoration must still be attempted and capture must fail
// closed without leaving UniMate invisible.
{
  const { context, state } = createHarness();
  state.dropPrepareAcknowledgement = true;
  await assert.rejects(
    context.__runtimeExports.captureActiveTab({ tab: { id: 11, windowId: 1 } }),
    (error) => error?.code === "CAPTURE_UI_HIDE_FAILED" && error?.phase === "capture",
  );
  assert.equal(state.captures.length, 0, "capture must not proceed without hide confirmation");
  assert.equal(state.captureUiHidden, false, "lost hide acknowledgement must still restore the UI");
  assert.deepEqual(
    state.sent.map(({ request }) => request.type),
    ["PREPARE_COMPANION_CAPTURE", "RESTORE_COMPANION_CAPTURE"],
  );
}

// Capture errors should preserve their actual cause for UI classification.
{
  const { context, state } = createHarness();
  state.captureError = new Error("Either the '<all_urls>' or 'activeTab' permission is required.");
  await assert.rejects(
    context.__runtimeExports.captureActiveTab({ tab: { id: 11, windowId: 1 } }),
    (error) =>
      error?.code === "CAPTURE_PERMISSION_DENIED" &&
      error?.phase === "capture" &&
      /denied screen capture/i.test(error.message),
  );
  assert.equal(state.captureUiHidden, false, "capture failure must restore the interface");
}

// Unknown and malformed messages always produce a structured response.
{
  const { listeners } = createHarness();
  const diagnostics = await dispatch(
    listeners.runtime,
    { type: "RUNTIME_DIAGNOSTICS" },
    { tab: { id: 11, windowId: 1, url: "https://article.example/" } },
  );
  assert.equal(diagnostics.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(diagnostics.data)), {
    serviceWorkerConnected: true,
    contentScriptConnected: true,
    tabIdentified: true,
    eligiblePage: true,
    captureApiAvailable: true,
    capturePermission: true,
    manifestVersion: 3,
  });

  for (const request of [{ type: "NOT_REAL" }, null, {}]) {
    const response = await dispatch(listeners.runtime, request, {
      tab: { id: 11, windowId: 1 },
    });
    assert.equal(response.ok, false);
    assert.match(response.error, /unknown companion request/i);
  }
}

// Toolbar click recovers tabs whose declarative content script is stale after
// an extension reload, then retries the toggle exactly once.
{
  const { listeners, state } = createHarness();
  state.failSendByTab.set(
    11,
    new Error("Could not establish connection. Receiving end does not exist."),
  );
  await listeners.action({ id: 11, windowId: 1, url: "https://article.example/" });
  assert.equal(state.injected.length, 1, "extension messaging should dispose before reinjection");
  assert.deepEqual(
    state.sent.map(({ request }) => request.type),
    ["TOGGLE_COMPANION", "DISPOSE_COMPANION_INSTANCE", "TOGGLE_COMPANION"],
    "toolbar toggle should retry once after recovery injection",
  );
  assert.deepEqual(Array.from(state.injected[0]?.files || []), [
    "context-extractor.js",
    "content.js",
  ]);
}

// Extension install/update recovery covers eligible existing tabs, while
// Chrome-owned pages are skipped. This is the no-manual-refresh path.
{
  const { listeners, state } = createHarness();
  assert.equal(typeof listeners.installed, "function");
  listeners.installed();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(state.injected.length, 2, "two eligible tabs require extension disposal + inject");
  for (const tabId of [11, 22]) {
    const operations = state.injected.filter(({ target }) => target.tabId === tabId);
    assert.equal(operations.length, 1, `tab ${tabId} must be recovered exactly once`);
    assert.deepEqual(Array.from(operations[0].files || []), ["context-extractor.js", "content.js"]);
  }
  assert.equal(
    state.injected.some(({ target }) => target.tabId === 33),
    false,
    "Chrome-owned tabs must not be injected",
  );
}

console.log(
  "PASS runtime messaging, reload recovery, bounded rate limits, capture isolation, and diagnostics",
);
