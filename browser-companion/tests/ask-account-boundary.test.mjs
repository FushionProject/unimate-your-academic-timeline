import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import { z } from "zod";

const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const authSource = read("src/lib/auth-fetch.ts");
const clientSource = read("src/functions/ask-unimate.ts");
const routeSource = read("src/routes/ask.tsx");
const ast = ts.createSourceFile(
  "ask.tsx",
  routeSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const ask = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "Ask",
);
assert(ask?.body, "Execute the real Ask component declarations");
const declaration = (name) => {
  const statement = ask.body.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((item) => item.name.getText(ast) === name),
  );
  assert(statement, `Missing production Ask declaration: ${name}`);
  return statement.getText(ast);
};
const cleanupEffect = ask.body.statements.find(
  (node) =>
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(ast) === "useEffect" &&
    node.expression.arguments[0]?.getText(ast).includes("activeRequestRef.current?.abort()"),
);
assert(cleanupEffect, "Exercise the actual account/unmount cleanup");
const cleanupSource = cleanupEffect.expression.arguments[0].getText(ast);
assert.match(routeSource, /<Ask\s+key=\{userId\}/, "Each account owns a fresh Ask component");

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const session = (user = "student-A", token = "synthetic-token-A") => ({
  data: { session: user ? { user: { id: user }, access_token: token } : null },
  error: null,
});
const answer = () => new Response(JSON.stringify({ answer: "Synthetic answer", webResults: [] }));
function fixture() {
  const state = {
    lookupCalls: 0,
    lookup: async () => session(),
    requests: [],
    reply: async () => answer(),
    saves: [],
    writes: [],
  };
  const bindings = {
    supabase: {
      auth: {
        getSession: async () => {
          state.lookupCalls++;
          return state.lookup();
        },
      },
    },
  };
  let auth;
  const context = vm.createContext({
    exports: {},
    z,
    crypto,
    Response,
    AbortController,
    DOMException,
    Intl,
    fetch: async (url, options) => {
      state.requests.push({ url, ...options });
      return state.reply(url, options);
    },
    require: (name) => {
      if (name === "./supabase") return bindings;
      if (name === "../lib/auth-fetch") return auth;
      if (name === "zod") return { z };
      assert.fail(`Unexpected dependency ${name}`);
    },
  });
  const execute = (source) =>
    vm.runInContext(
      ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText,
      context,
    );
  auth = (execute(authSource), context.exports);
  context.exports = {};
  execute(clientSource);
  const client = context.exports;
  const changed = (error) =>
    error instanceof auth.AuthSessionChangedError &&
    error.code === "AUTH_SESSION_CHANGED" &&
    error.retryable === false;
  const mount = () => {
    state.messages = [{ id: "old-A", type: "user", content: "Private history from A" }];
    Object.assign(context, {
      userId: "student-A",
      question: "Private question from A",
      historyLoading: false,
      selectedConversationId: "conversation-A",
      selectedCourseId: "",
      selectedCourse: undefined,
      // Like React, state setters do not replace this render's closed-over value.
      messages: state.messages,
      sendingRef: { current: false },
      activeRequestRef: { current: null },
      activeUserIdRef: { current: null },
      selectedConversationIdRef: { current: "conversation-A" },
      historyRequestRef: { current: 0 },
      localMessageIdsRef: { current: new Set() },
      questionInputRef: { current: null },
      window: { setTimeout: () => 0 },
      setMessages: (value) => {
        state.writes.push("messages");
        state.messages = typeof value === "function" ? value(state.messages) : value;
      },
      setQuestion: (value) => {
        state.writes.push("question");
        context.question = typeof value === "function" ? value(context.question) : value;
      },
      setLoading: (value) => {
        state.writes.push("loading");
        context.loading = value;
      },
      setSendError: (value) => {
        state.writes.push("error");
        context.sendError = value;
      },
      setUsage: (value) => {
        state.writes.push("usage");
        context.usage = value;
      },
      setHistoryNotice: (value) => {
        state.writes.push("notice");
        context.historyNotice = value;
      },
      saveCompanionExchange: async (...args) => {
        state.saves.push(args);
        return [];
      },
    });
    execute(
      `${declaration("getConversationHistory")}\n${declaration("handleSend")}\n` +
        `globalThis.send = handleSend; globalThis.mountRequestEffect = ${cleanupSource};`,
    );
    return context.mountRequestEffect();
  };
  return { state, context, client, auth, bindings, changed, mount };
}
const privatePayload = {
  question: "Private question from A",
  conversationHistory: [{ role: "user", content: "Private history from A" }],
};

// A deferred session lock must never pair A's prompt/history with B's token or
// an anonymous request. Validation occurs before fetch, not after its response.
for (const next of [
  session("student-B", "synthetic-token-B"),
  session(null),
  session("student-A", ""),
]) {
  const f = fixture(),
    pending = deferred();
  f.state.lookup = () => pending.promise;
  const request = f.client.askUniMate(privatePayload, { expectedUserId: "student-A" });
  assert.equal(f.state.requests.length, 0);
  pending.resolve(next);
  await assert.rejects(request, f.changed);
  assert.equal(f.state.requests.length, 0);
}
for (const access of [undefined, {}, { expectedUserId: "" }, { expectedUserId: " " }]) {
  const f = fixture();
  await assert.rejects(f.client.askUniMate(privatePayload, access), f.changed);
  assert.equal(f.state.lookupCalls, 0);
  assert.equal(f.state.requests.length, 0);
}
{
  const f = fixture();
  f.bindings.supabase = null;
  await assert.rejects(
    f.client.askUniMate(privatePayload, { expectedUserId: "student-A" }),
    f.changed,
  );
  assert.deepEqual(
    Object.keys(await f.auth.getAuthHeaders()),
    [],
    "Unbound callers retain compatibility",
  );
  assert.equal(f.state.requests.length, 0);
}
{
  const f = fixture(),
    pending = deferred();
  f.state.lookup = () => pending.promise;
  const options = { expectedUserId: "student-A" };
  const request = f.auth.getAuthHeaders(options);
  options.expectedUserId = "student-B";
  pending.resolve(session("student-B"));
  await assert.rejects(request, f.changed, "Capture the expected account before awaiting");
}
{
  const f = fixture();
  f.state.lookup = async () => ({ ...session(), error: { message: "synthetic auth failure" } });
  await assert.rejects(
    f.client.askUniMate(privatePayload, { expectedUserId: "student-A" }),
    f.changed,
  );
  assert.equal(f.state.requests.length, 0);
}
{
  const f = fixture(),
    pending = deferred(),
    controller = new AbortController();
  f.state.lookup = () => pending.promise;
  const request = f.client.askUniMate(privatePayload, {
    expectedUserId: "student-A",
    signal: controller.signal,
  });
  pending.resolve(session("student-A", "synthetic-refreshed-A"));
  assert.equal((await request).answer, "Synthetic answer");
  assert.equal(f.state.requests.length, 1);
  const sent = f.state.requests[0];
  assert.equal(sent.url, "/api/ask-unimate");
  assert.equal(sent.headers.Authorization, "Bearer synthetic-refreshed-A");
  assert.equal(sent.signal, controller.signal);
  assert.deepEqual(JSON.parse(sent.body).conversationHistory, privatePayload.conversationHistory);
}
for (const beforeLookup of [false, true]) {
  const f = fixture(),
    pending = deferred(),
    controller = new AbortController();
  f.state.lookup = () => pending.promise;
  if (beforeLookup) controller.abort();
  const request = f.client.askUniMate(privatePayload, {
    expectedUserId: "student-A",
    signal: controller.signal,
  });
  controller.abort();
  pending.resolve(session());
  await assert.rejects(request, (error) => error.name === "AbortError");
  assert.equal(f.state.requests.length, 0);
  if (beforeLookup) assert.equal(f.state.lookupCalls, 0);
}

// Run the real component's send declaration and cleanup callback with synthetic
// state setters. No duplicated implementation of its ownership/finally guards.
{
  const f = fixture();
  f.mount();
  f.state.lookup = async () => session("student-B", "synthetic-token-B");
  await f.context.send();
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.saves.length, 0);
  assert.equal(f.context.sendError.retryable, false);
  assert.match(f.context.sendError.message, /signed-in account changed/);
  assert.equal(f.context.question, privatePayload.question);
  assert.equal(f.state.messages.length, 1);
  assert.equal(f.context.loading, false);
}
{
  const f = fixture();
  f.mount();
  f.state.lookup = async () => session("student-A", "synthetic-refreshed-A");
  await f.context.send();
  assert.equal(f.state.requests.length, 1);
  assert.deepEqual(
    JSON.parse(f.state.requests[0].body).conversationHistory,
    privatePayload.conversationHistory,
  );
  assert.deepEqual(f.state.saves[0], [
    "student-A",
    "conversation-A",
    privatePayload.question,
    "Synthetic answer",
  ]);
  assert.equal(f.context.activeRequestRef.current, null);
  assert.equal(f.context.sendingRef.current, false);
  assert.equal(f.context.loading, false);
}
for (const nextUser of [null, "student-B"]) {
  const f = fixture(),
    lookup = deferred();
  const unmount = f.mount();
  f.state.lookup = () => lookup.promise;
  const sending = f.context.send();
  const controller = f.context.activeRequestRef.current;
  unmount();
  assert.equal(controller.signal.aborted, true);
  assert.equal(f.context.sendingRef.current, false);
  assert.equal(f.context.activeUserIdRef.current, null);
  assert.equal(f.context.selectedConversationIdRef.current, null);
  assert.equal(f.context.historyRequestRef.current, 1);
  f.context.activeUserIdRef.current = nextUser;
  const writesAfterUnmount = f.state.writes.length;
  lookup.resolve(session(nextUser));
  await sending;
  assert.equal(f.state.requests.length, 0);
  assert.equal(f.state.saves.length, 0);
  assert.equal(f.state.writes.length, writesAfterUnmount);
}
{
  const f = fixture(),
    parsing = deferred(),
    started = deferred();
  const unmount = f.mount();
  f.state.reply = async () => ({
    ok: true,
    json: () => {
      started.resolve();
      return parsing.promise;
    },
  });
  const sending = f.context.send();
  await started.promise;
  const controller = f.context.activeRequestRef.current;
  unmount();
  const writesAfterUnmount = f.state.writes.length;
  parsing.resolve({ answer: "Late answer", webResults: [] });
  await sending;
  assert.equal(controller.signal.aborted, true);
  assert.equal(f.state.saves.length, 0, "Ignore an adapter that resolves after abort");
  assert.equal(f.state.writes.length, writesAfterUnmount);
}
for (const reject of [false, true]) {
  const f = fixture(),
    response = deferred(),
    started = deferred();
  f.mount();
  f.state.reply = () => {
    started.resolve();
    return response.promise;
  };
  const sending = f.context.send();
  await started.promise;
  const newer = new AbortController();
  f.context.activeRequestRef.current = newer;
  const previousWrites = f.state.writes.length;
  if (reject) response.reject(new Error("late failure"));
  else response.resolve(answer());
  await sending;
  assert.equal(f.context.activeRequestRef.current, newer);
  assert.equal(f.context.sendingRef.current, true, "Old finally cannot clear newer busy state");
  assert.equal(f.context.loading, true);
  assert.equal(f.state.writes.length, previousWrites);
  assert.equal(f.state.saves.length, 0);
}
console.log(
  "PASS actual Ask account boundary: no cross-account fetch/history, same-user refresh, abort/unmount, nonretryable identity changes and stale request isolation",
);
