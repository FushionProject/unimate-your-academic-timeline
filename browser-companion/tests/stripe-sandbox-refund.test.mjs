import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sandboxRefund } from "../../scripts/stripe-sandbox-refund.mjs";
import { TARGET, ARTIFACT } from "../../scripts/prepare-stripe-sandbox.mjs";

async function fixture(test) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-refund-fixture-"));
  try {
    const record = {
      version: 1,
      marker: "unimate-stripe-sandbox-synthetic-v1",
      userId: "10000000-0000-4000-8000-000000000001",
      nonce: "20000000-0000-4000-8000-000000000002",
      account: TARGET.account,
      price: TARGET.price,
      supabase: TARGET.supabase,
    };
    record.email = `unimate-billing-${record.nonce}@example.test`;
    const directory = path.join(root, ".stripe-sandbox.local");
    await fs.mkdir(directory, { mode: 0o700 });
    await fs.writeFile(path.join(root, ARTIFACT), JSON.stringify(record), { mode: 0o600 });
    const customer = {
      id: "cus_fixture",
      livemode: false,
      metadata: { user_id: record.userId },
      test_clock: "clock_fixture",
    };
    const sub = {
      id: "sub_fixture",
      livemode: false,
      customer: customer.id,
      metadata: { user_id: record.userId },
      status: "active",
      collection_method: "charge_automatically",
      cancel_at_period_end: false,
      cancel_at: null,
      latest_invoice: "in_renewal",
      items: { has_more: false, data: [{ quantity: 1, price: { id: TARGET.price } }] },
    };
    const invoice = {
      id: "in_renewal",
      customer: customer.id,
      livemode: false,
      status: "paid",
      billing_reason: "subscription_cycle",
      collection_method: "charge_automatically",
      currency: "usd",
      amount_due: 599,
      amount_remaining: 0,
      amount_paid: 599,
      total: 599,
      parent: { type: "subscription_details", subscription_details: { subscription: sub.id } },
      lines: {
        has_more: false,
        data: [{ quantity: 1, pricing: { price_details: { price: TARGET.price } } }],
      },
    };
    const payment = {
      id: "inpay_fixture",
      invoice: invoice.id,
      livemode: false,
      status: "paid",
      currency: "usd",
      amount_paid: 599,
      amount_requested: 599,
      payment: { type: "payment_intent", payment_intent: "pi_fixture" },
    };
    const intent = {
      id: "pi_fixture",
      customer: customer.id,
      livemode: false,
      status: "succeeded",
      currency: "usd",
      amount: 599,
      amount_received: 599,
      latest_charge: "ch_fixture",
    };
    const charge = {
      id: "ch_fixture",
      customer: customer.id,
      payment_intent: intent.id,
      livemode: false,
      status: "succeeded",
      paid: true,
      captured: true,
      disputed: false,
      currency: "usd",
      amount: 599,
      amount_captured: 599,
      amount_refunded: 0,
      refunded: false,
    };
    const state = {
      customer,
      sub,
      invoice,
      payment,
      intent,
      charge,
      clockStatus: "ready",
      writes: [],
      refunds: [],
      subMore: false,
      paymentsMore: false,
      refundsMore: false,
      extraPayment: false,
      wrongMarker: false,
      changedLink: false,
      profileReads: 0,
      uncertain: false,
      pending: false,
      wrongResult: false,
    };
    const json = (value) => new Response(JSON.stringify(value));
    const fetchImpl = async (url, init) => {
      assert.equal(init.redirect, "manual");
      assert.ok(init.signal);
      const parsed = new URL(url);
      if (parsed.origin === TARGET.supabase) {
        assert.equal(init.method, undefined, "no database or auth writes");
        if (parsed.pathname.includes("/admin/users/"))
          return json({
            id: record.userId,
            email: record.email,
            app_metadata: {
              unimate_test_marker: state.wrongMarker ? "wrong" : record.marker,
              unimate_test_nonce: record.nonce,
            },
          });
        assert.equal(parsed.pathname, "/rest/v1/profiles");
        return json([
          {
            id: record.userId,
            stripe_customer_id:
              state.changedLink && state.profileReads++ > 0 ? "cus_other" : customer.id,
          },
        ]);
      }
      assert.equal(parsed.origin, "https://api.stripe.com");
      assert.equal(init.headers["Stripe-Version"], "2026-06-24.dahlia");
      if (init.method) {
        assert.equal(init.method, "POST");
        assert.equal(parsed.pathname, "/v1/refunds", "only refund mutation permitted");
        assert.match(init.headers["Idempotency-Key"], /^unimate-refund-/);
        const body = new URLSearchParams(init.body);
        assert.deepEqual([...body.keys()].sort(), ["amount", "charge"]);
        assert.equal(body.get("charge"), charge.id);
        assert.ok(["100", "499"].includes(body.get("amount")));
        state.writes.push({
          amount: Number(body.get("amount")),
          key: init.headers["Idempotency-Key"],
        });
        if (state.uncertain) throw new Error("SECRET_RAW_PROVIDER_ERROR");
        const result = {
          id: state.refunds.length ? "re_remaining" : "re_partial",
          charge: state.wrongResult ? "ch_other" : charge.id,
          payment_intent: intent.id,
          amount: Number(body.get("amount")),
          currency: "usd",
          status: state.pending ? "pending" : "succeeded",
        };
        state.refunds.push(result);
        charge.amount_refunded += result.amount;
        charge.refunded = charge.amount_refunded === 599;
        return json(result);
      }
      if (parsed.pathname.startsWith("/v1/customers/")) return json(customer);
      if (parsed.pathname === "/v1/test_helpers/test_clocks/clock_fixture")
        return json({ id: "clock_fixture", livemode: false, status: state.clockStatus });
      if (parsed.pathname === "/v1/subscriptions")
        return json({ data: [sub], has_more: state.subMore });
      if (parsed.pathname === `/v1/subscriptions/${sub.id}`) return json(sub);
      if (parsed.pathname === `/v1/invoices/${invoice.id}`) return json(invoice);
      if (parsed.pathname === "/v1/invoice_payments") {
        assert.equal(parsed.searchParams.get("invoice"), invoice.id);
        assert.equal(parsed.searchParams.get("status"), "paid");
        return json({
          data: state.extraPayment ? [payment, payment] : [payment],
          has_more: state.paymentsMore,
        });
      }
      if (parsed.pathname === `/v1/payment_intents/${intent.id}`) return json(intent);
      if (parsed.pathname === `/v1/charges/${charge.id}`) return json(charge);
      if (parsed.pathname === "/v1/refunds") {
        assert.equal(parsed.searchParams.get("charge"), charge.id);
        return json({ data: state.refunds, has_more: state.refundsMore });
      }
      throw new Error("unexpected synthetic read");
    };
    const run = (action) =>
      sandboxRefund({
        action,
        approved: true,
        root,
        fetchImpl,
        verify: async (args) => {
          assert.equal(args.verificationOnly, true);
          return {
            supa: { SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture" },
            stripe: { STRIPE_SECRET_KEY: "sk_test_fixture" },
          };
        },
      });
    await test({ state, run, root, directory });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

await assert.rejects(sandboxRefund({ action: "status" }), /EXPLICIT_REFUND_APPROVAL_REQUIRED/);
await assert.rejects(
  sandboxRefund({ action: "refund-arbitrary", approved: true }),
  /EXPLICIT_REFUND_APPROVAL_REQUIRED/,
);
await fixture(async ({ run, state, root }) => {
  const baseline = await run("status");
  assert.equal(state.writes.length, 0);
  assert.equal(baseline.amountRefunded, 0);
  assert(
    !/cus_|sub_|in_|pi_|ch_|sk_test_|example.test/.test(JSON.stringify(baseline)),
    "safe status has no provider identities or keys",
  );
  const partial = await run("refund-partial");
  assert.equal(partial.refundAmount, 100);
  assert.equal((await fs.stat(path.join(root, partial.artifact))).mode & 0o777, 0o600);
  assert.equal((await run("status")).amountRefunded, 100);
  await assert.rejects(run("refund-partial"), /ALREADY_JOURNALED/);
  const remaining = await run("refund-remaining");
  assert.equal(remaining.refundAmount, 499);
  const final = await run("status");
  assert.equal(final.amountRefunded, 599);
  assert.equal(final.fullyRefunded, true);
  assert.equal(
    final.subscriptionStatus,
    "active",
    "refund does not invent subscription cancellation",
  );
  assert.equal(final.invoiceStatus, "paid");
  assert.equal(final.refundCount, 2);
  await assert.rejects(run("refund-remaining"), /ALREADY_JOURNALED/);
  assert.deepEqual(
    state.writes.map((write) => write.amount),
    [100, 499],
  );
});

const invalid = [
  [(s) => (s.wrongMarker = true), /IDENTITY_MISMATCH/],
  [(s) => (s.customer.livemode = true), /CUSTOMER_MISMATCH/],
  [(s) => (s.sub.status = "past_due"), /ONE_ACTIVE/],
  [(s) => (s.clockStatus = "advancing"), /READY_CLOCK/],
  [(s) => (s.subMore = true), /INCOMPLETE_SUBSCRIPTION/],
  [(s) => (s.sub.items.data[0].price.id = "price_other"), /SUBSCRIPTION_SCOPE/],
  [(s) => (s.invoice.status = "open"), /EXACT_PAID_RENEWAL/],
  [(s) => (s.invoice.billing_reason = "subscription_create"), /EXACT_PAID_RENEWAL/],
  [(s) => (s.invoice.livemode = true), /EXACT_PAID_RENEWAL/],
  [(s) => (s.invoice.amount_paid = 598), /EXACT_PAID_RENEWAL/],
  [(s) => (s.invoice.parent.subscription_details.subscription = "sub_other"), /EXACT_PAID_RENEWAL/],
  [(s) => (s.invoice.lines.has_more = true), /EXACT_PAID_RENEWAL/],
  [(s) => (s.extraPayment = true), /ONE_COMPLETE_INVOICE_PAYMENT/],
  [(s) => (s.paymentsMore = true), /ONE_COMPLETE_INVOICE_PAYMENT/],
  [(s) => (s.payment.livemode = true), /INVOICE_PAYMENT_SCOPE/],
  [(s) => (s.payment.invoice = "in_other"), /INVOICE_PAYMENT_SCOPE/],
  [(s) => (s.payment.payment.type = "payment_record"), /INVOICE_PAYMENT_SCOPE/],
  [(s) => (s.intent.customer = "cus_other"), /PAYMENT_INTENT_SCOPE/],
  [(s) => (s.intent.livemode = true), /PAYMENT_INTENT_SCOPE/],
  [(s) => (s.intent.status = "processing"), /PAYMENT_INTENT_SCOPE/],
  [(s) => (s.intent.amount_received = 600), /PAYMENT_INTENT_SCOPE/],
  [(s) => (s.charge.livemode = true), /TEST_CHARGE/],
  [(s) => (s.charge.disputed = true), /TEST_CHARGE/],
  [(s) => (s.charge.captured = false), /TEST_CHARGE/],
  [(s) => (s.charge.amount_captured = 598), /TEST_CHARGE/],
  [(s) => (s.charge.customer = "cus_other"), /TEST_CHARGE/],
  [(s) => (s.charge.payment_intent = "pi_other"), /TEST_CHARGE/],
  [(s) => (s.charge.currency = "eur"), /TEST_CHARGE/],
  [(s) => (s.refundsMore = true), /COMPLETE_SCOPED_REFUND_LIST/],
  [(s) => (s.charge.amount_refunded = 100), /UNREFUNDED_CHARGE/],
];
for (const [modify, expected] of invalid)
  await fixture(async ({ state, run }) => {
    modify(state);
    await assert.rejects(run("refund-partial"), expected);
    assert.equal(state.writes.length, 0);
  });

await fixture(async ({ run, state }) => {
  await assert.rejects(run("refund-remaining"), /VERIFIED_PARTIAL/);
  assert.equal(state.writes.length, 0);
});
await fixture(async ({ run, state, directory }) => {
  state.changedLink = true;
  await assert.rejects(run("refund-partial"), /CUSTOMER_MISMATCH/);
  assert.equal(state.writes.length, 0, "immediate identity recheck precedes the only POST");
  assert(
    (await fs.readdir(directory)).some(
      (file) => file.startsWith("refund-") && file.endsWith(".json"),
    ),
  );
});
for (const failure of ["uncertain", "pending", "wrongResult"])
  await fixture(async ({ run, state, directory }) => {
    state[failure] = true;
    await assert.rejects(
      run("refund-partial"),
      failure === "uncertain" ? /REMOTE_REQUEST_FAILED/ : /REFUND_NOT_CONFIRMED/,
    );
    const file = (await fs.readdir(directory)).find(
      (name) => name.startsWith("refund-") && name.endsWith(".json"),
    );
    const journal = JSON.parse(await fs.readFile(path.join(directory, file), "utf8"));
    assert.equal(journal.state, "pending");
    state[failure] = false;
    if (failure === "wrongResult") state.refunds[0].charge = state.charge.id;
    assert.equal((await run("status")).pendingRefundJournals, 1);
    await assert.rejects(run("refund-partial"), /PENDING_OUTCOME/);
    await assert.rejects(run("refund-remaining"), /PENDING_OUTCOME/);
    assert.equal(state.writes.length, 1, "uncertain outcome never retries or completes remainder");
  });
await fixture(async ({ run, state }) => {
  state.uncertain = true;
  await assert.rejects(run("refund-partial"), /REMOTE_REQUEST_FAILED/);
  state.uncertain = false;
  state.invoice.id = "in_later";
  state.sub.latest_invoice = state.invoice.id;
  state.payment.invoice = state.invoice.id;
  state.intent.id = "pi_later";
  state.payment.payment.payment_intent = state.intent.id;
  state.charge.id = "ch_later";
  state.intent.latest_charge = state.charge.id;
  state.charge.payment_intent = state.intent.id;
  const status = await run("status");
  assert.equal(status.partialJournalState, null, "later invoice has no per-charge journal");
  assert.equal(status.pendingRefundJournals, 1, "status exposes earlier uncertainty safely");
  await assert.rejects(run("refund-partial"), /PENDING_OUTCOME/);
  await assert.rejects(run("refund-remaining"), /PENDING_OUTCOME/);
  assert.equal(state.writes.length, 1, "a later paid renewal cannot bypass pending refunds");
});
await fixture(async ({ run, state, root }) => {
  const partial = await run("refund-partial");
  await fs.unlink(path.join(root, partial.artifact));
  await assert.rejects(run("refund-remaining"), /VERIFIED_PARTIAL/);
  assert.equal(state.writes.length, 1, "external partial refund cannot authorize the remainder");
});
await fixture(async ({ run, state, directory }) => {
  await fs.writeFile(path.join(directory, "refund-operation.lock"), "", { mode: 0o600 });
  await assert.rejects(run("refund-partial"), /REFUND_OPERATION_LOCKED/);
  assert.equal(state.writes.length, 0);
});
await fixture(async ({ run, state, directory }) => {
  await fs.chmod(directory, 0o755);
  await assert.rejects(run("refund-partial"), /PRIVATE_DIRECTORY_REQUIRED/);
  assert.equal(state.writes.length, 0);
});

console.log(
  "PASS fixed sandbox refunds: modern payment graph,100+499,scope guards,private journals,no retries",
);
