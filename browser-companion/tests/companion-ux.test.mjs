import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
function functionSource(name, nextName) {
  const start = source.indexOf(`  async function ${name}(`);
  const end = source.indexOf(`  async function ${nextName}(`, start);
  assert.ok(start > 0 && end > start);
  return source.slice(start, end);
}

function harness({ pro = true, consent = true, fail = false, authFail = false } = {}) {
  const events = [];
  const user = { role: "user", message: "Explain this" };
  const assistant = { role: "assistant", message: "Let’s take it one step at a time." };
  const state = {
    busy: false,
    auth: { authenticated: true, isPro: true, userId: "student" },
    privacyConsent: { accepted: true },
    messages: [],
    pageHistory: [],
    draft: "Explain this",
    runtime: {},
    pendingSave: null,
    activeConversationId: "chat-1",
    open: true,
  };
  const context = vm.createContext({
    state,
    crypto,
    location: { href: "https://course.test/lesson" },
    body: { querySelector: () => null },
    renderChat: (status) => events.push(["render", status]),
    renderPrivacyConsent: () => events.push(["consent"]),
    renderAuth: () => events.push(["auth"]),
    renderNotPro: () => events.push(["upgrade"]),
    studentFacingError: () => "Try again",
    extractContext: () => {
      events.push(["extract"]);
      return { pageUrl: "https://course.test/lesson", visiblePageText: "Course material" };
    },
    send: async (request) => {
      events.push([request.type, request]);
      switch (request.type) {
        case "PRIVACY_CONSENT_STATE":
          return { accepted: consent };
        case "AUTH_STATE":
          if (authFail) throw new Error("Connection lost");
          return { authenticated: true, isPro: pro, userId: "student" };
        case "SEND_CHAT":
          if (fail) throw new Error("Connection lost");
          return { user, assistant, requestId: request.requestId, contextMode: "text-fallback" };
        case "LOAD_MESSAGES":
          return [];
        case "LOAD_CHAT_STATE":
          return {
            conversationId: state.nextConversationId || "chat-1",
            conversationTitle: "Biology",
            messages: [user, assistant],
          };
        default:
          throw new Error(request.type);
      }
    },
  });
  vm.runInContext(
    `${functionSource("submitChat", "initialize")}\n${functionSource("refreshMessagesOnOpen", "handleBrowserChatChanged")}\nglobalThis.testApi = { submitChat, refreshMessagesOnOpen };`,
    context,
  );
  return { state, events, context, api: context.testApi };
}

for (const options of [{ consent: false }, { pro: false }]) {
  const { state, events, api } = harness(options);
  await api.submitChat("Explain this");
  assert.equal(
    events.some(([name]) => name === "extract" || name === "SEND_CHAT"),
    false,
    "No extraction or capture request is permitted without consent AND current Pro access",
  );
  assert.equal(state.busy, false);
  assert.equal(state.draft, "Explain this");
}

{
  const { state, events, api } = harness();
  await api.submitChat("Explain this");
  const names = events.map(([name]) => name);
  assert.ok(names.indexOf("PRIVACY_CONSENT_STATE") < names.indexOf("extract"));
  assert.ok(names.indexOf("AUTH_STATE") < names.indexOf("extract"));
  assert.equal(state.pageHistory.length, 2);
  assert.equal(
    state.contextMode,
    "text-fallback",
    "The UI can honestly disclose text-only grounding",
  );
  state.draft = "Can you give me an example?";
  await api.refreshMessagesOnOpen();
  assert.equal(
    state.pageHistory.length,
    2,
    "Reopening the same chat preserves current-page conversation context",
  );
  assert.equal(
    state.draft,
    "Can you give me an example?",
    "Refreshing shared history preserves the draft",
  );
  await api.submitChat(state.draft);
  const requests = events.filter(([name]) => name === "SEND_CHAT");
  assert.equal(
    requests[1][1].history.length,
    2,
    "Follow-up requests include the previous same-page exchange",
  );
}

{
  const { state, api } = harness({ fail: true });
  await api.submitChat("Explain this");
  assert.equal(state.draft, "Explain this", "A failed request restores the question for retry");
  assert.equal(state.messages.length, 0, "A failed request leaves no orphaned optimistic bubble");
  assert.equal(state.busy, false);
}

{
  const { state, events, api } = harness({ authFail: true });
  await api.submitChat("Explain this");
  assert.equal(state.busy, false, "A failed access check must re-enable the composer");
  assert.equal(
    events.some(([name]) => name === "extract"),
    false,
  );
}

{
  const { state, api } = harness();
  state.pageHistory = [{ role: "assistant", message: "Old chat context" }];
  state.nextConversationId = "chat-2";
  await api.refreshMessagesOnOpen();
  assert.equal(
    state.pageHistory.length,
    0,
    "Switching browser chats clears the previous conversation’s context",
  );
}

{
  const { context, events } = harness();
  const node = { addEventListener() {}, style: {}, scrollHeight: 0 };
  context.body = { innerHTML: "", querySelector: () => node };
  context.escapeHtml = String;
  context.formatAssistantMessage = String;
  context.queueMicrotask = () => {};
  context.focusInitialControl = () => {};
  context.handleChat = () => {};
  context.handleSignOut = () => {};
  context.retrySaving = () => {};
  const start = source.indexOf("  function renderChat(");
  const end = source.indexOf("  async function retrySaving(", start);
  vm.runInContext(`${source.slice(start, end)}\nrenderChat();`, context);
  assert.equal(
    events.some(([name]) => name === "extract"),
    false,
    "Rendering the chat never reads webpage text",
  );
  assert.match(context.body.innerHTML, /Nothing is captured while you type/);
}

{
  const { state, events, api } = harness();
  state.pendingSave = "request-unsaved";
  await api.refreshMessagesOnOpen();
  await api.submitChat("Another question");
  assert.equal(
    events.some(([name]) => name === "LOAD_CHAT_STATE" || name === "SEND_CHAT"),
    false,
    "An unsaved answer must not disappear during refresh or be overwritten by another request",
  );
}

console.log(
  "PASS Companion consent and Pro preflight, draft recovery, same-page continuity, and unsaved-answer preservation",
);
