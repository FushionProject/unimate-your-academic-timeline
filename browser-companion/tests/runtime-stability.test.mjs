import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const backgroundSource = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
const contentSource = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

// Check the installed-browser fixture without importing its Playwright entry
// point, opening a socket, reading credentials or launching a browser. This
// verifies the HTTP failure contract; it does not substitute for the installed
// Send/preflight/panel scenarios in that harness.
{
  const browserHarness = fs.readFileSync(
    new URL("../../scripts/test-companion-browser.mjs", import.meta.url),
    "utf8",
  );
  const start = browserHarness.indexOf("const student =");
  const end = browserHarness.indexOf("\nawait new Promise((resolve) => server.listen");
  assert.ok(start >= 0 && end > start, "installed fixture boundaries must remain explicit");
  let handleRequest;
  const fixture = vm.createContext({
    URL,
    http: {
      createServer(handler) {
        handleRequest = handler;
        return {};
      },
    },
  });
  vm.runInContext(
    `${browserHarness.slice(start, end)}
globalThis.setUserValidationFailure = (status) => { userValidationFailureStatus = status; };`,
    fixture,
  );
  const requestUser = async () => {
    const response = {};
    await handleRequest(
      { url: "/auth/v1/user", method: "GET", async *[Symbol.asyncIterator]() {} },
      {
        writeHead(status, headers) {
          response.status = status;
          response.headers = headers;
        },
        end(body) {
          response.body = JSON.parse(body);
        },
      },
    );
    return response;
  };
  for (const status of [null, 429, 503, null]) {
    fixture.setUserValidationFailure(status);
    const response = await requestUser();
    assert.equal(response.status, status || 200);
    assert.equal(response.headers["content-type"], "application/json");
    assert.equal(response.headers["access-control-allow-origin"], "*");
    assert.equal(response.headers["retry-after"], status === 429 ? "30" : undefined);
    if (status) {
      assert.deepEqual(response.body, { error: "Synthetic user validation outage" });
    } else {
      assert.equal(response.body.id, "10000000-0000-4000-8000-000000000001");
      assert.equal(response.body.email, "pro@example.test");
    }
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function createHarness({ sessionStorage = {}, captureTimeoutMs = 8000 } = {}) {
  const session = {
    access_token: "access",
    refresh_token: "refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1", email: "student@example.test" },
  };
  const listeners = { runtime: null, action: null, installed: null };
  const state = {
    storedSession: session,
    fetchOverride: null,
    afterCapture: null,
    activeByWindow: new Map([
      [1, 11],
      [2, 22],
    ]),
    captures: [],
    windows: [],
    createdTabs: [],
    sent: [],
    injected: [],
    failSendByTab: new Map(),
    dropPrepareAcknowledgement: false,
    captureError: null,
    documentByTab: new Map([
      [11, "document-11"],
      [22, "document-22"],
    ]),
    documentChecks: [],
    pingProtocol: null,
    preserveDuringDisposal: false,
    captureUiHidden: false,
    privacyConsentAccepted: true,
    revokeConsentDuringPrepare: false,
    visionResponses: [],
    requests: [],
  };
  const chrome = {
    storage: {
      local: {
        async get(key) {
          if (key === "unimateCompanionPrivacyConsent") {
            return {
              unimateCompanionPrivacyConsent: {
                accepted: state.privacyConsentAccepted,
                version: 1,
              },
            };
          }
          return { unimateCompanionSession: structuredClone(state.storedSession) };
        },
        async set(value) {
          if (value.unimateCompanionSession)
            state.storedSession = structuredClone(value.unimateCompanionSession);
        },
        async remove() {
          state.storedSession = null;
        },
      },
      session: {
        async get(key) {
          return structuredClone(key === null ? sessionStorage : { [key]: sessionStorage[key] });
        },
        async set(value) {
          Object.assign(sessionStorage, structuredClone(value));
        },
        async remove(keys) {
          for (const key of [].concat(keys)) delete sessionStorage[key];
        },
      },
    },
    tabs: {
      async create(options) {
        state.createdTabs.push(options);
        return { id: 44 };
      },
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
        state.afterCapture?.();
        return `data:image/jpeg;base64,WINDOW_${windowId}`;
      },
      async sendMessage(tabId, request, options) {
        state.sent.push({ tabId, request, options });
        const failure = state.failSendByTab.get(tabId);
        if (failure) {
          state.failSendByTab.delete(tabId);
          throw failure;
        }
        if (request?.type === "PREPARE_COMPANION_CAPTURE") {
          state.captureUiHidden = true;
          if (state.revokeConsentDuringPrepare) state.privacyConsentAccepted = false;
          if (state.dropPrepareAcknowledgement) {
            throw new Error("The message port closed before a response was received.");
          }
          return { ok: true, hidden: true, captureId: request.captureId };
        }
        if (request?.type === "RESTORE_COMPANION_CAPTURE") {
          state.captureUiHidden = false;
          return { ok: true, restored: true };
        }
        if (request?.type === "COMPANION_PING") {
          return { ok: true, nonce: request.nonce, ...(state.pingProtocol || {}) };
        }
        if (
          request?.type === "DISPOSE_COMPANION_INSTANCE" &&
          request.preserveIfCompatible &&
          state.preserveDuringDisposal
        )
          return {
            ok: true,
            preserved: true,
            protocolVersion: 2,
            extensionVersion: manifest.version,
          };
        return { ok: true };
      },
    },
    scripting: {
      async executeScript(details) {
        if (details.injectImmediately) {
          state.documentChecks.push(details);
          return [
            { result: true, frameId: 0, documentId: state.documentByTab.get(details.target.tabId) },
          ];
        }
        state.injected.push(details);
        return [{ result: true }];
      },
    },
    runtime: {
      id: "unimate-test-extension",
      getURL(path) {
        return `chrome-extension://unimate-test-extension/${path}`;
      },
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
    windows: {
      async create(options) {
        state.windows.push(options);
        return { id: 7 };
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
      const override = await state.fetchOverride?.(href, options);
      if (override) return override;
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
    `${backgroundSource.replace("const CAPTURE_TIMEOUT_MS = 8000;", `const CAPTURE_TIMEOUT_MS = ${captureTimeoutMs};`)}\nglobalThis.__runtimeExports = { captureActiveTab, sendChat, fetchWithTimeout, CompanionError, getValidSession, signOut, sanitizePageContext };`,
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
      {
        documentId: `document-${tabId}`,
        tab: { id: tabId, windowId, url: `https://tab-${tabId}.example/`, title: `Tab ${tabId}` },
      },
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
  const { context } = createHarness();
  context.fetch = async () => ({ text: () => new Promise(() => {}) });
  const timeout = new context.__runtimeExports.CompanionError("Response body stalled", {
    code: "AI_TIMEOUT",
    phase: "screenshot-analysis",
  });
  await assert.rejects(
    context.__runtimeExports.fetchWithTimeout(
      "https://unimate.example/api/analyze-screenshot",
      {},
      5,
      timeout,
    ),
    (error) => error.code === "AI_TIMEOUT",
  );
}

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
    { documentId: "document-11", tab: { id: 11, windowId: 1, url: "https://quiz.example/" } },
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
    new Response(
      JSON.stringify({
        code: "AI_BILLING_UNAVAILABLE",
        retryable: false,
        error: "AI help is unavailable",
      }),
      {
        status: 503,
        headers: { "content-type": "application/json", "retry-after": "0.001" },
      },
    ),
  );
  const response = await dispatch(
    listeners.runtime,
    {
      type: "SEND_CHAT",
      message: "Explain this",
      context: { visiblePageText: "Course material" },
      history: [],
    },
    { documentId: "document-11", tab: { id: 11, windowId: 1, url: "https://course.example/" } },
  );
  assert.equal(response.ok, false);
  assert.equal(response.errorCode, "AI_BILLING_UNAVAILABLE");
  assert.equal(response.errorPhase, "ai");
  assert.equal(response.retryable, false);
  assert.equal(
    state.requests.filter(({ href }) => href.endsWith("/api/analyze-screenshot")).length,
    1,
    "A provider billing outage must not retry the model",
  );
  assert.equal(state.requests.filter(({ href }) => href.endsWith("/api/dashboard-ai")).length, 0);
}

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
    { documentId: "document-11", tab: { id: 11, windowId: 1, url: "https://quiz.example/" } },
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
    { documentId: "document-11", tab: { id: 11, windowId: 1, url: "https://quiz.example/" } },
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
    { documentId: "document-11", tab: { id: 11, windowId: 1, url: "https://quiz.example/" } },
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
    context.__runtimeExports.captureActiveTab({
      documentId: "document-11",
      tab: { id: 11, windowId: 1 },
    }),
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
  state.revokeConsentDuringPrepare = true;
  await assert.rejects(
    context.__runtimeExports.captureActiveTab({
      documentId: "document-11",
      tab: { id: 11, windowId: 1 },
    }),
    (error) => error.code === "PRIVACY_CONSENT_REQUIRED",
  );
  assert.equal(
    state.captures.length,
    0,
    "Pausing sharing while capture prepares must prevent the screenshot",
  );
  assert.equal(state.captureUiHidden, false, "A paused capture must restore the panel");
}

{
  const { context, state } = createHarness();
  state.dropPrepareAcknowledgement = true;
  await assert.rejects(
    context.__runtimeExports.captureActiveTab({
      documentId: "document-11",
      tab: { id: 11, windowId: 1 },
    }),
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
    context.__runtimeExports.captureActiveTab({
      documentId: "document-11",
      tab: { id: 11, windowId: 1 },
    }),
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
    { documentId: "document-11", tab: { id: 11, windowId: 1, url: "https://article.example/" } },
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

// Credential entry is confined to a top-level extension-owned document. A
// content script has the extension ID too, so its page URL must also match.
{
  const { listeners, state } = createHarness();
  const signInUrl = "chrome-extension://unimate-test-extension/signin.html";
  const badSenders = [
    { id: "unimate-test-extension", url: "https://course.example/", tab: { url: signInUrl } },
    { id: "another-extension", url: signInUrl },
    { id: "unimate-test-extension", url: `${signInUrl}?spoof=1` },
    { id: "unimate-test-extension", url: signInUrl, frameId: 1 },
    {},
  ];
  for (const sender of badSenders) {
    const response = await dispatch(
      listeners.runtime,
      { type: "SIGN_IN", email: "student@example.test", password: "test-secret" },
      sender,
    );
    assert.equal(response.ok, false);
    assert.equal(response.errorCode, "UNTRUSTED_SIGN_IN_PAGE");
  }
  assert.equal(state.requests.length, 0, "untrusted credentials must never reach the auth service");
  const opened = await dispatch(listeners.runtime, { type: "OPEN_SIGN_IN" }, badSenders[0]);
  assert.equal(opened.ok, true);
  assert.equal(state.windows[0].url, signInUrl);
  assert.equal(state.windows[0].type, "popup");
  const help = await dispatch(
    listeners.runtime,
    { type: "OPEN_ACCOUNT_HELP", url: "https://attacker.example/" },
    { id: "unimate-test-extension", url: signInUrl },
  );
  assert.equal(help.ok, true);
  assert.equal(
    state.createdTabs[0].url,
    "https://unimate.example/signin",
    "account help must use only the configured UniMate origin",
  );

  state.storedSession = null;
  state.fetchOverride = async (href) =>
    href.includes("grant_type=password")
      ? json({
          access_token: "private-access-token",
          refresh_token: "private-refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: "user-1", email: "student@example.test" },
        })
      : undefined;
  const accepted = await dispatch(
    listeners.runtime,
    { type: "SIGN_IN", email: "student@example.test", password: "test-secret" },
    { id: "unimate-test-extension", url: signInUrl, frameId: 0 },
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.data.authenticated, true);
  const notifications = state.sent.filter(({ request }) => request.type === "SESSION_CHANGED");
  assert.deepEqual(
    notifications.map(({ tabId }) => tabId),
    [11, 22],
  );
  assert.ok(notifications.every(({ request }) => Object.keys(request).length === 1));
  assert.doesNotMatch(
    JSON.stringify(accepted),
    /private-access-token|private-refresh-token|test-secret/,
  );
}

// Other tabs clear stale account data before a slow remote logout completes.
{
  const { context, state } = createHarness();
  let started;
  let finish;
  const logoutStarted = new Promise((resolve) => {
    started = resolve;
  });
  state.fetchOverride = async (href) => {
    if (href.endsWith("/auth/v1/logout")) {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
  };
  const signout = context.__runtimeExports.signOut();
  await logoutStarted;
  assert.equal(state.storedSession, null);
  assert.deepEqual(
    state.sent
      .filter(({ request }) => request.type === "SESSION_CHANGED")
      .map(({ tabId }) => tabId),
    [11, 22],
  );
  finish(json({}));
  await signout;
}

// The initial user-validation request must classify outages just like the
// post-refresh request. Preserve the session and Retry-After so the UI can
// offer recovery instead of suggesting expired credentials or losing work.
for (const [status, code, retryAfter] of [
  [429, "AI_RATE_LIMITED", 30_000],
  [503, "BACKEND_UNAVAILABLE", 0],
]) {
  const { listeners, state } = createHarness();
  const originalSession = structuredClone(state.storedSession);
  state.fetchOverride = async (href) =>
    href.endsWith("/auth/v1/user")
      ? new Response(JSON.stringify({ error: "Temporary auth outage" }), {
          status,
          headers: status === 429 ? { "retry-after": "30" } : {},
        })
      : undefined;
  const sender = { documentId: "document-11", tab: { id: 11, windowId: 1 } };
  const failed = await dispatch(listeners.runtime, { type: "AUTH_STATE" }, sender);
  assert.equal(failed.ok, false);
  assert.equal(failed.errorCode, code);
  assert.equal(failed.errorPhase, "auth");
  assert.equal(failed.retryAfterMs, retryAfter);
  assert.deepEqual(state.storedSession, originalSession);
  assert.equal(state.requests.length, 1, "An auth outage must not trigger a refresh or paid work");
  assert.equal(state.captures.length, 0);
  assert.equal(
    state.sent.some(({ request }) => request.type === "SESSION_CHANGED"),
    false,
  );

  state.fetchOverride = null;
  const recovered = await dispatch(listeners.runtime, { type: "AUTH_STATE" }, sender);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.data.authenticated, true);
  assert.equal(recovered.data.isPro, true);
  assert.equal(state.storedSession.refresh_token, originalSession.refresh_token);
  assert.equal(
    state.requests.some(({ href }) => href.includes("grant_type=")),
    false,
  );
  assert.equal(
    state.requests.some(({ href }) => href.includes("/api/analyze-screenshot")),
    false,
  );
  assert.equal(
    state.requests.some(({ href }) => href.includes("/api/dashboard-ai")),
    false,
  );
}

// Concurrent status/chat callers share refresh rotation, and transient auth
// outages retain the refresh token so the next attempt can recover.
{
  const { context, state } = createHarness();
  state.storedSession.expires_at = 1;
  let rotations = 0;
  state.fetchOverride = async (href) => {
    if (href.includes("grant_type=refresh_token")) {
      rotations += 1;
      return json({
        ...state.storedSession,
        access_token: "renewed",
        refresh_token: "rotated",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      });
    }
  };
  const sessions = await Promise.all(
    Array.from({ length: 8 }, () => context.__runtimeExports.getValidSession()),
  );
  assert.equal(rotations, 1, "concurrent checks must rotate a refresh token only once");
  assert.ok(sessions.every((session) => session.access_token === "renewed"));
  state.storedSession.expires_at = 1;
  state.fetchOverride = async (href) =>
    href.includes("grant_type=refresh_token")
      ? json({ error: "Temporarily unavailable" }, 503)
      : undefined;
  await assert.rejects(context.__runtimeExports.getValidSession(), /Temporarily unavailable/);
  assert.equal(
    state.storedSession.refresh_token,
    "rotated",
    "a transient refresh outage must preserve the session",
  );
}

// Definitively rejected refresh credentials are also a session boundary:
// a previously authorized in-flight response must not repopulate local state.
{
  const { context, listeners, state } = createHarness();
  let releaseAnswer;
  let announceStarted;
  const started = new Promise((resolve) => {
    announceStarted = resolve;
  });
  state.fetchOverride = async (href) => {
    if (href.endsWith("/api/analyze-screenshot")) {
      announceStarted();
      return new Promise((resolve) => {
        releaseAnswer = resolve;
      });
    }
    if (href.includes("grant_type=refresh_token"))
      return json({ error: "Refresh token revoked" }, 400);
  };
  const pending = dispatch(
    listeners.runtime,
    { type: "SEND_CHAT", requestId: "expired-session-flight", message: "Fixture", context: {} },
    { documentId: "document-11", tab: { id: 11, windowId: 1 } },
  );
  await started;
  state.storedSession.expires_at = 1;
  await assert.rejects(context.__runtimeExports.getValidSession(), { code: "AUTH_REQUIRED" });
  assert.equal(state.storedSession, null);
  releaseAnswer(json({ answer: "Late private answer" }));
  const response = await pending;
  assert.equal(
    response.errorCode,
    "AUTH_REQUIRED",
    "Expired identity must invalidate in-flight work",
  );
  assert.equal(
    state.requests.some(
      ({ href, options }) => href.includes("companion_chats") && options.method === "POST",
    ),
    false,
  );
}

// Every definitive rejection clears local caches/journals and notifies tabs;
// a login discovering expiration can establish its new session in one attempt.
for (const reason of ["refresh-400", "refresh-401", "missing-refresh", "retried-user-401"]) {
  const sessionStorage = {};
  const { context, listeners, state } = createHarness({ sessionStorage });
  const loginSession = structuredClone(state.storedSession);
  await dispatch(
    listeners.runtime,
    { type: "SEND_CHAT", requestId: `before-${reason}`, message: "Fixture", context: {} },
    { documentId: "document-11", tab: { id: 11, windowId: 1 } },
  );
  assert.ok(Object.keys(sessionStorage).length > 0);
  state.storedSession.expires_at = reason === "retried-user-401" ? loginSession.expires_at : 1;
  if (reason === "missing-refresh") delete state.storedSession.refresh_token;
  let signedIn = false;
  state.fetchOverride = async (href) => {
    if (href.includes("grant_type=password")) {
      assert.equal(Object.keys(sessionStorage).length, 0);
      assert.equal(
        vm.runInContext("completedChatRequests.size + pendingChatPersistence.size", context),
        0,
      );
      signedIn = true;
      return json(loginSession);
    }
    if (href.includes("grant_type=refresh_token"))
      return reason === "retried-user-401"
        ? json(loginSession)
        : json({ error: "Revoked" }, reason === "refresh-400" ? 400 : 401);
    if (!signedIn && reason === "retried-user-401" && href.endsWith("/auth/v1/user"))
      return json({}, 401);
  };
  const response = await dispatch(
    listeners.runtime,
    { type: "SIGN_IN", email: "student@example.test", password: "test-secret" },
    {
      id: "unimate-test-extension",
      url: "chrome-extension://unimate-test-extension/signin.html",
      frameId: 0,
    },
  );
  assert.equal(response.ok, true, `${reason}: secure sign-in must not require a second attempt`);
  assert.equal(response.data.authenticated, true);
  assert.equal(state.sent.filter(({ request }) => request.type === "SESSION_CHANGED").length, 4);
}

// Sign-out must win against a validation response that arrives afterward.
{
  const { context, state } = createHarness();
  let resolveUser;
  let announceStarted;
  const started = new Promise((resolve) => {
    announceStarted = resolve;
  });
  state.fetchOverride = async (href) => {
    if (href.endsWith("/auth/v1/user")) {
      announceStarted();
      return new Promise((resolve) => {
        resolveUser = resolve;
      });
    }
    if (href.endsWith("/auth/v1/logout")) return json({});
  };
  const validation = context.__runtimeExports.getValidSession();
  await started;
  await context.__runtimeExports.signOut();
  resolveUser(json({ id: "user-1" }));
  await assert.rejects(validation, (error) => error.code === "AUTH_REQUIRED");
  assert.equal(state.storedSession, null, "late validation must not recreate a signed-out session");
}

// Chrome can switch tabs while capture is pending; discard those pixels and
// do not silently analyze the old DOM either.
{
  const { context, state } = createHarness();
  state.afterCapture = () => state.activeByWindow.set(1, 99);
  await assert.rejects(
    context.__runtimeExports.sendChat(
      {
        message: "Analyze this",
        context: { visiblePageText: "Old page" },
      },
      { documentId: "document-11", tab: { id: 11, windowId: 1, url: "https://course.example/" } },
    ),
    (error) => error.code === "CAPTURE_TAB_CHANGED",
  );
  assert.equal(
    state.requests.filter(({ href }) => /\/api\/(analyze-screenshot|dashboard-ai)$/.test(href))
      .length,
    0,
  );
  assert.equal(state.captureUiHidden, false);
}

// Provenance must not disclose URL credentials, query secrets or fragments.
{
  const { context } = createHarness();
  const { sanitizePageContext } = context.__runtimeExports;
  assert.equal(
    sanitizePageContext(
      {},
      { tab: { url: "https://user:secret@example.test/course?token=private#access_token=secret" } },
    ).pageUrl,
    "https://example.test/course",
  );
  assert.equal(
    sanitizePageContext({}, { tab: { url: "file:///Users/student/private.pdf" } }).pageUrl,
    "",
  );
}

// Consent may be withdrawn while the provider is working or during a short
// rate-limit delay. Neither case permits another upload/save afterward.
{
  const { context, state } = createHarness();
  state.fetchOverride = async (href) => {
    if (href.endsWith("/api/analyze-screenshot")) {
      state.privacyConsentAccepted = false;
      return json({ answer: "Finished after sharing was paused" });
    }
  };
  await assert.rejects(
    context.__runtimeExports.sendChat(
      { message: "Analyze", context: {} },
      { documentId: "document-11", tab: { id: 11, windowId: 1 } },
    ),
    (error) => error.code === "PRIVACY_CONSENT_REQUIRED",
  );
  assert.equal(
    state.requests.filter(({ href }) => href.includes("/rest/v1/companion_chats")).length,
    0,
  );
}
{
  const { context, state } = createHarness();
  state.fetchOverride = async (href) => {
    if (href.endsWith("/api/analyze-screenshot")) {
      state.privacyConsentAccepted = false;
      return new Response(JSON.stringify({ error: "Wait" }), {
        status: 429,
        headers: { "retry-after": "0.001" },
      });
    }
  };
  await assert.rejects(
    context.__runtimeExports.sendChat(
      { message: "Analyze", context: {} },
      { documentId: "document-11", tab: { id: 11, windowId: 1 } },
    ),
    (error) => error.code === "PRIVACY_CONSENT_REQUIRED",
  );
  assert.equal(
    state.requests.filter(({ href }) => href.endsWith("/api/analyze-screenshot")).length,
    1,
  );
}

// A lost save acknowledgement can happen after the database committed. The
// MV3 worker may then restart. Its journal must preserve the answer and IDs,
// avoiding another model call and duplicate messages on retry.
{
  const sessionStorage = {};
  const { context, state } = createHarness({ sessionStorage });
  state.fetchOverride = async (href) => {
    if (href.endsWith("/auth/v1/logout")) return json({});
    if (href.endsWith("/api/analyze-screenshot")) {
      await context.__runtimeExports.signOut();
      return json({ answer: "Finished after sign-out" });
    }
  };
  await assert.rejects(
    context.__runtimeExports.sendChat(
      { message: "Analyze", context: {} },
      { documentId: "document-11", tab: { id: 11, windowId: 1 } },
    ),
    (error) => error.code === "AUTH_REQUIRED",
  );
  assert.equal(
    state.requests.filter(({ href }) => href.includes("/rest/v1/companion_chats")).length,
    0,
  );
  assert.equal(Object.keys(sessionStorage).length, 0);
}

{
  const sessionStorage = {};
  const first = createHarness({ sessionStorage });
  let committedRows;
  first.state.fetchOverride = async (href, options) => {
    if (href.includes("/rest/v1/companion_chats") && options.method === "POST") {
      committedRows = JSON.parse(options.body);
      throw new Error("Connection dropped after commit");
    }
  };
  const payload = {
    type: "SEND_CHAT",
    requestId: "restart-safe-request",
    message: "Explain this",
    context: { visiblePageText: "PRIVATE_PAGE_CONTEXT" },
  };
  const sender = {
    documentId: "document-11",
    tab: { id: 11, windowId: 1, url: "https://course.example/" },
  };
  const response = await dispatch(first.listeners.runtime, payload, sender);
  assert.equal(response.ok, true);
  assert.match(response.data.persistenceWarning, /could not save/);
  assert.doesNotMatch(
    JSON.stringify(sessionStorage),
    /PRIVATE_PAGE_CONTEXT|data:image|access_token|refresh_token|diagnostics/,
  );
  const restarted = createHarness({ sessionStorage });
  restarted.state.fetchOverride = async (href, options) => {
    if (href.includes("/rest/v1/companion_chats")) {
      if (options.method === "POST") {
        assert.deepEqual(
          JSON.parse(options.body).map((row) => row.id),
          committedRows.map((row) => row.id),
        );
        assert.match(options.headers.Prefer, /ignore-duplicates/);
        return json([]);
      }
      return json(committedRows);
    }
  };
  const replay = await dispatch(restarted.listeners.runtime, payload, sender);
  assert.equal(replay.data.assistant.message, response.data.assistant.message);
  assert.equal(
    restarted.state.captures.length,
    0,
    "worker restart must not regenerate an available answer",
  );
  const retry = await dispatch(
    restarted.listeners.runtime,
    { type: "RETRY_CHAT_PERSISTENCE", requestId: payload.requestId },
    sender,
  );
  assert.equal(retry.ok, true);
  assert.equal(retry.data.assistant.id, committedRows[1].id);
  const savedReplay = await dispatch(restarted.listeners.runtime, payload, sender);
  assert.equal(savedReplay.data.persistenceWarning, undefined);
  assert.equal(savedReplay.data.user.id, committedRows[0].id);
  await restarted.context.__runtimeExports.signOut();
  assert.equal(Object.keys(sessionStorage).length, 0, "sign-out must clear journaled chat content");
}

// Every account-bound response must honor sign-out/account replacement, not
// just chat generation and token validation. Delayed billing/history must not
// repopulate a cleared panel with the previous account's identity or messages.
for (const replaceAccount of [false, true]) {
  for (const [type, pausedPath, lateBody] of [
    ["AUTH_STATE", "/api/billing-status", { isPro: true }],
    ["LOAD_MESSAGES", "/api/billing-status", { isPro: true }],
    ["LOAD_CHAT_STATE", "/api/billing-status", { isPro: true }],
    ["RECOVER_CHAT_REQUEST", "/api/billing-status", { isPro: true }],
    ["LOAD_MESSAGES", "/rest/v1/companion_chats", [{ role: "user", message: "OLD_PRIVATE_CHAT" }]],
    [
      "LOAD_CHAT_STATE",
      "/rest/v1/companion_chats",
      [{ role: "user", message: "OLD_PRIVATE_CHAT" }],
    ],
    ["LOAD_CHAT_STATE", "/rest/v1/companion_preferences", []],
  ]) {
    const { context, listeners, state } = createHarness();
    let announce;
    let release;
    let paused = false;
    const started = new Promise((resolve) => {
      announce = resolve;
    });
    state.fetchOverride = async (href, options) => {
      if (!paused && href.includes(pausedPath)) {
        paused = true;
        announce();
        return new Promise((resolve) => {
          release = resolve;
        });
      }
      if (href.endsWith("/auth/v1/logout")) return json({});
      if (href.includes("grant_type=password"))
        return json({
          access_token: "new-account-access",
          refresh_token: "new-account-refresh",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: { id: "user-2", email: "new@example.test" },
        });
      if (
        href.endsWith("/auth/v1/user") &&
        options.headers.Authorization === "Bearer new-account-access"
      )
        return json({ id: "user-2", email: "new@example.test" });
    };
    const pending = dispatch(listeners.runtime, { type, requestId: "stale-account-recovery" }, {});
    await started;
    await context.__runtimeExports.signOut();
    if (replaceAccount) {
      const signedIn = await dispatch(
        listeners.runtime,
        {
          type: "SIGN_IN",
          email: "new@example.test",
          password: "fixture-password",
        },
        {
          id: "unimate-test-extension",
          url: "chrome-extension://unimate-test-extension/signin.html",
          frameId: 0,
        },
      );
      assert.equal(signedIn.ok, true);
      assert.equal(signedIn.data.userId, "user-2");
    }
    const callsBeforeLateResponse = state.requests.length;
    release(json(lateBody));
    const response = await pending;
    assert.equal(response.ok, false, `${type} must reject a stale account response`);
    assert.equal(response.errorCode, "AUTH_REQUIRED");
    assert.equal(response.errorPhase, "auth");
    assert.doesNotMatch(JSON.stringify(response), /OLD_PRIVATE_CHAT|student@example/);
    assert.equal(
      state.requests.length,
      callsBeforeLateResponse,
      "Stale work must not start subsequent reads or writes",
    );
    assert.equal(state.storedSession?.user?.id || null, replaceAccount ? "user-2" : null);
  }
}

// Consent changes during entitlement or journal reads must block cached data
// and explicit persistence retries just as they block fresh provider calls.
for (const replayMode of ["cached", "journal", "retry-save", "recover-cached", "recover-journal"]) {
  const sessionStorage = {};
  const initial = createHarness({ sessionStorage });
  const payload = {
    type: "SEND_CHAT",
    requestId: `consent-${replayMode}`,
    message: "Fixture question",
    context: {},
  };
  const sender = { documentId: "document-11", tab: { id: 11, windowId: 1 } };
  await dispatch(initial.listeners.runtime, payload, sender);
  const harness = replayMode.includes("journal") ? createHarness({ sessionStorage }) : initial;
  if (replayMode.includes("journal")) {
    const originalGet = harness.context.chrome.storage.session.get;
    harness.context.chrome.storage.session.get = async (key) => {
      const result = await originalGet(key);
      harness.state.privacyConsentAccepted = false;
      return result;
    };
  } else {
    harness.state.fetchOverride = async (href) => {
      if (href.includes("/api/billing-status")) {
        harness.state.privacyConsentAccepted = false;
        return json({ isPro: true });
      }
    };
  }
  const before = harness.state.requests.length;
  const replay = await dispatch(
    harness.listeners.runtime,
    replayMode === "retry-save"
      ? { type: "RETRY_CHAT_PERSISTENCE", requestId: payload.requestId }
      : replayMode.startsWith("recover-")
        ? { type: "RECOVER_CHAT_REQUEST", requestId: payload.requestId }
        : payload,
    sender,
  );
  assert.equal(replay.ok, false);
  assert.equal(replay.errorCode, "PRIVACY_CONSENT_REQUIRED");
  assert.equal(
    harness.state.requests
      .slice(before)
      .some(({ href }) => /analyze-screenshot|dashboard-ai|companion_chats/.test(href)),
    false,
  );
}

// Lost transport recovery is a read-only lookup, never a second capture,
// provider call, conversation write, or save. Completed unsaved answers also
// remain recoverable with their warning after a worker restart.
for (const unsaved of [false, true]) {
  const sessionStorage = {};
  const original = createHarness({ sessionStorage });
  if (unsaved)
    original.state.fetchOverride = async (href, options) => {
      if (href.includes("/companion_chats") && options.method === "POST")
        return json({ error: "Fixture unavailable save" }, 503);
    };
  const requestId = `read-only-recovery-${unsaved}`;
  const sent = await dispatch(
    original.listeners.runtime,
    { type: "SEND_CHAT", requestId, message: "Recover this exact answer" },
    { documentId: "document-11", tab: { id: 11, windowId: 1 } },
  );
  assert.equal(sent.ok, true);
  for (const harness of [original, createHarness({ sessionStorage })]) {
    const previousRequests = harness.state.requests.length;
    const previousCaptures = harness.state.captures.length;
    const recovered = await dispatch(
      harness.listeners.runtime,
      { type: "RECOVER_CHAT_REQUEST", requestId },
      {},
    );
    assert.equal(recovered.ok, true);
    assert.equal(recovered.data.status, "complete");
    assert.equal(recovered.data.response.requestId, requestId);
    assert.equal(recovered.data.response.assistant.message, sent.data.assistant.message);
    assert.equal(Boolean(recovered.data.response.persistenceWarning), unsaved);
    assert.equal(harness.state.captures.length, previousCaptures);
    assert.equal(
      harness.state.requests
        .slice(previousRequests)
        .some(
          ({ href, options }) =>
            /analyze-screenshot|dashboard-ai|companion_/.test(href) || options.method === "POST",
        ),
      false,
    );
  }
  // Even a journal snapshot returned after sign-out cannot disclose old data.
  const restarted = createHarness({ sessionStorage });
  const originalGet = restarted.context.chrome.storage.session.get;
  restarted.context.chrome.storage.session.get = async (key) => {
    const result = await originalGet(key);
    if (key !== null) await restarted.context.__runtimeExports.signOut();
    return result;
  };
  const stale = await dispatch(
    restarted.listeners.runtime,
    { type: "RECOVER_CHAT_REQUEST", requestId },
    {},
  );
  assert.equal(stale.errorCode, "AUTH_REQUIRED");
  assert.equal(stale.data, undefined);
}
{
  const { listeners, state } = createHarness();
  let announce;
  let release;
  const started = new Promise((resolve) => {
    announce = resolve;
  });
  state.fetchOverride = async (href) => {
    if (href.endsWith("/api/analyze-screenshot")) {
      announce();
      return new Promise((resolve) => {
        release = resolve;
      });
    }
  };
  const requestId = "pending-recovery";
  const pending = dispatch(
    listeners.runtime,
    { type: "SEND_CHAT", requestId, message: "Pending" },
    { documentId: "document-11", tab: { id: 11, windowId: 1 } },
  );
  await started;
  const recovered = await dispatch(
    listeners.runtime,
    { type: "RECOVER_CHAT_REQUEST", requestId },
    {},
  );
  assert.equal(recovered.data.status, "pending");
  assert.equal(recovered.data.response, undefined);
  assert.equal(state.captures.length, 1);
  assert.equal(
    state.requests.filter(({ href }) => href.endsWith("/api/analyze-screenshot")).length,
    1,
  );
  release(json({ answer: "One completed answer" }));
  assert.equal((await pending).ok, true);
}
for (const blockedBy of ["absent", "invalid-id", "consent", "auth", "pro", "other-account"]) {
  const sessionStorage = {
    "unimateCompanionRequest:user-2:unknown": {
      response: { assistant: { message: "OTHER_ACCOUNT_PRIVATE" } },
    },
  };
  const { listeners, state } = createHarness({ sessionStorage });
  if (blockedBy === "consent") state.privacyConsentAccepted = false;
  if (blockedBy === "auth") state.storedSession = null;
  if (blockedBy === "pro")
    state.fetchOverride = async (href) =>
      href.includes("/api/billing-status") ? json({ isPro: false }) : undefined;
  const result = await dispatch(
    listeners.runtime,
    {
      type: "RECOVER_CHAT_REQUEST",
      requestId: blockedBy === "invalid-id" ? "../invalid" : "unknown",
    },
    {},
  );
  if (["absent", "other-account"].includes(blockedBy))
    assert.equal(result.data.status, "not_found");
  else
    assert.equal(
      result.errorCode,
      {
        "invalid-id": "INVALID_REQUEST_ID",
        consent: "PRIVACY_CONSENT_REQUIRED",
        auth: "AUTH_REQUIRED",
        pro: "PRO_REQUIRED",
      }[blockedBy],
    );
  assert.doesNotMatch(JSON.stringify(result), /OTHER_ACCOUNT_PRIVATE/);
  assert.equal(state.captures.length, 0);
  assert.equal(
    state.requests.some(({ href }) => /analyze-screenshot|dashboard-ai|companion_/.test(href)),
    false,
  );
}

// A sign-out inside the final asynchronous consent check must not repopulate
// the answer cache or return old account data after its journal was cleared.
{
  const { context, listeners, state } = createHarness();
  const originalSet = context.chrome.storage.session.set;
  const originalGet = context.chrome.storage.local.get;
  let finalConsent = false;
  context.chrome.storage.session.set = async (value) => {
    await originalSet(value);
    if (Object.values(value).some((entry) => entry.response && !entry.pending)) finalConsent = true;
  };
  context.chrome.storage.local.get = async (key) => {
    if (key === "unimateCompanionPrivacyConsent" && finalConsent) {
      finalConsent = false;
      await context.__runtimeExports.signOut();
    }
    return originalGet(key);
  };
  state.fetchOverride = async (href) => (href.endsWith("/auth/v1/logout") ? json({}) : undefined);
  const response = await dispatch(
    listeners.runtime,
    { type: "SEND_CHAT", message: "Fixture", context: {} },
    { documentId: "document-11", tab: { id: 11, windowId: 1 } },
  );
  assert.equal(response.errorCode, "AUTH_REQUIRED");
  assert.equal(vm.runInContext("completedChatRequests.size", context), 0);
}

// Same-URL reloads change the browser-owned document ID. Both before and
// after native capture, mismatches fail closed without any text fallback.
for (const afterCapture of [false, true]) {
  const { context, listeners, state } = createHarness();
  if (afterCapture) state.afterCapture = () => state.documentByTab.set(11, "new-document");
  else state.documentByTab.set(11, "new-document");
  const response = await dispatch(
    listeners.runtime,
    { type: "SEND_CHAT", message: "Fixture", context: { visiblePageText: "Old document" } },
    { documentId: "document-11", tab: { id: 11, windowId: 1, url: "https://same-url.test/" } },
  );
  assert.equal(response.errorCode, "CAPTURE_TAB_CHANGED");
  assert.equal(
    state.requests.some(({ href }) => /analyze-screenshot|dashboard-ai/.test(href)),
    false,
  );
  assert.equal(state.captureUiHidden, false);
  assert.equal(context.__runtimeExports !== undefined, true);
}
{
  const { listeners, state } = createHarness();
  const response = await dispatch(
    listeners.runtime,
    { type: "SEND_CHAT", message: "Fixture", context: { visiblePageText: "Old document" } },
    { tab: { id: 11, windowId: 1 } },
  );
  assert.equal(response.errorCode, "CAPTURE_DOCUMENT_UNAVAILABLE");
  assert.equal(state.captures.length, 0);
  assert.equal(
    state.requests.some(({ href }) => /analyze-screenshot|dashboard-ai/.test(href)),
    false,
  );
}

// Every native stage shares one bounded deadline, including dropped PREPARE
// and RESTORE acknowledgements. Late uncancellable pixels are discarded.
{
  const { context, listeners, state } = createHarness({ captureTimeoutMs: 25 });
  // Timers can become runnable before Date.now reaches their requested wall
  // clock boundary. Make that ordering deterministic instead of requiring a
  // lucky millisecond boundary under host load.
  context.__captureClock = Date.now();
  vm.runInContext("Date.now = () => __captureClock", context);
  let restoring = false;
  const originalSend = context.chrome.tabs.sendMessage;
  context.chrome.tabs.sendMessage = async (...args) => {
    if (args[1].type === "RESTORE_COMPANION_CAPTURE") {
      restoring = true;
      await originalSend(...args);
      return new Promise(() => {});
    }
    return originalSend(...args);
  };
  context.setTimeout = (callback, delay) =>
    setTimeout(callback, restoring && delay <= 25 ? 0 : delay);
  const response = await dispatch(
    listeners.runtime,
    { type: "SEND_CHAT", message: "Fixture", context: { visiblePageText: "No timeout fallback" } },
    { documentId: "document-11", tab: { id: 11, windowId: 1 } },
  );
  assert.equal(
    response.errorCode,
    "CAPTURE_TIMEOUT",
    "An already rejected restore deadline cannot be swallowed",
  );
  assert.equal(
    state.requests.some(({ href }) => /analyze-screenshot|dashboard-ai/.test(href)),
    false,
  );
}

for (const stalledStage of ["query", "document", "prepare", "capture", "recapture", "restore"]) {
  const { context, listeners, state } = createHarness({ captureTimeoutMs: 25 });
  let release;
  const stalled = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const originalSend = context.chrome.tabs.sendMessage;
  if (stalledStage === "query") context.chrome.tabs.query = stalled;
  if (stalledStage === "document") context.chrome.scripting.executeScript = stalled;
  context.chrome.tabs.sendMessage = async (tabId, request, options) => {
    if (
      (stalledStage === "prepare" && request.type === "PREPARE_COMPANION_CAPTURE") ||
      (stalledStage === "restore" && request.type === "RESTORE_COMPANION_CAPTURE")
    ) {
      await originalSend(tabId, request, options);
      return stalled();
    }
    return originalSend(tabId, request, options);
  };
  if (stalledStage === "capture" || stalledStage === "recapture") {
    context.chrome.tabs.captureVisibleTab = async (_windowId, options) => {
      state.captures.push(options);
      if (stalledStage === "recapture" && state.captures.length === 1)
        return `data:image/jpeg;base64,${"x".repeat(2_400_000)}`;
      return stalled();
    };
  }
  const response = await dispatch(
    listeners.runtime,
    { type: "SEND_CHAT", message: "Fixture", context: { visiblePageText: "No timeout fallback" } },
    { documentId: "document-11", tab: { id: 11, windowId: 1 } },
  );
  assert.equal(response.errorCode, "CAPTURE_TIMEOUT", stalledStage);
  assert.equal(
    state.requests.some(({ href }) => /analyze-screenshot|dashboard-ai/.test(href)),
    false,
  );
  release?.("data:image/jpeg;base64,LATE_PIXELS");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    state.requests.some(({ href }) => /analyze-screenshot|dashboard-ai/.test(href)),
    false,
  );
  const prepare = state.sent.find(({ request }) => request.type === "PREPARE_COMPANION_CAPTURE");
  if (prepare) {
    assert.equal(prepare.options.documentId, "document-11");
    const restore = state.sent.find(({ request }) => request.type === "RESTORE_COMPANION_CAPTURE");
    assert.equal(restore.request.captureId, prepare.request.captureId);
    assert.equal(restore.options.documentId, "document-11");
  }
}

// Install/update rehydration preserves an already-mounted matching generation,
// while old protocol/version instances still receive genuine recovery.
for (const mode of ["current", "old-version", "old-protocol", "appeared-during-probe"]) {
  const { listeners, state } = createHarness();
  state.pingProtocol =
    mode === "appeared-during-probe"
      ? null
      : {
          protocolVersion: mode === "old-protocol" ? 1 : 2,
          extensionVersion: mode === "old-version" ? "0.9.0" : manifest.version,
        };
  state.preserveDuringDisposal = mode === "appeared-during-probe";
  listeners.installed();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    state.injected.length,
    ["current", "appeared-during-probe"].includes(mode) ? 0 : 2,
    mode,
  );
}

// Execute the actual isolated-world startup, including a compatible instance
// appearing only after the final failed probe. No awaited background decision
// is authoritative enough to dispose that new instance.
const startupSource = `${contentSource.slice(0, contentSource.indexOf("  const state = {"))}
  globalThis.startedNewInstance = true;
})();`;
function startupHarness({ version = manifest.version, protocol = 2, active = true } = {}) {
  const state = { disposals: 0, removals: 0 };
  const runtime = { getManifest: () => manifest };
  const previous = Object.assign(() => state.disposals++, {
    protocolVersion: protocol,
    extensionVersion: version,
    isActive: () => active,
  });
  const window = {};
  window.top = window;
  const world = vm.createContext({
    window,
    extensionRuntime: () => runtime,
    __unimateCompanionPrivateDispose: previous,
    document: { getElementById: () => ({ remove: () => state.removals++ }) },
  });
  return { world, state };
}
for (const options of [{}, { version: "0.9.0" }, { protocol: 1 }, { active: false }]) {
  const { world, state } = startupHarness(options);
  vm.runInContext(startupSource, world);
  const preserve = Object.keys(options).length === 0;
  assert.equal(state.disposals, preserve ? 0 : 1);
  assert.equal(state.removals, preserve ? 0 : 1);
  assert.equal(Boolean(world.startedNewInstance), !preserve);
}
{
  // Metadata is registered on the private function using the captured version,
  // and stops advertising a live instance as soon as disposal begins.
  const registration = contentSource.slice(
    contentSource.lastIndexOf("  globalThis.__unimateCompanionPrivateDispose = Object.assign"),
    contentSource.lastIndexOf("})();"),
  );
  const world = vm.createContext({
    dispose() {},
    disposed: false,
    extensionVersion: manifest.version,
    extensionRuntime: () => ({}),
  });
  vm.runInContext(registration, world);
  assert.equal(world.__unimateCompanionPrivateDispose.protocolVersion, 2);
  assert.equal(world.__unimateCompanionPrivateDispose.extensionVersion, manifest.version);
  assert.equal(world.__unimateCompanionPrivateDispose.isActive(), true);
  world.disposed = true;
  assert.equal(world.__unimateCompanionPrivateDispose.isActive(), false);
}
for (const forced of [false, true]) {
  const { context, listeners } = createHarness();
  const { world, state } = startupHarness();
  const injections = [];
  context.chrome.tabs.query = async () => [{ id: 11, url: "https://article.example/" }];
  context.chrome.tabs.sendMessage = async (_tabId, request) => {
    if (request.type === "COMPANION_PING") return { ok: false };
    if (request.type === "TOGGLE_COMPANION" && injections.length) return { ok: true };
    throw new Error("Channel closed before acknowledgement");
  };
  context.chrome.scripting.executeScript = async (details) => {
    injections.push(details);
    if (details.func) {
      vm.runInContext(`(${details.func.toString()})()`, world);
      // Real disposal clears its private binding.
      delete world.__unimateCompanionPrivateDispose;
    } else {
      // This is the last possible injection boundary: a compatible declarative
      // instance has mounted, even though every earlier PING failed.
      vm.runInContext(startupSource, world);
    }
    return [{ result: true }];
  };
  if (forced) await listeners.action({ id: 11, url: "https://article.example/" });
  else {
    listeners.installed();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(injections.filter((item) => item.func).length, forced ? 1 : 0);
  assert.equal(state.disposals, forced ? 1 : 0);
  assert.equal(Boolean(world.startedNewInstance), forced);
  assert.equal(injections.filter((item) => item.files).length, 1);
}

console.log(
  "PASS runtime messaging, reload recovery, bounded rate limits, capture isolation, and diagnostics",
);
