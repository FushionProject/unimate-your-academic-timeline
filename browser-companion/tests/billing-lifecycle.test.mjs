import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHmac, webcrypto } from "node:crypto";
import ts from "typescript";
import { selectPreferredSubscription, stripeStateEntitled } from "../../src/lib/billing-policy.ts";

// Execute production handlers, signature verification, pagination, ownership,
// and profile writes. Only HTTP transport/auth validation are synthetic. No
// env files, listening server, Stripe account, database, or paid AI is used.
const source = fs.readFileSync(new URL("../../src/server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true);
const names = [
  "CompanionUpstreamError",
  "companionErrorResponse",
  "readBillingProfile",
  "requireCompanionEntitlement",
  "stripeConfiguration",
  "stripeRequest",
  "patchBillingProfile",
  "readBillingProfileAsServiceRole",
  "findUserIdsByStripeCustomer",
  "subscriptionHasConfiguredPrice",
  "stripeCustomerId",
  "subscriptionEntitled",
  "billingStateForSubscription",
  "subscriptionScheduledCancellation",
  "listCustomerSubscriptions",
  "stripeList",
  "subscriptionPeriodEnd",
  "confirmedSubscriptionEntitled",
  "currentCustomerBilling",
  "preferredSubscription",
  "createPortalUrl",
  "createOrBindStripeCustomer",
  "readCustomerCheckouts",
  "handleBillingStatus",
  "handleBillingStatusInner",
  "handleCreatePortalSession",
  "handleCreateCheckoutSession",
  "checkoutIntegrationIdentifier",
  "verifyStripeSignature",
  "constantTimeEqual",
  "retrieveStripeSubscription",
  "invoiceSubscriptionId",
  "retrieveCustomerFromCharge",
  "syncCustomerEntitlement",
  "reconcileCustomerBilling",
  "objectId",
  "handleStripeWebhook",
];
const declarations = names
  .map((name) => {
    const node = ast.statements.find((entry) => entry.name?.text === name);
    assert.ok(node, `actual server declaration ${name}`);
    return node.getText(ast);
  })
  .join("\n")
  .replaceAll("import.meta.env.DEV", "false");
const compiled = ts.transpileModule(declarations, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const userId = "00000000-0000-4000-8000-000000000001";
const customerId = "cus_synthetic";
const priceId = "price_synthetic";
const secret = "synthetic-webhook-signing-value";
const now = 1_800_000_000;
const subscription = (id = "sub_current", status = "active", overrides = {}) => ({
  id,
  status,
  customer: customerId,
  metadata: { user_id: userId },
  latest_invoice: { id: `in_${id}`, status: "paid" },
  items: { data: [{ price: { id: priceId }, current_period_end: now + 86400 }] },
  ...overrides,
});
const invoice = (subId, status = "paid") => ({
  id: `in_${subId}`,
  status,
  parent: { type: "subscription_details", subscription_details: { subscription: subId } },
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function fixture() {
  const state = {
    profile: { id: userId, is_pro: false, stripe_customer_id: customerId, billing_revision: 0 },
    subscriptions: [],
    historical: new Map(),
    paidInvoices: new Map(),
    invoices: new Map(),
    calls: [],
    writes: [],
    sessions: new Map(),
    owners: null,
    failure: null,
    page: null,
    auth: true,
    exposeSession: false,
    checkoutListings: null,
    checkoutPage: null,
    checkoutHook: null,
    time: now * 1000,
    subscriptionHook: null,
    customerHook: null,
    customerCreates: new Map(),
    email: "synthetic@example.test",
    price: {},
    forceConflict: false,
  };
  const env = {
    STRIPE_SECRET_KEY: "sk_test_synthetic",
    STRIPE_PRICE_ID: priceId,
    STRIPE_WEBHOOK_SECRET: secret,
    UNIMATE_CANONICAL_ORIGIN: "https://unimate.test",
    VITE_SUPABASE_URL: "https://database.test",
    VITE_SUPABASE_ANON_KEY: "synthetic-public",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
  };
  const transport = async (input, init = {}) => {
    const url = new URL(input);
    state.calls.push({ url, ...init });
    if (state.failure?.(url, init)) return json({ error: "synthetic outage" }, 503);
    if (url.origin === "https://database.test") {
      assert.equal(url.pathname, "/rest/v1/profiles");
      if (init.method === "PATCH") {
        assert.equal(url.searchParams.get("id"), `eq.${userId}`);
        const values = JSON.parse(init.body);
        const expected = Number(url.searchParams.get("billing_revision")?.replace(/^eq\./, ""));
        assert.equal(
          values.billing_revision,
          expected + 1,
          "every billing writer participates in revision CAS",
        );
        const binding = state.profile.stripe_customer_id
          ? `eq.${state.profile.stripe_customer_id}`
          : "is.null";
        if (
          state.forceConflict ||
          state.profile.billing_revision !== expected ||
          url.searchParams.get("stripe_customer_id") !== binding
        )
          return json([]);
        state.writes.push(values);
        Object.assign(state.profile, values);
        return json([state.profile]);
      }
      if (url.searchParams.has("stripe_customer_id"))
        return json(
          (
            state.owners ||
            (url.searchParams.get("stripe_customer_id") === `eq.${state.profile.stripe_customer_id}`
              ? [userId]
              : [])
          ).map((id) => ({ id })),
        );
      return json(state.profile ? [state.profile] : []);
    }
    assert.equal(url.origin, "https://api.stripe.com", "no unexpected network target");
    assert.equal(new Headers(init.headers).get("Stripe-Version"), "2026-06-24.dahlia");
    const path = url.pathname.replace(/^\/v1/, "");
    if (path === "/subscriptions") {
      assert.equal(url.searchParams.get("customer"), customerId);
      const response = json(
        state.page ? state.page(url) : { data: state.subscriptions, has_more: false },
      );
      if (state.subscriptionHook) await state.subscriptionHook();
      return response;
    }
    if (path.startsWith("/subscriptions/")) {
      const id = path.split("/").at(-1);
      const current = state.subscriptions.find((s) => s.id === id) || state.historical.get(id);
      return current ? json(current) : json({}, 404);
    }
    if (path === "/invoices") {
      assert.equal(url.searchParams.get("status"), "paid");
      return json({
        data: state.paidInvoices.get(url.searchParams.get("subscription")) || [],
        has_more: false,
      });
    }
    if (path.startsWith("/invoices/"))
      return json(state.invoices.get(path.split("/").at(-1)) || {}, 200);
    if (path.startsWith("/charges/")) return json({ id: "ch_synthetic", customer: customerId });
    if (path.startsWith("/prices/"))
      return json({
        active: true,
        type: "recurring",
        livemode: false,
        unit_amount: 999,
        currency: "usd",
        recurring: { interval: "month", interval_count: 1 },
        ...state.price,
      });
    if (path === "/customers") {
      if (state.customerHook) await state.customerHook();
      const key = new Headers(init.headers).get("Idempotency-Key");
      const prior = state.customerCreates.get(key);
      if (prior && prior !== init.body) return json({ error: "idempotency_error" }, 400);
      state.customerCreates.set(key, init.body);
      return json({ id: customerId });
    }
    if (path === "/billing_portal/sessions")
      return json({ url: "https://billing.stripe.com/synthetic" });
    if (path === "/checkout/sessions" && init.method !== "POST") {
      if (state.checkoutPage) return json(state.checkoutPage(url));
      return json({
        data:
          state.checkoutListings ||
          (state.exposeSession
            ? [
                {
                  id: "cs_synthetic",
                  mode: "subscription",
                  status: "open",
                  url: "https://checkout.stripe.com/synthetic",
                  line_items: { data: [{ price: { id: priceId } }] },
                },
              ]
            : []),
        has_more: false,
      });
    }
    if (path === "/checkout/sessions") {
      if (state.checkoutHook) await state.checkoutHook();
      const key = new Headers(init.headers).get("Idempotency-Key");
      const prior = state.sessions.get(key);
      if (prior && prior !== init.body) return json({ error: "idempotency_error" }, 400);
      state.sessions.set(key, init.body);
      return json({ url: "https://checkout.stripe.com/synthetic" });
    }
    throw new Error(`Unexpected fixture route ${path}`);
  };
  const context = vm.createContext({
    Request,
    Response,
    URL,
    URLSearchParams,
    TextEncoder,
    Uint8Array,
    crypto: webcrypto,
    Date: { now: () => state.time },
    process: { env },
    console: { error() {}, warn() {} },
    STRIPE_API_TIMEOUT_MS: 8000,
    SUPABASE_ENTITLEMENT_TIMEOUT_MS: 8000,
    STRIPE_WEBHOOK_TOLERANCE_SECONDS: 300,
    MAX_STRIPE_SIGNATURE_CHARS: 2048,
    MAX_STRIPE_WEBHOOK_BYTES: 1_000_000,
    fetchWithTimeout: transport,
    jsonResponse: json,
    supabaseServiceHeaders: () => ({ apikey: "synthetic-service" }),
    readRequestTextLimited: async (request, max) => {
      const text = await request.text();
      return Buffer.byteLength(text) > max ? new Response(null, { status: 413 }) : text;
    },
    requireAuthenticatedUser: async () =>
      state.auth ? { id: userId, email: state.email } : json({ code: "INVALID_SESSION" }, 401),
    enforceUserRateLimit: () => null,
    developmentProOverride: () => false,
    selectPreferredSubscription,
    stripeStateEntitled,
  });
  vm.runInContext(`${compiled}\nglobalThis.api = { ${names.join(",")} };`, context);
  const request = (path, method = "GET") =>
    new Request(`https://unimate.test${path}`, {
      method,
      headers: { Authorization: "Bearer synthetic-user" },
    });
  const event = async (type, object, options = {}) => {
    const body = JSON.stringify({
      id: "evt_synthetic",
      type,
      livemode: false,
      data: { object },
      ...options.event,
    });
    const timestamp = options.timestamp ?? now;
    const signature = createHmac("sha256", options.secret || secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    return context.api.handleStripeWebhook(
      new Request("https://unimate.test/api/stripe-webhook", {
        method: "POST",
        headers: { "Stripe-Signature": options.header || `t=${timestamp},v1=${signature}` },
        body,
      }),
    );
  };
  const access = async () => {
    const result = await context.api.requireCompanionEntitlement(
      request("/api/analyze-screenshot"),
    );
    return result instanceof Response ? result.status : 200;
  };
  return { state, env, api: context.api, request, event, access };
}

// Billing return URLs come from explicit operator configuration or Vercel's
// immutable Preview system hostname, never user-controlled request headers.
{
  const preview = {
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_TARGET_ENV: "preview",
    VERCEL_URL: "unimate-synthetic-deployment.vercel.app",
  };
  const configuration = (overrides = {}) => {
    const f = fixture();
    delete f.env.UNIMATE_CANONICAL_ORIGIN;
    Object.assign(f.env, preview, overrides);
    return f.api.stripeConfiguration();
  };
  const expectedOrigin = `https://${preview.VERCEL_URL}`;
  assert.equal(configuration().canonicalOrigin, expectedOrigin);
  for (const key of ["VERCEL_ENV", "VERCEL_TARGET_ENV"]) {
    assert.equal(configuration({ [key]: undefined }).canonicalOrigin, expectedOrigin);
  }
  assert.equal(
    configuration({ STRIPE_SECRET_KEY: "rk_test_synthetic" }).canonicalOrigin,
    expectedOrigin,
    "restricted test keys support the same Preview-only fallback",
  );
  assert.equal(
    configuration({
      UNIMATE_CANONICAL_ORIGIN: " https://configured.test/path ",
      VITE_UNIMATE_API_URL: "https://legacy.test",
    }).canonicalOrigin,
    "https://configured.test",
    "explicit canonical configuration takes precedence",
  );
  assert.equal(
    configuration({ VITE_UNIMATE_API_URL: "https://legacy.test" }).canonicalOrigin,
    "https://legacy.test",
    "the existing explicitly configured API origin remains supported",
  );
  for (const origin of ["", " ", "not-a-url", "http://unsafe.test", "https://user@unsafe.test"]) {
    for (const key of ["UNIMATE_CANONICAL_ORIGIN", "VITE_UNIMATE_API_URL"]) {
      assert.equal(
        configuration({ [key]: origin }).status,
        503,
        `an invalid explicit ${key} never falls through to the Preview hostname`,
      );
    }
  }
  assert.equal(
    configuration({ UNIMATE_CANONICAL_ORIGIN: "bad", VITE_UNIMATE_API_URL: "https://legacy.test" })
      .status,
    503,
    "an invalid canonical origin cannot fall through to the legacy configuration either",
  );
  for (const overrides of [
    { VERCEL: undefined },
    { VERCEL: "true" },
    { VERCEL_ENV: undefined, VERCEL_TARGET_ENV: undefined },
    { VERCEL_ENV: "production" },
    { VERCEL_TARGET_ENV: "production" },
    { VERCEL_ENV: "development" },
    { VERCEL_TARGET_ENV: "staging" },
    { VERCEL_TARGET_ENV: "" },
    { STRIPE_SECRET_KEY: "sk_live_synthetic", STRIPE_LIVE_MODE_ENABLED: "true" },
    { STRIPE_SECRET_KEY: "rk_live_synthetic", STRIPE_LIVE_MODE_ENABLED: "true" },
    { STRIPE_SECRET_KEY: "sk_live_synthetic" },
    { STRIPE_SECRET_KEY: "invalid-synthetic" },
  ]) {
    assert.equal(configuration(overrides).status, 503, "fallback stays Preview/test-mode only");
  }
  for (const host of [
    undefined,
    "",
    "vercel.app",
    "evil.test",
    "evil.vercel.app.test",
    "nested.app.vercel.app",
    "https://app.vercel.app",
    "app.vercel.app/",
    "app.vercel.app:443",
    "app.vercel.app?next=evil",
    "app.vercel.app#fragment",
    "user@app.vercel.app",
    "app.vercel.app\\evil.test",
    "app.vercel.app.",
    " app.vercel.app",
    "app.vercel.app\n",
    "app_foo.vercel.app",
    "-app.vercel.app",
    "app-.vercel.app",
    `${"a".repeat(64)}.vercel.app`,
  ]) {
    assert.equal(configuration({ VERCEL_URL: host }).status, 503, "deployment hostname is strict");
  }
  assert.equal(
    configuration({
      VERCEL_URL: undefined,
      VERCEL_BRANCH_URL: "branch.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "production.vercel.app",
    }).status,
    503,
    "branch and production aliases are not fallback candidates",
  );
  assert.equal(
    configuration({
      VERCEL_ENV: "production",
      VERCEL_TARGET_ENV: "production",
      STRIPE_SECRET_KEY: "sk_live_synthetic",
      STRIPE_LIVE_MODE_ENABLED: "true",
      UNIMATE_CANONICAL_ORIGIN: "https://configured.test",
    }).canonicalOrigin,
    "https://configured.test",
    "explicit production origin retains the existing live-mode opt-in contract",
  );

  const f = fixture();
  delete f.env.UNIMATE_CANONICAL_ORIGIN;
  Object.assign(f.env, preview);
  const spoofedRequest = (path) =>
    new Request(`https://attacker.test${path}`, {
      method: "POST",
      headers: {
        Authorization: "Bearer synthetic-user",
        Host: "attacker.test",
        "X-Forwarded-Host": "attacker.test",
      },
    });
  assert.equal(
    (await f.api.handleCreateCheckoutSession(spoofedRequest("/api/create-checkout-session")))
      .status,
    200,
  );
  const checkoutCall = f.state.calls.find(
    (call) => call.url.pathname === "/v1/checkout/sessions" && call.method === "POST",
  );
  const checkoutBody = new URLSearchParams(checkoutCall.body);
  assert.equal(new URL(checkoutBody.get("success_url")).origin, expectedOrigin);
  assert.equal(new URL(checkoutBody.get("cancel_url")).origin, expectedOrigin);
  assert.equal(
    (await f.api.handleCreatePortalSession(spoofedRequest("/api/create-portal-session"))).status,
    200,
  );
  const portalCall = f.state.calls.find(
    (call) => call.url.pathname === "/v1/billing_portal/sessions",
  );
  assert.equal(
    new URL(new URLSearchParams(portalCall.body).get("return_url")).origin,
    expectedOrigin,
  );
}

// A genuine signed lifecycle unlocks only after payment; cancellation takes
// effect when Stripe's current state ends access, never at the scheduling step.
{
  const f = fixture();
  assert.equal(await f.access(), 403);
  let response = await f.api.handleCreateCheckoutSession(
    f.request("/api/create-checkout-session", "POST"),
  );
  assert.equal(response.status, 200);
  assert.equal(f.state.profile.is_pro, false, "Checkout creation is not fulfillment");
  f.state.subscriptions = [
    subscription("sub_current", "active", { latest_invoice: { id: "in_initial", status: "open" } }),
  ];
  const checkout = {
    mode: "subscription",
    subscription: "sub_current",
    customer: customerId,
    client_reference_id: userId,
    payment_status: "unpaid",
  };
  assert.equal((await f.event("checkout.session.completed", checkout)).status, 200);
  assert.equal(await f.access(), 403);
  assert.equal(
    (await f.event("customer.subscription.created", f.state.subscriptions[0])).status,
    200,
  );
  assert.equal(
    await f.access(),
    403,
    "active async initial subscription cannot bypass unpaid Checkout",
  );
  f.state.subscriptions[0].latest_invoice.status = "void";
  await f.event("checkout.session.async_payment_failed", checkout);
  assert.equal(await f.access(), 403, "failed initial payment can leave Stripe status active");
  f.state.subscriptions[0].latest_invoice.status = "paid";
  response = await f.event("checkout.session.async_payment_succeeded", {
    ...checkout,
    payment_status: "paid",
  });
  assert.equal(response.status, 200);
  assert.equal(await f.access(), 200);
  f.state.subscriptions[0].cancel_at_period_end = true;
  await f.event("customer.subscription.updated", f.state.subscriptions[0]);
  assert.equal(await f.access(), 200, "scheduled cancellation preserves paid access");
  const status = await (await f.api.handleBillingStatus(f.request("/api/billing-status"))).json();
  assert.equal(status.state, "canceling");
  assert.equal(status.currentPeriodEnd, now + 86400, "modern item-level billing period");
  f.state.subscriptions[0].status = "canceled";
  await f.event("customer.subscription.deleted", f.state.subscriptions[0]);
  assert.equal(
    await f.access(),
    403,
    "immediate or completed period-end cancellation revokes access",
  );
  await f.event("customer.subscription.created", subscription());
  await f.event("checkout.session.completed", { ...checkout, payment_status: "paid" });
  assert.equal(
    await f.access(),
    403,
    "delayed historical creation/checkout cannot resurrect canceled access",
  );
}

// Real flexible-billing Portal shape: cancel_at is scheduled even when the
// legacy flag is false. Its clock intentionally predates this fixture's clock.
{
  const f = fixture();
  const cancelAt = 1794624308;
  f.state.subscriptions = [
    subscription("sub_flexible", "active", {
      cancel_at_period_end: false,
      cancel_at: cancelAt,
      canceled_at: 1791945997,
      items: { data: [{ price: { id: priceId }, current_period_end: cancelAt }] },
    }),
  ];
  const status = async () =>
    (await f.api.handleBillingStatus(f.request("/api/billing-status"))).json();
  assert.equal(
    (await f.event("customer.subscription.updated", f.state.subscriptions[0])).status,
    200,
  );
  assert.equal(await f.access(), 200, "scheduling never prematurely revokes paid access");
  assert.deepEqual(await status(), {
    isPro: true,
    state: "canceling",
    canManage: true,
    cancelAtPeriodEnd: true,
    currentPeriodEnd: cancelAt,
  });
  // A custom scheduled date must not display the unrelated later renewal date.
  f.state.subscriptions[0].items.data[0].current_period_end = cancelAt + 86400;
  assert.equal((await status()).currentPeriodEnd, cancelAt);
  for (const invalid of [null, 0, -1, 1.5, "1794624308"]) {
    f.state.subscriptions[0].cancel_at = invalid;
    const cleared = await status();
    assert.equal(
      cleared.state,
      "active",
      "canceled_at alone never indicates scheduled cancellation",
    );
    assert.equal(cleared.cancelAtPeriodEnd, false);
  }
  f.state.subscriptions[0].cancel_at = cancelAt;
  f.state.subscriptions[0].status = "canceled";
  await f.event("customer.subscription.deleted", f.state.subscriptions[0]);
  const terminal = await status();
  assert.equal(terminal.state, "canceled");
  assert.equal(terminal.isPro, false);
  assert.equal(terminal.cancelAtPeriodEnd, false);
  assert.equal(await f.access(), 403);
}

// Replacement subscription survives delayed Checkout, invoice, failed async,
// refund/dispute, and old cancellation events. Repeated events are state-idempotent.
{
  const f = fixture();
  f.state.subscriptions = [subscription("sub_new")];
  f.state.historical.set("sub_old", subscription("sub_old", "canceled"));
  const cases = [
    [
      "checkout.session.completed",
      {
        mode: "subscription",
        subscription: "sub_old",
        client_reference_id: userId,
        payment_status: "paid",
      },
    ],
    ["invoice.payment_failed", invoice("sub_old", "open")],
    ["invoice.paid", { subscription: "sub_old" }],
    ["checkout.session.async_payment_failed", { subscription: "sub_old" }],
    ["customer.subscription.deleted", subscription("sub_old", "canceled")],
    ["charge.refunded", { id: "ch_synthetic" }],
    ["charge.dispute.created", { charge: "ch_synthetic" }],
    ["charge.dispute.closed", { charge: "ch_synthetic" }],
  ];
  for (const [type, object] of cases) {
    for (let duplicate = 0; duplicate < 2; duplicate++) {
      assert.equal((await f.event(type, object)).status, 200, type);
      assert.equal(await f.access(), 200, `${type} preserves paid replacement`);
    }
  }
  await Promise.all(cases.map(([type, object]) => f.event(type, object)));
  assert.equal(
    await f.access(),
    200,
    "concurrent duplicate notifications of the same current state",
  );
  // This does not claim cross-instance serialization of changing Stripe snapshots.
  f.state.subscriptions = [];
  await f.event("customer.subscription.updated", subscription("sub_stale"));
  assert.equal(
    await f.access(),
    403,
    "empty authoritative list never falls back to an old active event",
  );
}

// Read-only, authenticated status reports the effective non-secret grace policy
// without reconciling Stripe or changing the persisted entitlement.
{
  const f = fixture();
  for (const [setting, expected] of [
    [undefined, true],
    ["true", true],
    ["false", false],
  ]) {
    if (setting === undefined) delete f.env.STRIPE_PAST_DUE_GRACE_ENABLED;
    else f.env.STRIPE_PAST_DUE_GRACE_ENABLED = setting;
    const priorWrites = f.state.writes.length;
    const response = await f.api.handleBillingStatus(
      f.request("/api/billing-status?reconcile=false"),
    );
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.pastDueGraceEnabled, expected);
    assert.equal(status.isPro, false);
    assert.equal(f.state.writes.length, priorWrites);
  }
  const unauthenticated = await f.api.handleBillingStatus(
    new Request("https://unimate.test/api/billing-status?reconcile=false"),
  );
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).pastDueGraceEnabled, undefined);
}

// Failed renewal grace needs a genuinely paid subscription. Existing policy
// remains configurable; initial unpaid subscriptions do not inherit grace.
{
  const f = fixture();
  f.state.subscriptions = [
    subscription("sub_current", "past_due", { latest_invoice: invoice("sub_current", "open") }),
  ];
  await f.event("invoice.payment_failed", invoice("sub_current", "open"));
  assert.equal(await f.access(), 403);
  f.state.paidInvoices.set("sub_current", [invoice("sub_current")]);
  await f.event("invoice.payment_failed", invoice("sub_current", "open"));
  assert.equal(await f.access(), 200);
  f.env.STRIPE_PAST_DUE_GRACE_ENABLED = "false";
  await f.event("invoice.payment_action_required", invoice("sub_current", "open"));
  assert.equal(await f.access(), 403);
  f.env.STRIPE_PAST_DUE_GRACE_ENABLED = "true";
  for (const state of ["unpaid", "paused", "incomplete", "incomplete_expired", "canceled"]) {
    f.state.subscriptions[0].status = state;
    await f.event("customer.subscription.updated", f.state.subscriptions[0]);
    assert.equal(await f.access(), 403, state);
  }
  f.state.subscriptions[0].status = "trialing";
  await f.event("customer.subscription.updated", f.state.subscriptions[0]);
  assert.equal(await f.access(), 200, "existing trial policy preserved");
}

// Initial card authentication is a pending payment, not paid access. Exercise
// actual signed action-required notifications, expanded modern invoice parent
// IDs, invoice retrieval and the status/Portal paths without a hosted challenge.
{
  const f = fixture();
  const pendingInvoice = invoice("sub_authentication", "open");
  pendingInvoice.parent.subscription_details.subscription = { id: "sub_authentication" };
  const sub = subscription("sub_authentication", "incomplete", {
    latest_invoice: pendingInvoice.id,
  });
  f.state.subscriptions = [sub];
  f.state.invoices.set(pendingInvoice.id, pendingInvoice);
  const status = async () => {
    const response = await f.api.handleBillingStatus(f.request("/api/billing-status"));
    assert.equal(response.status, 200);
    return response.json();
  };

  assert.equal((await f.event("customer.subscription.created", sub)).status, 200);
  for (let delivery = 0; delivery < 2; delivery++) {
    assert.equal((await f.event("invoice.payment_action_required", pendingInvoice)).status, 200);
    assert.equal(await f.access(), 403, "an unfinished initial challenge never grants Pro");
  }
  const pending = await status();
  assert.equal(pending.state, "incomplete");
  assert.equal(pending.isPro, false);
  assert.equal(pending.canManage, true, "pending payment still exposes billing recovery");
  const checkout = await f.api.handleCreateCheckoutSession(
    f.request("/api/create-checkout-session", "POST"),
  );
  assert.equal(checkout.status, 200);
  assert.deepEqual(await checkout.json(), {
    alreadySubscribed: true,
    url: "https://billing.stripe.com/synthetic",
  });
  assert.equal(f.state.sessions.size, 0, "the pending challenge cannot create a second purchase");
  assert.equal(
    (await f.api.handleCreatePortalSession(f.request("/api/create-portal-session", "POST"))).status,
    200,
  );

  // A payment notification must not override an authoritative subscription
  // that is still incomplete. The following subscription event completes it.
  const staleChallenge = structuredClone(pendingInvoice);
  pendingInvoice.status = "paid";
  assert.equal((await f.event("invoice.paid", pendingInvoice)).status, 200);
  assert.equal(await f.access(), 403);
  sub.status = "active";
  assert.equal((await f.event("customer.subscription.updated", sub)).status, 200);
  assert.equal(await f.access(), 200, "paid invoice and active subscription unlock together");
  assert.equal((await status()).state, "active");
  assert.ok(
    f.state.calls.some((call) => call.url.pathname === `/v1/invoices/${pendingInvoice.id}`),
    "an unexpanded invoice reference is resolved before granting access",
  );
  assert.equal((await f.event("invoice.payment_action_required", staleChallenge)).status, 200);
  assert.equal(await f.access(), 200, "a delayed challenge notification cannot undo recovery");

  sub.status = "canceled";
  assert.equal((await f.event("customer.subscription.deleted", sub)).status, 200);
  assert.equal(await f.access(), 403);
  assert.equal((await f.event("invoice.paid", pendingInvoice)).status, 200);
  assert.equal(await f.access(), 403, "a late paid invoice cannot revive canceled access");
}

// Abandoned authentication expires without grace, even when an earlier paid
// subscription exists. A delayed success notification is only a reconciliation
// signal; neither its type nor its paid snapshot is sufficient for fulfillment.
{
  const f = fixture();
  const previous = subscription("sub_previous", "canceled");
  const sub = subscription("sub_auth_expired", "incomplete", {
    latest_invoice: invoice("sub_auth_expired", "open"),
  });
  f.state.subscriptions = [previous, sub];
  f.state.paidInvoices.set(previous.id, [invoice(previous.id)]);
  assert.equal((await f.event("invoice.payment_action_required", sub.latest_invoice)).status, 200);
  assert.equal(await f.access(), 403, "paid history is scoped to the current subscription");
  sub.status = "incomplete_expired";
  sub.latest_invoice.status = "void";
  assert.equal((await f.event("customer.subscription.updated", sub)).status, 200);
  const lateCheckout = {
    mode: "subscription",
    subscription: { id: sub.id },
    customer: { id: customerId },
    client_reference_id: userId,
    payment_status: "paid",
  };
  assert.equal(
    (await f.event("checkout.session.async_payment_succeeded", lateCheckout)).status,
    200,
  );
  assert.equal(await f.access(), 403, "expired pending authentication stays locked");
  assert.equal((await f.event("invoice.paid", invoice(sub.id))).status, 200);
  assert.equal(await f.access(), 403);
}

// Delayed Checkout success can arrive before invoice settlement is readable.
// Repeated status checks keep the Companion locked until a fresh authoritative
// invoice shows paid; this tests handlers only, not a real delayed payment rail.
{
  const f = fixture();
  const sub = subscription("sub_delayed", "active", { latest_invoice: "in_delayed" });
  const settling = { ...invoice(sub.id, "open"), id: "in_delayed" };
  f.state.subscriptions = [sub];
  f.state.invoices.set(settling.id, settling);
  const checkout = {
    mode: "subscription",
    subscription: sub.id,
    client_reference_id: userId,
    customer: customerId,
    payment_status: "paid",
  };
  assert.equal((await f.event("checkout.session.async_payment_succeeded", checkout)).status, 200);
  assert.equal(await f.access(), 403, "event payment_status alone is not paid invoice evidence");
  let response = await f.api.handleBillingStatus(f.request("/api/billing-status"));
  assert.equal(response.status, 200);
  const pending = await response.json();
  assert.equal(pending.state, "incomplete");
  assert.equal(pending.isPro, false);
  assert.equal(pending.canManage, true);
  const priorWrites = f.state.writes.length;
  f.state.failure = (url) => url.pathname === `/v1/invoices/${settling.id}`;
  assert.ok((await f.event("checkout.session.async_payment_succeeded", checkout)).status >= 500);
  assert.equal(f.state.writes.length, priorWrites, "invoice outage leaves a retryable event");
  assert.equal(await f.access(), 403);
  f.state.failure = null;
  settling.status = "paid";
  assert.equal((await f.event("invoice.paid", settling)).status, 200);
  assert.equal(await f.access(), 200);
  // Even an old failure reconciles the now-settled state, not its event label.
  assert.equal((await f.event("checkout.session.async_payment_failed", checkout)).status, 200);
  assert.equal(await f.access(), 200);
  sub.status = "unpaid";
  assert.equal((await f.event("customer.subscription.updated", sub)).status, 200);
  assert.equal(await f.access(), 403, "terminal unpaid overrides historical paid invoices");
  assert.equal((await f.event("checkout.session.async_payment_succeeded", checkout)).status, 200);
  assert.equal(await f.access(), 403);
}

// Dedicated paused/resumed events must work without relying on an accompanying
// subscription.updated delivery. This is subscription status pausing, not
// Stripe's distinct pause_collection setting, which does not change status.
{
  const f = fixture();
  const sub = subscription("sub_pause_resume");
  f.state.subscriptions = [sub];
  assert.equal((await f.event("invoice.paid", invoice(sub.id))).status, 200);
  assert.equal(await f.access(), 200);
  const activeSnapshot = structuredClone(sub);
  sub.status = "paused";
  const pausedSnapshot = structuredClone(sub);
  assert.equal((await f.event("customer.subscription.paused", sub)).status, 200);
  assert.equal(await f.access(), 403);
  let response = await f.api.handleBillingStatus(f.request("/api/billing-status"));
  assert.equal(response.status, 200);
  const paused = await response.json();
  assert.equal(paused.state, "paused");
  assert.equal(paused.isPro, false);
  assert.equal(paused.canManage, true);
  assert.equal((await f.event("customer.subscription.resumed", activeSnapshot)).status, 200);
  assert.equal(await f.access(), 403, "a stale resume event cannot bypass current paused state");
  sub.status = "active";
  assert.equal((await f.event("customer.subscription.resumed", sub)).status, 200);
  assert.equal(await f.access(), 200);
  assert.equal((await f.event("customer.subscription.paused", pausedSnapshot)).status, 200);
  assert.equal(await f.access(), 200, "a delayed pause event cannot undo the current paid resume");
  sub.status = "unpaid";
  assert.equal((await f.event("customer.subscription.updated", sub)).status, 200);
  response = await f.api.handleBillingStatus(f.request("/api/billing-status"));
  assert.equal(response.status, 200);
  const unpaid = await response.json();
  assert.equal(unpaid.state, "unpaid");
  assert.equal(unpaid.isPro, false);
  assert.equal(unpaid.canManage, true);
  assert.equal(await f.access(), 403);
}

// A newer invoice parent shape is authoritative. An unrelated invoice with a
// legacy-looking subscription field must not synchronize any customer access.
{
  const f = fixture();
  f.state.subscriptions = [subscription()];
  for (const parent of [
    { type: "quote_details", quote_details: {} },
    { type: "subscription_details", subscription_details: { subscription: {} } },
    { type: "subscription_details" },
  ]) {
    const unrelated = { ...invoice("sub_current"), subscription: "sub_current", parent };
    assert.equal((await f.event("invoice.payment_action_required", unrelated)).status, 200);
    assert.equal(f.state.writes.length, 0);
    assert.equal(f.state.calls.length, 0, "unrelated invoice references cause no provider lookup");
  }
}

// Full lists, not the first page, decide entitlement. Broken or bounded-out
// pagination returns a retryable server failure without changing access.
{
  const f = fixture();
  f.state.page = (url) =>
    url.searchParams.has("starting_after")
      ? { data: [subscription("sub_paid")], has_more: false }
      : {
          data: Array.from({ length: 100 }, (_, i) => subscription(`sub_old_${i}`, "canceled")),
          has_more: true,
        };
  await f.event("customer.subscription.updated", subscription());
  assert.equal(await f.access(), 200);
  assert.equal(f.state.calls.filter((c) => c.url.pathname === "/v1/subscriptions").length, 2);
  for (const page of [
    () => ({ data: [], has_more: true }),
    () => ({ data: {} }),
    () => ({ data: [subscription()], has_more: true }),
  ]) {
    f.state.page = page;
    const writes = f.state.writes.length;
    assert.ok((await f.event("customer.subscription.updated", subscription())).status >= 500);
    assert.equal(f.state.writes.length, writes);
  }
}

// Signature verification is real HMAC, not mocked: wrong key, stale/future
// timestamp, missing mode, and live events never query or mutate ownership.
{
  const f = fixture();
  for (const options of [
    { secret: "wrong" },
    { timestamp: now - 301 },
    { timestamp: now + 301 },
    { event: { livemode: true } },
    { event: { livemode: undefined } },
    { header: "invalid" },
  ]) {
    assert.equal(
      (await f.event("customer.subscription.updated", subscription(), options)).status,
      400,
    );
  }
  assert.equal(f.state.calls.length, 0);
  assert.equal(
    (await f.event("customer.subscription.updated", subscription(), { event: { data: {} } }))
      .status,
    400,
  );
  f.state.subscriptions = [subscription()];
  const signed = createHmac("sha256", secret)
    .update(
      `${now}.${JSON.stringify({ id: "evt_synthetic", type: "customer.subscription.updated", livemode: false, data: { object: subscription() } })}`,
    )
    .digest("hex");
  assert.equal(
    (
      await f.event("customer.subscription.updated", subscription(), {
        header: `t=${now},v1=bad,v1=${signed}`,
      })
    ).status,
    200,
  );
}

// Every upstream/storage failure is non-success and leaves the cached flag
// unchanged for retry. Ownership mismatch never writes another user's profile.
{
  for (const failure of [
    (url) => url.pathname === "/v1/subscriptions",
    (url) => url.searchParams.has("stripe_customer_id"),
    (_url, init) => init.method === "PATCH",
  ]) {
    const f = fixture();
    f.state.subscriptions = [subscription()];
    f.state.failure = failure;
    assert.ok((await f.event("customer.subscription.updated", subscription())).status >= 500);
    assert.equal(f.state.profile.is_pro, false);
    assert.equal(f.state.writes.length, 0);
    f.state.failure = null;
    assert.equal((await f.event("customer.subscription.updated", subscription())).status, 200);
    assert.equal(await f.access(), 200);
  }
  const f = fixture();
  f.state.subscriptions = [subscription()];
  f.state.owners = ["another-user"];
  assert.ok((await f.event("customer.subscription.updated", subscription())).status >= 500);
  assert.equal(f.state.writes.length, 0);
  f.state.owners = [userId, "another-user"];
  assert.ok((await f.event("customer.subscription.updated", subscription())).status >= 500);
  f.state.auth = false;
  assert.equal(await f.access(), 401);
}

// Both billing entry points enforce authenticated, persisted ownership before
// creating any Stripe session. Client-supplied IDs/return URLs are not authority.
{
  const f = fixture();
  for (const handler of ["handleCreateCheckoutSession", "handleCreatePortalSession"]) {
    f.state.auth = false;
    f.state.calls.length = 0;
    assert.equal((await f.api[handler](f.request("/api/billing", "POST"))).status, 401);
    assert.equal(f.state.calls.length, 0);
    f.state.auth = true;
    f.state.owners = ["another-user"];
    f.state.calls.length = 0;
    assert.equal((await f.api[handler](f.request("/api/billing", "POST"))).status, 409);
    assert(
      !f.state.calls.some(
        (call) => call.url.origin === "https://api.stripe.com" && call.method === "POST",
      ),
    );
  }
  f.state.owners = null;
  const response = await f.api.handleCreateCheckoutSession(
    new Request("https://unimate.test/api/create-checkout-session", {
      method: "POST",
      headers: { Authorization: "Bearer synthetic-user", "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: "cus_victim",
        user_id: "another-user",
        price: "price_attacker",
        return_url: "https://untrusted.test",
      }),
    }),
  );
  assert.equal(response.status, 200);
  const params = new URLSearchParams([...f.state.sessions.values()][0]);
  assert.equal(params.get("customer"), customerId);
  assert.equal(params.get("client_reference_id"), userId);
  assert.equal(params.get("line_items[0][price]"), priceId);
  assert(![...params.values()].some((value) => value.includes("untrusted.test")));
}

// Real handlers restore paid access after a renewal recovers; an older failure
// delivery afterward cannot undo authoritative current paid state.
{
  const f = fixture();
  f.env.STRIPE_PAST_DUE_GRACE_ENABLED = "false";
  f.state.subscriptions = [
    subscription("sub_renewal", "past_due", { latest_invoice: invoice("sub_renewal", "open") }),
  ];
  f.state.paidInvoices.set("sub_renewal", [invoice("sub_renewal")]);
  assert.equal(
    (await f.event("invoice.payment_failed", invoice("sub_renewal", "open"))).status,
    200,
  );
  assert.equal(await f.access(), 403);
  f.state.subscriptions[0].status = "active";
  f.state.subscriptions[0].latest_invoice = invoice("sub_renewal");
  assert.equal((await f.event("invoice.paid", invoice("sub_renewal"))).status, 200);
  assert.equal(await f.access(), 200);
  assert.equal(
    (await f.event("invoice.payment_failed", invoice("sub_renewal", "open"))).status,
    200,
  );
  assert.equal(await f.access(), 200);
}

// Default-grace renewal flow: the warning is not confused with revocation or
// cancellation. Execute signed events and the actual reconciled status handler,
// including the draft interval before Stripe finalizes a renewal invoice.
{
  const f = fixture();
  const sub = subscription("sub_grace_renewal");
  f.state.subscriptions = [sub];
  f.state.paidInvoices.set(sub.id, [invoice(sub.id)]);
  assert.equal((await f.event("invoice.paid", invoice(sub.id))).status, 200);
  const status = async () => {
    const response = await f.api.handleBillingStatus(f.request("/api/billing-status"));
    assert.equal(response.status, 200);
    return response.json();
  };
  sub.latest_invoice = { ...invoice(sub.id, "draft"), id: "in_next_cycle" };
  assert.equal((await f.event("customer.subscription.updated", sub)).status, 200);
  assert.equal((await status()).state, "active");
  assert.equal(await f.access(), 200, "draft renewal does not revoke a previously paid plan");

  sub.status = "past_due";
  sub.latest_invoice.status = "open";
  assert.equal((await f.event("invoice.payment_failed", sub.latest_invoice)).status, 200);
  const failed = await status();
  assert.equal(failed.state, "past_due", "billing UI must show the payment warning");
  assert.equal(failed.isPro, true, "default grace policy keeps previously paid access");
  assert.equal(failed.canManage, true, "customer can open the portal to recover");
  assert.equal(failed.cancelAtPeriodEnd, false, "failed payment is not scheduled cancellation");
  assert.equal(await f.access(), 200);

  const staleFailure = structuredClone(sub.latest_invoice);
  sub.status = "active";
  sub.latest_invoice.status = "paid";
  assert.equal((await f.event("invoice.paid", sub.latest_invoice)).status, 200);
  assert.equal((await status()).state, "active", "recovery clears the warning");
  assert.equal((await f.event("invoice.payment_failed", staleFailure)).status, 200);
  assert.equal((await status()).state, "active", "late failure cannot restore the warning");
  assert.equal(await f.access(), 200);
}

// Identical checkout retries remain byte-identical under one Stripe key,
// including the eight-letter integration label. Browser-supplied prices never
// enter the production handler's fixed server-owned plan parameters.
{
  const f = fixture();
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await f.api.handleCreateCheckoutSession(f.request("/api/create-checkout-session", "POST")))
        .status,
      200,
    );
  assert.equal(f.state.sessions.size, 1);
  const body = new URLSearchParams([...f.state.sessions.values()][0]);
  assert.match(body.get("integration_identifier"), /^unimate_web_[a-z]{8}$/);
  assert.equal(body.get("line_items[0][price]"), priceId);
  assert.equal(body.get("client_reference_id"), userId);
  assert.equal(body.get("customer"), customerId);
  assert.equal(
    body.get("success_url"),
    "https://unimate.test/upgrade?success=true&session_id={CHECKOUT_SESSION_ID}",
  );
  f.state.subscriptions = [subscription("sub_completed_then_canceled", "canceled")];
  assert.equal(
    (await f.api.handleCreateCheckoutSession(f.request("/api/create-checkout-session", "POST")))
      .status,
    200,
  );
  assert.equal(
    f.state.sessions.size,
    2,
    "cancel and repurchase in the same window starts a new generation",
  );
  await f.event("customer.subscription.deleted", f.state.subscriptions[0]);
  assert.equal(
    (await f.api.handleCreateCheckoutSession(f.request("/api/create-checkout-session", "POST")))
      .status,
    200,
  );
  assert.equal(
    f.state.sessions.size,
    2,
    "billing revision churn does not create a fresh checkout attempt",
  );
  const writes = f.state.sessions.size;
  f.state.failure = (url, init) =>
    url.pathname === "/v1/checkout/sessions" && init.method !== "POST";
  assert.ok(
    (await f.api.handleCreateCheckoutSession(f.request("/api/create-checkout-session", "POST")))
      .status >= 500,
  );
  assert.equal(f.state.sessions.size, writes, "failed session lookup cannot create a duplicate");
}

// Credential rotation changes authentication, never an in-flight attempt's
// idempotent business payload or payable session count.
{
  const f = fixture();
  const checkout = () =>
    f.api.handleCreateCheckoutSession(f.request("/api/create-checkout-session", "POST"));
  assert.equal((await checkout()).status, 200);
  f.env.STRIPE_SECRET_KEY = "sk_test_rotated_synthetic";
  assert.equal(
    (await checkout()).status,
    200,
    "rotated key must recover the same checkout attempt",
  );
  assert.equal(f.state.sessions.size, 1);
}

// A monthly label is not enough: month x3 is quarterly, not the advertised
// monthly plan. Missing/incorrect mode must not silently coerce into test mode.
for (const price of [
  { unit_amount: 599 },
  { unit_amount: 1000 },
  { currency: "eur" },
  { recurring: { interval: "month", interval_count: 3 } },
  { recurring: { interval: "month" } },
  { recurring: { interval: "month", interval_count: "1" } },
  { livemode: undefined },
  { livemode: 0 },
]) {
  const f = fixture();
  f.state.price = price;
  assert.equal(
    (await f.api.handleCreateCheckoutSession(f.request("/api/create-checkout-session", "POST")))
      .status,
    503,
  );
  assert.equal(f.state.sessions.size, 0, "invalid monthly price never creates payable checkout");
}

// A price migration must not relabel historical $5.99 sessions or let stale
// deployment env override the current $9.99 customer-facing contract.
for (const config of [
  { STRIPE_PRO_MONTHLY_AMOUNT_CENTS: "599" },
  { STRIPE_PRO_MONTHLY_AMOUNT_CENTS: "1000" },
  { STRIPE_PRO_MONTHLY_AMOUNT_CENTS: "NaN" },
  { STRIPE_PRO_CURRENCY: "eur" },
]) {
  const f = fixture();
  Object.assign(f.env, config);
  f.state.exposeSession = true;
  const response = await f.api.handleCreateCheckoutSession(
    f.request("/api/create-checkout-session", "POST"),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).url, undefined);
  assert.equal(
    f.state.calls.filter((call) => call.url.origin === "https://api.stripe.com").length,
    0,
  );
  assert.equal(f.state.writes.length, 0);
}
for (const existingCustomer of [false, true]) {
  const f = fixture();
  f.state.price = { unit_amount: 599 };
  f.state.exposeSession = true;
  if (!existingCustomer) f.state.profile.stripe_customer_id = null;
  const response = await f.api.handleCreateCheckoutSession(
    f.request("/api/create-checkout-session", "POST"),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).url, undefined);
  assert.equal(f.state.customerCreates.size, 0, "price checked before customer creation");
  assert.equal(f.state.writes.length, 0);
  assert.equal(
    f.state.calls.filter((call) => call.url.pathname === "/v1/checkout/sessions").length,
    0,
    "historical amount cannot return an already-open checkout",
  );
}
{
  const f = fixture();
  f.env.STRIPE_PRO_MONTHLY_AMOUNT_CENTS = "599";
  f.state.profile.is_pro = true;
  f.state.subscriptions = [subscription()];
  assert.equal(
    (await f.api.handleCreateCheckoutSession(f.request("/api/create-checkout-session", "POST")))
      .status,
    503,
  );
  const portal = await f.api.handleCreatePortalSession(
    f.request("/api/create-portal-session", "POST"),
  );
  assert.equal(portal.status, 200, "stale new-purchase pricing does not block billing management");
  assert.equal((await portal.json()).url, "https://billing.stripe.com/synthetic");
  const status = await f.api.handleBillingStatus(f.request("/api/billing-status"));
  assert.equal(status.status, 200);
  assert.equal((await status.json()).isPro, true);
  assert.equal(await f.access(), 200, "a pricing mismatch does not revoke an existing entitlement");
}
{
  const f = fixture();
  f.env.STRIPE_PRO_MONTHLY_AMOUNT_CENTS = "999";
  f.env.STRIPE_PRO_CURRENCY = "USD";
  assert.equal(
    (await f.api.handleCreateCheckoutSession(f.request("/api/create-checkout-session", "POST")))
      .status,
    200,
    "the explicit owner-approved amount remains payable in the synthetic fixture",
  );
  assert.equal(f.state.sessions.size, 1);
}

// A successful customer creation followed by a database outage must recover
// even if Auth's mutable email changes before the retry.
{
  const f = fixture();
  f.state.profile.stripe_customer_id = null;
  f.state.failure = (_url, init) => init.method === "PATCH";
  const checkout = () =>
    f.api.handleCreateCheckoutSession(f.request("/api/create-checkout-session", "POST"));
  assert.equal((await checkout()).status, 503);
  assert.equal(f.state.customerCreates.size, 1);
  assert.equal(f.state.profile.stripe_customer_id, null);
  f.state.failure = null;
  f.state.email = "changed-synthetic@example.test";
  assert.equal(
    (await checkout()).status,
    200,
    "same immutable customer-create payload recovers binding",
  );
  assert.equal(f.state.customerCreates.size, 1);
  assert.equal(f.state.profile.stripe_customer_id, customerId);
}

// An in-flight first attempt invisible to the list straddles the old five-minute
// boundary. Both handlers must use the same key and byte-identical payload.
{
  const f = fixture();
  f.state.time = 299_000;
  let release, captured;
  const paused = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    captured = resolve;
  });
  f.state.checkoutHook = async () => {
    f.state.checkoutHook = null;
    captured();
    await paused;
  };
  const first = f.api.handleCreateCheckoutSession(
    f.request("/api/create-checkout-session", "POST"),
  );
  await ready;
  f.state.time = 300_000;
  const second = await f.api.handleCreateCheckoutSession(
    f.request("/api/create-checkout-session", "POST"),
  );
  release();
  assert.equal((await first).status, 200);
  assert.equal(second.status, 200);
  assert.equal(
    f.state.sessions.size,
    1,
    "cross-boundary concurrent requests create only one payable session",
  );
}
{
  const f = fixture();
  const checkout = (id, status, fields = {}) => ({
    id,
    status,
    mode: "subscription",
    line_items: { data: [{ price: { id: priceId } }] },
    ...fields,
  });
  assert.equal(
    (await f.api.handleCreateCheckoutSession(f.request("/api/create-checkout-session", "POST")))
      .status,
    200,
  );
  f.state.checkoutListings = [checkout("cs_expired", "expired")];
  assert.equal(
    (await f.api.handleCreateCheckoutSession(f.request("/api/create-checkout-session", "POST")))
      .status,
    200,
  );
  assert.equal(f.state.sessions.size, 2, "expired session advances a stable attempt generation");
  f.state.checkoutListings = [checkout("cs_paid", "complete", { subscription: "sub_paid" })];
  f.state.historical.set("sub_paid", subscription("sub_paid"));
  const result = await f.api.handleCreateCheckoutSession(
    f.request("/api/create-checkout-session", "POST"),
  );
  assert.equal(result.status, 200);
  assert.equal(
    (await result.json()).alreadySubscribed,
    true,
    "completed session verifies subscription even when list has not caught up",
  );
  assert.equal(f.state.sessions.size, 2);
  for (const session of [
    checkout("cs_bad", "complete"),
    checkout("cs_bad", "complete", { subscription: "sub_missing" }),
    checkout("cs_bad", "open", { url: "https://untrusted.test/pay" }),
    checkout("cs_bad", "unknown"),
    { id: "cs_bad", mode: "subscription" },
  ]) {
    f.state.checkoutListings = [session];
    assert.ok(
      (await f.api.handleCreateCheckoutSession(f.request("/api/create-checkout-session", "POST")))
        .status >= 500,
    );
    assert.equal(
      f.state.sessions.size,
      2,
      "ambiguous checkout state cannot create another session",
    );
  }
  f.state.checkoutListings = null;
  f.state.checkoutPage = (url) =>
    url.searchParams.has("starting_after")
      ? {
          data: [checkout("cs_open", "open", { url: "https://checkout.stripe.com/reuse" })],
          has_more: false,
        }
      : { data: [checkout("cs_expired", "expired")], has_more: true };
  const reused = await f.api.handleCreateCheckoutSession(
    f.request("/api/create-checkout-session", "POST"),
  );
  assert.equal(
    (await reused.json()).url,
    "https://checkout.stripe.com/reuse",
    "open sessions beyond the first page are reused",
  );
  assert.equal(f.state.sessions.size, 2);
}

// Deterministic interleavings exercise actual DB revision predicates. A no-op
// cancellation still advances revision, invalidating older paid snapshots.
for (const statusFirst of [false, true]) {
  for (const startingActive of [false, true]) {
    const f = fixture();
    const older = subscription("sub_current", startingActive ? "active" : "canceled");
    const newer = subscription("sub_current", startingActive ? "canceled" : "active");
    f.state.subscriptions = [older];
    let release, captured;
    const paused = new Promise((resolve) => {
      release = resolve;
    });
    const ready = new Promise((resolve) => {
      captured = resolve;
    });
    f.state.subscriptionHook = async () => {
      f.state.subscriptionHook = null;
      captured();
      await paused;
    };
    const first = statusFirst
      ? f.api.handleBillingStatus(f.request("/api/billing-status"))
      : f.event("customer.subscription.updated", older);
    await ready;
    f.state.subscriptions = [newer];
    assert.equal((await f.event("customer.subscription.updated", newer)).status, 200);
    release();
    assert.equal((await first).status, 200);
    assert.equal(
      f.state.profile.is_pro,
      !startingActive,
      "late stale writer re-fetches current state after conflict",
    );
    assert.equal(f.state.profile.billing_revision, 2);
    assert.equal(
      f.state.calls.filter((c) => c.url.pathname === "/v1/subscriptions").length,
      3,
      "CAS conflict re-fetches Stripe, not just the revision",
    );
  }
}
{
  const f = fixture();
  f.state.subscriptions = [subscription()];
  f.state.forceConflict = true;
  assert.ok((await f.event("customer.subscription.updated", subscription())).status >= 500);
  assert.equal(f.state.writes.length, 0);
  assert.equal(
    f.state.calls.filter((c) => c.url.pathname === "/v1/subscriptions").length,
    3,
    "conflict retry is bounded",
  );
}
{
  const f = fixture();
  f.state.profile.stripe_customer_id = null;
  const original = structuredClone(f.state.profile);
  let release, captured;
  const paused = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    captured = resolve;
  });
  f.state.customerHook = async () => {
    captured();
    await paused;
  };
  const bind = f.api.createOrBindStripeCustomer({ id: userId }, { secretKey: "sk_test_synthetic" });
  await ready;
  assert.equal(
    await f.api.patchBillingProfile(userId, { stripe_customer_id: "cus_new_binding" }, original),
    "updated",
  );
  release();
  assert.equal(await bind, "cus_new_binding");
  assert.equal(
    f.state.profile.stripe_customer_id,
    "cus_new_binding",
    "late customer creation never overwrites a newer binding",
  );
}

console.log(
  "PASS actual signed billing lifecycle: payment/authentication/delayed settlement, pause/resume, cancellation, replacement, replay, pagination, ownership, failures, and stable Checkout retries (offline)",
);
