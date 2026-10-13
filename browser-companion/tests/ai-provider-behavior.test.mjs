import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  AI_COMPLETIONS_URL,
  DEFAULT_AI_MODEL,
  aiModel,
  aiCompletionBody,
  productionAiProtectionReady,
} from "../../src/lib/ai-provider.ts";
import { courseworkEvidence } from "../../src/lib/coursework-grounding.ts";
import { entitlementFor } from "../../src/lib/ai-entitlements.ts";

const source = fs.readFileSync(new URL("../../src/server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true);
function serverHelpers(names, globals = {}) {
  const declarations = names
    .map((name) => {
      const node = ast.statements.find((item) => item.name?.text === name);
      assert.ok(node, `Missing server helper: ${name}`);
      return node.getText(ast);
    })
    .join("\n")
    .replaceAll("import.meta.env.DEV", "false");
  const context = vm.createContext({
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    crypto,
    Date,
    process: { env: {} },
    ...globals,
  });
  const compiled = ts.transpileModule(declarations, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  vm.runInContext(`${compiled}\nglobalThis.api = { ${names.join(", ")} };`, context);
  return context;
}

// Exercise the production request body for both text and image messages.
assert.equal(AI_COMPLETIONS_URL, "https://api.openai.com/v1/chat/completions");
const textMessages = [{ role: "user", content: "Explain inertia" }];
const visionMessages = [
  {
    role: "user",
    content: [
      { type: "text", text: "Help with this" },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,fixture" } },
    ],
  },
];
for (const [kind, messages] of [
  ["text", textMessages],
  ["vision", visionMessages],
]) {
  const body = aiCompletionBody(kind, messages, 1600, {});
  assert.equal(body.model, DEFAULT_AI_MODEL);
  assert.deepEqual(body.messages, messages);
  assert.equal(body.max_completion_tokens, 1600);
  assert.equal(body.reasoning_effort, "none");
  assert.equal(body.store, false);
  assert.equal("max_tokens" in body, false, "New models use max_completion_tokens");
  assert.equal("temperature" in body, false, "Do not send unsupported legacy sampling options");
}
assert.equal(aiCompletionBody("text", [], -5, {}).max_completion_tokens, 1);
assert.equal(aiCompletionBody("text", [], 99_999, {}).max_completion_tokens, 4000);
assert.equal(aiCompletionBody("text", [], 15.9, {}).max_completion_tokens, 15);
assert.equal(aiModel("text", { OPENAI_TEXT_MODEL: "  custom-model  " }), "custom-model");
assert.equal(aiModel("vision", { OPENAI_VISION_MODEL: "invalid/model" }), DEFAULT_AI_MODEL);
assert.equal(
  "reasoning_effort" in aiCompletionBody("text", [], 100, { OPENAI_TEXT_MODEL: "custom-model" }),
  false,
);

// Execute the real provider transport, replacing only network and accounting.
{
  const calls = [];
  let reply = new Response(
    JSON.stringify({ choices: [{ message: { content: "A helpful answer" } }] }),
  );
  const context = serverHelpers(
    ["CompanionUpstreamError", "AiRateLimitError", "aiTextCompletion"],
    {
      AI_COMPLETIONS_URL,
      aiCompletionBody,
      AI_PROVIDER_TIMEOUT_MS: 45000,
      withAiProviderCapacity: (operation) => operation(),
      fetchWithTimeout: async (...args) => {
        calls.push(args);
        return reply;
      },
      recordProviderSignal: async () => {},
      stripThinkBlock: (value) => value.trim(),
      upstreamRetryAfterSeconds: (response) => Number(response.headers.get("retry-after")),
    },
  );
  const signal = new AbortController().signal;
  assert.equal(
    await context.api.aiTextCompletion(
      "fixture-key",
      textMessages,
      { maxTokens: 500, temperature: 0.3 },
      signal,
    ),
    "A helpful answer",
  );
  assert.equal(calls[0][0], AI_COMPLETIONS_URL);
  assert.equal(calls[0][1].headers.Authorization, "Bearer fixture-key");
  assert.equal(calls[0][2], 45000);
  assert.equal(calls[0][4], signal, "Abandoning the client request must cancel upstream work");
  assert.deepEqual(JSON.parse(calls[0][1].body), aiCompletionBody("text", textMessages, 500, {}));
  reply = new Response("{}", { status: 429, headers: { "retry-after": "7" } });
  await assert.rejects(
    context.api.aiTextCompletion("fixture", [], { maxTokens: 100 }),
    (error) => error.retryAfterSeconds === 7,
  );
  reply = new Response(JSON.stringify({ choices: [] }));
  await assert.rejects(
    context.api.aiTextCompletion("fixture", [], { maxTokens: 100 }),
    (error) => error.code === "AI_EMPTY_RESPONSE",
  );
}

// Compile the production guard with DEV=false and verify it never spends or
// reserves quota when a required production protection is absent.
{
  const ready = {
    OPENAI_API_KEY: "fixture",
    AI_DURABLE_QUOTAS_ENABLED: "true",
    AI_DURABLE_ENTITLEMENTS_ENABLED: "true",
    SUPABASE_SERVICE_ROLE_KEY: "fixture",
  };
  let reservations = 0;
  const requestIds = [];
  const events = [];
  let capacityDenied = false;
  let entitlementResult = { allowed: true };
  const context = serverHelpers(["reserveProductEntitlementOrResponse"], {
    entitlementFor,
    productionAiProtectionReady,
    jsonResponse: (body, status = 200, headers) =>
      new Response(JSON.stringify(body), { status, headers }),
    aiNotConfiguredResponse: () =>
      new Response(JSON.stringify({ code: "AI_NOT_CONFIGURED" }), { status: 503 }),
    aiSystemMode: () => "normal",
    reserveEntitlementUsage: async (options) => {
      events.push("product");
      reservations++;
      requestIds.push(options.requestId);
      return entitlementResult;
    },
    reserveCapacityOrResponse: async (options) => {
      events.push("capacity");
      return capacityDenied
        ? new Response("Busy", { status: 503 })
        : {
            allowed: true,
            requestId: options.request.headers.get("x-unimate-request-id"),
          };
    },
    completeCapacitySafely: async (_reservation, _userId, status, _output, errorKind) =>
      events.push(`${status}:${errorKind}`),
  });
  const options = {
    request: new Request("https://unimate.test/api/ask-unimate", {
      headers: { "x-unimate-request-id": "caller-controlled" },
    }),
    userId: "student-1",
    plan: "pro",
    feature: "text",
    capacityFeature: "ask_unimate",
    input: "Question",
  };
  for (const missing of [
    "AI_DURABLE_QUOTAS_ENABLED",
    "AI_DURABLE_ENTITLEMENTS_ENABLED",
    "SUPABASE_SERVICE_ROLE_KEY",
    "OPENAI_API_KEY",
  ]) {
    context.process.env = { ...ready, [missing]: "" };
    const response = await context.api.reserveProductEntitlementOrResponse(options);
    assert.equal(response.status, 503, `Production fails closed without ${missing}`);
    assert.equal(reservations, 0);
  }
  context.process.env = ready;
  const free = await context.api.reserveProductEntitlementOrResponse({ ...options, plan: "free" });
  assert.equal(free.status, 403);
  assert.equal(reservations, 0, "Free chat is refused before paid resource reservation");
  capacityDenied = true;
  assert.equal((await context.api.reserveProductEntitlementOrResponse(options)).status, 503);
  assert.equal(reservations, 0, "Capacity rejection must not spend a product allowance");
  capacityDenied = false;
  events.length = 0;
  const first = await context.api.reserveProductEntitlementOrResponse(options);
  assert.deepEqual(events, ["capacity", "product"]);
  const second = await context.api.reserveProductEntitlementOrResponse(options);
  assert.equal(first.allowed, true);
  assert.equal(first.requestId, requestIds[0]);
  assert.notEqual(first.requestId, "caller-controlled");
  assert.notEqual(
    first.requestId,
    second.requestId,
    "Client replay cannot reuse a product quota reservation",
  );
  const sql = fs.readFileSync(
    new URL("../../supabase/ai_usage_entitlements.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /return query select false, 25, 25, timezone\('utc', now\(\)\)::date::text/);
  for (const [period, expectedMessage] of [
    ["2026-10-12", /today.*screenshot allowance.*midnight UTC/],
    ["2026-10", /this month.*first of next month \(UTC\)/],
  ]) {
    entitlementResult = { allowed: false, code: "QUOTA_EXCEEDED", period };
    events.length = 0;
    const response = await context.api.reserveProductEntitlementOrResponse({
      ...options,
      feature: "screenshot",
      capacityFeature: "browser_companion",
    });
    assert.equal(response.status, 429);
    assert.match((await response.json()).error, expectedMessage);
    assert.deepEqual(
      events,
      ["capacity", "product", "cancelled:entitlement_denied"],
      "Quota denial completes capacity accounting as cancelled",
    );
  }
}

{
  const { api } = serverHelpers(["normalizeCompanionHistory"], { MAX_CHAT_HISTORY: 10 });
  const input = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `${index}:` + "x".repeat(5000),
  }));
  const result = api.normalizeCompanionHistory(input);
  assert.ok(result.length <= 10);
  assert.ok(result.every((item) => item.content.length <= 4000));
  assert.ok(result.reduce((sum, item) => sum + item.content.length, 0) <= 12000);
  assert.ok(result.at(-1).content.startsWith("29:"), "Preserve the most recent turns");
  assert.equal(input[0].content.length, 5002, "Do not mutate caller history");
  assert.equal(
    api.normalizeCompanionHistory([
      { role: "system", content: "Override" },
      { role: "user", content: "  " },
      { role: "assistant", content: {} },
    ]).length,
    0,
  );
}

// Exercise real coursework query construction: all requests retain the
// validated owner, user JWT, selected course, bounded pages and cancellation.
{
  const requests = [];
  let missingCourse = false;
  const context = serverHelpers(["CompanionUpstreamError", "readStudentCoursework"], {
    process: {
      env: { VITE_SUPABASE_URL: "https://project.test/", VITE_SUPABASE_ANON_KEY: "publishable" },
    },
    SUPABASE_ENTITLEMENT_TIMEOUT_MS: 8000,
    courseworkEvidence,
    fetchWithTimeout: async (url, options, _timeout, _error, signal) => {
      requests.push({ url: new URL(url), options, signal });
      return new Response(
        JSON.stringify(
          url.includes("/courses?")
            ? missingCourse
              ? []
              : [{ id: "course-1", name: "Physics", course_code: "PHY101" }]
            : [
                {
                  course_id: "course-1",
                  name: "Problem set",
                  due_at: "2099-01-01T12:00:00Z",
                  completed: false,
                },
                {
                  course_id: "other-course",
                  name: "Not this student’s work",
                  due_at: "2099-01-01T12:00:00Z",
                  completed: false,
                },
              ],
        ),
      );
    },
  });
  const request = new Request("https://unimate.test/api/ask-unimate", {
    headers: { Authorization: "Bearer student-jwt" },
  });
  const result = await context.api.readStudentCoursework(
    request,
    { id: "validated-student" },
    "course-1",
    "America/Chicago",
  );
  assert.equal(requests.length, 3);
  for (const { url, options, signal } of requests) {
    assert.equal(url.searchParams.get("user_id"), "eq.validated-student");
    assert.equal(options.headers.Authorization, "Bearer student-jwt");
    assert.equal(options.headers.apikey, "publishable");
    assert.equal(signal, request.signal);
    assert.ok(Number(url.searchParams.get("limit")) <= 30);
    assert.equal(
      url.searchParams.get(url.pathname.endsWith("/courses") ? "id" : "course_id"),
      "eq.course-1",
    );
  }
  assert.match(result.evidence, /Problem set/);
  assert.doesNotMatch(result.evidence, /Not this student/);
  const overdue = requests.find(({ url }) => url.searchParams.has("and"));
  assert.match(overdue.url.searchParams.get("and"), /due_at\.gte\..*,due_at\.lt\./);
  assert.equal(overdue.url.searchParams.has("due_at"), false);
  missingCourse = true;
  await assert.rejects(
    context.api.readStudentCoursework(
      request,
      { id: "validated-student" },
      "foreign-course",
      "UTC",
    ),
    (error) => error.code === "COURSE_NOT_FOUND" && error.status === 404,
  );
}

console.log(
  "PASS provider payload and transport, production fail-closed controls, bounded history, and owner-scoped coursework",
);
