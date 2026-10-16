import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  COMPANION_GROUNDING_SYSTEM_PROMPT,
  GROUNDED_FALLBACK_ANSWER,
  buildTutorTaskInstruction,
  classifyCompanionIntent,
  detectHallucination,
  normalizeProvenance,
  resolveCompanionReference,
  stripThinkBlock,
} from "../../src/lib/companion-grounding.ts";

// Execute the actual server functions with mocked transport, without starting
// the app or spending API credits. AST extraction preserves their real bodies.
const source = fs.readFileSync(new URL("../../src/server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true);
function serverFunctions(names, globals = {}) {
  const declarations = names
    .map((name) => {
      const declaration = ast.statements.find((node) => node.name?.text === name);
      assert.ok(declaration, `Server declaration ${name} exists`);
      return declaration.getText(ast);
    })
    .join("\n")
    .replaceAll("import.meta.env.DEV", "false");
  const context = vm.createContext({
    Request,
    Response,
    URL,
    process: { env: {} },
    console: { error() {}, warn() {} },
    jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    ...globals,
  });
  const compiled = ts.transpileModule(declarations, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  vm.runInContext(`${compiled}\nglobalThis.api = { ${names.join(", ")} };`, context);
  return context;
}

const authenticatedRequest = (path = "/api/billing-status", options = {}) =>
  new Request(`https://unimate.test${path}`, {
    headers: { Authorization: "Bearer validated-user-token" },
    ...options,
  });

// Legacy Pro support selects only the existing entitlement column. It cannot
// conceal configured billing outages, missing profiles, or malformed data.
{
  let profileRows = [{ is_pro: true }];
  let profileFailure = false;
  let stripeFailure = false;
  let subscription = { status: "active" };
  let syncSucceeds = true;
  const calls = [];
  const env = {
    VITE_SUPABASE_URL: "https://project.test",
    VITE_SUPABASE_ANON_KEY: "public-fixture",
  };
  const context = serverFunctions(
    [
      "CompanionUpstreamError",
      "companionErrorResponse",
      "stripeConfiguration",
      "readBillingProfile",
      "handleBillingStatus",
      "handleBillingStatusInner",
    ],
    {
      process: { env },
      SUPABASE_ENTITLEMENT_TIMEOUT_MS: 8000,
      requireAuthenticatedUser: async () => ({ id: "validated-owner" }),
      developmentProOverride: () => false,
      enforceUserRateLimit: () => null,
      fetchWithTimeout: async (url, init, _timeout, _error, signal) => {
        calls.push({ url: new URL(url), init, signal });
        return new Response(JSON.stringify(profileRows), { status: profileFailure ? 500 : 200 });
      },
      listCustomerSubscriptions: async () => {
        if (stripeFailure) throw new Error("Stripe unavailable");
        return subscription ? [subscription] : [];
      },
      preferredSubscription: (subscriptions) => subscriptions[0] || null,
      subscriptionEntitled: (status) => status === "active",
      billingStateForSubscription: (value) => value.status,
      subscriptionScheduledCancellation: () => false,
      patchBillingProfile: async () => syncSucceeds,
      reconcileCustomerBilling: async () => {
        if (stripeFailure || !syncSucceeds) throw new Error("Billing unavailable");
        return { subscription, isPro: subscription?.status === "active" };
      },
      subscriptionPeriodEnd: () => null,
    },
  );
  const request = authenticatedRequest();
  let response = await context.api.handleBillingStatus(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { isPro: true, state: "legacy", canManage: false });
  assert.equal(calls.at(-1).url.searchParams.get("select"), "is_pro");
  assert.equal(calls.at(-1).url.searchParams.get("id"), "eq.validated-owner");
  assert.equal(calls.at(-1).init.headers.Authorization, "Bearer validated-user-token");
  assert.equal(calls.at(-1).signal, request.signal);

  profileRows = [{ is_pro: false }];
  assert.equal((await (await context.api.handleBillingStatus(request)).json()).isPro, false);
  for (const rows of [[], {}, [{ is_pro: "true" }], [{ is_pro: 1 }], [{ is_pro: null }]]) {
    profileRows = rows;
    assert.equal((await context.api.handleBillingStatus(request)).status, 503);
  }
  profileRows = [{ is_pro: true }];
  profileFailure = true;
  response = await context.api.handleBillingStatus(request);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "ENTITLEMENT_UNAVAILABLE");
  profileFailure = false;

  // A reader used by purchasing/portal still requires the full billing schema.
  await context.api.readBillingProfile("validated-owner", "validated-user-token");
  assert.equal(
    calls.at(-1).url.searchParams.get("select"),
    "is_pro,stripe_customer_id,billing_revision",
  );
  for (const partial of [
    { STRIPE_SECRET_KEY: "sk_test_fixture" },
    { STRIPE_PRICE_ID: "price_fixture" },
    { STRIPE_SECRET_KEY: "invalid", STRIPE_PRICE_ID: "price_fixture" },
  ]) {
    context.process.env = { ...env, ...partial };
    const count = calls.length;
    assert.equal((await context.api.handleBillingStatus(request)).status, 503);
    assert.equal(
      (
        await context.api.handleBillingStatus(
          authenticatedRequest("/api/billing-status?reconcile=false"),
        )
      ).status,
      503,
    );
    assert.equal(
      calls.length,
      count,
      "Broken configuration never falls back to profile entitlement",
    );
  }
  context.process.env = {
    ...env,
    STRIPE_SECRET_KEY: "sk_test_fixture",
    STRIPE_PRICE_ID: "price_fixture",
    UNIMATE_CANONICAL_ORIGIN: "https://unimate.test",
  };
  profileRows = [{ is_pro: true, stripe_customer_id: "customer_fixture" }];
  response = await context.api.handleBillingStatus(request);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).isPro, true);
  assert.equal(
    calls.at(-1).url.searchParams.get("select"),
    "is_pro,stripe_customer_id,billing_revision",
  );
  stripeFailure = true;
  response = await context.api.handleBillingStatus(request);
  assert.equal(response.status, 503);
  const unavailable = await response.json();
  assert.equal(unavailable.code, "BILLING_SYNC_FAILED");
  assert.equal(unavailable.isPro, undefined, "An outage never reuses stale Pro status");
  stripeFailure = false;
  subscription = null;
  syncSucceeds = false;
  assert.equal((await context.api.handleBillingStatus(request)).status, 503);
  syncSucceeds = true;
  assert.equal((await (await context.api.handleBillingStatus(request)).json()).isPro, false);
}

// Both companion routes use this actual guard. Client-supplied profile claims
// cannot grant access; a successful authenticated lookup must contain true.
{
  let rows = [{ is_pro: true }];
  let status = 200;
  let authDenied = false;
  const calls = [];
  const context = serverFunctions(
    [
      "CompanionUpstreamError",
      "companionErrorResponse",
      "requireCompanionEntitlement",
      "handleDashboardAI",
      "handleAnalyzeScreenshot",
    ],
    {
      process: {
        env: {
          VITE_SUPABASE_URL: "https://project.test",
          VITE_SUPABASE_ANON_KEY: "public-fixture",
        },
      },
      SUPABASE_ENTITLEMENT_TIMEOUT_MS: 8000,
      requireAuthenticatedUser: async () =>
        authDenied ? new Response("Unauthorized", { status: 401 }) : { id: "validated-owner" },
      developmentProOverride: () => false,
      MAX_IMAGE_DATA_URL_CHARS: 8_000_000,
      MAX_SCREENSHOT_BODY_BYTES: 3_000_000,
      rejectLargeRequest: () => null,
      parseJsonBody: (request) => request.json(),
      fetchWithTimeout: async (url, init, _timeout, _error, signal) => {
        calls.push({ url: new URL(url), init, signal });
        return new Response(JSON.stringify(rows), { status });
      },
    },
  );
  const request = authenticatedRequest("/api/analyze-screenshot", {
    method: "POST",
    body: JSON.stringify({ isPro: true, userId: "other-owner" }),
  });
  assert.equal(
    (await context.api.requireCompanionEntitlement(new Request("https://unimate.test"))).status,
    401,
  );
  assert.equal(calls.length, 0);
  const allowed = await context.api.requireCompanionEntitlement(request);
  assert.equal(allowed.user.id, "validated-owner");
  assert.equal(calls.at(-1).url.searchParams.get("id"), "eq.validated-owner");
  assert.equal(calls.at(-1).url.searchParams.get("select"), "is_pro");
  assert.equal(calls.at(-1).signal, request.signal);
  for (const value of [false, "true", 1, null, undefined]) {
    rows = [{ is_pro: value }];
    const denied = await context.api.requireCompanionEntitlement(request);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, "PRO_REQUIRED");
  }
  rows = [{ is_pro: false }];
  for (const [handler, path, body] of [
    ["handleDashboardAI", "/api/dashboard-ai", { type: "companion-chat", message: "Solve this" }],
    [
      "handleAnalyzeScreenshot",
      "/api/analyze-screenshot",
      { imageBase64: "data:image/png;base64,AAAA", question: "Solve this" },
    ],
  ]) {
    const denied = await context.api[handler](
      authenticatedRequest(path, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    assert.equal(denied.status, 403, `${handler} denies Free before any model or quota call`);
    assert.equal((await denied.json()).code, "PRO_REQUIRED");
  }
  rows = [{ is_pro: true }];
  status = 503;
  assert.equal((await context.api.requireCompanionEntitlement(request)).status, 503);
  authDenied = true;
  const count = calls.length;
  assert.equal((await context.api.requireCompanionEntitlement(request)).status, 401);
  assert.equal(calls.length, count, "Rejected authentication stops before profile access");
}

// Actual upstream wrapper aborts timed-out and abandoned requests and preserves
// the distinct error code, so a dropped tab cannot leave paid work running.
{
  const signals = [];
  const context = serverFunctions(["CompanionUpstreamError", "fetchWithTimeout"], {
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (_url, init) =>
      new Promise((_resolve, reject) => {
        signals.push(init.signal);
        if (init.signal.aborted) reject(new Error("Aborted"));
        else
          init.signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
      }),
  });
  const timeoutError = new context.api.CompanionUpstreamError("AI_TIMEOUT", "ai", 504, "Timed out");
  await assert.rejects(
    context.api.fetchWithTimeout("https://provider.test", {}, 5, timeoutError),
    (error) => error.code === "AI_TIMEOUT" && error.status === 504,
  );
  assert.equal(signals.at(-1).aborted, true);
  const client = new AbortController();
  const abandoned = context.api.fetchWithTimeout(
    "https://provider.test",
    {},
    1000,
    timeoutError,
    client.signal,
  );
  client.abort();
  await assert.rejects(
    abandoned,
    (error) => error.code === "REQUEST_CANCELLED" && error.status === 499,
  );
  assert.equal(signals.at(-1).aborted, true);
}

// Full response downloads retain deadlines, cancellation, and concurrency.
{
  let upstreamSignal;
  let streamController;
  let cancelled = 0;
  const context = serverFunctions(
    ["CompanionUpstreamError", "fetchWithTimeout", "withAiProviderCapacity"],
    {
      AbortController,
      setTimeout,
      clearTimeout,
      activeAiProviderRequests: 0,
      configuredAiConcurrency: () => 1,
      fetch: async (_url, init) => {
        upstreamSignal = init.signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              streamController = controller;
            },
            cancel() {
              cancelled++;
            },
          }),
          { headers: { "content-type": "application/json", "retry-after": "7" } },
        );
      },
    },
  );
  const error = new context.api.CompanionUpstreamError("AI_TIMEOUT", "ai", 504, "Timed out");
  const fetchBody = (signal, limit = 100) =>
    context.api.fetchWithTimeout("https://fixture.test", {}, 30, error, signal, limit);
  const pending = context.api.withAiProviderCapacity(() => fetchBody());
  await Promise.resolve();
  await assert.rejects(
    context.api.withAiProviderCapacity(() => fetchBody()),
    (e) => e.code === "AI_BUSY",
  );
  await assert.rejects(pending, (e) => e.code === "AI_TIMEOUT");
  assert.equal(upstreamSignal.aborted, true);
  assert.ok(cancelled > 0);
  assert.equal(context.activeAiProviderRequests, 0);

  const client = new AbortController();
  const abandoned = fetchBody(client.signal);
  await Promise.resolve();
  client.abort();
  await assert.rejects(abandoned, (e) => e.code === "REQUEST_CANCELLED");
  assert.equal(upstreamSignal.aborted, true);

  const oversized = fetchBody(undefined, 3);
  await Promise.resolve();
  streamController.enqueue(new Uint8Array(4));
  await assert.rejects(oversized, (e) => e.code === "UPSTREAM_RESPONSE_TOO_LARGE");
  assert.equal(upstreamSignal.aborted, true);

  const exact = fetchBody(undefined, 3);
  await Promise.resolve();
  streamController.enqueue(new TextEncoder().encode("abc"));
  streamController.close();
  const result = await exact;
  assert.equal(await result.text(), "abc");
  assert.equal(result.headers.get("retry-after"), "7");
  assert.equal(result.status, 200);
  for (const status of [204, 304, 302, 429, 500]) {
    context.fetch = async () =>
      new Response([204, 304].includes(status) ? null : "body", {
        status,
        headers: { location: "/next", "retry-after": "8" },
      });
    const response = await fetchBody();
    assert.equal(response.status, status);
    assert.equal(response.headers.get("location"), "/next");
    assert.equal(response.headers.get("retry-after"), "8");
    assert.equal(await response.text(), [204, 304].includes(status) ? "" : "body");
  }
}

// Auth service outages never impersonate an expired student session.
{
  let status = 200;
  const context = serverFunctions(
    [
      "CompanionUpstreamError",
      "companionErrorResponse",
      "getUserFromAccessToken",
      "requireAuthenticatedUser",
    ],
    {
      process: {
        env: {
          VITE_SUPABASE_URL: "https://fixture.test",
          VITE_SUPABASE_ANON_KEY: "public-fixture",
        },
      },
      SUPABASE_AUTH_TIMEOUT_MS: 8000,
      fetchWithTimeout: async () => Response.json({ id: "validated-owner" }, { status }),
    },
  );
  for (status of [429, 500, 502, 503, 504, 404]) {
    const response = await context.api.requireAuthenticatedUser(authenticatedRequest());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "AUTH_UNAVAILABLE");
  }
  for (status of [401, 403]) {
    const response = await context.api.requireAuthenticatedUser(authenticatedRequest());
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "INVALID_SESSION");
  }
  status = 200;
  assert.equal(
    (await context.api.requireAuthenticatedUser(authenticatedRequest())).id,
    "validated-owner",
  );
}

// Explicit current targets win over an unrelated highlight, including # syntax.
{
  const provenance = normalizeProvenance({
    selectedText: "An unrelated history paragraph is still highlighted.",
    visiblePageText:
      "3. History — Summarize\nA historical passage.\n4. Biology — Explain\nPhotosynthesis converts light energy.\n5. Algebra — Solve",
  });
  for (const prompt of [
    "#4",
    "Try #4",
    "Explain this question 4",
    "Explain this section #4",
    "Try the fourth one",
  ]) {
    const resolved = resolveCompanionReference(prompt, provenance);
    assert.equal(resolved.ordinal, 4, prompt);
    assert.match(resolved.matchedText, /Photosynthesis/);
    assert.doesNotMatch(resolved.matchedText, /history|Algebra/i);
  }
  assert.equal(
    resolveCompanionReference("Explain this paragraph", provenance).reference,
    "current selection",
  );
  assert.equal(stripThinkBlock("<think>internal only</think>"), "");
  assert.equal(stripThinkBlock("<think>truncated internal only"), "");
  assert.equal(stripThinkBlock("<think>internal</think>Answer: 42."), "Answer: 42.");
  const context = serverFunctions(["generateGroundedCompanionAnswer"], {
    COMPANION_GROUNDING_SYSTEM_PROMPT,
    GROUNDED_FALLBACK_ANSWER,
    detectHallucination,
  });
  let calls = 0;
  const blocked = await context.api.generateGroundedCompanionAnswer({
    provenance,
    userMessage: "Explain this",
    callModel: async () => {
      calls++;
      return 'The passage says "An unseen research paper from 2035 found 97% of students need a fictional therapy."';
    },
  });
  assert.equal(blocked.answer, GROUNDED_FALLBACK_ANSWER);
  assert.equal(blocked.blocked, true);
  assert.equal(calls, 1, "Grounding rejection never silently spends on a retry");
}

// Supportive study coaching can paraphrase grounded concepts without presenting
// its own sentence as an exact quotation. Keep the quotation guard unchanged.
{
  const question =
    "I'm overwhelmed and don't know where to start studying this. Help me take one small step.";
  const provenance = normalizeProvenance({
    visiblePageText:
      "Cellular respiration: mitochondria convert energy from nutrients into ATP. ATP is the cell's usable energy.",
  });
  assert.equal(classifyCompanionIntent(question), "general-help");
  const supportiveAnswer =
    "Let's start with one sentence: mitochondria make ATP, which is the cell’s usable energy.\nRead it once, then cover it and say it back in your own words.";
  assert.equal(detectHallucination(supportiveAnswer, provenance, question).flagged, false);
  const quotedParaphrase =
    "Start with one sentence: “Mitochondria make ATP, which is the cell’s usable energy.”";
  assert.ok(
    detectHallucination(quotedParaphrase, provenance, question).reasons.includes(
      "fabricated_quote",
    ),
  );
  const inventedSource =
    "The textbook says “Mitochondria make ATP through a hidden process that your instructor expects you to memorize.”";
  assert.ok(detectHallucination(inventedSource, provenance, question).flagged);
  assert.match(
    COMPANION_GROUNDING_SYSTEM_PROMPT,
    /Use quotation marks only for exact text copied from supplied page sources/,
  );
  assert.match(
    COMPANION_GROUNDING_SYSTEM_PROMPT,
    /study summaries, and suggested practice sentences as ordinary unquoted prose/,
  );
  assert.match(
    buildTutorTaskInstruction("general-help"),
    /one manageable step, without an Answer label/,
  );
  assert.match(buildTutorTaskInstruction("explain"), /without an Answer label/);
  assert.match(buildTutorTaskInstruction("solve"), /answer first/);
  const context = serverFunctions(["generateGroundedCompanionAnswer"], {
    COMPANION_GROUNDING_SYSTEM_PROMPT,
    GROUNDED_FALLBACK_ANSWER,
    detectHallucination,
  });
  const result = await context.api.generateGroundedCompanionAnswer({
    provenance,
    userMessage: question,
    callModel: async () => supportiveAnswer,
  });
  assert.equal(result.blocked, false);
  assert.equal(result.answer, supportiveAnswer);
}

// The actual extension serializer must fit the server envelope at every legal
// image/metadata limit, including multibyte text and JSON-escaped UTF-16. These
// checks stop before reservation/provider work and make no external calls.
{
  const numericConstant = (text, name) => {
    const match = text.match(new RegExp(`const ${name} = ([0-9_]+)`));
    assert.ok(match, `Numeric limit ${name} exists`);
    return Number(match[1].replaceAll("_", ""));
  };
  const imageLimit = numericConstant(source, "MAX_IMAGE_DATA_URL_CHARS");
  const envelopeLimit = numericConstant(source, "MAX_SCREENSHOT_BODY_BYTES");
  assert.equal(imageLimit, 2_500_000, "Individual image limit remains unchanged");
  assert.equal(envelopeLimit, 3_000_000);
  assert.ok(
    envelopeLimit < 4_500_000,
    "The total request cap leaves room below Vercel's transport limit",
  );
  let reservations = 0;
  const serverContext = serverFunctions(
    [
      "rejectLargeRequest",
      "readStreamTextLimited",
      "readRequestTextLimited",
      "isNonEmptyString",
      "parseJsonBody",
      "handleAnalyzeScreenshot",
    ],
    {
      TextDecoder,
      MAX_JSON_BODY_BYTES: numericConstant(source, "MAX_JSON_BODY_BYTES"),
      MAX_IMAGE_DATA_URL_CHARS: imageLimit,
      MAX_SCREENSHOT_BODY_BYTES: envelopeLimit,
      requireCompanionEntitlement: async () => ({ user: { id: "synthetic-student" } }),
      enforceUserRateLimit: () => null,
      aiFeatureEnabled: () => true,
      reserveProductEntitlementOrResponse: async () => {
        reservations += 1;
        return new Response("Accepted before provider work", { status: 202 });
      },
    },
  );
  const extensionSource = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
  let serialized;
  const extensionContext = vm.createContext({
    ...Object.fromEntries(
      ["MAX_HISTORY", "MAX_MESSAGE_CHARS", "MAX_HISTORY_ITEM_CHARS", "MAX_ANSWER_CHARS"].map(
        (name) => [name, numericConstant(extensionSource, name)],
      ),
    ),
    sessionEpoch: 0,
    config: { UNIMATE_API_URL: "https://synthetic.invalid" },
    requirePrivacyConsent: async () => {},
    assertSessionEpoch() {},
    fetchBackendWithBoundedRetry: async (_url, request) => {
      serialized = request.body;
      return {};
    },
    parseResponse: async () => ({ answer: "Synthetic response" }),
  });
  vm.runInContext(
    extensionSource.slice(
      extensionSource.indexOf("function companionProvenanceFields("),
      extensionSource.indexOf("async function captureActiveTab("),
    ),
    extensionContext,
  );
  const prefix = "data:image/jpeg;base64,";
  const maximumImage = prefix + "A".repeat(Math.floor((imageLimit - prefix.length) / 4) * 4);
  const submit = (body, declareLength) =>
    serverContext.api.handleAnalyzeScreenshot(
      new Request("https://synthetic.invalid/api/analyze-screenshot", {
        method: "POST",
        body,
        headers: declareLength ? { "content-length": String(Buffer.byteLength(body)) } : {},
      }),
    );
  for (const character of ["A", "漢", "\ud800"]) {
    await extensionContext.callScreenshotChat(
      { access_token: "synthetic" },
      character.repeat(1400),
      {
        highlightedText: character.repeat(2000),
        nearbyText: character.repeat(2500),
        visiblePageText: character.repeat(3500),
        pageTitle: character.repeat(300),
        pageUrl: character.repeat(500),
      },
      maximumImage,
      Array.from({ length: 10 }, (_, index) => ({
        role: index % 2 ? "assistant" : "user",
        message: character.repeat(4000),
      })),
      "synthetic-request",
    );
    assert.ok(Buffer.byteLength(serialized) < envelopeLimit);
    for (const declared of [true, false]) {
      assert.equal(
        (await submit(serialized, declared)).status,
        202,
        "Maximum legal image plus actual serialized context/history must pass declared and streamed body guards",
      );
    }
  }
  const smallBody = { imageBase64: prefix + "AAAA", question: "Explain", padding: "" };
  const smallLength = Buffer.byteLength(JSON.stringify(smallBody));
  for (const declared of [true, false]) {
    const exact = JSON.stringify({
      ...smallBody,
      padding: "A".repeat(envelopeLimit - smallLength),
    });
    assert.equal(Buffer.byteLength(exact), envelopeLimit);
    assert.equal((await submit(exact, declared)).status, 202, "The envelope boundary is inclusive");
    const count = reservations;
    assert.equal(
      (await submit(exact + " ", declared)).status,
      413,
      "One byte above the envelope is rejected even without Content-Length",
    );
    assert.equal(reservations, count, "An oversized body never reaches paid-work reservation");
    const oversizedImage = JSON.stringify({
      imageBase64: maximumImage + "AAAA",
      question: "Explain",
    });
    const response = await submit(oversizedImage, declared);
    assert.equal(
      response.status,
      413,
      "A larger envelope does not relax the separate image-size limit",
    );
    assert.equal((await response.json()).error, "Image is too large");
    assert.equal(reservations, count);
  }
}

console.log(
  "PASS companion backend behavior: billing compatibility, fail-closed access, current references, and grounded fallback",
);

// Exercise the real one-call tutor wrapper, not just the detector. Generated
// teaching must be returned intact; unverified source claims use an accurate
// provenance fallback rather than falsely saying the screenshot is unreadable.
{
  const context = serverFunctions(["generateGroundedCompanionAnswer"], {
    COMPANION_GROUNDING_SYSTEM_PROMPT,
    GROUNDED_FALLBACK_ANSWER,
    detectHallucination,
  });
  const cases = [
    [
      "What is 12 × 12?",
      "Just give me one hint, without the answer.",
      "Try 12 × 10 = 120 first, then add two more groups of 12.",
      false,
    ],
    [
      "Multiplication combines equal groups.",
      "Quiz me with a new practice problem.",
      "Practice question: What is 120 × 3?",
      false,
    ],
    [
      "Which gas is released during photosynthesis?",
      "Answer this question.",
      "The correct answer is oxygen.",
      false,
    ],
    [
      "Light travels at a constant speed in a vacuum.",
      "Explain the speed of light.",
      "Light travels at about 300,000 km/s in a vacuum.",
      false,
    ],
    [
      "Find the area of a circle with radius 12 cm.",
      "Solve this.",
      "Answer: 144π cm², approximately 452.39 cm².",
      false,
    ],
    [
      "Photosynthesis converts light energy into chemical energy stored in sugars.",
      "Quote the supplied sentence exactly.",
      'The passage reads: "Photosynthesis converts light energy into chemical energy stored in sugars."',
      false,
    ],
    [
      "Photosynthesis converts light energy into chemical energy stored in sugars.",
      "Quote the supplied sentence exactly.",
      'The passage reads: "Photosynthesis converts light energy into chemical energy stored in sugars."\nThe passage reads: "An invented course requirement."',
      true,
    ],
    ["Photosynthesis produces oxygen.", "Explain this.", "87% of students agree.", true],
    [
      "Photosynthesis produces oxygen.",
      "Explain this.",
      "General background: the page says 87% of students agree.",
      true,
    ],
    [
      "Photosynthesis produces oxygen.",
      "Answer this.",
      "The answer key says the correct answer is oxygen.",
      true,
    ],
    ["Question 1. Define a cell.", "Answer question 9.", "Answer: B.", true],
    [
      "Question 1. Define a cell.",
      "Answer question 9.",
      "I cannot see question 9, but choose B.",
      true,
    ],
    ["Photosynthesis produces oxygen.", "Explain this.", "The page says:\n87% agree.", true],
    [
      "Photosynthesis produces oxygen.",
      "Explain this.",
      "According to Smith (2024), 87% preferred this method.",
      true,
    ],
  ];
  for (const [text, question, answer, blocked] of cases) {
    let calls = 0;
    const result = await context.api.generateGroundedCompanionAnswer({
      provenance: normalizeProvenance({ visiblePageText: text }),
      userMessage: question,
      callModel: async () => {
        calls++;
        return answer;
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.blocked, blocked, answer);
    assert.equal(result.answer, blocked ? GROUNDED_FALLBACK_ANSWER : answer);
    if (blocked) assert.doesNotMatch(result.answer, /can't read|can’t read|unreadable/i);
  }
}
console.log(
  "PASS actual tutor wrapper preserves authored teaching and blocks unsupported source claims",
);
