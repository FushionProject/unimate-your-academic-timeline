import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
function functionSource(name, nextName) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  const end =
    nextName === "mountListeners"
      ? source.indexOf('  mascot.addEventListener("click"', start)
      : source.search(new RegExp(`  (?:async )?function ${nextName}\\(`));
  assert.ok(start > 0 && end > start);
  return source.slice(start, end);
}

function harness({ pro = true, consent = true, fail = false, authFail = false, onSend } = {}) {
  const events = [];
  const user = { role: "user", message: "Explain this" };
  const assistant = { role: "assistant", message: "Let’s take it one step at a time." };
  const state = {
    busy: false,
    sessionVersion: 0,
    historyLoadVersion: 0,
    pageHistoryUrl: "https://course.test/lesson",
    auth: { authenticated: true, isPro: true, userId: "student" },
    privacyConsent: { accepted: true },
    messages: [],
    pageHistory: [],
    draft: "Explain this",
    runtime: {},
    pendingSave: null,
    view: "chat",
    renderedConversationId: "chat-1",
    activeConversationId: "chat-1",
    open: true,
  };
  const context = vm.createContext({
    state,
    crypto,
    location: { href: "https://course.test/lesson" },
    body: { querySelector: () => null, contains: () => false },
    shadow: { activeElement: null },
    prepareRenderFocus: () => false,
    announce: (message, isError) => events.push(["announce", message, isError]),
    canRestorePanelFocus: () => true,
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
      const customResult = onSend?.(request, state);
      if (customResult !== undefined) return customResult;
      switch (request.type) {
        case "PRIVACY_CONSENT_STATE":
          return { accepted: consent };
        case "AUTH_STATE":
          if (authFail) throw new Error("Connection lost");
          return { authenticated: true, isPro: pro, userId: "student" };
        case "SEND_CHAT":
          if (fail)
            throw Object.assign(new Error("Provider unavailable"), { backgroundResponded: true });
          return { user, assistant, requestId: request.requestId, contextMode: "text-fallback" };
        case "RECOVER_CHAT_REQUEST":
          return { status: "not_found" };
        case "LOAD_MESSAGES":
          return [];
        case "SIGN_OUT":
        case "OPEN_SIGN_IN":
        case "WEBSITE_SIGN_OUT":
        case "RUNTIME_DIAGNOSTICS":
          return {};
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
  const runtimeListener = source.slice(
    source.indexOf("  const runtimeMessageListener ="),
    source.indexOf("  if (initialRuntime) {"),
  );
  vm.runInContext(
    `${functionSource("submitChat", "initialize")}\n${functionSource("refreshMessagesOnOpen", "handleBrowserChatChanged")}\n${functionSource("initialize", "mountListeners")}\n${functionSource("applyAuthState", "handleSignOut")}\n${functionSource("handleSignOut", "handleWebsiteSignOut")}\n${functionSource("handleWebsiteSignOut", "syncWebsiteAuthState")}\n${functionSource("handleOpenSignIn", "applyAuthState")}\n${runtimeListener}\nglobalThis.testApi = { submitChat, refreshMessagesOnOpen, initialize, handleSignOut, handleWebsiteSignOut, handleOpenSignIn, runtimeMessageListener };`,
    context,
  );
  vm.runInContext(functionSource("rememberReadingPosition", "announce"), context);
  vm.runInContext(functionSource("retainFailedQuestion", "submitChat"), context);
  return { state, events, context, api: context.testApi };
}

// A definitive revocation is not a transient history/network failure. Keep the
// same identity and work, hide the composer, then recover without signing in.
for (const entry of ["refreshMessagesOnOpen", "initialize"]) {
  let revoked = true;
  const { state, events, api } = harness({
    onSend: (request) =>
      revoked && request.type === "LOAD_CHAT_STATE"
        ? Promise.reject(Object.assign(new Error("Pro required"), { code: "PRO_REQUIRED" }))
        : undefined,
  });
  state.messages = [{ role: "assistant", message: "Keep the earlier answer" }];
  await api[entry]();
  assert.equal(state.auth.isPro, false);
  assert.equal(state.auth.userId, "student");
  assert.equal(state.draft, "Explain this");
  assert.equal(state.messages[0].message, "Keep the earlier answer");
  assert.ok(events.some(([name]) => name === "upgrade"));
  assert.equal(
    events.some(([name]) => name === "extract" || name === "SEND_CHAT"),
    false,
  );
  revoked = false;
  await api.initialize();
  assert.equal(state.auth.isPro, true);
  assert.equal(state.auth.userId, "student");
  assert.equal(state.draft, "Explain this");
  assert.equal(
    events.some(([name]) => name === "OPEN_SIGN_IN" || name === "SIGN_OUT"),
    false,
  );
}

for (const rejectedRequest of ["AUTH_STATE", "SEND_CHAT", "RETRY_CHAT_PERSISTENCE"]) {
  const { state, events, context, api } = harness({
    onSend: (request) =>
      request.type === rejectedRequest
        ? Promise.reject(
            Object.assign(new Error("Pro required"), {
              code: "PRO_REQUIRED",
              backgroundResponded: true,
            }),
          )
        : undefined,
  });
  if (rejectedRequest === "RETRY_CHAT_PERSISTENCE") {
    state.pendingSave = "keep-unsaved-request";
    vm.runInContext(functionSource("retrySaving", "handleOpenSignIn"), context);
    await context.retrySaving({ currentTarget: {} });
    assert.equal(state.pendingSave, "keep-unsaved-request");
  } else {
    await api.submitChat("Explain this");
  }
  assert.equal(state.auth.isPro, false);
  assert.equal(state.auth.userId, "student");
  assert.equal(state.draft, "Explain this");
  assert.ok(events.some(([name]) => name === "upgrade"));
  if (rejectedRequest !== "SEND_CHAT") {
    assert.equal(
      events.some(([name]) => name === "extract" || name === "SEND_CHAT"),
      false,
    );
  }
}

// A definitive session rejection must expose secure sign-in, not leave the
// old account's composer/history visible with an unusable retry button.
for (const operation of [
  "refreshMessagesOnOpen",
  "initialize",
  "AUTH_STATE",
  "SEND_CHAT",
  "RETRY_CHAT_PERSISTENCE",
]) {
  const rejectedRequest = ["refreshMessagesOnOpen", "initialize"].includes(operation)
    ? "LOAD_CHAT_STATE"
    : operation;
  const { state, events, context, api } = harness({
    onSend: (request) =>
      request.type === rejectedRequest
        ? Promise.reject(
            Object.assign(new Error("Session ended"), {
              code: "AUTH_REQUIRED",
              phase: "auth",
              backgroundResponded: true,
            }),
          )
        : undefined,
  });
  state.messages = [{ role: "assistant", message: "Private earlier answer" }];
  state.pageHistory = [{ role: "assistant", message: "Private page evidence" }];
  if (operation === "RETRY_CHAT_PERSISTENCE") {
    state.pendingSave = "expired-account-request";
    vm.runInContext(functionSource("retrySaving", "handleOpenSignIn"), context);
    await context.retrySaving({ currentTarget: {} });
  } else if (operation === "AUTH_STATE" || operation === "SEND_CHAT") {
    await api.submitChat("Explain this");
  } else await api[operation]();
  assert.equal(state.auth.authenticated, false, `${operation} must invalidate cached identity`);
  assert.equal(state.auth.isPro, false);
  assert.equal(state.busy, false);
  assert.equal(state.messages.length, 0);
  assert.equal(state.pageHistory.length, 0);
  assert.equal(state.draft, "");
  assert.equal(state.pendingSave, null);
  assert.equal(state.unresolvedRequest, null);
  assert.ok(events.some(([name]) => name === "auth"));
  if (operation !== "SEND_CHAT") {
    assert.equal(
      events.some(([name]) => name === "extract" || name === "SEND_CHAT"),
      false,
    );
  }
}

for (const rejectedRequest of ["RECOVER_CHAT_REQUEST", "LOAD_MESSAGES"]) {
  const { state, events, api } = harness({
    onSend: (request) => {
      if (request.type === "SEND_CHAT") return Promise.reject(new Error("Message port closed"));
      if (request.type === rejectedRequest)
        return Promise.reject(
          Object.assign(new Error("Session ended"), {
            code: "AUTH_REQUIRED",
            phase: "auth",
            backgroundResponded: true,
          }),
        );
    },
  });
  await api.submitChat("Explain this");
  assert.equal(state.auth.authenticated, false, `${rejectedRequest} rejects the old account`);
  assert.equal(state.unresolvedRequest, null);
  assert.equal(state.draft, "");
  assert.equal(state.messages.length, 0);
  assert.ok(events.some(([name]) => name === "auth"));
  assert.equal(events.filter(([name]) => name === "SEND_CHAT").length, 1);
}

// Network/auth timeouts are not definitive rejection: retain identity/work.
for (const code of ["AUTH_TIMEOUT", "ENTITLEMENT_TIMEOUT", "NETWORK_ERROR"]) {
  const { state, events, api } = harness({
    onSend: (request) =>
      request.type === "LOAD_CHAT_STATE"
        ? Promise.reject(Object.assign(new Error("Temporary outage"), { code, phase: "auth" }))
        : undefined,
  });
  state.messages = [{ role: "assistant", message: "Keep my answer" }];
  await api.refreshMessagesOnOpen();
  assert.equal(state.auth.authenticated, true);
  assert.equal(state.draft, "Explain this");
  assert.equal(state.messages[0].message, "Keep my answer");
  assert.equal(
    events.some(([name]) => name === "auth"),
    false,
  );
}

// Exercise the real error formatter in the Send flow, not only a history-load
// failure: an auth outage must keep both the question and the usable session.
for (const rejectedRequest of ["AUTH_STATE", "SEND_CHAT"]) {
  for (const code of ["AUTH_TIMEOUT", "BACKEND_UNAVAILABLE", "NETWORK_ERROR"]) {
    const { state, events, context, api } = harness({
      onSend: (request) =>
        request.type === rejectedRequest
          ? Promise.reject(
              Object.assign(new Error("Temporary outage"), {
                code,
                phase: "auth",
                backgroundResponded: true,
              }),
            )
          : undefined,
    });
    vm.runInContext(functionSource("studentFacingError", "extractContext"), context);
    await api.submitChat("Explain this");
    assert.equal(state.auth.authenticated, true);
    assert.equal(state.auth.userId, "student");
    assert.equal(state.auth.isPro, true);
    assert.equal(state.draft, "Explain this");
    assert.equal(state.busy, false);
    assert.equal(
      events.some(([name]) => name === "auth" || name === "SIGN_OUT"),
      false,
    );
    const message = events.filter(([name]) => name === "render").at(-1)?.[1];
    assert.match(message, /couldn.t verify.*session/i);
    assert.match(message, /Your question is kept here/);
    assert.doesNotMatch(message, /ended|expired|sign in|password|upgrade/i);
    if (rejectedRequest === "AUTH_STATE") {
      assert.equal(
        events.some(([name]) => name === "extract" || name === "SEND_CHAT"),
        false,
      );
    }
  }
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
  assert.ok(events.some(([name]) => name === "AUTH_STATE"));
  await api.submitChat("Another question");
  assert.equal(
    events.some(([name]) => name === "LOAD_CHAT_STATE" || name === "SEND_CHAT"),
    false,
    "An unsaved answer must not disappear during refresh or be overwritten by another request",
  );
}

// Unresolved work prevents history replacement, never an access check. Exercise
// both recovery slots against real production refresh/apply/reset declarations.
for (const slot of ["pendingSave", "failedQuestion"]) {
  for (const outcome of [
    "pro",
    "revoked",
    "pro-error",
    "signed-out",
    "auth-error",
    "other-user",
    "offline",
  ]) {
    let currentOutcome = outcome;
    const { state, events, api } = harness({
      onSend: (request) => {
        if (request.type !== "AUTH_STATE") return undefined;
        if (["pro-error", "auth-error", "offline"].includes(currentOutcome))
          return Promise.reject(
            Object.assign(new Error("Synthetic access check"), {
              code:
                currentOutcome === "pro-error"
                  ? "PRO_REQUIRED"
                  : currentOutcome === "auth-error"
                    ? "AUTH_REQUIRED"
                    : "NETWORK_ERROR",
            }),
          );
        return {
          authenticated: currentOutcome !== "signed-out",
          isPro: currentOutcome === "pro" || currentOutcome === "other-user",
          userId:
            currentOutcome === "signed-out"
              ? undefined
              : currentOutcome === "other-user"
                ? "student-b"
                : "student",
        };
      },
    });
    state[slot] = "Private unresolved work";
    state.messages = [{ role: "assistant", message: "Private unsaved answer" }];
    state.pageHistory = [{ role: "assistant", message: "Private page evidence" }];
    state.unresolvedRequest = { requestId: "private-request" };
    state.draft = "Private next question";
    await api.refreshMessagesOnOpen();
    assert.ok(events.some(([name]) => name === "AUTH_STATE"));
    assert.equal(
      events.some(([name]) => name === "extract" || name === "SEND_CHAT"),
      false,
    );
    const identityChanged = ["signed-out", "auth-error", "other-user"].includes(outcome);
    if (identityChanged) {
      assert.equal(state[slot], null, `${slot}/${outcome} clears private recovery work`);
      assert.equal(state.draft, "");
      assert.equal(state.unresolvedRequest, null);
      assert.equal(state.pageHistory.length, 0);
      assert.ok(!state.messages.some((item) => item.message === "Private unsaved answer"));
      if (outcome === "other-user") assert.equal(state.auth.userId, "student-b");
      else {
        assert.equal(state.auth.authenticated, false);
        assert.ok(events.some(([name]) => name === "auth"));
      }
    } else {
      assert.equal(state[slot], "Private unresolved work");
      assert.equal(state.draft, "Private next question");
      assert.equal(state.messages[0].message, "Private unsaved answer");
      assert.equal(state.activeConversationId, "chat-1");
      assert.equal(
        events.some(([name]) => name === "LOAD_CHAT_STATE"),
        false,
      );
      if (["revoked", "pro-error"].includes(outcome)) {
        assert.equal(state.auth.isPro, false);
        assert.ok(events.some(([name]) => name === "upgrade"));
        currentOutcome = "pro";
        await api.initialize();
        assert.equal(state.auth.isPro, true);
        assert.equal(state[slot], "Private unresolved work");
        assert.equal(state.draft, "Private next question");
        assert.equal(state.messages[0].message, "Private unsaved answer");
        assert.equal(
          events.some(([name]) => name === "LOAD_CHAT_STATE"),
          false,
        );
      } else
        assert.equal(
          events.some(([name]) => name === "upgrade" || name === "auth"),
          false,
        );
    }
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// A late access response cannot undo a newer identity/disclosure/history load.
for (const slot of ["pendingSave", "failedQuestion"]) {
  for (const change of ["sign-out", "new-load", "privacy", "busy", "closed"]) {
    const late = deferred();
    const { state, events, api } = harness({
      onSend: (request) => (request.type === "AUTH_STATE" ? late.promise : undefined),
    });
    state[slot] = "Unresolved work";
    const pending = api.refreshMessagesOnOpen();
    if (change === "sign-out") await api.handleWebsiteSignOut();
    if (change === "new-load" || change === "privacy") state.historyLoadVersion += 1;
    if (change === "privacy") state.view = "privacy";
    if (change === "busy") state.busy = true;
    if (change === "closed") state.open = false;
    const before = JSON.stringify(state);
    const eventCount = events.length;
    late.resolve({ authenticated: true, isPro: true, userId: "late-other-user" });
    await pending;
    assert.equal(JSON.stringify(state), before, `${slot}/${change} ignores stale access`);
    assert.equal(events.length, eventCount);
  }
}

for (const persistenceWarning of ["", "Answer ready; save still pending."]) {
  const started = deferred();
  const lostReply = deferred();
  const saved = {
    user: { id: "saved-user", role: "user", message: "Earlier A" },
    assistant: { id: "saved-assistant", role: "assistant", message: "Already saved answer" },
    conversationId: "chat-1",
    contextMode: "screenshot",
    persistenceWarning,
  };
  const { state, events, api } = harness({
    onSend(request) {
      if (request.type === "SEND_CHAT") {
        started.resolve();
        return lostReply.promise;
      }
      if (request.type === "RECOVER_CHAT_REQUEST")
        return { status: "complete", response: { ...saved, requestId: request.requestId } };
    },
  });
  const pending = api.submitChat("Earlier A");
  await started.promise;
  state.draft = "New draft B";
  lostReply.reject(new Error("Message port closed after save"));
  await pending;
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[1].id, "saved-assistant");
  assert.equal(state.failedQuestion, null);
  assert.equal(state.unresolvedRequest, null);
  assert.equal(state.draft, "New draft B");
  assert.equal(
    state.pendingSave,
    persistenceWarning ? events.find(([name]) => name === "SEND_CHAT")[1].requestId : null,
    "Journal recovery also preserves an unsaved answer's save-retry identity",
  );
  assert.equal(
    events.some(([name]) => name === "LOAD_MESSAGES"),
    false,
  );
  assert.equal(events.filter(([name]) => name === "SEND_CHAT").length, 1);
  assert.equal(
    events.find(([name]) => name === "RECOVER_CHAT_REQUEST")[1].requestId,
    events.find(([name]) => name === "SEND_CHAT")[1].requestId,
  );
}

for (const recoveryStatus of ["pending", "not_found", "unreachable"]) {
  let sends = 0;
  let recoveries = 0;
  const { state, events, api } = harness({
    onSend(request, current) {
      if (request.type === "SEND_CHAT" && ++sends === 1) {
        current.draft = "New draft B";
        return Promise.reject(new Error("Message port closed"));
      }
      if (request.type === "RECOVER_CHAT_REQUEST")
        return recoveryStatus === "unreachable" && ++recoveries === 1
          ? Promise.reject(new Error("Worker unavailable"))
          : { status: recoveryStatus === "unreachable" ? "not_found" : recoveryStatus };
    },
  });
  await api.submitChat("Earlier A");
  assert.equal(state.failedQuestion, "Earlier A");
  assert.equal(state.draft, "New draft B");
  assert.match(events.filter(([name]) => name === "render").at(-1)[1], /can’t confirm/);
  const original = events.find(([name]) => name === "SEND_CHAT")[1];
  assert.equal(state.unresolvedRequest.payload, original);
  const extractions = events.filter(([name]) => name === "extract").length;
  await api.submitChat(state.failedQuestion, true);
  const retried = events.filter(([name]) => name === "SEND_CHAT").at(-1)[1];
  assert.equal(
    retried,
    original,
    `${recoveryStatus}: explicit retry preserves the exact payload and request identity`,
  );
  assert.equal(
    events.filter(([name]) => name === "extract").length,
    extractions + 1,
    "Retry checks current page provenance before replaying the frozen request",
  );
  assert.equal(state.draft, "New draft B");
  assert.equal(state.unresolvedRequest, null);
}

for (const changedField of [
  "pageTitle",
  "highlightedText",
  "nearbyText",
  "visiblePageText",
  "matchedQuestionText",
]) {
  let sends = 0;
  const { state, context, events, api } = harness({
    onSend(request, current) {
      if (request.type === "SEND_CHAT" && ++sends === 1) {
        current.draft = "New draft B";
        return Promise.reject(new Error("Message port closed"));
      }
    },
  });
  await api.submitChat("Earlier A");
  const original = state.unresolvedRequest.payload;
  context.extractContext = () => ({ ...original.context, [changedField]: "Changed page evidence" });
  await api.submitChat(state.failedQuestion, true);
  assert.equal(
    events.filter(([name]) => name === "SEND_CHAT").length,
    1,
    `${changedField}: same-URL content change must not mix frozen text with current pixels`,
  );
  assert.equal(state.unresolvedRequest.payload, original);
  assert.equal(state.draft, "New draft B");
  assert.match(events.filter(([name]) => name === "render").at(-1)[1], /page has changed/);
}

for (const complete of [false, true]) {
  const { state, context, events, api } = harness({
    onSend(request) {
      if (request.type === "RECOVER_CHAT_REQUEST")
        return complete
          ? {
              status: "complete",
              response: {
                user: { role: "user", message: "Earlier A" },
                assistant: { role: "assistant", message: "Recovered earlier answer" },
              },
            }
          : { status: "pending" };
    },
  });
  state.failedQuestion = "Earlier A";
  state.draft = "New draft B";
  state.unresolvedRequest = {
    pageUrl: "https://course.test/lesson",
    payload: {
      type: "SEND_CHAT",
      requestId: "original-request",
      message: "Earlier A",
      context: { pageUrl: "https://course.test/lesson", visiblePageText: "Original lesson" },
    },
  };
  context.location.href = "https://course.test/different-lesson";
  await api.submitChat(state.failedQuestion, true);
  assert.equal(
    events.some(([name]) => name === "SEND_CHAT" || name === "extract"),
    false,
    "Navigation permits read-only recovery, never old context plus a new-page capture",
  );
  assert.equal(state.draft, "New draft B");
  if (complete) {
    assert.equal(state.failedQuestion, null);
    assert.equal(state.messages.at(-1).message, "Recovered earlier answer");
  } else {
    assert.equal(state.failedQuestion, "Earlier A");
    assert.match(events.filter(([name]) => name === "render").at(-1)[1], /original page/);
  }
}

for (const code of ["DUPLICATE_REQUEST", "DUPLICATE_IN_FLIGHT"]) {
  const { state, events, api } = harness({
    onSend(request) {
      if (request.type === "SEND_CHAT")
        return Promise.reject(
          Object.assign(new Error("Original request already exists"), {
            code,
            backgroundResponded: true,
          }),
        );
    },
  });
  await api.submitChat("Earlier A");
  const original = state.unresolvedRequest.payload;
  await api.submitChat(state.failedQuestion, true);
  assert.equal(
    state.unresolvedRequest.payload,
    original,
    `${code} is not proof of provider failure and must never release retry identity`,
  );
  assert.equal(events.filter(([name]) => name === "SEND_CHAT").at(-1)[1], original);
}

for (const stage of ["AUTH_STATE", "SEND_CHAT"]) {
  const started = deferred();
  const response = deferred();
  let held = false;
  const { state, events, api } = harness({
    onSend: (request) => {
      if (request.type !== stage || held) return undefined;
      held = true;
      started.resolve();
      return response.promise;
    },
  });
  const pending = api.submitChat("Earlier question A");
  await started.promise;
  state.draft = "New draft B";
  response.reject(
    Object.assign(new Error("Synthetic provider failure"), { backgroundResponded: true }),
  );
  await pending;
  assert.equal(state.failedQuestion, "Earlier question A", `${stage} preserves failed A`);
  assert.equal(state.draft, "New draft B", `${stage} preserves newly typed B`);
  assert.equal(state.busy, false);
  const sends = events.filter(([name]) => name === "SEND_CHAT").length;
  await api.submitChat(state.draft);
  await api.refreshMessagesOnOpen();
  assert.equal(events.filter(([name]) => name === "SEND_CHAT").length, sends);
  assert.equal(
    events.some(([name]) => name === "LOAD_CHAT_STATE"),
    false,
  );
  assert.equal(state.failedQuestion, "Earlier question A", "Sending B cannot overwrite A");
  await api.submitChat(state.failedQuestion, true);
  assert.equal(state.failedQuestion, null, "Successful explicit retry clears only A");
  assert.equal(state.draft, "New draft B", "Explicit retry never consumes B");
  assert.equal(
    events.filter(([name]) => name === "SEND_CHAT").at(-1)[1].message,
    "Earlier question A",
  );
  assert.equal(
    events.some(([name]) => name === "RECOVER_CHAT_REQUEST"),
    false,
    "Known provider or preflight failures do not masquerade as uncertain transport outcomes",
  );
  const requestIds = events
    .filter(([name]) => name === "SEND_CHAT")
    .map(([, request]) => request.requestId);
  assert.equal(
    new Set(requestIds).size,
    requestIds.length,
    "Known failed requests use a fresh retry ID",
  );
}

{
  const { state, api } = harness({ fail: true });
  state.failedQuestion = "Earlier question A";
  state.draft = "New draft B";
  await api.submitChat(state.failedQuestion, true);
  assert.equal(
    state.failedQuestion,
    "Earlier question A",
    "Repeated failure retains recovery slot",
  );
  assert.equal(state.draft, "New draft B");
}

{
  const { state, context } = harness();
  state.draft = "New draft B";
  context.retainFailedQuestion("A".repeat(8000));
  assert.equal(state.failedQuestion.length, 4000, "The recovery slot is bounded like the composer");
  assert.equal(state.draft, "New draft B");
}

{
  const { state, context, events } = harness();
  state.failedQuestion = "Earlier question A";
  state.draft = "New draft B";
  const listeners = new Map();
  context.body = {
    innerHTML: "",
    querySelector: (selector) => ({
      style: {},
      scrollHeight: 0,
      addEventListener: (event, handler) => listeners.set(`${selector}:${event}`, handler),
    }),
  };
  Object.assign(context, {
    escapeHtml: String,
    formatAssistantMessage: String,
    queueMicrotask: () => {},
    focusInitialControl: () => {},
    handleChat: () => {},
    handleSignOut: () => {},
    retrySaving: () => {},
  });
  vm.runInContext(
    `${functionSource("renderChat", "retrySaving")}\nrenderChat("Connection failed", true);`,
    context,
  );
  assert.match(context.body.innerHTML, /Earlier question A/);
  assert.match(events.at(-1)[1], /earlier question and new draft are both kept/);
  listeners.get(".um-discard-question:click")();
  assert.equal(state.failedQuestion, null);
  assert.equal(state.draft, "New draft B", "Explicit discard removes only A");
}

{
  const access = deferred();
  const { state, api } = harness({
    onSend: (request) => (request.type === "AUTH_STATE" ? access.promise : undefined),
  });
  const pending = api.submitChat("Explain this");
  await Promise.resolve();
  assert.equal(state.draft, "", "Sending clears the submitted draft before access checks");
  state.draft = "And how does that compare?";
  access.resolve({ authenticated: true, isPro: true, userId: "student" });
  await pending;
  assert.equal(
    state.draft,
    "And how does that compare?",
    "Typing during preflight survives the response",
  );
}

{
  const { state, context, events, api } = harness();
  state.pageHistory = [{ role: "assistant", message: "Answer about the previous page" }];
  context.location.href = "https://course.test/next-lesson";
  await api.submitChat("Explain this");
  assert.equal(
    events.find(([name]) => name === "SEND_CHAT")[1].history.length,
    0,
    "Sending immediately after SPA navigation must not include the previous page’s history",
  );
}

{
  const { state, context, events, api } = harness();
  context.UniMateContextExtractor = {
    buildFocusedContextPacket() {
      throw new Error("Unusual page markup");
    },
  };
  await api.submitChat("Explain this");
  assert.equal(state.busy, false);
  assert.ok(
    events.some(([name]) => name === "SEND_CHAT"),
    "Supplemental context errors still allow the consented screenshot request",
  );
}

{
  const oldLoad = deferred();
  let loads = 0;
  const { state, api } = harness({
    onSend: (request) =>
      request.type === "LOAD_CHAT_STATE" && ++loads === 1 ? oldLoad.promise : undefined,
  });
  const first = api.refreshMessagesOnOpen();
  state.nextConversationId = "chat-new";
  await api.refreshMessagesOnOpen();
  oldLoad.resolve({ conversationId: "chat-old", messages: [], conversationTitle: "Old" });
  await first;
  assert.equal(
    state.activeConversationId,
    "chat-new",
    "An older history response cannot undo a later chat selection",
  );
}

for (const operation of ["initialize", "refreshMessagesOnOpen"]) {
  const oldLoad = deferred();
  const started = deferred();
  const { state, api } = harness({
    onSend: (request) => {
      if (request.type === "LOAD_CHAT_STATE") {
        started.resolve();
        return oldLoad.promise;
      }
    },
  });
  const pending = api[operation]();
  await started.promise;
  await api.handleWebsiteSignOut();
  oldLoad.resolve({
    conversationId: "private-chat",
    messages: [{ role: "assistant", message: "Private" }],
    conversationTitle: "Private",
  });
  await pending;
  assert.equal(
    state.messages.length,
    0,
    `${operation} cannot restore private history after sign-out`,
  );
  assert.equal(state.activeConversationId, null);
  assert.equal(state.auth.authenticated, false);
}

for (const phase of ["AUTH_STATE", "SEND_CHAT", "LOAD_MESSAGES"]) {
  const late = deferred();
  const started = deferred();
  const { state, events, api } = harness({
    fail: phase === "LOAD_MESSAGES",
    onSend: (request) => {
      if (request.type === phase) {
        started.resolve();
        return late.promise;
      }
    },
  });
  const pending = api.submitChat("Explain this");
  await started.promise;
  await api.handleWebsiteSignOut();
  // A quick sign-in to the same account still starts a new session.
  state.auth = { authenticated: true, isPro: true, userId: "student" };
  state.busy = true;
  if (phase === "AUTH_STATE") late.resolve(state.auth);
  else if (phase === "SEND_CHAT")
    late.resolve({
      user: { role: "user", message: "Old question" },
      assistant: { role: "assistant", message: "Old response" },
    });
  else late.resolve([{ role: "assistant", message: "Old recovered response" }]);
  await pending;
  assert.equal(
    state.messages.length,
    0,
    `Late ${phase} responses cannot restore an earlier session’s messages`,
  );
  assert.equal(state.busy, true, "An earlier request cannot unlock a new session’s active request");
  if (phase === "AUTH_STATE") assert.ok(!events.some(([name]) => name === "extract"));
}

{
  const { state, events, api } = harness({
    onSend: (request) =>
      request.type === "SIGN_OUT" ? Promise.reject(new Error("Offline")) : undefined,
  });
  await api.handleSignOut();
  assert.equal(state.auth.authenticated, true, "A failed sign-out is not presented as successful");
  assert.equal(state.busy, false);
  assert.ok(
    events.some(([name, status]) => name === "render" && /couldn’t sign you out/.test(status)),
  );
}

{
  const { state, events, api } = harness({
    onSend: (request) =>
      request.type === "AUTH_STATE"
        ? Promise.resolve({ authenticated: true, isPro: true, userId: "different-student" })
        : undefined,
  });
  state.pageHistory = [{ role: "assistant", message: "Private history from the previous student" }];
  state.messages = state.pageHistory.slice();
  await api.submitChat("Explain this");
  assert.equal(state.messages.length, 0);
  assert.equal(state.pageHistory.length, 0);
  assert.equal(state.activeConversationId, null);
  assert.equal(state.draft, "");
  assert.ok(
    !events.some(([name]) => name === "extract" || name === "SEND_CHAT"),
    "A changed account cannot send the previous student’s context",
  );
  await api.submitChat("My own question");
  assert.ok(
    events.some(([name]) => name === "SEND_CHAT"),
    "The new student can start a fresh conversation",
  );
}

{
  const { state, context } = harness();
  const handlers = {};
  let submits = 0;
  let focused = false;
  let selection;
  const oldInput = { selectionStart: 3, selectionEnd: 8 };
  const input = {
    style: {},
    scrollHeight: 84,
    value: "A longer follow-up question",
    addEventListener: (type, listener) => {
      handlers[type] = listener;
    },
    focus: () => {
      focused = true;
    },
    setSelectionRange: (...range) => {
      selection = range;
    },
  };
  const generic = {
    addEventListener() {},
    scrollHeight: 200,
    requestSubmit: () => {
      submits += 1;
    },
  };
  let replaced = false;
  context.body = {
    set innerHTML(value) {
      this.markup = value;
      replaced = true;
    },
    querySelector: (selector) =>
      selector === ".um-input" ? (replaced ? input : oldInput) : generic,
  };
  context.shadow.activeElement = oldInput;
  context.escapeHtml = String;
  context.formatAssistantMessage = String;
  context.queueMicrotask = () => {};
  context.focusInitialControl = () => {};
  context.handleChat = () => {};
  context.handleSignOut = () => {};
  context.retrySaving = () => {};
  state.busy = true;
  vm.runInContext(`${functionSource("renderChat", "retrySaving")}\nrenderChat();`, context);
  assert.equal(focused, true, "Updating a response retains focus in an active composer");
  assert.deepEqual(selection, [3, 8], "Updating a response retains the draft’s selection");
  assert.equal(input.style.height, "84px", "Restored multiline drafts resize immediately");
  handlers.input();
  assert.equal(state.draft, input.value);
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }]) {
    handlers.keydown({
      key: "Enter",
      preventDefault() {
        throw new Error("Composition/newline must remain editable");
      },
      ...extra,
    });
  }
  assert.equal(submits, 0, "IME confirmation and Shift+Enter do not submit a question");
  let prevented = false;
  handlers.keydown({
    key: "Enter",
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(submits, 1);
  assert.equal(prevented, true);
}

{
  const { state, events, api } = harness();
  state.pendingSave = "unsaved-answer";
  state.messages = [{ role: "assistant", message: "Keep this answer" }];
  await api.initialize();
  assert.ok(
    !events.some(([name]) => name === "LOAD_CHAT_STATE"),
    "Returning from page-sharing settings preserves an unsaved answer",
  );
  assert.equal(state.messages[0].message, "Keep this answer");
}

{
  const { state, events, api } = harness({
    onSend: (request) =>
      request.type === "LOAD_CHAT_STATE" ? Promise.reject(new Error("Offline")) : undefined,
  });
  state.messages = [{ role: "assistant", message: "Existing answer" }];
  await api.initialize();
  assert.equal(
    state.auth.userId,
    "student",
    "A temporary history failure does not discard the account identity",
  );
  assert.equal(state.messages[0].message, "Existing answer");
  assert.equal(state.draft, "Explain this");
  assert.ok(
    events.some(
      ([name, message]) =>
        name === "render" &&
        message === "We couldn’t refresh your Companion. Please try again in a moment.",
    ),
    "Existing Pro access retains its chat-specific recovery message",
  );
  assert.equal(
    events.some(([name]) => name === "upgrade"),
    false,
  );
}

// A failed explicit plan check must stay gated and explain how to retry. Use
// the real renderers: renderChat's Free-account redirect used to drop the error.
// Plain fetch failures are serialized by the worker as COMPANION_ERROR.
for (const code of ["AUTH_TIMEOUT", "BACKEND_UNAVAILABLE", "COMPANION_ERROR"]) {
  let offline = true;
  const { state, context, events, api } = harness({
    onSend: (request) =>
      request.type === "AUTH_STATE" && offline
        ? Promise.reject(Object.assign(new Error("Private diagnostic detail"), { code }))
        : undefined,
  });
  state.auth = { configured: true, authenticated: true, isPro: false, userId: "student" };
  state.messages = [{ role: "assistant", message: "Earlier answer awaiting sync" }];
  state.pendingSave = "keep-unsaved-request";
  const controls = new Map();
  context.body = {
    innerHTML: "",
    contains: () => false,
    querySelector: (selector) => {
      if (!controls.has(selector))
        controls.set(selector, {
          style: {},
          scrollHeight: 40,
          addEventListener(type, listener) {
            this[type] = listener;
          },
        });
      return controls.get(selector);
    },
  };
  context.escapeHtml = String;
  context.formatAssistantMessage = String;
  context.handleChat = () => {};
  context.retrySaving = () => {};
  context.queueMicrotask = () => {};
  vm.runInContext(functionSource("renderNotPro", "rememberReadingPosition"), context);
  vm.runInContext(functionSource("renderChat", "retrySaving"), context);
  await api.initialize();
  assert.match(context.body.innerHTML, /role="alert"/);
  assert.match(context.body.innerHTML, /couldn’t check your Pro access.*try again/i);
  assert.doesNotMatch(context.body.innerHTML, /Private diagnostic|class="um-input"/);
  assert.match(context.body.innerHTML, /I’ve upgraded · Check access/);
  assert.equal(state.view, "upgrade");
  assert.equal(state.auth.isPro, false);
  assert.equal(state.auth.authenticated, true);
  assert.equal(state.auth.userId, "student");
  assert.equal(state.draft, "Explain this");
  assert.equal(state.pendingSave, "keep-unsaved-request");
  assert.equal(state.messages[0].message, "Earlier answer awaiting sync");
  assert.equal(events.filter(([name]) => name === "AUTH_STATE").length, 1);
  assert.equal(
    events.some(([name]) => name === "LOAD_CHAT_STATE"),
    false,
  );

  // Recovery uses the existing button, not an automatic retry or sign-in flow.
  offline = false;
  await controls.get(".um-check-plan").click();
  assert.equal(events.filter(([name]) => name === "AUTH_STATE").length, 2);
  assert.equal(state.auth.isPro, true);
  assert.equal(state.view, "chat");
  assert.equal(state.auth.userId, "student");
  assert.equal(state.draft, "Explain this");
  assert.equal(state.pendingSave, "keep-unsaved-request");
  assert.equal(state.messages[0].message, "Earlier answer awaiting sync");
  assert.doesNotMatch(context.body.innerHTML, /couldn’t check your Pro access/);
  assert.equal(
    events.some(([name]) =>
      ["SIGN_IN", "SIGN_OUT", "OPEN_SIGN_IN", "OPEN_UPGRADE", "SEND_CHAT", "extract"].includes(
        name,
      ),
    ),
    false,
  );
}

// A failed consent lookup must keep the disclosure ahead of the upgrade gate,
// even if the last known account was signed in and Free.
for (const consent of [null, { accepted: false }]) {
  const { state, context, events, api } = harness({
    onSend: (request) =>
      request.type === "PRIVACY_CONSENT_STATE"
        ? Promise.reject(new Error("Storage unavailable"))
        : undefined,
  });
  state.auth = { configured: true, authenticated: true, isPro: false, userId: "student" };
  state.privacyConsent = consent;
  state.pendingSave = "keep-unsaved-request";
  context.body = {
    innerHTML: "",
    contains: () => false,
    querySelector: () => ({ addEventListener() {} }),
  };
  context.escapeHtml = String;
  context.queueMicrotask = () => {};
  vm.runInContext(functionSource("renderPrivacyConsent", "rememberReadingPosition"), context);
  vm.runInContext(functionSource("renderChat", "retrySaving"), context);
  await api.initialize();
  assert.equal(state.view, "privacy");
  assert.match(context.body.innerHTML, /Allow and continue/);
  assert.doesNotMatch(context.body.innerHTML, /Explore UniMate Pro|class="um-input"/);
  assert.equal(state.auth.userId, "student");
  assert.equal(state.auth.isPro, false);
  assert.equal(state.pendingSave, "keep-unsaved-request");
  assert.equal(state.draft, "Explain this");
  assert.deepEqual(
    events.map(([name]) => name),
    ["PRIVACY_CONSENT_STATE"],
  );
}

{
  const { state, api } = harness();
  state.nextConversationId = "chat-other";
  state.pageHistory = [{ role: "assistant", message: "Previous conversation" }];
  await api.initialize();
  assert.equal(
    state.pageHistory.length,
    0,
    "Reinitializing into a different chat clears its prior conversation context",
  );
}

{
  const { state, context, events, api } = harness();
  state.auth = { configured: true, authenticated: false, isPro: false };
  const button = { disabled: false, textContent: "Sign in securely" };
  let click;
  context.body = {
    innerHTML: "",
    querySelector: (selector) =>
      selector === ".um-signin"
        ? {
            addEventListener: (type, listener) => {
              assert.equal(type, "click");
              click = listener;
            },
          }
        : null,
  };
  context.escapeHtml = String;
  context.queueMicrotask = () => {};
  context.focusInitialControl = () => {};
  vm.runInContext(
    `${functionSource("renderAuth", "renderPrivacyConsent")}\nrenderAuth();`,
    context,
  );
  assert.doesNotMatch(
    context.body.innerHTML,
    /<input|<textarea|<form/i,
    "Credentials are never entered into the host page’s DOM",
  );
  assert.match(context.body.innerHTML, /Sign in securely/);
  assert.equal(click, api.handleOpenSignIn);
  await click({ currentTarget: button });
  const request = events.find(([name]) => name === "OPEN_SIGN_IN")[1];
  assert.deepEqual(
    Object.keys(request),
    ["type"],
    "The host content script only requests the extension-owned sign-in window",
  );
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Sign in securely");
  assert.ok(!events.some(([name]) => name === "SIGN_IN"));
}

{
  const { events, api } = harness({
    onSend: (request) =>
      request.type === "OPEN_SIGN_IN" ? Promise.reject(new Error("Popup unavailable")) : undefined,
  });
  await api.handleOpenSignIn({ currentTarget: {} });
  assert.ok(
    events.some(([name]) => name === "auth"),
    "An unavailable sign-in window returns the panel to a retryable sign-in state",
  );
}

{
  const { state, events, api } = harness();
  state.open = false;
  state.busy = true;
  state.pendingSave = "private-unsaved-answer";
  state.failedQuestion = "Private earlier question";
  state.unresolvedRequest = { payload: { message: "Private request" } };
  state.messages = [{ role: "assistant", message: "Private answer" }];
  state.pageHistory = state.messages.slice();
  let response;
  api.runtimeMessageListener(
    { type: "SESSION_CHANGED", userId: "untrusted-payload", isPro: true },
    {},
    (value) => {
      response = value;
    },
  );
  assert.equal(response.ok, true);
  assert.equal(state.auth.authenticated, false);
  assert.equal(state.auth.userId, undefined);
  assert.equal(state.sessionVersion, 1);
  assert.equal(state.busy, false);
  assert.equal(state.messages.length, 0);
  assert.equal(state.pageHistory.length, 0);
  assert.equal(state.pendingSave, null);
  assert.equal(state.failedQuestion, null, "Session changes also clear retained private questions");
  assert.equal(state.unresolvedRequest, null);
  assert.equal(state.draft, "");
  assert.ok(
    events.some(([name]) => name === "auth"),
    "A hidden panel also removes the old account’s message markup",
  );
  assert.ok(
    !events.some(([name]) => name === "AUTH_STATE" || name === "extract"),
    "A closed panel clears state without capturing or fetching chat data",
  );
}

{
  const { state, context, events, api } = harness();
  const refreshed = deferred();
  context.renderChat = () => refreshed.resolve();
  state.messages = [{ role: "assistant", message: "Previous account" }];
  api.runtimeMessageListener(
    { type: "SESSION_CHANGED", userId: "untrusted-payload" },
    {},
    () => {},
  );
  assert.equal(
    state.messages.length,
    0,
    "Session broadcasts clear old messages synchronously before refreshing",
  );
  await refreshed.promise;
  assert.equal(
    state.auth.userId,
    "student",
    "Session identity is re-read from background authorization, never taken from the notification",
  );
  assert.ok(events.some(([name]) => name === "AUTH_STATE"));
  assert.ok(events.some(([name]) => name === "PRIVACY_CONSENT_STATE"));
  assert.ok(!events.some(([name]) => name === "extract" || name === "SEND_CHAT"));
}

for (const [operation, requestType] of [
  ["handleSignOut", "SIGN_OUT"],
  ["handleWebsiteSignOut", "WEBSITE_SIGN_OUT"],
]) {
  for (const outcome of ["success", "failure"]) {
    const remoteLogout = deferred();
    const refreshed = deferred();
    const { state, context, events, api } = harness({
      onSend: (request) => {
        if (request.type === requestType) return remoteLogout.promise;
        if (request.type === "AUTH_STATE")
          return Promise.resolve({
            authenticated: true,
            isPro: true,
            userId: "new-session-student",
          });
      },
    });
    const pendingLogout = api[operation]();
    // Background clears credentials and broadcasts before remote logout finishes.
    state.open = false;
    api.runtimeMessageListener({ type: "SESSION_CHANGED" }, {}, () => {});
    assert.equal(state.auth.authenticated, false);
    // A subsequent successful login broadcasts a new session while that remote
    // logout acknowledgement is still pending.
    state.open = true;
    context.renderChat = () => refreshed.resolve();
    api.runtimeMessageListener({ type: "SESSION_CHANGED" }, {}, () => {});
    await refreshed.promise;
    state.draft = "Question in my new session";
    state.busy = true;
    const newSessionVersion = state.sessionVersion;
    const newMessages = state.messages;
    const authRenders = events.filter(([name]) => name === "auth").length;
    if (outcome === "success") remoteLogout.resolve({});
    else remoteLogout.reject(new Error("Remote logout timed out"));
    await pendingLogout;
    assert.equal(
      state.auth.userId,
      "new-session-student",
      `${requestType} ${outcome} cannot overwrite a newer authenticated session`,
    );
    assert.equal(state.sessionVersion, newSessionVersion);
    assert.equal(state.messages, newMessages);
    assert.equal(state.draft, "Question in my new session");
    assert.equal(state.busy, true, "A stale logout completion cannot unlock a newer request");
    assert.equal(
      events.filter(([name]) => name === "auth").length,
      authRenders,
      "A stale logout does not rerender the sign-in screen",
    );
  }
}

for (const scenario of [
  "composer",
  "host-interrupts",
  "initial-host-focus",
  "closed-during-capture",
]) {
  const listeners = new Map();
  const properties = new Map();
  const state = { open: true, captureHidden: false };
  const document = {
    body: {},
    documentElement: { contains: () => true },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };
  const shadow = { activeElement: null };
  const host = {
    style: {
      getPropertyValue: (name) => properties.get(name) || "",
      getPropertyPriority: () => "",
      setProperty: (name, value) => {
        properties.set(name, value);
        if (name === "display" && value === "none") {
          document.activeElement = document.body;
          shadow.activeElement = null;
        }
      },
      removeProperty: (name) => properties.delete(name),
    },
  };
  let focusCount = 0;
  let selection;
  const composer = {
    isConnected: true,
    selectionStart: 2,
    selectionEnd: 7,
    selectionDirection: "backward",
    focus: () => {
      focusCount += 1;
      document.activeElement = host;
      shadow.activeElement = composer;
    },
    setSelectionRange: (...value) => {
      selection = value;
    },
  };
  document.activeElement = scenario === "initial-host-focus" ? {} : host;
  shadow.activeElement = scenario === "initial-host-focus" ? null : composer;
  const context = vm.createContext({
    state,
    document,
    shadow,
    host,
    mascot: {},
    setTimeout,
    clearTimeout,
    nextPaint: async () => {},
    getComputedStyle: () => ({ display: properties.get("display") }),
  });
  vm.runInContext(
    `${functionSource("canRestorePanelFocus", "sendOnce")}\nglobalThis.capture = { prepareForCapture, restoreAfterCapture };`,
    context,
  );
  const captureId = crypto.randomUUID();
  await context.capture.prepareForCapture({ captureId, expiresAt: Date.now() + 8000 });
  assert.equal(properties.get("display"), "none");
  if (scenario === "host-interrupts") {
    const hostInput = {};
    document.activeElement = hostInput;
    listeners.get("focusin")({ target: hostInput });
    // Returning to the page body does not erase the user's deliberate choice.
    document.activeElement = document.body;
  }
  if (scenario === "closed-during-capture") state.open = false;
  context.capture.restoreAfterCapture(captureId);
  assert.equal(properties.has("display"), false);
  assert.equal(
    listeners.has("focusin"),
    false,
    "Capture focus listener is removed after restoring",
  );
  assert.equal(
    focusCount,
    scenario === "composer" ? 1 : 0,
    `Focus restoration respects ${scenario}`,
  );
  if (scenario === "composer") assert.deepEqual(selection, [2, 7, "backward"]);
}

{
  let now = 1000;
  let timerId = 0;
  const timers = new Map();
  const styles = new Map([
    ["display", "inline-flex"],
    ["pointer-events", "auto"],
  ]);
  const state = { open: true, captureHidden: false, draft: "My unfinished question" };
  const document = {
    body: {},
    documentElement: { contains: () => true },
    addEventListener() {},
    removeEventListener() {},
  };
  document.activeElement = document.body;
  const context = vm.createContext({
    state,
    document,
    shadow: { activeElement: null },
    mascot: {},
    host: {
      style: {
        getPropertyValue: (name) => styles.get(name) || "",
        getPropertyPriority: () => "important",
        setProperty: (name, value) => styles.set(name, value),
        removeProperty: (name) => styles.delete(name),
      },
    },
    Date: { now: () => now },
    setTimeout: (callback, delay) => {
      timers.set(++timerId, { callback, delay });
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    nextPaint: async () => {},
    getComputedStyle: () => ({ display: styles.get("display") }),
  });
  vm.runInContext(functionSource("canRestorePanelFocus", "sendOnce"), context);
  const lease = { captureId: crypto.randomUUID(), expiresAt: 9000 };
  for (const invalid of [
    undefined,
    {},
    { ...lease, captureId: "not-a-uuid" },
    { ...lease, expiresAt: now },
    { ...lease, expiresAt: 9001 },
    { ...lease, expiresAt: Infinity },
  ]) {
    await assert.rejects(context.prepareForCapture(invalid), /lease/);
    assert.equal(state.captureHidden, false);
  }
  const ack = await context.prepareForCapture(lease);
  assert.equal(ack.captureId, lease.captureId);
  assert.equal(ack.hidden, true);
  assert.equal(timers.size, 1);
  assert.equal(
    timers.get(1).delay,
    10000,
    "Worker failure cannot hide the UI longer than ten seconds",
  );
  now = 1500;
  await context.prepareForCapture(lease);
  assert.equal(timers.size, 1, "An idempotent preparation never extends the watchdog");
  await assert.rejects(context.prepareForCapture({ ...lease, expiresAt: 9500 }), /already/);
  await assert.rejects(
    context.prepareForCapture({ ...lease, captureId: crypto.randomUUID() }),
    /already/,
  );
  assert.equal(context.restoreAfterCapture(crypto.randomUUID()).restored, false);
  assert.equal(state.captureHidden, true);
  now = 11000;
  timers.get(1).callback();
  assert.equal(
    state.captureHidden,
    false,
    "Content restores independently with no worker RESTORE message",
  );
  assert.equal(state.captureLease, null);
  assert.equal(timers.size, 0);
  assert.equal(styles.get("display"), "inline-flex");
  assert.equal(styles.get("pointer-events"), "auto");
  assert.equal(state.draft, "My unfinished question");
  await assert.rejects(context.prepareForCapture(lease), /expired/);

  const nextLease = { captureId: crypto.randomUUID(), expiresAt: now + 8000 };
  await context.prepareForCapture(nextLease);
  assert.equal(context.restoreAfterCapture(lease.captureId).restored, false);
  assert.equal(styles.get("display"), "none", "An old worker cannot reveal a newer capture");
  context.restoreAfterCapture(undefined, true);
  assert.equal(timers.size, 0, "Forced disposal clears the watchdog");
  assert.equal(state.captureHidden, false);

  const paint = deferred();
  context.nextPaint = () => paint.promise;
  const lateLease = { captureId: crypto.randomUUID(), expiresAt: now + 8000 };
  const pending = context.prepareForCapture(lateLease);
  now = lateLease.expiresAt;
  paint.resolve();
  await assert.rejects(pending, /expired/);
  assert.equal(
    state.captureHidden,
    false,
    "A late paint cannot acknowledge a usable capture lease",
  );
  assert.equal(timers.size, 0);
}

{
  const { context, api } = harness();
  context.extensionVersion = "1.2.3";
  let reply;
  api.runtimeMessageListener({ type: "COMPANION_PING", nonce: "probe" }, {}, (value) => {
    reply = value;
  });
  assert.equal(reply.protocolVersion, 2);
  assert.equal(reply.extensionVersion, "1.2.3");
  assert.equal(reply.nonce, "probe");
  const disposals = [];
  context.dispose = () => disposals.push("disposed");
  context.queueMicrotask = (callback) => callback();
  for (const compatible of [
    { protocolVersion: 2, extensionVersion: "1.2.3" },
    { protocolVersion: 1, extensionVersion: "1.2.3" },
    { protocolVersion: 2, extensionVersion: "1.2.2" },
    undefined,
  ]) {
    const before = disposals.length;
    api.runtimeMessageListener(
      { type: "DISPOSE_COMPANION_INSTANCE", preserveIfCompatible: compatible },
      {},
      (value) => {
        reply = value;
      },
    );
    const preserved = compatible?.protocolVersion === 2 && compatible.extensionVersion === "1.2.3";
    assert.equal(disposals.length, before + (preserved ? 0 : 1));
    assert.equal(reply.preserved === true, preserved);
    if (preserved) {
      assert.equal(reply.protocolVersion, 2);
      assert.equal(reply.extensionVersion, "1.2.3");
    }
  }
}

for (const scenario of ["host", "header-button", "initial-open", "replaced-action"]) {
  const { state, context } = harness();
  const queued = [];
  let initialFocusCount = 0;
  let actionFocusCount = 0;
  const active =
    scenario === "host"
      ? null
      : { matches: (selector) => scenario === "replaced-action" && selector === ".um-signout" };
  const control = { style: {}, scrollHeight: 60, addEventListener() {} };
  const action = {
    ...control,
    focus: () => {
      actionFocusCount += 1;
    },
  };
  context.body = {
    innerHTML: "",
    contains: (element) => scenario === "replaced-action" && element === active,
    querySelector: (selector) => (selector === ".um-signout" ? action : control),
  };
  context.panel = { contains: (element) => Boolean(element && element === active) };
  context.shadow.activeElement = active;
  state.initialFocusPending = scenario === "initial-open";
  context.escapeHtml = String;
  context.formatAssistantMessage = String;
  context.queueMicrotask = (callback) => queued.push(callback);
  context.focusInitialControl = () => {
    initialFocusCount += 1;
  };
  context.handleChat = () => {};
  context.handleSignOut = () => {};
  context.retrySaving = () => {};
  vm.runInContext(
    `${functionSource("prepareRenderFocus", "handlePanelKeyboard")}\n${functionSource("renderChat", "retrySaving")}\nrenderChat();`,
    context,
  );
  queued.forEach((callback) => callback());
  assert.equal(
    initialFocusCount,
    scenario === "initial-open" ? 1 : 0,
    `History refresh respects ${scenario} focus`,
  );
  assert.equal(actionFocusCount, scenario === "replaced-action" ? 1 : 0);
  assert.equal(state.initialFocusPending, false);
}

{
  const closed = [];
  const context = vm.createContext({ state: { open: true }, toggle: (open) => closed.push(open) });
  vm.runInContext(
    `${functionSource("handlePanelKeyboard", "containWheel")}\nglobalThis.key = handlePanelKeyboard;`,
    context,
  );
  for (const shiftKey of [false, true]) {
    context.key({
      key: "Tab",
      shiftKey,
      preventDefault() {
        throw new Error("Tab must leave the non-modal panel naturally");
      },
    });
  }
  let prevented = false;
  let stopped = false;
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    context.key({
      key: "Escape",
      ...composition,
      preventDefault() {
        throw new Error("IME Escape must remain available to cancel composition");
      },
    });
  }
  assert.deepEqual(closed, [], "Cancelling IME composition does not close the companion");
  context.key({
    key: "Escape",
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
  });
  assert.deepEqual(closed, [false]);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.doesNotMatch(
    source,
    /aria-modal="true"/,
    "The beside-coursework panel does not announce itself as modal",
  );
}

{
  const foreground = source.match(/\.um-context \{[^}]*color: (#[0-9a-f]{6})/i)[1];
  const background = source.match(/\.um-panel \{[^}]*background: (#[0-9a-f]{6})/i)[1];
  const luminance = (hex) => {
    const values = hex
      .slice(1)
      .match(/../g)
      .map((value) => parseInt(value, 16) / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const contrast = (luminance(background) + 0.05) / (luminance(foreground) + 0.05);
  assert.ok(
    contrast >= 4.5,
    `Small context text must meet 4.5:1 contrast against the panel; received ${contrast.toFixed(2)}:1`,
  );
}

{
  const { state, context } = harness();
  const node = { addEventListener() {}, style: {}, scrollHeight: 0 };
  context.body = { innerHTML: "", querySelector: () => node };
  context.queueMicrotask = () => {};
  context.handleChat = () => {};
  context.handleSignOut = () => {};
  context.retrySaving = () => {};
  state.messages = [
    { role: "user", message: "Explain <this>" },
    { role: "assistant", message: "Let’s look at **one step**." },
  ];
  vm.runInContext(
    `${functionSource("escapeHtml", "studentFacingError")}\n${functionSource("renderChat", "retrySaving")}\nrenderChat();`,
    context,
  );
  assert.match(
    context.body.innerHTML,
    /class="um-message user"><span class="um-sr-only">You: <\/span>Explain &lt;this&gt;/,
  );
  assert.match(
    context.body.innerHTML,
    /class="um-message assistant"><span class="um-sr-only">UniMate: <\/span>Let’s look at <strong>one step<\/strong>/,
  );
  const labelStyle = source.match(/\.um-sr-only \{([^}]+)\}/)[1];
  assert.doesNotMatch(
    labelStyle,
    /display:\s*none|visibility:\s*hidden/,
    "Speaker text remains available to assistive technology",
  );
  assert.match(labelStyle, /clip-path:\s*inset\(50%\)/, "Speaker labels do not add visual clutter");
}

{
  class ScrollElement {
    constructor(parent, overflowY = "visible", height = 100, contentHeight = 100) {
      this.parentElement = parent;
      this.overflowY = overflowY;
      this.clientHeight = height;
      this.scrollHeight = contentHeight;
      this.scrollTop = 0;
    }
    contains(element) {
      while (element) {
        if (element === this) return true;
        element = element.parentElement;
      }
      return false;
    }
  }
  const hostPage = new ScrollElement(null, "auto", 500, 2000);
  const panel = new ScrollElement(hostPage);
  const body = new ScrollElement(panel, "auto", 300, 800);
  const textarea = new ScrollElement(body, "auto", 100, 200);
  const context = vm.createContext({
    state: { open: true },
    panel,
    Element: ScrollElement,
    getComputedStyle: (element) => ({ overflowY: element.overflowY, lineHeight: "20px" }),
  });
  vm.runInContext(
    `${functionSource("containWheel", "escapeHtml")}\nglobalThis.wheel = containWheel;`,
    context,
  );
  const wheel = (target, deltaY, deltaMode = 0, extra = {}) => {
    let prevented = false;
    context.wheel({
      target,
      deltaY,
      deltaMode,
      preventDefault() {
        prevented = true;
      },
      ...extra,
    });
    return prevented;
  };
  assert.equal(
    wheel(textarea, 30),
    false,
    "A nested textarea that can scroll keeps normal native scrolling",
  );
  assert.equal(body.scrollTop, 0);
  textarea.scrollTop = 100;
  assert.equal(
    wheel(textarea, 30),
    true,
    "At the textarea bottom, its parent receives the wheel gesture",
  );
  assert.equal(body.scrollTop, 30);
  assert.equal(wheel(textarea, 2, 1), true);
  assert.equal(body.scrollTop, 70, "Line-based wheel gestures use the parent's line height");
  textarea.scrollTop = 0;
  assert.equal(wheel(textarea, -20), true);
  assert.equal(
    body.scrollTop,
    50,
    "At the textarea top, scrolling hands back to the parent upward",
  );
  textarea.scrollTop = 100;
  body.scrollTop = 100;
  assert.equal(wheel(textarea, 1, 2), true);
  assert.equal(body.scrollTop, 400, "Page-based wheel gestures use the parent's viewport height");
  body.scrollTop = 500;
  assert.equal(
    wheel(textarea, 60),
    true,
    "The companion prevents wheel handoff to the webpage at its lower boundary",
  );
  assert.equal(hostPage.scrollTop, 0);
  textarea.scrollTop = 0;
  body.scrollTop = 0;
  assert.equal(
    wheel(textarea, -60),
    true,
    "The companion prevents wheel handoff at its upper boundary",
  );
  assert.equal(hostPage.scrollTop, 0);
  const composerButton = new ScrollElement(body);
  assert.equal(
    wheel(composerButton, 30),
    false,
    "Wheel over composer controls can natively scroll the overflow body",
  );
  assert.equal(
    wheel(textarea, 0, 0, { deltaX: 30 }),
    true,
    "Horizontal wheel gestures do not escape to the webpage",
  );
  assert.equal(wheel(textarea, 30, 0, { ctrlKey: true }), false, "Browser zoom remains available");
  assert.equal(
    wheel(hostPage, 30),
    false,
    "The companion does not intercept host-page wheel gestures",
  );
}

// A deliberate disclosure supersedes late access/history loads without blocking
// future background history synchronization.
{
  const authReply = deferred();
  const { state, context, events, api } = harness({
    onSend: (request) => (request.type === "AUTH_STATE" ? authReply.promise : undefined),
  });
  const control = { addEventListener() {} };
  context.body = { innerHTML: "", contains: () => false, querySelector: () => control };
  context.escapeHtml = String;
  context.queueMicrotask = () => {};
  vm.runInContext(functionSource("renderPrivacyConsent", "renderNotPro"), context);
  const initializing = api.initialize();
  await Promise.resolve();
  context.renderPrivacyConsent();
  authReply.resolve({ authenticated: true, isPro: true, userId: "late-other-user" });
  await initializing;
  assert.equal(state.view, "privacy");
  assert.equal(
    state.auth.userId,
    "student",
    "Late access replies cannot replace disclosure or identity",
  );
  const disclosure = context.body.innerHTML;
  const renders = events.filter(([kind]) => kind === "render").length;
  await api.refreshMessagesOnOpen();
  assert.equal(state.messages.length, 2, "History still synchronizes behind the disclosure");
  assert.equal(context.body.innerHTML, disclosure);
  assert.equal(events.filter(([kind]) => kind === "render").length, renders);
  assert.equal(state.view, "privacy");
}

for (const scenario of ["unchanged", "new-history", "bottom", "own-send", "other-conversation"]) {
  const { state, context } = harness();
  const before = {
    scrollTop: scenario === "bottom" ? 1200 : 120,
    scrollHeight: 1600,
    clientHeight: 400,
  };
  const after = {
    scrollTop: 0,
    scrollHeight: scenario === "unchanged" ? 1600 : 2000,
    clientHeight: 400,
  };
  const control = { style: {}, scrollHeight: 40, addEventListener() {} };
  let replaced = false;
  context.body = {
    set innerHTML(value) {
      replaced = true;
      this.html = value;
    },
    querySelector: (selector) =>
      selector === ".um-messages" ? (replaced ? after : before) : control,
  };
  context.escapeHtml = String;
  context.formatAssistantMessage = String;
  context.handleChat = () => {};
  context.retrySaving = () => {};
  context.queueMicrotask = () => {};
  if (scenario === "other-conversation") state.activeConversationId = "chat-2";
  vm.runInContext(functionSource("renderChat", "retrySaving"), context);
  context.renderChat("", false, scenario === "own-send");
  assert.equal(
    after.scrollTop,
    ["unchanged", "new-history"].includes(scenario) ? 120 : after.scrollHeight,
    `Reading position follows the intended policy for ${scenario}`,
  );
  assert.equal(state.renderedConversationId, state.activeConversationId);
}

{
  const { context, api, state } = harness();
  const polite = { textContent: "" };
  const urgent = { textContent: "" };
  context.announcer = polite;
  context.alertAnnouncer = urgent;
  vm.runInContext(functionSource("announce", "renderChat"), context);
  await api.submitChat("Explain this");
  assert.equal(polite.textContent, "UniMate: Let’s take it one step at a time.");
  assert.equal(urgent.textContent, "");
  await api.refreshMessagesOnOpen();
  assert.equal(
    polite.textContent,
    "UniMate: Let’s take it one step at a time.",
    "History refresh does not replace the announcement with the entire log",
  );
  assert.equal(context.announcer, polite, "Announcements use the same persistent node");
  context.announce("Your question is saved below; please try again.", true);
  assert.equal(polite.textContent, "");
  assert.match(urgent.textContent, /question is saved/);
  api.runtimeMessageListener({ type: "SESSION_CHANGED" }, {}, () => {});
  assert.equal(urgent.textContent, "", "Changing accounts clears old announcements immediately");
  assert.equal(polite.textContent, "");
  state.open = false;
  const initialMarkup = source.slice(
    source.indexOf("root.innerHTML ="),
    source.indexOf("shadow.append"),
  );
  assert.match(
    initialMarkup,
    /class="um-announcer um-sr-only" role="status" aria-live="polite" aria-atomic="true"/,
  );
  assert.match(initialMarkup, /class="um-alert-announcer um-sr-only" role="alert"/);
  assert.doesNotMatch(
    functionSource("renderChat", "retrySaving"),
    /class="um-announcer/,
    "Rerendering the body cannot recreate its sibling live region",
  );
}

console.log(
  "PASS Companion consent/Pro checks, draft recovery, navigation boundaries, async session isolation, history ordering, sign-out failures, and unsaved-answer preservation",
);
