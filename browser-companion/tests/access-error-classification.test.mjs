import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadFunctions(path, names, globals) {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.JS,
  );
  const found = new Map();
  const visit = (node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      names.includes(node.name?.text)
    )
      found.set(node.name.text, node.getText(ast));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(found.size, names.length);
  const compiled = ts.transpileModule(names.map((name) => found.get(name)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ ...globals });
  vm.runInContext(`${compiled}\nglobalThis.api = { ${names.join(", ")} };`, context);
  return context;
}

const background = loadFunctions(
  "../background.js",
  ["CompanionError", "retryAfterMs", "parseResponse"],
  { Date },
);
const content = loadFunctions(
  "../content.js",
  ["studentFacingError", "isRetryableMessagingError"],
  {},
);
for (const code of ["AI_BILLING_UNAVAILABLE", "AI_CONFIGURATION_ERROR", "AI_NOT_CONFIGURED"]) {
  await assert.rejects(
    background.api.parseResponse(
      new Response(JSON.stringify({ code, error: "Provider unavailable", retryable: false }), {
        status: 503,
      }),
      "screenshot-analysis",
    ),
    (error) => {
      assert.equal(error.code, code);
      assert.equal(error.retryable, false);
      assert.equal(error.phase, "ai");
      assert.equal(content.api.isRetryableMessagingError(error), false);
      const message = content.api.studentFacingError(error);
      assert.match(message, /Your question is kept here/);
      assert.doesNotMatch(message, /try again|upgrade|sign in/i);
      return true;
    },
  );
}
for (const [status, code, expectedCode, expectedPhase] of [
  [403, "PRO_REQUIRED", "PRO_REQUIRED", "entitlement"],
  [403, "AUTH_REQUIRED", "AUTH_REQUIRED", "auth"],
  [401, undefined, "AUTH_REQUIRED", "auth"],
  [402, undefined, "PRO_REQUIRED", "entitlement"],
  [403, "FORBIDDEN", "BACKEND_REQUEST_FAILED", "screenshot-analysis"],
  [403, undefined, "BACKEND_REQUEST_FAILED", "screenshot-analysis"],
]) {
  await assert.rejects(
    background.api.parseResponse(
      new Response(JSON.stringify({ error: "Request refused", code }), { status }),
      "screenshot-analysis",
    ),
    (error) => error.code === expectedCode && error.phase === expectedPhase,
  );
}

assert.match(
  content.api.studentFacingError({ code: "AI_RESPONSE_TRUNCATED" }),
  /cut short.*kept here.*one part at a time/,
);

// Auth service outages preserve the signed-in session and question. The copy
// must not contradict that behavior by claiming the student was signed out.
for (const error of [
  { code: "AUTH_TIMEOUT", phase: "auth" },
  { code: "AUTH_TIMEOUT" },
  { code: "NETWORK_ERROR", phase: "auth", message: "Failed to fetch" },
  { code: "BACKEND_UNAVAILABLE", phase: "auth", message: "Temporary outage" },
]) {
  const message = content.api.studentFacingError(error);
  assert.match(message, /couldn.t verify.*session/i);
  assert.match(message, /Your question is kept here/);
  assert.doesNotMatch(message, /ended|expired|sign in|password|upgrade/i);
}
assert.match(
  content.api.studentFacingError({ code: "AUTH_REQUIRED", phase: "auth" }),
  /session has ended.*Sign in again/,
);
await assert.rejects(
  background.api.parseResponse(
    new Response(JSON.stringify({ error: "Try later" }), {
      status: 429,
      headers: { "retry-after": "30" },
    }),
    "auth",
  ),
  (error) => {
    const message = content.api.studentFacingError(error);
    assert.match(message, /Your question is kept here.*30 seconds/);
    assert.doesNotMatch(message, /ended|expired|sign in|password|upgrade/i);
    return true;
  },
);

let answer;
let response;
const web = loadFunctions("../../src/components/screen-assistant.tsx", ["handleAsk"], {
  photo: "data:image/jpeg;base64,fixture",
  asking: false,
  isPro: true,
  consent: true,
  session: { access_token: "fixture-token" },
  requestRef: { current: null },
  question: "Explain this",
  history: [],
  AbortController,
  setTimeout,
  clearTimeout,
  crypto,
  fetch: async () => response,
  setAnswer: (value) => {
    answer = value;
  },
  setAsking: () => {},
  setHistory: () => {},
  setQuestion: () => {},
});
for (const [status, code, expectedMessage] of [
  [403, "PRO_REQUIRED", /Pro feature/],
  [403, "AUTH_REQUIRED", /session expired/],
  [401, undefined, /session expired/],
  [402, undefined, /Pro feature/],
  [403, "FORBIDDEN", /^Request refused$/],
  [403, undefined, /^Request refused$/],
]) {
  response = new Response(JSON.stringify({ error: "Request refused", code }), { status });
  await web.api.handleAsk();
  assert.equal(answer.kind, "error");
  assert.match(answer.text, expectedMessage);
}

console.log(
  "PASS extension and screen assistant typed access errors, temporary auth failures, rate limits and generic forbidden errors",
);
