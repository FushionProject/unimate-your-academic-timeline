import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sandboxDispute } from "../../scripts/stripe-sandbox-dispute.mjs";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";

async function fixture(test) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-dispute-fixture-"));
  try {
    await fs.mkdir(path.join(root, ".stripe-sandbox.local"), { mode: 0o700 });
    const userId = "10000000-0000-4000-8000-000000000001";
    const customer = {
      id: "cus_fixture",
      livemode: false,
      metadata: { user_id: userId },
      test_clock: "clock_fixture",
      invoice_settings: { default_payment_method: "pm_original" },
    };
    const sub = {
      id: "sub_fixture",
      livemode: false,
      customer: customer.id,
      metadata: { user_id: userId },
      status: "active",
      collection_method: "charge_automatically",
      cancel_at_period_end: false,
      default_payment_method: "pm_original",
      latest_invoice: "in_initial",
      items: { has_more: false, data: [{ price: { id: TARGET.price }, quantity: 1 }] },
    };
    const invoice = {
      id: "in_initial",
      livemode: false,
      customer: customer.id,
      parent: { type: "subscription_details", subscription_details: { subscription: sub.id } },
      status: "paid",
      billing_reason: "subscription_cycle",
      currency: "usd",
      total: 599,
      amount_paid: 599,
      amount_remaining: 0,
      lines: {
        has_more: false,
        data: [{ pricing: { price_details: { price: TARGET.price } }, quantity: 1 }],
      },
    };
    const paid = {
      id: "inpay_fixture",
      invoice: "in_next",
      livemode: false,
      status: "paid",
      amount_paid: 599,
      currency: "usd",
      payment: { type: "payment_intent", payment_intent: "pi_fixture" },
    };
    const intent = {
      id: "pi_fixture",
      livemode: false,
      customer: customer.id,
      status: "succeeded",
      currency: "usd",
      amount_received: 599,
      payment_method: "pm_dispute",
      latest_charge: "ch_fixture",
    };
    const charge = {
      id: "ch_fixture",
      livemode: false,
      customer: customer.id,
      payment_intent: intent.id,
      paid: true,
      captured: true,
      amount: 599,
      currency: "usd",
      amount_refunded: 0,
      payment_method: "pm_dispute",
    };
    const dispute = {
      id: "du_fixture",
      livemode: false,
      charge: charge.id,
      payment_intent: intent.id,
      currency: "usd",
      amount: 599,
      reason: "fraudulent",
      status: "needs_response",
    };
    const state = {
      customer,
      sub,
      invoice,
      paid,
      intent,
      charge,
      dispute,
      writes: [],
      inspectCount: 0,
      changed: false,
      uncertainAt: null,
      paymentsMore: false,
      disputesMore: false,
      noDispute: false,
      wrongMethodOwner: false,
      wrongAttachedOwner: false,
      wrongResultId: false,
    };
    const json = (value) => new Response(JSON.stringify(value));
    const run = (action) =>
      sandboxDispute({
        action,
        approved: true,
        root,
        verify: async (args) => {
          assert.equal(args.verificationOnly, true);
          return {
            stripe: {
              STRIPE_SECRET_KEY: "sk_test_fixture",
              STRIPE_LIVE_MODE_ENABLED: "false",
              STRIPE_PRICE_ID: TARGET.price,
            },
          };
        },
        inspect: async (args) => {
          assert.equal(args.action, "status");
          return {
            account: TARGET.account,
            userId,
            customerId: state.changed && state.inspectCount++ > 0 ? "cus_other" : customer.id,
            clockId: "clock_fixture",
            clockStatus: "ready",
            subscriptions: [
              { id: sub.id, status: sub.status },
              { id: "sub_old", status: "canceled" },
            ],
          };
        },
        fetchImpl: async (url, init) => {
          const parsed = new URL(url),
            endpoint = parsed.pathname.replace("/v1", "");
          assert.equal(parsed.origin, "https://api.stripe.com");
          assert.equal(init.redirect, "manual");
          assert.equal(init.headers["Stripe-Version"], "2026-06-24.dahlia");
          if (init.method) {
            assert.equal(init.method, "POST");
            assert.match(init.headers["Idempotency-Key"], /^unimate-dispute-/);
            state.writes.push(endpoint);
            if (state.writes.length === state.uncertainAt)
              throw new Error("PRIVATE_RAW_PROVIDER_FAILURE");
            const body = new URLSearchParams(init.body);
            if (endpoint === "/payment_methods/pm_card_createDispute/attach") {
              assert.equal(body.get("customer"), customer.id);
              return json({
                id: "pm_dispute",
                customer: state.wrongAttachedOwner ? "cus_other" : customer.id,
                livemode: false,
                type: "card",
                card: { last4: "0259" },
              });
            }
            if (endpoint === `/subscriptions/${sub.id}`) {
              sub.default_payment_method = body.get("default_payment_method") || null;
              return json({ ...sub, id: state.wrongResultId ? "sub_other" : sub.id });
            }
            if (endpoint === `/disputes/${dispute.id}/close`) {
              assert.equal(init.body, "");
              dispute.status = "lost";
              return json(dispute);
            }
            throw new Error("unexpected fixture mutation");
          }
          if (endpoint === `/customers/${customer.id}`) return json(customer);
          if (endpoint === `/subscriptions/${sub.id}`) return json(sub);
          if (endpoint === `/invoices/${invoice.id}`) return json(invoice);
          if (endpoint.startsWith("/payment_methods/"))
            return json({
              id: endpoint.split("/").at(-1),
              customer: state.wrongMethodOwner ? "cus_other" : customer.id,
              livemode: false,
              type: "card",
              card: { last4: "4242" },
            });
          if (endpoint === "/invoice_payments") {
            assert.equal(parsed.searchParams.get("invoice"), invoice.id);
            assert.equal(parsed.searchParams.get("status"), "paid");
            return json({ data: [paid], has_more: state.paymentsMore });
          }
          if (endpoint === `/payment_intents/${intent.id}`) return json(intent);
          if (endpoint === `/charges/${charge.id}`) return json(charge);
          if (endpoint === "/disputes") {
            assert.equal(parsed.searchParams.get("charge"), charge.id);
            return json({ data: state.noDispute ? [] : [dispute], has_more: state.disputesMore });
          }
          throw new Error("unexpected fixture read");
        },
      });
    const renewal = () => {
      invoice.id = "in_next";
      sub.latest_invoice = invoice.id;
    };
    await test({ state, run, root, renewal });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

await assert.rejects(sandboxDispute({ action: "status" }), /EXPLICIT_DISPUTE_APPROVAL_REQUIRED/);
await assert.rejects(
  sandboxDispute({ action: "arbitrary", approved: true }),
  /EXPLICIT_DISPUTE_APPROVAL_REQUIRED/,
);
for (const stripe of [
  {
    STRIPE_SECRET_KEY: "sk_live_forbidden",
    STRIPE_LIVE_MODE_ENABLED: "false",
    STRIPE_PRICE_ID: TARGET.price,
  },
  {
    STRIPE_SECRET_KEY: "sk_test_fixture",
    STRIPE_LIVE_MODE_ENABLED: "true",
    STRIPE_PRICE_ID: TARGET.price,
  },
  {
    STRIPE_SECRET_KEY: "sk_test_fixture",
    STRIPE_LIVE_MODE_ENABLED: "false",
    STRIPE_PRICE_ID: "price_other",
  },
])
  await assert.rejects(
    sandboxDispute({
      action: "status",
      approved: true,
      verify: async () => ({ stripe }),
      inspect: async () => assert.fail("invalid config must stop before any identity/data read"),
    }),
    /EXACT_TEST_BILLING_CONFIG_REQUIRED/,
  );
for (const fallback of [false, true])
  await fixture(async ({ state, run, renewal, root }) => {
    if (fallback) state.sub.default_payment_method = null;
    assert.equal((await run("status")).disputeState, "awaiting-new-renewal");
    assert.equal(state.writes.length, 0);
    await run("install-dispute");
    assert.equal(state.sub.default_payment_method, "pm_dispute");
    assert.equal(state.writes.length, 2, "fixture installed without any charge creation");
    await assert.rejects(run("install-dispute"), /ALREADY_JOURNALED/);
    renewal();
    state.invoice.status = "draft";
    assert.equal((await run("status")).disputeState, "awaiting-paid-renewal");
    state.invoice.status = "paid";
    state.noDispute = true;
    assert.equal((await run("status")).disputeState, "awaiting-dispute");
    state.noDispute = false;
    const result = await run("status");
    assert.equal(result.disputeState, "needs_response");
    assert(!/pm_|cus_|ch_|pi_|du_|sk_test_/.test(JSON.stringify(result)));
    await assert.rejects(run("close-dispute"), /RESTORE_ORIGINAL/);
    await run("restore-payment");
    assert.equal(state.sub.default_payment_method, fallback ? null : "pm_original");
    await run("close-dispute");
    assert.equal(state.dispute.status, "lost");
    assert.equal(state.writes.length, 4);
    await assert.rejects(run("close-dispute"), /OPEN_SYNTHETIC_DISPUTE_REQUIRED/);
    for (const name of await fs.readdir(path.join(root, ".stripe-sandbox.local")))
      assert.equal(
        (await fs.stat(path.join(root, ".stripe-sandbox.local", name))).mode & 0o777,
        0o600,
      );
  });
for (const modify of [
  (s) => {
    s.customer.metadata.user_id = "other";
  },
  (s) => {
    s.sub.livemode = true;
  },
  (s) => {
    s.sub.items.data[0].price.id = "price_other";
  },
  (s) => {
    s.sub.items.data[0].quantity = 2;
  },
  (s) => {
    s.sub.cancel_at = 1234;
  },
  (s) => {
    s.changed = true;
  },
  (s) => {
    s.wrongMethodOwner = true;
  },
  (s) => {
    s.invoice.parent.subscription_details.subscription = "sub_other";
  },
])
  await fixture(async ({ state, run }) => {
    modify(state);
    await assert.rejects(run("install-dispute"));
    assert.equal(state.writes.length, 0);
  });
for (const modify of [
  (s) => {
    s.invoice.total = 600;
  },
  (s) => {
    s.invoice.billing_reason = "manual";
  },
  (s) => {
    s.paymentsMore = true;
  },
  (s) => {
    s.paid.livemode = true;
  },
  (s) => {
    s.paid.invoice = "in_other";
  },
  (s) => {
    s.intent.customer = "cus_other";
  },
  (s) => {
    s.intent.payment_method = "pm_other";
  },
  (s) => {
    s.charge.customer = "cus_other";
  },
  (s) => {
    s.charge.amount_refunded = 1;
  },
  (s) => {
    s.disputesMore = true;
  },
  (s) => {
    s.dispute.livemode = true;
  },
  (s) => {
    s.dispute.charge = "ch_other";
  },
  (s) => {
    s.dispute.amount = 600;
  },
])
  await fixture(async ({ state, run, renewal }) => {
    await run("install-dispute");
    renewal();
    await run("restore-payment");
    modify(state);
    await assert.rejects(run("close-dispute"));
    assert.equal(state.writes.length, 3);
  });
for (const uncertainAt of [1, 2])
  await fixture(async ({ state, run }) => {
    state.uncertainAt = uncertainAt;
    await assert.rejects(
      run("install-dispute"),
      (error) => error.code && !error.message.includes("PRIVATE_RAW"),
    );
    await assert.rejects(run("install-dispute"), /UNCERTAIN_MUTATION/);
    await assert.rejects(run("restore-payment"), /UNCERTAIN_MUTATION/);
    assert.equal(state.writes.length, uncertainAt);
    assert.equal((await run("status")).testAccountVerified, true);
  });
for (const property of ["wrongAttachedOwner", "wrongResultId"])
  await fixture(async ({ state, run }) => {
    state[property] = true;
    await assert.rejects(run("install-dispute"));
    const writes = state.writes.length;
    await assert.rejects(run("install-dispute"), /UNCERTAIN_MUTATION/);
    assert.equal(state.writes.length, writes);
  });
for (const kind of ["renewal", "renewal-payment"])
  await fixture(async ({ run, root, state }) => {
    await fs.writeFile(
      path.join(root, ".stripe-sandbox.local", `${kind}-${"a".repeat(64)}.json`),
      JSON.stringify({ state: "pending" }),
      { mode: 0o600 },
    );
    await assert.rejects(run("install-dispute"), /UNCERTAIN_MUTATION/);
    assert.equal(state.writes.length, 0);
    assert.equal((await run("status")).testAccountVerified, true);
  });
console.log(
  "PASS offline sandbox dispute: exact invoice/payment/charge provenance, isolated fixture install/restore, bounded test-only close, private journals and uncertain-outcome stop",
);
