import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sandboxRenewal } from "../../scripts/stripe-sandbox-renewal.mjs";
import { TARGET, ARTIFACT } from "../../scripts/prepare-stripe-sandbox.mjs";

async function fixture(test) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-renewal-fixture-"));
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
    await fs.mkdir(path.join(root, ".stripe-sandbox.local"), { mode: 0o700 });
    await fs.writeFile(path.join(root, ARTIFACT), JSON.stringify(record), { mode: 0o600 });
    const customer = {
      id: "cus_fixture",
      livemode: false,
      metadata: { user_id: record.userId },
      test_clock: "clock_fixture",
      invoice_settings: { default_payment_method: "pm_original" },
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
      default_payment_method: "pm_original",
      latest_invoice: "in_first",
      items: {
        has_more: false,
        data: [{ quantity: 1, price: { id: TARGET.price }, current_period_end: 2002592000 }],
      },
    };
    const clock = {
      id: "clock_fixture",
      livemode: false,
      frozen_time: 2000000000,
      status: "ready",
    };
    const invoice = {
      id: "in_first",
      customer: customer.id,
      livemode: false,
      status: "paid",
      billing_reason: "subscription_create",
      collection_method: "charge_automatically",
      currency: "usd",
      created: 2000000000,
      amount_due: 599,
      amount_remaining: 0,
      amount_paid: 599,
      total: 599,
      auto_advance: true,
      attempted: true,
      attempt_count: 1,
      parent: { type: "subscription_details", subscription_details: { subscription: sub.id } },
      lines: {
        has_more: false,
        data: [{ quantity: 1, pricing: { price_details: { price: TARGET.price } } }],
      },
    };
    const state = {
      customer,
      sub,
      clock,
      invoice,
      writes: [],
      reads: 0,
      wrongMarker: false,
      changedLink: false,
      uncertain: false,
      extra: false,
      more: false,
      wrongMethodOwner: false,
    };
    const json = (value) => new Response(JSON.stringify(value));
    const fetchImpl = async (url, init) => {
      assert.equal(init.redirect, "manual");
      assert.ok(init.signal);
      const parsed = new URL(url);
      if (parsed.origin === TARGET.supabase) {
        assert.equal(init.method, undefined, "no database/auth writes");
        if (parsed.pathname.includes("/admin/users/"))
          return json({
            id: record.userId,
            email: record.email,
            app_metadata: {
              unimate_test_marker: state.wrongMarker ? "wrong" : record.marker,
              unimate_test_nonce: record.nonce,
            },
          });
        return json([
          {
            id: record.userId,
            stripe_customer_id:
              state.changedLink && state.reads++ > 0 ? "cus_changed" : customer.id,
          },
        ]);
      }
      assert.equal(parsed.origin, "https://api.stripe.com");
      assert.equal(init.headers["Stripe-Version"], "2026-06-24.dahlia");
      if (init.method) {
        assert.equal(init.method, "POST");
        assert.match(init.headers["Idempotency-Key"], /^unimate-renewal-/);
        state.writes.push({ path: parsed.pathname, body: new URLSearchParams(init.body) });
        if (state.uncertain) throw new Error("SECRET_RAW_PROVIDER_ERROR");
        const body = new URLSearchParams(init.body);
        if (parsed.pathname.endsWith("/advance")) return json({ ...clock, status: "advancing" });
        if (parsed.pathname.endsWith("/attach")) {
          assert.equal(parsed.pathname, "/v1/payment_methods/pm_card_chargeCustomerFail/attach");
          assert.equal(body.get("customer"), customer.id);
          return json({
            id: "pm_decline",
            customer: customer.id,
            type: "card",
            livemode: false,
            card: { last4: "0341" },
          });
        }
        if (parsed.pathname === `/v1/subscriptions/${sub.id}`) {
          sub.default_payment_method = body.get("default_payment_method") || null;
          return json(sub);
        }
        if (parsed.pathname === `/v1/invoices/${invoice.id}/pay`) {
          assert.equal(body.get("payment_method"), "pm_original");
          invoice.status = "paid";
          invoice.amount_paid = 599;
          invoice.amount_remaining = 0;
          return json(invoice);
        }
        throw new Error("unexpected fixture mutation");
      }
      if (parsed.pathname === `/v1/customers/${customer.id}`) return json(customer);
      if (parsed.pathname === `/v1/test_helpers/test_clocks/${clock.id}`) return json(clock);
      if (parsed.pathname === "/v1/subscriptions")
        return json({
          data: state.extra ? [sub, { ...sub, id: "sub_extra" }] : [sub],
          has_more: state.more,
        });
      if (parsed.pathname === `/v1/subscriptions/${sub.id}`) return json(sub);
      if (parsed.pathname === `/v1/invoices/${invoice.id}`) return json(invoice);
      if (parsed.pathname.startsWith("/v1/payment_methods/"))
        return json({
          id: parsed.pathname.split("/").at(-1),
          customer: state.wrongMethodOwner ? "cus_other" : customer.id,
          type: "card",
          livemode: false,
        });
      throw new Error("unexpected fixture read");
    };
    const run = (action) =>
      sandboxRenewal({
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
    const recurring = (status) => {
      invoice.id = "in_renewal";
      sub.latest_invoice = invoice.id;
      invoice.billing_reason = "subscription_cycle";
      invoice.status = status;
      invoice.amount_remaining = status === "paid" ? 0 : 599;
      invoice.amount_paid = status === "paid" ? 599 : 0;
      invoice.created = clock.frozen_time;
    };
    await test({ state, run, root, recurring });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

await assert.rejects(sandboxRenewal({ action: "status" }), /EXPLICIT_RENEWAL_APPROVAL_REQUIRED/);
await assert.rejects(
  sandboxRenewal({ action: "arbitrary", approved: true }),
  /EXPLICIT_RENEWAL_APPROVAL_REQUIRED/,
);
await fixture(async ({ run, state }) => {
  const result = await run("status");
  assert.equal(result.clockFrozenTime, state.clock.frozen_time);
  assert.equal(result.paymentMethod, "existing");
  assert.equal(state.writes.length, 0);
  assert(
    !/cus_|sub_|pm_|sk_test_|example.test/.test(JSON.stringify(result)),
    "no private identities or keys in status",
  );
});
await fixture(async ({ run, state }) => {
  await run("advance-to-renewal");
  assert.equal(
    state.writes[0].body.get("frozen_time"),
    String(state.sub.items.data[0].current_period_end),
  );
  await assert.rejects(run("advance-to-renewal"), /ALREADY_JOURNALED/);
  assert.equal(state.writes.length, 1);
});
await fixture(async ({ run, state, recurring }) => {
  recurring("draft");
  await run("settle-renewal");
  assert.equal(state.writes[0].body.get("frozen_time"), String(state.clock.frozen_time + 3601));
});
for (const useCustomerDefault of [false, true])
  await fixture(async ({ run, state, recurring, root }) => {
    if (useCustomerDefault) state.sub.default_payment_method = null;
    await run("install-decline");
    assert.equal(state.writes.length, 2);
    assert.equal(state.sub.default_payment_method, "pm_decline");
    assert.equal((await run("status")).paymentMethod, "installed-decline");
    await assert.rejects(run("install-decline"), /ALREADY_JOURNALED/);
    state.sub.status = "past_due";
    recurring("open");
    await assert.rejects(run("pay-invoice"), /RESTORED_BOUNDED/);
    await run("restore-payment");
    assert.equal(state.sub.default_payment_method, useCustomerDefault ? null : "pm_original");
    assert.equal((await run("status")).paymentMethod, "original");
    await run("pay-invoice");
    assert.equal(state.invoice.status, "paid");
    assert.equal(state.writes.length, 4);
    await assert.rejects(run("pay-invoice"), /BOUNDED_RECURRING/);
    for (const name of await fs.readdir(path.join(root, ".stripe-sandbox.local")))
      assert.equal(
        (await fs.stat(path.join(root, ".stripe-sandbox.local", name))).mode & 0o777,
        0o600,
      );
  });
for (const modify of [
  (s) => {
    s.wrongMarker = true;
  },
  (s) => {
    s.customer.metadata.user_id = "other";
  },
  (s) => {
    s.customer.livemode = true;
  },
  (s) => {
    s.sub.items.data[0].price.id = "price_other";
  },
  (s) => {
    s.sub.items.data[0].quantity = 2;
  },
  (s) => {
    s.sub.metadata.user_id = "other";
  },
  (s) => {
    s.sub.cancel_at = s.sub.items.data[0].current_period_end;
  },
  (s) => {
    s.sub.pause_collection = {};
  },
  (s) => {
    s.extra = true;
  },
  (s) => {
    s.more = true;
  },
  (s) => {
    s.clock.status = "advancing";
  },
  (s) => {
    s.invoice.parent.subscription_details.subscription = "sub_other";
  },
  (s) => {
    s.changedLink = true;
  },
])
  await fixture(async ({ state, run }) => {
    modify(state);
    await assert.rejects(run("advance-to-renewal"));
    assert.equal(state.writes.length, 0);
  });
await fixture(async ({ state, run }) => {
  state.wrongMethodOwner = true;
  await assert.rejects(run("install-decline"), /PAYMENT_METHOD_SCOPE/);
  assert.equal(state.writes.length, 0);
});
for (const modify of [
  (s) => {
    s.invoice.auto_advance = false;
  },
  (s) => {
    s.invoice.amount_due = 600;
  },
  (s) => {
    s.invoice.currency = "eur";
  },
  (s) => {
    s.invoice.billing_reason = "manual";
  },
  (s) => {
    s.invoice.lines.has_more = true;
  },
  (s) => {
    s.invoice.lines.data[0].pricing.price_details.price = "price_other";
  },
  (s) => {
    s.invoice.created = s.clock.frozen_time - 3601;
  },
  (s) => {
    s.sub.items.data[0].current_period_end = s.clock.frozen_time + 3600;
  },
])
  await fixture(async ({ state, run, recurring }) => {
    recurring("draft");
    modify(state);
    await assert.rejects(run("settle-renewal"));
    assert.equal(state.writes.length, 0);
  });
for (const action of ["advance-to-renewal", "install-decline"])
  await fixture(async ({ state, run }) => {
    state.uncertain = true;
    await assert.rejects(
      run(action),
      (error) => error.code && !error.message.includes("SECRET_RAW"),
    );
    assert.equal(state.writes.length, 1);
    await assert.rejects(run(action), /UNCERTAIN_JOURNAL/);
    await assert.rejects(run("settle-renewal"), /UNCERTAIN_JOURNAL/);
    assert.equal((await run("status")).testAccountVerified, true);
    assert.equal(state.writes.length, 1, "unknown mutation never automatically retries");
  });
console.log(
  "PASS offline synthetic renewal helper: scoped clock steps, decline/restore/payment, identity/amount gates, private journals, no uncertain retries or secret output",
);
