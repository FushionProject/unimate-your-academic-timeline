import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";

// Execute the production checkout handler and checkout-list validation with
// synthetic transport only. No credentials, listening server, or Stripe writes.
const source = fs.readFileSync(new URL("../../src/server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true);
const names = [
  "handleCreateCheckoutSession",
  "checkoutIntegrationIdentifier",
  "readCustomerCheckouts",
  "stripeList",
  "objectId",
  "stripeCustomerId",
  "subscriptionHasConfiguredPrice",
];
const declarations = names
  .map((name) => {
    const node = ast.statements.find((entry) => entry.name?.text === name);
    assert.ok(node, `actual server declaration ${name}`);
    return node.getText(ast);
  })
  .join("\n");
const compiled = ts.transpileModule(declarations, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const userId = "00000000-0000-4000-8000-000000000001";
const customerId = "cus_synthetic";
const priceId = "price_synthetic";
const checkoutUrl = "https://checkout.stripe.com/synthetic";
const json = (body, status = 200, headers) =>
  new Response(JSON.stringify(body), { status, headers });
const openSession = (fields = {}) => ({
  id: "cs_synthetic",
  mode: "subscription",
  status: "open",
  url: checkoutUrl,
  line_items: { data: [{ price: { id: priceId } }], has_more: false },
  ...fields,
});

function fixture() {
  const state = {
    calls: [],
    logs: [],
    listCalls: 0,
    ownerCalls: 0,
    recoverySessions: [openSession()],
    ownersChanged: false,
    lookupFailure: false,
    postStatus: 409,
    postBody: { error: { code: "idempotency_key_in_use", message: "private provider detail" } },
    postHandler: null,
    listing: null,
  };
  const config = {
    secretKey: "synthetic-placeholder",
    priceId,
    liveMode: false,
    canonicalOrigin: "https://unimate.test",
  };
  const stripeRequest = async (path, actualConfig, init = {}, key) => {
    assert.equal(actualConfig, config);
    state.calls.push({ path, method: init.method || "GET", body: init.body, key });
    const url = new URL(`https://api.stripe.com/v1${path}`);
    if (url.pathname === `/v1/prices/${priceId}`) {
      return json({
        active: true,
        type: "recurring",
        livemode: false,
        unit_amount: 599,
        currency: "usd",
        recurring: { interval: "month", interval_count: 1 },
      });
    }
    assert.equal(url.pathname, "/v1/checkout/sessions", "only scoped checkout requests");
    if (init.method === "POST") {
      const params = new URLSearchParams(init.body);
      assert.equal(params.get("customer"), customerId);
      assert.equal(params.get("line_items[0][price]"), priceId);
      assert.equal(params.get("metadata[user_id]"), userId);
      assert.ok(key);
      if (state.postHandler) return state.postHandler();
      return typeof state.postBody === "string"
        ? new Response(state.postBody, { status: state.postStatus })
        : json(state.postBody, state.postStatus);
    }
    assert.equal(url.searchParams.get("customer"), customerId);
    assert.equal(url.searchParams.get("expand[]"), "data.line_items");
    state.listCalls++;
    if (state.lookupFailure && state.listCalls > 1) return json({}, 503);
    return json({
      data: state.listing ? state.listing() : state.listCalls > 1 ? state.recoverySessions : [],
      has_more: false,
    });
  };
  const unexpectedMutation = () => {
    throw new Error("unexpected extra Stripe mutation");
  };
  const context = vm.createContext({
    Request,
    Response,
    URL,
    URLSearchParams,
    TextEncoder,
    Uint8Array,
    crypto: webcrypto,
    process: { env: {} },
    console: { error: (...args) => state.logs.push(args) },
    stripeConfiguration: () => config,
    jsonResponse: json,
    requireAuthenticatedUser: async () => ({ id: userId }),
    enforceUserRateLimit: () => null,
    readBillingProfile: async () => ({ stripe_customer_id: customerId, is_pro: false }),
    findUserIdsByStripeCustomer: async (id) => {
      assert.equal(id, customerId);
      state.ownerCalls++;
      return state.ownersChanged && state.ownerCalls > 1 ? ["another-user"] : [userId];
    },
    listCustomerSubscriptions: async () => [],
    preferredSubscription: () => null,
    retrieveStripeSubscription: async (id) => ({
      id,
      customer: customerId,
      status: "active",
      items: { data: [{ price: { id: priceId } }], has_more: false },
    }),
    createOrBindStripeCustomer: unexpectedMutation,
    createPortalUrl: unexpectedMutation,
    stripeRequest,
  });
  vm.runInContext(`${compiled}\nglobalThis.checkout = handleCreateCheckoutSession;`, context);
  const checkout = () =>
    context.checkout(
      new Request("https://unimate.test/api/create-checkout-session", {
        method: "POST",
        headers: { Authorization: "Bearer synthetic-session" },
      }),
    );
  const posts = () => state.calls.filter((call) => call.method === "POST");
  return { state, checkout, posts };
}

{
  const f = fixture();
  const response = await f.checkout();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).url, checkoutUrl);
  assert.equal(f.state.listCalls, 2, "one bounded read-only recovery pass");
  assert.equal(f.posts().length, 1, "conflict never replays the create request");
  assert.equal(f.state.ownerCalls, 2, "ownership rechecked before disclosing the winner");
  assert.deepEqual(f.state.logs, [], "private Stripe failure data stays out of logs");
}

for (const sessions of [
  [],
  [openSession({ line_items: { data: [{ price: { id: "price_other" } }] } })],
  [openSession({ status: "complete", subscription: "sub_already_paid", url: null })],
]) {
  const f = fixture();
  f.state.recoverySessions = sessions;
  const response = await f.checkout();
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("Retry-After"), "2");
  const body = await response.json();
  assert.equal(body.code, "CHECKOUT_IN_PROGRESS");
  assert.equal(body.url, undefined);
  assert.doesNotMatch(JSON.stringify(body), /private provider detail/);
  assert.equal(f.posts().length, 1);
}

for (const failure of ["lookup", "invalid-url", "ambiguous-session"]) {
  const f = fixture();
  if (failure === "lookup") f.state.lookupFailure = true;
  if (failure === "invalid-url")
    f.state.recoverySessions = [openSession({ url: "https://untrusted.test/pay" })];
  if (failure === "ambiguous-session")
    f.state.recoverySessions = [openSession({ status: "unknown" })];
  const response = await f.checkout();
  assert.equal(response.status, 502, `${failure} fails closed`);
  assert.equal((await response.json()).url, undefined);
  assert.equal(f.posts().length, 1);
}

{
  const f = fixture();
  f.state.ownersChanged = true;
  const response = await f.checkout();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).url, undefined);
  assert.equal(f.state.listCalls, 1, "changed ownership prevents recovery lookup");
  assert.equal(f.posts().length, 1);
}

for (const [status, body] of [
  [409, { error: { code: "idempotency_error", message: "private provider detail" } }],
  [400, { error: { code: "idempotency_key_in_use" } }],
  [503, { error: { code: "idempotency_key_in_use" } }],
  [409, "not-json"],
  [409, null],
]) {
  const f = fixture();
  f.state.postStatus = status;
  f.state.postBody = body;
  const response = await f.checkout();
  assert.equal(response.status, 502, "only the exact documented concurrent conflict recovers");
  assert.equal(f.state.listCalls, 1);
  assert.equal(f.posts().length, 1);
  assert.doesNotMatch(JSON.stringify(f.state.logs), /private provider detail/);
}

// Model an actual in-flight conflict: Stripe rejects the second POST before
// the first becomes list-visible. It must safely retry later without a new
// payable Checkout or a different attempt key/payload.
{
  const f = fixture();
  let release, entered;
  let visible = false;
  const waiting = new Promise((resolve) => (release = resolve));
  const ready = new Promise((resolve) => (entered = resolve));
  f.state.listing = () => (visible ? [openSession()] : []);
  f.state.postHandler = async () => {
    if (f.posts().length === 1) {
      entered();
      await waiting;
      visible = true;
      return json({ url: checkoutUrl });
    }
    return json({ error: { code: "idempotency_key_in_use" } }, 409);
  };
  const first = f.checkout();
  await ready;
  const second = await f.checkout();
  assert.equal(second.status, 409);
  assert.equal((await second.json()).code, "CHECKOUT_IN_PROGRESS");
  release();
  assert.equal((await first).status, 200);
  const retry = await f.checkout();
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).url, checkoutUrl);
  assert.equal(f.posts().length, 2, "later retry reuses the first session without a POST");
  assert.equal(f.posts()[0].key, f.posts()[1].key);
  assert.equal(f.posts()[0].body, f.posts()[1].body);
}

console.log("PASS checkout concurrency: exact conflict recovery, safe retry, no duplicate create");
