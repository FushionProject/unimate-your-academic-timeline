import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initialDecline } from "../../scripts/stripe-sandbox-initial-decline.mjs";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";

async function fixture(test) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-initial-decline-fixture-"));
  try {
    const dir = path.join(root, ".stripe-sandbox.local");
    await fs.mkdir(dir, { mode: 0o700 });
    const userId = "10000000-0000-4000-8000-000000000001";
    const state = {
      live: false,
      isPro: false,
      gateStatus: 403,
      gateCode: "PRO_REQUIRED",
      wrongAccount: false,
      session: null,
      otherOpen: false,
      more: false,
      wrongPrice: false,
      unknownCreate: false,
      maliciousUrl: false,
      expireUnknown: false,
      expireAppliedUnknown: false,
      badExpire: false,
      afterCreate: null,
      afterExpire: null,
      omitOpen: false,
      creates: 0,
      expires: 0,
      subscriptions: [{ id: "sub_old", status: "canceled" }],
    };
    const makeSession = () => ({
      id: "cs_test_fixture",
      livemode: false,
      customer: "cus_primary",
      client_reference_id: userId,
      metadata: { user_id: userId },
      mode: "subscription",
      subscription: null,
      payment_status: "unpaid",
      amount_total: 599,
      currency: "usd",
      status: "open",
    });
    const json = (value) => new Response(JSON.stringify(value));
    const run = (action, extra = {}) =>
      initialDecline({
        action,
        approved: true,
        root,
        verify: async () => ({
          stripe: {
            STRIPE_SECRET_KEY: state.live ? "sk_live_forbidden" : "sk_test_fixture",
            STRIPE_PRICE_ID: TARGET.price,
            STRIPE_LIVE_MODE_ENABLED: "false",
          },
        }),
        inspect: async (args) => {
          assert.equal(args.action, "status");
          return {
            account: state.wrongAccount ? "acct_other" : TARGET.account,
            clockStatus: "ready",
            userId,
            customerId: "cus_primary",
            subscriptions: structuredClone(state.subscriptions),
          };
        },
        lifecycle: async (args) => {
          if (args.action === "status")
            return {
              userId,
              profile: { isPro: state.isPro },
              gate: { status: state.gateStatus, code: state.gateCode },
            };
          assert.equal(args.action, "checkout");
          state.creates++;
          const journal = JSON.parse(
            await fs.readFile(path.join(dir, "initial-decline-v1.json"), "utf8"),
          );
          assert.equal(journal.state, "pending", "journal must precede any Checkout mutation");
          assert.equal((await fs.stat(path.join(dir, "initial-decline-v1.json"))).mode & 0o077, 0);
          state.session = makeSession();
          state.afterCreate?.();
          if (state.unknownCreate) throw new Error("private raw credentials and URLs");
          return {
            url: state.maliciousUrl
              ? "https://evil.example/c/pay/cs_test_fixture"
              : "https://checkout.stripe.com/c/pay/cs_test_fixture#privateBearer",
          };
        },
        fetchImpl: async (raw, init) => {
          const url = new URL(raw);
          assert.equal(url.origin, "https://api.stripe.com");
          assert.equal(init.redirect, "manual");
          if (url.pathname === "/v1/checkout/sessions") {
            assert.equal(url.searchParams.get("customer"), "cus_primary");
            assert.equal(url.searchParams.get("status"), "open");
            const data =
              state.session?.status === "open" && !state.omitOpen
                ? [structuredClone(state.session)]
                : [];
            if (state.otherOpen) data.push({ ...makeSession(), id: "cs_test_other" });
            return json({ data, has_more: state.more });
          }
          if (url.pathname === "/v1/checkout/sessions/cs_test_fixture") return json(state.session);
          if (url.pathname === "/v1/checkout/sessions/cs_test_fixture/line_items")
            return json({
              has_more: false,
              data: [
                {
                  price: state.wrongPrice ? "price_other" : TARGET.price,
                  quantity: 1,
                  amount_total: 599,
                  currency: "usd",
                },
              ],
            });
          if (url.pathname === "/v1/checkout/sessions/cs_test_fixture/expire") {
            assert.equal(init.method, "POST");
            state.expires++;
            const journal = JSON.parse(
              await fs.readFile(path.join(dir, "initial-decline-v1.json"), "utf8"),
            );
            assert.equal(journal.state, "expiry-pending");
            if (state.expireAppliedUnknown) state.session.status = "expired";
            if (state.expireUnknown || state.expireAppliedUnknown)
              throw new Error("private raw body");
            state.session.status = "expired";
            state.afterExpire?.();
            return json({
              ...state.session,
              ...(state.badExpire ? { customer: "cus_other" } : {}),
            });
          }
          assert.fail("Unexpected remote path");
        },
        ...extra,
      });
    await test({ run, state, dir, makeSession });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

await fixture(async ({ run, state }) => {
  const created = await run("create");
  assert.equal(created.created, true);
  assert.equal(state.creates, 1);
  assert.ok(!JSON.stringify(created).includes("privateBearer"));
  await assert.rejects(run("create"), /ALREADY_STARTED/);
  assert.equal((await run("status")).checkoutStatus, "open");
  assert.equal((await run("cleanup")).checkoutStatus, "expired");
  assert.equal(state.expires, 1);
  assert.equal((await run("cleanup")).journalState, "cleaned");
  assert.equal(state.expires, 1);
});
for (const flag of ["unknownCreate", "maliciousUrl"])
  await fixture(async ({ run, state }) => {
    state[flag] = true;
    await assert.rejects(run("create"), /FAILED|URL_REQUIRED/);
    await assert.rejects(run("create"), /ALREADY_STARTED/);
    await assert.rejects(run("cleanup"), /RESOLVED_INITIAL_DECLINE_JOURNAL_REQUIRED/);
    assert.equal(state.creates, 1);
    assert.equal(state.expires, 0);
  });
for (const flag of ["live", "wrongAccount", "isPro", "otherOpen", "more"])
  await fixture(async ({ run, state }) => {
    state[flag] = true;
    await assert.rejects(
      run("create"),
      /CONFIG_REQUIRED|SCOPE_REQUIRED|FREE_GATE_REQUIRED|OPEN_CHECKOUT|LIST_REQUIRED/,
    );
    assert.equal(state.creates, 0);
  });
for (const mutate of [
  (s) => (s.customer = "cus_other"),
  (s) => (s.livemode = true),
  (s) => (s.client_reference_id = "other"),
  (s) => (s.metadata.user_id = "other"),
  (s) => (s.subscription = "sub_new"),
  (s) => (s.payment_status = "paid"),
  (s) => (s.amount_total = 600),
  (s) => (s.currency = "eur"),
  (s) => (s.mode = "payment"),
  (s) => (s.status = "complete"),
])
  await fixture(async ({ run, state }) => {
    await run("create");
    mutate(state.session);
    await assert.rejects(run("cleanup"), /CHECKOUT_REQUIRED|LIST_REQUIRED/);
    assert.equal(state.expires, 0);
  });
for (const flag of ["wrongPrice", "otherOpen", "more", "isPro"])
  await fixture(async ({ run, state }) => {
    await run("create");
    state[flag] = true;
    await assert.rejects(
      run("cleanup"),
      /PRICE_REQUIRED|OPEN_CHECKOUT|LIST_REQUIRED|FREE_GATE_REQUIRED/,
    );
    assert.equal(state.expires, 0);
  });
await fixture(async ({ run, state }) => {
  await run("create");
  state.subscriptions.push({ id: "sub_new", status: "incomplete" });
  await assert.rejects(run("cleanup"), /FREE_SCOPE_REQUIRED/);
  assert.equal(state.expires, 0);
});
await fixture(async ({ run, state }) => {
  await run("create");
  state.subscriptions.push({ id: "sub_new", status: "canceled" });
  await assert.rejects(run("cleanup"), /JOURNAL_MISMATCH/);
  assert.equal(state.expires, 0);
});
await fixture(async ({ run, state }) => {
  await run("create");
  state.expireUnknown = true;
  await assert.rejects(run("cleanup"), /REMOTE_REQUEST_FAILED/);
  assert.equal((await run("status")).journalState, "expiry-pending");
  await assert.rejects(run("cleanup"), /UNCERTAIN_NO_RETRY/);
  assert.equal(state.expires, 1);
});
await fixture(async ({ run, state }) => {
  await run("create");
  state.expireAppliedUnknown = true;
  await assert.rejects(run("cleanup"), /REMOTE_REQUEST_FAILED/);
  assert.equal((await run("cleanup")).journalState, "cleaned");
  assert.equal(state.expires, 1);
});
await fixture(async ({ run, state }) => {
  await run("create");
  state.badExpire = true;
  await assert.rejects(run("cleanup"), /EXPIRY_NOT_CONFIRMED/);
  assert.equal(state.expires, 1);
});
for (const mutate of [
  (s) => (s.session.customer = "cus_other"),
  (s) => (s.wrongPrice = true),
  (s) => (s.isPro = true),
  (s) => (s.omitOpen = true),
])
  await fixture(async ({ run, state, dir }) => {
    state.afterCreate = () => mutate(state);
    await assert.rejects(
      run("create"),
      /LIST_REQUIRED|PRICE_REQUIRED|FREE_GATE_REQUIRED|OPEN_CHECKOUT/,
    );
    assert.equal(state.creates, 1);
    const journal = JSON.parse(
      await fs.readFile(path.join(dir, "initial-decline-v1.json"), "utf8"),
    );
    assert.equal(journal.sessionId, "cs_test_fixture");
    assert.equal(
      journal.state,
      "created",
      "resolved ID remains available for exact reconciliation",
    );
    state.afterCreate = null;
    state.isPro = false;
    state.wrongPrice = false;
    state.omitOpen = false;
    state.session.customer = "cus_primary";
    await assert.rejects(run("create"), /ALREADY_STARTED/);
    assert.equal(state.creates, 1);
  });
for (const mutate of [
  (s) => (s.isPro = true),
  (s) => (s.otherOpen = true),
  (s) => s.subscriptions.push({ id: "sub_new", status: "incomplete" }),
])
  await fixture(async ({ run, state }) => {
    await run("create");
    state.afterExpire = () => mutate(state);
    await assert.rejects(run("cleanup"), /FREE_GATE_REQUIRED|OPEN_CHECKOUT|FREE_SCOPE_REQUIRED/);
    assert.equal(
      state.expires,
      1,
      "post-expiry readback must not silently report the old Free snapshot",
    );
  });
await assert.rejects(
  initialDecline({ action: "create", verify: () => assert.fail("approval before config") }),
  /APPROVAL_REQUIRED/,
);
console.log("Stripe initial-decline offline safety fixtures passed (no remote calls).");
