import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import {
  AI_COMPLETIONS_URL,
  DEFAULT_AI_MODEL,
  aiModel,
  aiCompletionBody,
  productionAiProtectionReady,
  AiProviderError,
  readAiProviderError,
} from "../../src/lib/ai-provider.ts";
import { courseworkEvidence } from "../../src/lib/coursework-grounding.ts";
import { entitlementFor } from "../../src/lib/ai-entitlements.ts";
import { getCompanionAccessState } from "../../src/lib/companion-store.ts";
import { supabaseServiceHeaders } from "../../src/lib/supabase-service.ts";

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

// All privileged Supabase transports accept both key formats without placing
// opaque secret keys in JWT headers. No real credentials or network are used.
{
  const modern = ["sb", "secret", "synthetic".repeat(4)].join("_");
  const legacy = ["eyJhbGciOiJIUzI1NiJ9", "eyJyb2xlIjoic2VydmljZV9yb2xlIn0", "synthetic"].join(".");
  assert.throws(() => supabaseServiceHeaders("   "), /not configured/);
  for (const key of [modern, legacy]) {
    const expected =
      key === modern ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
    assert.deepEqual(supabaseServiceHeaders(`  ${key}  `), expected);
    const calls = [];
    const env = {
      VITE_SUPABASE_URL: "https://fixture.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: key,
      AI_DURABLE_QUOTAS_ENABLED: "true",
      AI_DURABLE_ENTITLEMENTS_ENABLED: "true",
    };
    const context = serverHelpers(
      [
        "CompanionUpstreamError",
        "patchBillingProfile",
        "readBillingProfileAsServiceRole",
        "findUserIdsByStripeCustomer",
        "readBillingProfile",
      ],
      {
        supabaseServiceHeaders,
        process: { env: { ...env, VITE_SUPABASE_ANON_KEY: "public-fixture" } },
        SUPABASE_ENTITLEMENT_TIMEOUT_MS: 8000,
        fetchWithTimeout: async (...args) => {
          calls.push(args);
          return new Response(
            JSON.stringify([{ id: "student", is_pro: true, billing_revision: 1 }]),
          );
        },
      },
    );
    assert.equal(
      await context.api.patchBillingProfile(
        "student",
        { is_pro: true },
        { is_pro: false, stripe_customer_id: null, billing_revision: 0 },
      ),
      "updated",
    );
    assert.equal((await context.api.readBillingProfileAsServiceRole("student")).is_pro, true);
    assert.equal((await context.api.findUserIdsByStripeCustomer("customer"))[0], "student");
    for (const [, options, timeout] of calls) {
      const headers = new Headers(options.headers);
      assert.equal(headers.get("apikey"), key);
      assert.equal(headers.get("authorization"), key === modern ? null : `Bearer ${key}`);
      assert.equal(timeout, 8000);
    }
    assert.equal(calls[0][1].method, "PATCH");
    assert.equal(calls[0][1].headers.Prefer, "return=representation");
    assert.deepEqual(JSON.parse(calls[0][1].body), { is_pro: true, billing_revision: 1 });
    assert.equal(new URL(calls[0][0]).searchParams.get("billing_revision"), "eq.0");
    assert.equal(new URL(calls[0][0]).searchParams.get("stripe_customer_id"), "is.null");
    await context.api.readBillingProfile("student", "student-session-jwt");
    assert.equal(calls.at(-1)[1].headers.apikey, "public-fixture");
    assert.equal(calls.at(-1)[1].headers.Authorization, "Bearer student-session-jwt");

    function moduleFixture(path) {
      const moduleSource = fs.readFileSync(new URL(path, import.meta.url), "utf8");
      const moduleContext = vm.createContext({
        exports: {},
        process: { env },
        AbortSignal,
        crypto,
        require: (name) => {
          assert.equal(name, "./supabase-service.ts");
          return { supabaseServiceHeaders };
        },
        fetch: async (...args) => {
          calls.push(args);
          return new Response(
            JSON.stringify([{ allowed: true, used: 1, quota_limit: 750, period_key: "fixture" }]),
          );
        },
      });
      vm.runInContext(
        ts.transpileModule(moduleSource, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
        }).outputText,
        moduleContext,
      );
      return moduleContext.exports;
    }
    const capacity = moduleFixture("../../src/lib/ai-capacity.ts");
    await capacity.recordProviderSignal({ success: true });
    const entitlement = moduleFixture("../../src/lib/ai-entitlements.ts");
    assert.equal(
      (
        await entitlement.reserveEntitlementUsage({
          userId: "student",
          feature: "text",
          requestId: "fixture",
        })
      ).allowed,
      true,
    );
    for (const [url, options] of calls.slice(-2)) {
      assert.match(url, /^https:\/\/fixture\.supabase\.co\/rest\/v1\/rpc\//);
      assert.equal(options.method, "POST");
      const headers = new Headers(options.headers);
      assert.equal(headers.get("apikey"), key);
      assert.equal(headers.get("authorization"), key === modern ? null : `Bearer ${key}`);
      assert.ok(options.signal instanceof AbortSignal);
    }
    assert.deepEqual(JSON.parse(calls.at(-1)[1].body), {
      requested_user_id: "student",
      requested_feature: "text",
      requested_request_id: "fixture",
    });
  }

  // Execute the scanner with in-memory synthetic files, never actual env files.
  const scanner = fs
    .readFileSync(new URL("../../scripts/secret-scan.mjs", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "");
  for (const [value, shouldReject] of [
    [modern, true],
    [["sb", "publishable", "synthetic".repeat(4)].join("_"), false],
  ]) {
    const output = [];
    let exitCode = 0;
    try {
      vm.runInNewContext(scanner, {
        execFileSync: () => "fixture.txt\0",
        readFileSync: () => value,
        console: { error: (text) => output.push(text), log: (text) => output.push(text) },
        process: {
          exit: (code) => {
            exitCode = code;
            throw new Error("fixture-exit");
          },
        },
      });
    } catch (error) {
      assert.equal(error.message, "fixture-exit");
    }
    assert.equal(exitCode, shouldReject ? 1 : 0);
    assert.equal(output.join("\n").includes(value), false, "Scanner never prints credentials");
    if (shouldReject) assert.match(output.join("\n"), /fixture.txt: Supabase secret/);
  }
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
  const completions = [];
  const signals = [];
  let networkFailure = false;
  let reply = new Response(
    JSON.stringify({ choices: [{ message: { content: "A helpful answer" } }] }),
  );
  const context = serverHelpers(
    ["CompanionUpstreamError", "aiTextCompletion", "aiErrorResponse", "runCapacityTracked"],
    {
      AI_COMPLETIONS_URL,
      aiCompletionBody,
      AiProviderError,
      readAiProviderError,
      AI_PROVIDER_TIMEOUT_MS: 45000,
      withAiProviderCapacity: (operation) => operation(),
      fetchWithTimeout: async (...args) => {
        calls.push(args);
        if (networkFailure) throw new TypeError("private-network-detail");
        return reply;
      },
      recordProviderSignal: async (signal) => signals.push(signal),
      completeCapacitySafely: async (...args) => completions.push(args),
      jsonResponse: (body, status = 200, headers) =>
        new Response(JSON.stringify(body), { status, headers }),
      stripThinkBlock: (value) => value.trim(),
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
  for (const [status, code, expectedCode] of [
    [429, "insufficient_quota", "AI_BILLING_UNAVAILABLE"],
    [429, "billing_hard_limit_reached", "AI_BILLING_UNAVAILABLE"],
    [429, "project_spend_limit_exceeded", "AI_BILLING_UNAVAILABLE"],
    [429, "organization_spend_limit_exceeded", "AI_BILLING_UNAVAILABLE"],
    [429, "organization_usage_limit_exceeded", "AI_BILLING_UNAVAILABLE"],
    [401, "invalid_api_key", "AI_CONFIGURATION_ERROR"],
    [403, "permission_denied", "AI_CONFIGURATION_ERROR"],
  ]) {
    reply = new Response(JSON.stringify({ error: { code, message: "private-provider-detail" } }), {
      status,
      headers: { "retry-after": "1" },
    });
    let failure;
    const previousCalls = calls.length;
    try {
      await context.api.runCapacityTracked({ requestId: "fixture" }, "student", () =>
        context.api.aiTextCompletion("fixture", [], { maxTokens: 100 }),
      );
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof AiProviderError);
    assert.equal(failure.code, expectedCode);
    assert.equal(failure.retryAfterSeconds, 0);
    const response = context.api.aiErrorResponse(failure);
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.retryable, false);
    assert.equal(response.headers.get("retry-after"), null);
    assert.doesNotMatch(JSON.stringify(body), /private-provider-detail/);
    assert.equal(calls.length, previousCalls + 1);
    assert.equal(
      signals.at(-1).rateLimited,
      false,
      "Billing failures are not a traffic rate limit",
    );
    assert.equal(completions.at(-1)[2], "provider_error");
    assert.equal(completions.at(-1)[4], expectedCode.toLowerCase());
  }
  reply = new Response(JSON.stringify({ choices: [] }));
  await assert.rejects(
    context.api.aiTextCompletion("fixture", [], { maxTokens: 100 }),
    (error) => error.code === "AI_EMPTY_RESPONSE",
  );
  reply = Response.json({
    choices: [
      { finish_reason: "length", message: { content: "Start by multiplying both sides by" } },
    ],
  });
  const callsBeforeTruncation = calls.length;
  await assert.rejects(context.api.aiTextCompletion("fixture", [], { maxTokens: 320 }), (error) => {
    const response = context.api.aiErrorResponse(error);
    assert.equal(response.status, 502);
    assert.equal(error.code, "AI_RESPONSE_TRUNCATED");
    assert.match(error.message, /cut off.*try again.*shorter response/s);
    return true;
  });
  assert.equal(
    calls.length,
    callsBeforeTruncation + 1,
    "Truncated answers never trigger a hidden paid retry",
  );
  assert.equal(signals.at(-1).success, false);
  networkFailure = true;
  try {
    await context.api.aiTextCompletion("fixture", [], { maxTokens: 100 });
    assert.fail("Transport failure must not be treated as an answer");
  } catch (error) {
    const response = context.api.aiErrorResponse(error);
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.equal(body.retryable, true);
    assert.doesNotMatch(JSON.stringify(body), /private-network-detail/);
  }
}

// Execute the screenshot route, including its real transport, serializer and
// capacity completion; only external services and grounding are fixtures.
{
  const calls = [];
  const signals = [];
  const completions = [];
  let reply;
  const context = serverHelpers(
    ["CompanionUpstreamError", "aiErrorResponse", "handleAnalyzeScreenshot"],
    {
      AI_COMPLETIONS_URL,
      aiCompletionBody,
      AiProviderError,
      readAiProviderError,
      AI_PROVIDER_TIMEOUT_MS: 45000,
      MAX_IMAGE_DATA_URL_CHARS: 2500000,
      MAX_SCREENSHOT_BODY_BYTES: 3000000,
      process: { env: { OPENAI_API_KEY: "fixture-key" } },
      jsonResponse: (body, status = 200, headers) =>
        new Response(JSON.stringify(body), { status, headers }),
      rejectLargeRequest: () => null,
      requireCompanionEntitlement: async () => ({ user: { id: "student" } }),
      enforceUserRateLimit: () => null,
      aiFeatureEnabled: () => true,
      parseJsonBody: (request) => request.json(),
      reserveProductEntitlementOrResponse: async () => ({ requestId: "fixture-reservation" }),
      normalizeProvenance: () => ({}),
      resolveCurrentCompanionTask: (provenance) => ({ provenance, intent: "explain" }),
      companionRequestDiagnostics: () => ({}),
      buildProvenanceBlock: () => "Screenshot evidence",
      buildTutorTaskInstruction: () => "Explain",
      normalizeCompanionHistory: () => [],
      companionMaxTokens: () => 500,
      withAiProviderCapacity: (operation) => operation(),
      fetchWithTimeout: async (...args) => {
        calls.push(args);
        return reply;
      },
      recordProviderSignal: async (signal) => signals.push(signal),
      completeCapacitySafely: async (...args) => completions.push(args),
      stripThinkBlock: (value) => value.trim(),
      generateGroundedCompanionAnswer: async ({ callModel }) => ({
        answer: await callModel("Grounded fixture instruction"),
      }),
    },
  );
  const cases = [
    [429, "insufficient_quota", 503, "AI_BILLING_UNAVAILABLE", false],
    [429, "billing_hard_limit_reached", 503, "AI_BILLING_UNAVAILABLE", false],
    [429, "project_spend_limit_exceeded", 503, "AI_BILLING_UNAVAILABLE", false],
    [429, "organization_spend_limit_exceeded", 503, "AI_BILLING_UNAVAILABLE", false],
    [429, "organization_usage_limit_exceeded", 503, "AI_BILLING_UNAVAILABLE", false],
    [401, "invalid_api_key", 503, "AI_CONFIGURATION_ERROR", false],
    [403, "permission_denied", 503, "AI_CONFIGURATION_ERROR", false],
    [429, "rate_limit_exceeded", 429, "AI_RATE_LIMITED", true],
    [503, "server_error", 502, "AI_PROVIDER_ERROR", true],
  ];
  for (const [upstreamStatus, code, publicStatus, publicCode, retryable] of cases) {
    reply = new Response(JSON.stringify({ error: { code, message: "private-provider-secret" } }), {
      status: upstreamStatus,
      headers: { "retry-after": "8" },
    });
    const request = new Request("https://unimate.test/api/analyze-screenshot", {
      method: "POST",
      body: JSON.stringify({ imageBase64: "data:image/png;base64,AAAA", question: "Explain this" }),
    });
    const previousCalls = calls.length;
    const response = await context.api.handleAnalyzeScreenshot(request);
    const body = await response.json();
    assert.equal(response.status, publicStatus);
    assert.equal(body.code, publicCode);
    assert.equal(body.phase, "ai");
    assert.equal(body.retryable, retryable);
    assert.equal(response.headers.get("retry-after"), retryable ? "8" : null);
    assert.doesNotMatch(JSON.stringify(body), /private-provider|fixture-key/);
    assert.equal(calls.length, previousCalls + 1, "Never automatically retry a provider failure");
    assert.equal(calls.at(-1)[4], request.signal);
    const sentBody = JSON.parse(calls.at(-1)[1].body);
    assert.equal(sentBody.messages.at(-1).content[1].image_url.url, "data:image/png;base64,AAAA");
    assert.equal(signals.at(-1).rateLimited, publicCode === "AI_RATE_LIMITED");
    assert.equal(completions.at(-1)[2], "provider_error");
    assert.equal(completions.at(-1)[4], publicCode.toLowerCase());
  }
  const unknown = context.api.aiErrorResponse(new Error("private-provider-secret"));
  assert.equal(unknown.status, 502);
  assert.equal((await unknown.json()).retryable, true);
  reply = Response.json({
    choices: [{ finish_reason: "length", message: { content: "Partial screenshot answer" } }],
  });
  const truncated = await context.api.handleAnalyzeScreenshot(
    new Request("https://unimate.test/api/analyze-screenshot", {
      method: "POST",
      body: JSON.stringify({ imageBase64: "data:image/png;base64,AAAA", question: "Explain this" }),
    }),
  );
  const truncatedBody = await truncated.json();
  assert.equal(truncated.status, 502);
  assert.equal(truncatedBody.code, "AI_RESPONSE_TRUNCATED");
  assert.equal(truncatedBody.retryable, true);
  assert.equal(truncatedBody.answer, undefined, "No partial answer is returned as success");
  assert.match(truncatedBody.error, /cut off.*try again.*shorter response/s);
  assert.equal(signals.at(-1).success, false);
  assert.equal(completions.at(-1)[2], "provider_error");
}

// Execute the Ask client adapter with simulated API responses, proving the
// server's retry decision survives parsing and reaches the composer unchanged.
{
  const clientSource = fs.readFileSync(
    new URL("../../src/functions/ask-unimate.ts", import.meta.url),
    "utf8",
  );
  let reply;
  const context = vm.createContext({
    exports: {},
    crypto,
    fetch: async () => reply,
    require: (name) => {
      if (name === "zod") return { z };
      if (name === "../lib/auth-fetch") return { getAuthHeaders: async () => ({}) };
      throw new Error(`Unexpected client dependency: ${name}`);
    },
  });
  vm.runInContext(
    ts.transpileModule(clientSource, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    context,
  );
  for (const [code, retryable, status] of [
    ["AI_BILLING_UNAVAILABLE", false, 503],
    ["AI_CONFIGURATION_ERROR", false, 503],
    ["AI_NOT_CONFIGURED", false, 503],
    ["AI_RATE_LIMITED", true, 429],
  ]) {
    reply = new Response(
      JSON.stringify({ error: "Safe helpful message", code, phase: "ai", retryable }),
      { status },
    );
    await assert.rejects(
      context.exports.askUniMate({ question: "Explain inertia" }),
      (error) =>
        error instanceof context.exports.UniMateApiError &&
        error.retryable === retryable &&
        error.code === code &&
        error.status === status,
    );
  }
  assert.equal(
    new context.exports.UniMateApiError("Unavailable", 503, "AI_BILLING_UNAVAILABLE").retryable,
    false,
  );
}

// Execute the actual Ask gate with billing snapshots, including an HTTP-success
// response carrying stale Free data while the subscription provider is offline.
{
  const askSource = fs.readFileSync(new URL("../../src/routes/ask.tsx", import.meta.url), "utf8");
  const askAst = ts.createSourceFile(
    "ask.tsx",
    askSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const gate = askAst.statements.find((node) => node.name?.text === "AskAccessGate");
  assert.ok(gate);
  let billing;
  let refetches = 0;
  const context = vm.createContext({
    useBillingStatus: () => billing,
    useAuth: () => ({ user: { id: "synthetic-gate-user" } }),
    useState: (value) => [value, () => {}],
    useRef: (value) => ({ current: value }),
    useCallback: (callback) => callback,
    useEffect: () => {},
    getCompanionAccessState,
    Link: "link",
    AskProIntroduction: "paywall",
    Ask: "chat",
    LoaderCircle: "loader",
    React: {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    },
  });
  vm.runInContext(
    ts.transpileModule(gate.getText(askAst), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText,
    context,
  );
  const nodes = (tree) =>
    tree && typeof tree === "object" ? [tree, ...tree.children.flatMap(nodes)] : [];
  const snapshot = (data, other = {}) => ({
    isPending: false,
    isError: false,
    isFetching: false,
    data,
    refetch: () => {
      refetches++;
    },
    ...other,
  });
  for (const isPro of [false, true]) {
    billing = snapshot({ isPro, temporarilyUnavailable: true });
    let tree = context.AskAccessGate();
    assert.equal(
      nodes(tree).some((node) => node.type === "paywall" || node.type === "chat"),
      false,
    );
    assert.ok(nodes(tree).some((node) => node.props.role === "alert"));
    const button = nodes(tree).find((node) => node.type === "button");
    button.props.onClick();
    billing.isFetching = true;
    tree = context.AskAccessGate();
    assert.equal(nodes(tree).find((node) => node.type === "button").props.disabled, true);
  }
  assert.equal(refetches, 2);
  billing = snapshot({ isPro: false });
  assert.equal(context.AskAccessGate().type, "paywall");
  billing = snapshot({ isPro: true });
  assert.equal(context.AskAccessGate().type, "chat");
  for (const options of [{ isError: true }, { data: undefined }]) {
    billing = snapshot({ isPro: false }, options);
    assert.ok(nodes(context.AskAccessGate()).some((node) => node.props.role === "alert"));
  }
  billing = snapshot(undefined, { isPending: true });
  assert.ok(nodes(context.AskAccessGate()).some((node) => node.props.role === "status"));

  let supportAttributes;
  function inspect(node) {
    if (ts.isJsxOpeningElement(node)) {
      const attributes = Object.fromEntries(
        node.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((attribute) => [attribute.name.getText(askAst), attribute.initializer?.text]),
      );
      if (attributes.to === "/support") supportAttributes = attributes;
    }
    ts.forEachChild(node, inspect);
  }
  inspect(askAst);
  assert.equal(
    supportAttributes?.target,
    "_blank",
    "Support must not unmount the unsaved Ask draft",
  );
  assert.match(supportAttributes.rel, /noopener/);
  assert.match(supportAttributes.rel, /noreferrer/);
  assert.match(supportAttributes["aria-label"], /new tab.*draft stays here/);
}

// Provider error bodies are untrusted and bounded; public failures never expose
// raw credentials or confuse the app's provider billing with a student plan.
{
  const classify = (status, error, headers) =>
    readAiProviderError(new Response(JSON.stringify({ error }), { status, headers }));
  const syntheticSecret = ["sk", "fixture", "never", "expose"].join("-");
  for (const code of [
    "insufficient_quota",
    "billing_hard_limit_reached",
    "billing_not_active",
    "usage_limit_reached",
    "credit_balance_exhausted",
    "project_spend_limit_exceeded",
    "organization_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
  ]) {
    const error = await classify(429, { code, message: syntheticSecret }, { "retry-after": "30" });
    assert.equal(error.code, "AI_BILLING_UNAVAILABLE");
    assert.equal(error.phase, "ai");
    assert.equal(error.status, 503);
    assert.equal(error.retryable, false);
    assert.equal(error.retryAfterSeconds, 0);
    assert.equal((JSON.stringify(error) + error.message).includes(syntheticSecret), false);
  }
  assert.equal(
    (
      await classify(429, {
        message: "You exceeded your current quota, please check your plan and billing details.",
      })
    ).code,
    "AI_BILLING_UNAVAILABLE",
  );
  const throttled = await classify(
    429,
    { code: "rate_limit_exceeded", message: "Requests per minute exceeded" },
    { "retry-after": "2.5" },
  );
  assert.equal(throttled.code, "AI_RATE_LIMITED");
  assert.equal(throttled.retryable, true);
  assert.equal(throttled.retryAfterSeconds, 3);
  assert.equal(
    (
      await classify(429, {
        code: "rate_limit_exceeded",
        message: "You exceeded your current quota of requests",
      })
    ).code,
    "AI_RATE_LIMITED",
    "Explicit provider rate code takes precedence over vague quota wording",
  );
  for (const value of ["invalid", "-4"])
    assert.equal((await classify(429, {}, { "retry-after": value })).retryAfterSeconds, 0);
  assert.equal(
    (await classify(429, {}, { "retry-after": "999999999999" })).retryAfterSeconds,
    86400,
  );
  for (const status of [401, 403, 404])
    assert.equal(
      (await classify(status, {})).status,
      503,
      "Provider authorization must not sign the student out",
    );
  assert.equal((await classify(400, { code: "model_not_found" })).code, "AI_CONFIGURATION_ERROR");
  assert.equal((await classify(400, {})).retryable, false);
  assert.equal((await classify(503, {})).retryable, true);
  assert.equal(
    (await readAiProviderError(new Response("<html>Unavailable</html>", { status: 502 }))).code,
    "AI_PROVIDER_ERROR",
  );
  let cancelled = false;
  const oversized = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(17000)));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { status: 500 },
  );
  assert.equal((await readAiProviderError(oversized)).code, "AI_PROVIDER_ERROR");
  assert.equal(cancelled, true, "Stop reading an oversized provider error instead of buffering it");
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
