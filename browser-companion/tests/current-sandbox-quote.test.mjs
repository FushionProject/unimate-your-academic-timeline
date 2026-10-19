import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  QUOTE_SCOPE,
  assertQuoteIgnored,
  verifyCurrentSandboxQuote,
} from "../../scripts/verify-current-sandbox-quote.mjs";
import { TARGET, ARTIFACT } from "../../scripts/prepare-stripe-sandbox.mjs";
import { CURRENT_SANDBOX_TARGET } from "../../scripts/verify-current-stripe-sandbox-price.mjs";

const now = 1800000000000;
const jwt = (claims) => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2ln`;
const project = {
  projectId: "prj_5XZ4ulni13tNLCvNzdL1gUPvashI",
  orgId: "team_MwJPMKdnqu1z8dxbKYBqdJCY",
  ssoProtection: { deploymentType: "all_except_custom_domains" },
  protectionBypass: {},
};
const deployment = {
  id: QUOTE_SCOPE.deployment,
  url: new URL(QUOTE_SCOPE.origin).hostname,
  projectId: project.projectId,
  ownerId: project.orgId,
  target: null,
  readyState: "READY",
  alias: [],
  meta: { githubCommitSha: QUOTE_SCOPE.source },
};
const access = {
  origin: QUOTE_SCOPE.origin,
  token: jwt({
    project_id: project.projectId,
    owner_id: project.orgId,
    environment: "development",
    exp: now / 1000 + 300,
  }),
};
const appAccessToken = jwt({ sub: "10000000-0000-4000-8000-000000000001", exp: now / 1000 + 3600 });
const billingProof = {
  deployment: QUOTE_SCOPE.deployment,
  source: QUOTE_SCOPE.source,
  configurationSource: "verified_preview_build_configuration",
  deploymentOverridesAbsent: true,
  priceId: CURRENT_SANDBOX_TARGET.price,
  amountCents: 999,
  currency: "usd",
  liveModeEnabled: false,
  keyBinding: "identical_test_key_sha256",
  secretKeyMode: "test",
  verifiedAt: now,
  secretKeySha256: createHash("sha256").update("rk_test_offlinefixture").digest("hex"),
};
const proofWithoutKeyHash = Object.fromEntries(
  Object.entries(billingProof).filter(([key]) => key !== "secretKeySha256"),
);
const guardProof = {
  ...proofWithoutKeyHash,
  keyBinding: "account_scoped_price_prewrite_guard",
  secretKeyMode: "test_enforced_before_mutation",
  secretKeyPresenceVerified: true,
  prewriteGuard: {
    source: QUOTE_SCOPE.source,
    liveKeyRejectedWhileLocked: true,
    exactPriceVerifiedBeforeBillingMutation: true,
  },
};
const roots = [];
async function fixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-quote-offline-"));
  roots.push(root);
  await fs.mkdir(path.join(root, ".stripe-sandbox.local"), { mode: 0o700 });
  const record = {
    version: 1,
    marker: "unimate-stripe-sandbox-synthetic-v1",
    account: TARGET.account,
    price: TARGET.price,
    supabase: TARGET.supabase,
    nonce: "20000000-0000-4000-8000-000000000002",
    userId: "10000000-0000-4000-8000-000000000001",
    password: "A".repeat(43),
    email: "unimate-billing-20000000-0000-4000-8000-000000000002@example.test",
    ...options.record,
  };
  const recordText = JSON.stringify(record);
  await fs.writeFile(path.join(root, ARTIFACT), recordText, { mode: 0o600 });
  const journalPath = path.join(root, ".stripe-sandbox.local", QUOTE_SCOPE.journal);
  const journals = async () =>
    (await fs.readFile(journalPath, "utf8")).trim().split("\n").map(JSON.parse);
  const state = { calls: [], created: false, expired: false };
  const price = {
    id: CURRENT_SANDBOX_TARGET.price,
    product: CURRENT_SANDBOX_TARGET.product,
    active: true,
    livemode: false,
    type: "recurring",
    billing_scheme: "per_unit",
    transform_quantity: null,
    currency: "usd",
    unit_amount: 999,
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
    ...options.price,
  };
  const session = () => ({
    id: "cs_test_newquote",
    livemode: false,
    customer: QUOTE_SCOPE.customer,
    client_reference_id: record.userId,
    metadata: { user_id: record.userId },
    mode: "subscription",
    status: state.expired ? "expired" : "open",
    subscription: null,
    payment_intent: null,
    payment_status: "unpaid",
    amount_total: 999,
    amount_subtotal: 999,
    currency: "usd",
    total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 },
    automatic_tax: { enabled: false },
    url: "https://checkout.stripe.com/c/pay/cs_test_newquote#private",
    success_url: `${QUOTE_SCOPE.origin}/upgrade?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${QUOTE_SCOPE.origin}/upgrade?canceled=true`,
    ...options.session,
  });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    state.calls.push({ origin: url.origin, path: url.pathname, method: init.method || "GET" });
    assert.equal(init.redirect, "manual");
    if (url.origin !== QUOTE_SCOPE.origin)
      assert.equal(init.headers["x-vercel-trusted-oidc-idp-token"], undefined);
    if (url.origin === TARGET.supabase) {
      assert.equal(init.method, undefined);
      assert.equal(init.headers.Authorization, `Bearer ${appAccessToken}`);
      if (url.pathname === "/auth/v1/user")
        return Response.json({
          id: record.userId,
          email: record.email,
          app_metadata: { unimate_test_marker: record.marker, unimate_test_nonce: record.nonce },
          ...options.user,
        });
      assert.equal(url.pathname, "/rest/v1/profiles");
      assert.equal(url.searchParams.get("id"), `eq.${record.userId}`);
      return Response.json([
        {
          id: record.userId,
          is_pro: false,
          stripe_customer_id: QUOTE_SCOPE.customer,
          billing_revision: 80,
          ...options.profile,
          ...(state.created && options.changedProfile ? { billing_revision: 81 } : {}),
        },
      ]);
    }
    if (url.origin === QUOTE_SCOPE.origin) {
      assert.equal(init.headers.Authorization, `Bearer ${appAccessToken}`);
      assert.equal(init.headers["x-vercel-trusted-oidc-idp-token"], access.token);
      if (url.pathname === "/api/billing-status")
        return Response.json({
          isPro: false,
          state: "free",
          canManage: true,
          pastDueGraceEnabled: true,
          ...options.status,
        });
      if (url.pathname === "/api/signup-status")
        return Response.json({ enabled: false, ...options.signup });
      assert.equal(url.pathname, "/api/create-checkout-session");
      assert.equal(init.method, "POST");
      assert.equal(init.body, "{}");
      assert.equal((await journals()).at(-1).phase, "create-pending");
      assert.equal(state.created, false, "app create is called at most once");
      state.created = true;
      if (options.createUnknown) throw new Error("private transport details must not escape");
      if (options.createRedirect)
        return new Response(null, {
          status: 302,
          headers: { location: "https://untrusted.test/private" },
        });
      return Response.json({ url: session().url, ...options.createdResponse });
    }
    assert.equal(url.origin, "https://api.stripe.com");
    assert.equal(init.headers.Authorization, "Bearer rk_test_offlinefixture");
    if (url.pathname === "/v1/account")
      return Response.json({ id: options.account || TARGET.account });
    if (url.pathname === `/v1/prices/${CURRENT_SANDBOX_TARGET.price}`) return Response.json(price);
    if (url.pathname === `/v1/customers/${QUOTE_SCOPE.customer}`)
      return Response.json({
        id: QUOTE_SCOPE.customer,
        livemode: false,
        test_clock: "clock_fixture",
        metadata: { user_id: record.userId },
        ...options.customer,
      });
    if (url.pathname === "/v1/test_helpers/test_clocks/clock_fixture")
      return Response.json({
        id: "clock_fixture",
        livemode: false,
        status: "ready",
        ...options.clock,
      });
    if (url.pathname === "/v1/subscriptions") {
      assert.equal(url.searchParams.get("customer"), QUOTE_SCOPE.customer);
      return Response.json({
        has_more: false,
        data: [
          {
            id: "sub_historical",
            customer: QUOTE_SCOPE.customer,
            livemode: false,
            status: "canceled",
            metadata: { user_id: record.userId },
            ...options.subscription,
          },
        ],
        ...options.subscriptionList,
      });
    }
    if (url.pathname === "/v1/checkout/sessions") {
      assert.equal(init.method, undefined);
      assert.equal(url.searchParams.get("customer"), QUOTE_SCOPE.customer);
      assert.equal(url.searchParams.get("status"), "open");
      return Response.json({
        has_more: false,
        data: !state.expired && (state.created || options.preexistingOpen) ? [session()] : [],
        ...options.openList,
      });
    }
    if (url.pathname === "/v1/checkout/sessions/cs_test_newquote/line_items")
      return Response.json({
        has_more: false,
        data: [
          {
            price: CURRENT_SANDBOX_TARGET.price,
            quantity: 1,
            amount_total: 999,
            amount_subtotal: 999,
            currency: "usd",
            ...options.line,
          },
        ],
      });
    if (url.pathname === "/v1/checkout/sessions/cs_test_newquote") return Response.json(session());
    assert.equal(url.pathname, "/v1/checkout/sessions/cs_test_newquote/expire");
    assert.equal(init.method, "POST");
    assert.equal((await journals()).at(-1).phase, "expiry-pending");
    assert.equal(state.expired, false, "expiry is attempted at most once");
    state.expired = true;
    if (options.expiryUnknown) throw new Error("private expiry details must not escape");
    return Response.json(session());
  };
  const run = (overrides = {}) =>
    verifyCurrentSandboxQuote({
      approved: true,
      access,
      project,
      deployment,
      appAccessToken,
      billingProof,
      root,
      fetchImpl,
      now: () => now,
      checkIgnored: () => {},
      verify: async () => ({
        stripe: {
          STRIPE_SECRET_KEY: "rk_test_offlinefixture",
          STRIPE_PRICE_ID: TARGET.price,
          STRIPE_LIVE_MODE_ENABLED: "false",
          ...options.stripe,
        },
        supa: {
          VITE_SUPABASE_URL: TARGET.supabase,
          VITE_SUPABASE_ANON_KEY: "sb_publishable_fixture",
        },
      }),
      ...overrides,
    });
  const mutations = () => state.calls.filter((c) => c.method === "POST");
  return { root, recordText, journalPath, journals, state, run, mutations };
}

try {
  assertQuoteIgnored(path.resolve(import.meta.dirname, "../.."));
  const f = await fixture();
  const result = await f.run();
  assert.equal(result.verified, true);
  assert.equal(result.scope, "hosted_unpaid_quote_only");
  assert.equal(result.checkoutExpired, true);
  assert.equal(result.paymentRequests, 0);
  assert.equal(result.deployedKeyEqualityVerified, true);
  assert.equal(f.mutations().length, 2);
  assert.deepEqual(
    (await f.journals()).map((j) => j.phase),
    ["create-pending", "quote-verified", "expiry-pending", "expired-verified"],
  );
  const saved = await fs.readFile(f.journalPath, "utf8");
  for (const privateValue of [
    access.token,
    appAccessToken,
    "rk_test_offlinefixture",
    "https://checkout.stripe.com",
    "A".repeat(43),
  ])
    assert.ok(!saved.includes(privateValue));
  assert.equal((await fs.stat(f.journalPath)).mode & 0o777, 0o600);
  assert.equal(await fs.readFile(path.join(f.root, ARTIFACT), "utf8"), f.recordText);
  const before = f.state.calls.length;
  await assert.rejects(f.run(), /QUOTE_ALREADY_CLAIMED_NO_RETRY/);
  assert.equal(f.state.calls.length, before);
  {
    const guarded = await fixture();
    const result = await guarded.run({ billingProof: guardProof });
    assert.equal(result.verified, true);
    assert.equal(result.deployedKeyEqualityVerified, false);
    assert.equal(result.accountBinding, "account_scoped_price_prewrite_guard");
    assert.equal(guarded.mutations().length, 2);
    assert.ok(
      (await guarded.journals()).every((entry) => entry.deployedKeyEqualityVerified === false),
    );
    for (const route of [
      "/api/billing-status",
      "/api/signup-status",
      "/auth/v1/user",
      "/v1/account",
      `/v1/prices/${CURRENT_SANDBOX_TARGET.price}`,
    ]) {
      const lookup = guarded.state.calls.findIndex((call) => call.path === route);
      assert.ok(
        lookup >= 0 && lookup < guarded.state.calls.findIndex((call) => call.method === "POST"),
      );
    }
  }
  for (const change of [
    { keyBinding: "unverified" },
    { secretKeyMode: "test" },
    { secretKeyPresenceVerified: false },
    { secretKeySha256: billingProof.secretKeySha256 },
    { prewriteGuard: undefined },
    { prewriteGuard: { ...guardProof.prewriteGuard, source: "0".repeat(40) } },
    { prewriteGuard: { ...guardProof.prewriteGuard, liveKeyRejectedWhileLocked: false } },
    {
      prewriteGuard: {
        ...guardProof.prewriteGuard,
        exactPriceVerifiedBeforeBillingMutation: false,
      },
    },
    { deploymentOverridesAbsent: false },
    { liveModeEnabled: true },
    { source: "0".repeat(40) },
    { priceId: TARGET.price },
    { amountCents: 599 },
  ]) {
    const item = await fixture();
    await assert.rejects(item.run({ billingProof: { ...guardProof, ...change } }));
    assert.equal(item.state.calls.length, 0);
  }
  for (const options of [
    { account: "acct_other" },
    { price: { unit_amount: 599 } },
    { user: { id: "other" } },
    { status: { state: "not_configured" } },
  ]) {
    const item = await fixture(options);
    await assert.rejects(item.run({ billingProof: guardProof }));
    assert.equal(item.mutations().length, 0);
    await assert.rejects(fs.stat(item.journalPath), { code: "ENOENT" });
  }
  for (const overrides of [
    { approved: false },
    { access: { ...access, origin: "https://other.vercel.app" } },
    { deployment: { ...deployment, target: "production" } },
    { deployment: { ...deployment, id: "dpl_other" } },
    { deployment: { ...deployment, meta: { githubCommitSha: "0".repeat(40) } } },
    { deployment: { ...deployment, alias: ["askunimate.com"] } },
    { project: { ...project, protectionBypass: { private: {} } } },
    { project: { ...project, ssoProtection: null } },
    { appAccessToken: "not-a-session" },
    { billingProof: undefined },
    { billingProof: { ...billingProof, configurationSource: "current_project_only" } },
    { billingProof: { ...billingProof, deploymentOverridesAbsent: false } },
    { billingProof: { ...billingProof, liveModeEnabled: true } },
    { billingProof: { ...billingProof, secretKeyMode: "live" } },
    { billingProof: { ...billingProof, deployment: "dpl_other" } },
    { billingProof: { ...billingProof, source: "0".repeat(40) } },
    { billingProof: { ...billingProof, priceId: TARGET.price } },
    { billingProof: { ...billingProof, amountCents: 599 } },
    { billingProof: { ...billingProof, verifiedAt: now - 300_001 } },
    { billingProof: { ...billingProof, verifiedAt: now + 1 } },
    {
      access: {
        ...access,
        token: jwt({
          project_id: project.projectId,
          owner_id: project.orgId,
          environment: "development",
          exp: now / 1000 + 30,
        }),
      },
    },
  ]) {
    const item = await fixture();
    await assert.rejects(item.run(overrides));
    assert.equal(item.state.calls.length, 0);
  }
  {
    const item = await fixture();
    await assert.rejects(
      item.run({ billingProof: { ...billingProof, secretKeySha256: "wrong" } }),
      /DEPLOYED_TEST_KEY_MISMATCH/,
    );
    assert.equal(item.state.calls.length, 0);
  }
  for (const options of [
    { account: "acct_other" },
    { stripe: { STRIPE_SECRET_KEY: "sk_live_fixture" } },
    { stripe: { STRIPE_LIVE_MODE_ENABLED: "true" } },
    { price: { unit_amount: 599 } },
    { user: { id: "other" } },
    { user: { app_metadata: {} } },
    { profile: { is_pro: true } },
    { profile: { stripe_customer_id: "cus_other" } },
    { customer: { livemode: true } },
    { customer: { metadata: { user_id: "other" } } },
    { clock: { status: "advancing" } },
    { subscription: { status: "active" } },
    { subscriptionList: { has_more: true } },
    { preexistingOpen: true },
    { status: { pastDueGraceEnabled: false } },
    { signup: { enabled: true } },
  ]) {
    const item = await fixture(options);
    await assert.rejects(item.run());
    assert.equal(item.mutations().length, 0);
    await assert.rejects(fs.stat(item.journalPath), { code: "ENOENT" });
  }
  for (const options of [
    { session: { amount_total: 599 } },
    { session: { subscription: "sub_unexpected" } },
    { session: { payment_status: "paid" } },
    { session: { automatic_tax: { enabled: true } } },
    { session: { success_url: "https://other.test" } },
    { line: { price: TARGET.price } },
    { line: { quantity: 2 } },
    { createdResponse: { alreadySubscribed: true } },
    { changedProfile: true },
    { createUnknown: true },
    { createRedirect: true },
  ]) {
    const item = await fixture(options);
    await assert.rejects(
      item.run(),
      (error) => !/private transport|private expiry/.test(error.message),
    );
    assert.equal(item.mutations().length, 1);
    await assert.rejects(item.run(), /QUOTE_ALREADY_CLAIMED_NO_RETRY/);
    assert.equal(item.mutations().length, 1);
  }
  {
    const item = await fixture({ expiryUnknown: true });
    await assert.rejects(item.run(), /REMOTE_REQUEST_FAILED/);
    assert.equal((await item.journals()).at(-1).phase, "expiry-pending");
    await assert.rejects(item.run(), /QUOTE_ALREADY_CLAIMED_NO_RETRY/);
    assert.equal(item.mutations().length, 2);
  }
  console.log(
    "PASS one-shot current-price quote: protected exact Preview, synthetic-only identity,999 quote,exact unpaid expiry,private claims,unknown-outcome no retry (offline)",
  );
} finally {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true });
}
