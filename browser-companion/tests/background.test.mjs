import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = `${fs.readFileSync(new URL("../background.js", import.meta.url), "utf8")}
globalThis.__unimateBackgroundTests = { sendChat };`;

let captureCount = 0;
let captureShouldFail = false;
let lastVisionBody = null;
let lastDashboardBody = null;
let dashboardCalls = 0;
let visionFailure = null;
let failAssistantPersistence = false;
let profileIsPro = true;
let privacyConsentAccepted = true;
const persistedRoles = [];
const storedSession = {
  access_token: "test-access-token",
  refresh_token: "test-refresh-token",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "00000000-0000-0000-0000-000000000001", email: "student@example.test" },
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const context = vm.createContext({
  URL,
  Response,
  crypto,
  console: { error() {}, warn() {} },
  importScripts() {},
  self: {
    UNIMATE_COMPANION_CONFIG: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "test-publishable-key",
      UNIMATE_API_URL: "https://unimate.example",
    },
  },
  setTimeout,
  clearTimeout,
  AbortController,
  fetch: async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith("/auth/v1/user")) return json(storedSession.user);
    if (href.includes("/rest/v1/profiles")) return json([{ is_pro: profileIsPro }]);
    if (href.includes("/rest/v1/companion_preferences")) {
      return options.method === "POST"
        ? json({}, 201)
        : json([{ active_conversation_id: "10000000-0000-0000-0000-000000000001" }]);
    }
    if (href.includes("/rest/v1/companion_conversations")) {
      return json([{ id: "10000000-0000-0000-0000-000000000001" }]);
    }
    if (href.includes("/rest/v1/companion_chats")) {
      const rows = JSON.parse(options.body);
      persistedRoles.push(...rows.map((row) => row.role));
      if (failAssistantPersistence && rows.some((row) => row.role === "assistant")) {
        return json({ error: "storage unavailable" }, 503);
      }
      return json(rows.map((row) => ({ id: crypto.randomUUID(), ...row })));
    }
    if (href.endsWith("/api/analyze-screenshot")) {
      if (visionFailure) {
        const response = visionFailure;
        visionFailure = null;
        return response;
      }
      lastVisionBody = JSON.parse(options.body);
      return json({
        answer: "Vision answer",
        companionDiagnostics: {
          selectedIntent: "answer",
          promptTemplate: "screenshot-first-tutor-v2",
          matchedPageTextLength: 64,
          visiblePageTextLength: 120,
        },
      });
    }
    if (href.endsWith("/api/dashboard-ai")) {
      dashboardCalls += 1;
      lastDashboardBody = JSON.parse(options.body);
      return json({ answer: "Text answer" });
    }
    throw new Error(`Unexpected test request: ${href}`);
  },
  chrome: {
    storage: {
      local: {
        async get(key) {
          if (key === "unimateCompanionPrivacyConsent") {
            return {
              unimateCompanionPrivacyConsent: privacyConsentAccepted
                ? { accepted: true, version: 1 }
                : undefined,
            };
          }
          return { unimateCompanionSession: storedSession };
        },
        async set() {},
        async remove() {},
      },
    },
    tabs: {
      async query() {
        return [{ id: 42 }];
      },
      async captureVisibleTab() {
        captureCount += 1;
        if (captureShouldFail) {
          const error = new Error("Cannot capture a restricted page");
          throw error;
        }
        return "data:image/jpeg;base64,TEST";
      },
      async sendMessage(_tabId, request) {
        if (request?.type === "PREPARE_COMPANION_CAPTURE") return { ok: true, hidden: true };
        if (request?.type === "RESTORE_COMPANION_CAPTURE") return { ok: true, restored: true };
        return { ok: true };
      },
    },
    runtime: { onMessage: { addListener() {} } },
    action: {
      onClicked: { addListener() {} },
      async setBadgeBackgroundColor() {},
      async setBadgeText() {},
      async setTitle() {},
    },
  },
});

vm.runInContext(source, context);
const { sendChat } = context.__unimateBackgroundTests;
const sender = { tab: { id: 42, windowId: 7 } };
const pageContext = {
  pageTitle: "Quiz review",
  pageUrl: "https://canvas.example/courses/1/quizzes/2",
  highlightedText: "",
  nearbyText: "",
  visiblePageText: "Question 4: Which organelle performs cellular respiration?",
  metrics: { extractedBlockCount: 7, detectedQuestionNumbers: [4] },
  relevance: {
    matchedQuestionNumber: 4,
    bestBlockId: "block-2",
    contextCharacterCount: 64,
    confidence: 0.98,
  },
};

privacyConsentAccepted = false;
const capturesBeforeConsentDenial = captureCount;
await assert.rejects(
  sendChat(
    {
      requestId: "no-privacy-consent",
      message: "Answer this question",
      context: pageContext,
      history: [],
    },
    sender,
  ),
  (error) => error?.code === "PRIVACY_CONSENT_REQUIRED" && error?.phase === "privacy",
);
assert.equal(
  captureCount,
  capturesBeforeConsentDenial,
  "page capture must not begin before affirmative privacy consent",
);
privacyConsentAccepted = true;

profileIsPro = false;
const capturesBeforeProDenial = captureCount;
await assert.rejects(
  sendChat(
    {
      requestId: "free-profile-request",
      message: "Answer this question",
      context: pageContext,
      history: [],
    },
    sender,
  ),
  (error) => error?.code === "PRO_REQUIRED" && error?.phase === "entitlement",
);
assert.equal(
  captureCount,
  capturesBeforeProDenial,
  "a non-Pro session must be rejected before screenshot capture or AI work",
);
profileIsPro = true;

const screenshotResult = await sendChat(
  {
    message: "Why was this marked incorrect?",
    context: pageContext,
    useScreenshot: true,
    screenshotReason: "automatic",
    contextConfidence: 0.42,
    history: [],
  },
  sender,
);
assert.equal(captureCount, 1, "screenshot mode should capture once");
assert.equal(screenshotResult.contextMode, "text+screenshot");
assert.match(lastVisionBody.imageBase64, /^data:image\/jpeg/);
// The raw student question is sent as `question`; page text is now structured,
// labelled provenance in `pageContext` — NOT bundled into the question string
// where the model could mistake it for source material.
assert.equal(lastVisionBody.question, "Why was this marked incorrect?");
assert.match(lastVisionBody.pageContext.visiblePageText, /Which organelle/);
assert.equal(typeof lastVisionBody.pageContext.selectedText, "string");
assert.equal(typeof lastVisionBody.pageContext.matchedPageText, "string");
assert.equal(lastVisionBody.pageContext.pageTitle, "Quiz review");
assert.equal(lastVisionBody.pageContext.pageUrl, "https://canvas.example/courses/1/quizzes/2");
assert.equal(screenshotResult.diagnostics.screenshotFallbackStatus, "captured");
assert.equal(screenshotResult.diagnostics.selectedIntent, "answer");
assert.equal(screenshotResult.diagnostics.promptTemplate, "screenshot-first-tutor-v2");

await sendChat(
  {
    message: "M".repeat(10_000),
    context: { ...pageContext, visiblePageText: "C".repeat(20_000) },
    useScreenshot: true,
    screenshotReason: "prompt-mismatch",
    history: [],
  },
  sender,
);
assert.ok(
  lastVisionBody.question.length <= 1400,
  "the raw question must be clamped before it leaves the extension",
);
assert.ok(
  lastVisionBody.pageContext.visiblePageText.length <= 3500,
  "supporting page text must be compact before it leaves the extension",
);

const textResult = await sendChat(
  {
    message: "Summarize the question.",
    context: pageContext,
    useScreenshot: false,
    history: [],
  },
  sender,
);
assert.equal(
  textResult.contextMode,
  "screenshot+supporting-text",
  "every eligible Send must be screenshot-first even if an old caller requests text mode",
);
assert.equal(captureCount, 3, "every eligible Send must capture exactly once");
assert.equal(dashboardCalls, 0, "normal Send must not take the DOM-only route");

captureShouldFail = true;
const fallbackResult = await sendChat(
  {
    message: "Explain the visible question.",
    context: pageContext,
    useScreenshot: true,
    history: [],
  },
  sender,
);
assert.equal(fallbackResult.contextMode, "text-fallback");
assert.equal(dashboardCalls, 1, "capture failure may fall back to compact supporting text");
assert.equal(lastDashboardBody.type, "companion-chat");
assert.match(lastDashboardBody.pageContext.visiblePageText, /Which organelle/);
assert.match(fallbackResult.diagnostics.screenshotFallbackStatus, /used text/);

captureShouldFail = false;
const persistedBeforeAiFailure = persistedRoles.length;
visionFailure = json({ error: "AI unavailable" }, 503);
await assert.rejects(
  sendChat(
    {
      requestId: "failed-ai-request",
      message: "Answer this problem",
      context: pageContext,
      history: [],
    },
    sender,
  ),
  /AI unavailable/,
);
assert.equal(
  persistedRoles.length,
  persistedBeforeAiFailure,
  "failed AI work must not leave an orphaned user message",
);

failAssistantPersistence = true;
const answerDespitePersistenceFailure = await sendChat(
  {
    requestId: "persistence-warning-request",
    message: "Explain this problem",
    context: pageContext,
    history: [],
  },
  sender,
);
assert.equal(answerDespitePersistenceFailure.assistant.message, "Vision answer");
assert.match(answerDespitePersistenceFailure.persistenceWarning, /could not save/i);
failAssistantPersistence = false;

const capturesBeforeDedupe = captureCount;
const stablePayload = {
  requestId: "stable-retry-request",
  message: "Solve this once",
  context: pageContext,
  history: [],
};
const firstStableResult = await sendChat(stablePayload, sender);
const secondStableResult = await sendChat(stablePayload, sender);
assert.equal(secondStableResult.requestId, firstStableResult.requestId);
assert.equal(
  captureCount,
  capturesBeforeDedupe + 1,
  "a retry with the same request ID must not capture, call AI, or persist twice",
);

console.log("PASS screenshot-first routing and text fallback");
