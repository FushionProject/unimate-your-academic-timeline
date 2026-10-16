import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  assertRecoveryStart,
  assertRecoveryDeployment,
  assertRecoverySnapshotLists,
  parseRecoveryCommand,
  recoveryErrorCode,
  recoveryRouteDecision,
  verifyRecoveryWarning,
  verifySavedTestMethod,
  createRecoveryController,
  createRecoveryJournal,
  runProtectedBillingRecovery,
  RECOVERY_JOURNAL,
  verifyUnpaidRecoveryResume,
  selectObservedRecoveryCard,
  observedRecoveryCard,
  assertNoRecoveryPaymentClaim,
  createRecoveryReconciliationFence,
} from "../../scripts/run-protected-billing-recovery.mjs";
import {
  PROTECTED_BILLING_RECOVERY as C,
  verifyRecoveryBaseline,
} from "../../scripts/protected-billing-recovery-policy.mjs";
import { TARGET, SetupError } from "../../scripts/prepare-stripe-sandbox.mjs";

// Import and rejected invocation must not read credentials or contact services.
await assert.rejects(runProtectedBillingRecovery(), /RECOVERY_EXPLICIT_PRIVATE_APPROVAL_REQUIRED/);
assertRecoveryStart({ approved: true, env: {} });
for (const key of ["DEBUG", "PWDEBUG", "NODE_OPTIONS", "NODE_INSPECT_RESUME_ON_START"])
  assert.throws(() => assertRecoveryStart({ approved: true, env: { [key]: "1" } }));
for (const value of [
  null,
  "",
  "eval alert(1)",
  "CHECKOUT https://other.test",
  "PAY_SUBMIT\nSTATUS",
  "A".repeat(81),
  "PORTAL_CLICK",
])
  assert.equal(parseRecoveryCommand(value), null);
assert.equal(parseRecoveryCommand(" STATUS "), "STATUS");
assert.equal(
  recoveryErrorCode(new Error("sk_test_secret https://private.test")),
  "RECOVERY_STOP_AND_RECONCILE",
);
assert.equal(
  recoveryErrorCode(new SetupError("RECOVERY_FIXED_COMMAND_REQUIRED")),
  "RECOVERY_FIXED_COMMAND_REQUIRED",
);
assert.equal(
  recoveryErrorCode(new SetupError("RECOVERY_sk_test_secret")),
  "RECOVERY_STOP_AND_RECONCILE",
);
const deployment = {
  meta: { githubCommitSha: C.source },
  alias: [],
  target: null,
  readyState: "READY",
  env: ["STRIPE_SECRET_KEY"],
};
{
  const fence = createRecoveryReconciliationFence();
  const first = {},
    second = {},
    unrelated = {};
  fence.assertSettled();
  fence.started(first);
  fence.started(second);
  assert.throws(fence.assertSettled, /RECONCILIATION_IN_FLIGHT/);
  fence.finished(first);
  fence.failed(unrelated);
  assert.throws(fence.assertSettled, /RECONCILIATION_IN_FLIGHT/);
  fence.finished(second);
  fence.assertSettled();
  fence.started(first);
  fence.failed(first);
  fence.finished(first);
  assert.throws(fence.assertSettled, /RECONCILIATION_OUTCOME_UNCERTAIN/);
}
assert.deepEqual(assertRecoveryDeployment(deployment), { graceEnabled: true });
for (const mutate of [
  (d) => (d.meta.githubCommitSha = "other"),
  (d) => d.alias.push("example.test"),
  (d) => (d.target = "production"),
  (d) => delete d.env,
  (d) => d.env.push("STRIPE_PAST_DUE_GRACE_ENABLED"),
  (d) => d.env.push({ key: "SECRET", value: "hidden" }),
]) {
  const bad = structuredClone(deployment);
  mutate(bad);
  assert.throws(() => assertRecoveryDeployment(bad));
}
for (const [pathname, method, navigation, held, expected] of [
  ["/api/dashboard-ai", "POST", false, false, "block"],
  ["/api/analyze-screenshot", "POST", false, true, "block"],
  ["/api/billing-status?reconcile=true", "GET", false, true, "read-only-status"],
  ["/api/billing-status", "POST", false, true, "block"],
  ["/upgrade?success=true", "GET", true, true, "hold-return"],
  ["/upgrade", "GET", true, false, "pass"],
  ["/api/create-portal-session", "POST", false, true, "pass"],
])
  assert.equal(
    recoveryRouteDecision({ url: C.origin + pathname, method, navigation }, held),
    expected,
  );
assert.equal(
  recoveryRouteDecision(
    { url: `${C.origin}/api/billing-status`, method: "GET", navigation: false },
    false,
    true,
  ),
  "read-only-status",
);
assert.equal(
  recoveryRouteDecision(
    { url: `${C.origin}/upgrade`, method: "GET", navigation: true },
    false,
    true,
  ),
  "pass",
);

function harness(options = {}) {
  let time = 1800000000000;
  const userId = "10000000-0000-4000-8000-000000000001",
    nonce = "20000000-0000-4000-8000-000000000002";
  const record = {
    version: 1,
    marker: "unimate-stripe-sandbox-synthetic-v1",
    account: C.account,
    price: C.price,
    supabase: TARGET.supabase,
    userId,
    nonce,
    email: `unimate-billing-${nonce}@example.test`,
  };
  const sub = (id, status) => ({
    id,
    status,
    livemode: false,
    customer: C.customer,
    metadata: { user_id: userId },
    items: {
      has_more: false,
      data: [{ price: C.price, quantity: 1, current_period_end: 1805000000 }],
    },
    collection_method: "charge_automatically",
    cancel_at_period_end: false,
    cancel_at: null,
    default_payment_method: "pm_original",
    latest_invoice: "in_initial",
  });
  const state = {
    origin: C.origin,
    source: C.source,
    record,
    user: {
      id: userId,
      email: record.email,
      app_metadata: { unimate_test_marker: record.marker, unimate_test_nonce: nonce },
    },
    customer: {
      id: C.customer,
      livemode: false,
      metadata: { user_id: userId },
      test_clock: "clock_fixture",
      invoice_settings: { default_payment_method: "pm_original" },
    },
    clock: { id: "clock_fixture", livemode: false, status: "ready", frozen_time: 1800000000 },
    profile: { id: userId, stripe_customer_id: C.customer, is_pro: false, billing_revision: 62 },
    subscriptions: { data: C.baseline.map((id) => sub(id, "canceled")), has_more: false },
    openCheckouts: { data: [], has_more: false },
    journalHashes: { ...C.journalHashes },
    observedAt: time,
  };
  const session = {
    id: "cs_test_fixture",
    url: "https://checkout.stripe.com/c/pay/cs_test_fixture",
    livemode: false,
    customer: C.customer,
    metadata: { user_id: userId },
    client_reference_id: userId,
    mode: "subscription",
    status: "open",
    payment_status: "unpaid",
    subscription: null,
    amount_total: 599,
    currency: "usd",
  };
  const item = {
    has_more: false,
    data: [{ price: C.price, quantity: 1, amount_total: 599, currency: "usd" }],
  };
  let invoice = {
    object: "invoice",
    id: "in_initial",
    livemode: false,
    customer: C.customer,
    status: "paid",
    billing_reason: "subscription_create",
    collection_method: "charge_automatically",
    currency: "usd",
    amount_due: 599,
    total: 599,
    amount_remaining: 0,
    amount_paid: 599,
    attempted: true,
    attempt_count: 1,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: "sub_recovery" },
    },
    lines: {
      has_more: false,
      data: [{ quantity: 1, pricing: { price_details: { price: C.price } } }],
    },
  };
  let method = {
    id: "pm_original",
    customer: C.customer,
    livemode: false,
    type: "card",
    card: { last4: "4242" },
  };
  const portal = {
    id: "bps_fixture",
    livemode: false,
    customer: C.customer,
    return_url: `${C.origin}/upgrade`,
    url: "https://billing.stripe.com/p/session/test_fixture",
  };
  const trace = [],
    journals = [],
    counts = { click: 0, pay: 0, warning: 0 };
  let url = `${C.origin}/upgrade`,
    eventType = "invoice.paid",
    eventId = "evt_purchase",
    held = false;
  const now = () => (time += 1000);
  const page = {
    url: () => url,
    waitForURL: async (predicate) => assert.ok(predicate(new URL(url))),
    goto: async (value) => {
      trace.push("goto");
      url = value;
      if (options.reconcileOnReturn && value === `${C.origin}/upgrade`)
        state.profile.billing_revision++;
    },
    getByRole: (_role, { name }) => ({
      waitFor: async () => {},
      count: async () => 1,
      isVisible: async () => true,
      isEnabled: async () => true,
      click: async () => {
        counts.click++;
        trace.push("click");
        if (options.clickFails) throw new Error("private url secret");
        if (name === "Manage billing") url = portal.url;
        else {
          url = `https://checkout.stripe.com/c/pay/${session.id}`;
          state.openCheckouts.data = [session];
        }
      },
    }),
  };
  const stripe = async (endpoint) => {
    trace.push("read");
    if (endpoint.endsWith("/line_items?limit=100")) return structuredClone(item);
    if (endpoint.startsWith("/checkout/sessions/")) return structuredClone(session);
    if (endpoint.startsWith("/invoices/")) return structuredClone(invoice);
    if (endpoint.startsWith("/payment_methods/")) return structuredClone(method);
    if (endpoint.startsWith("/invoice_payments?"))
      return {
        has_more: false,
        data: [
          {
            object: "invoice_payment",
            id: "inpay_fixture",
            livemode: false,
            invoice: "in_renewal",
            status: "paid",
            amount_paid: 599,
            amount_requested: 599,
            currency: "usd",
            payment: { type: "payment_intent", payment_intent: "pi_fixture" },
          },
        ],
      };
    if (endpoint.startsWith("/payment_intents/"))
      return {
        id: "pi_fixture",
        livemode: false,
        customer: C.customer,
        status: "succeeded",
        amount: 599,
        amount_received: 599,
        currency: "usd",
        payment_method: "pm_portalnew",
      };
    if (endpoint.startsWith("/events?"))
      return {
        has_more: false,
        data: [
          {
            id: "evt_portal",
            type: "billing_portal.session.created",
            livemode: false,
            created: Math.floor(journals.at(-1).portalAttemptedAt / 1000),
            data: { object: portal },
          },
        ],
      };
    throw new Error("Unexpected fixture endpoint");
  };
  const purchased = () => {
    state.profile.is_pro = true;
    state.profile.billing_revision = 65;
    state.subscriptions.data.push(sub("sub_recovery", "active"));
    state.openCheckouts.data = [];
    Object.assign(session, {
      status: "complete",
      payment_status: "paid",
      subscription: "sub_recovery",
    });
  };
  const controller = createRecoveryController({
    record,
    baseline: options.resumeJournal?.baseline || verifyRecoveryBaseline(state),
    resumeJournal: options.resumeJournal,
    graceVerified: true,
    snapshot: async () => {
      trace.push("snapshot");
      state.observedAt = now();
      return structuredClone(state);
    },
    stripe,
    deliveredEvents: async () => {
      trace.push("proof");
      return {
        deliveries: options.noDelivery
          ? []
          : [{ eventId, eventType, httpStatus: 200, at: time - 1 }],
        events: [
          {
            id: eventId,
            type: eventType,
            livemode: false,
            data: {
              object: structuredClone(
                eventType === "customer.subscription.deleted"
                  ? { ...state.subscriptions.data.at(-1), object: "subscription" }
                  : invoice,
              ),
            },
          },
        ],
      };
    },
    page,
    hold: (value) => {
      held = value;
      trace.push(`hold:${value}`);
    },
    now,
    persist: async (value) => {
      if (options.saveFails) throw new Error("write failed");
      journals.push(structuredClone(value));
      trace.push(`persist:${value.phase}`);
    },
    submitPayment: async () => {
      counts.pay++;
      trace.push("pay");
      if (options.payFails) throw new Error("uncertain submission");
      purchased();
    },
    savedMethodReady: async () => {
      if (options.savedMethodMissing) throw new Error("not a saved method");
      trace.push("saved-method-ready");
    },
    fillCard: async () => {
      trace.push("fill-card");
      if (options.fillFails) throw new Error("form changed");
    },
    submitCard: async () => {
      counts.pay++;
      trace.push("submit-card");
      purchased();
    },
    inspectSurface: async () => ({ inspectionOnly: true, surface: "stripe-portal" }),
    inspectFields: async () => ({ inspectionOnly: true, frames: [] }),
    inspectCard: async () => ({
      surface: "stripe-checkout",
      inspectionOnly: true,
      truncated: Boolean(options.structureInvalid),
      matches: [
        {
          text: "Card",
          ancestors: [
            { id: "payment-method-label-card", visible: true },
            { classes: ["card-accordion-item-cover"], visible: true },
          ],
        },
      ],
    }),
    selectCard: async () => {
      trace.push("select-card");
      if (options.selectFails) throw new Error("selection uncertain");
    },
    inspectWarning: async () => {
      counts.warning++;
      trace.push("warning");
      return !options.warningMissing;
    },
    assertReconciliationSettled: () => {
      assert.equal(held, true);
      if (options.reconciliationInFlight) throw new SetupError("RECOVERY_RECONCILIATION_IN_FLIGHT");
    },
    loadPortalHelper: async () => {
      trace.push("load-fixed-helper");
      if (!options.portalHelper) throw new Error("reviewed helper missing");
      return {
        updateVerifiedRecoveryPaymentMethod: async ({ portal: verified, claimUpdate }) => {
          assert.equal(verified.id, portal.id);
          await claimUpdate();
          trace.push("portal-update");
          if (options.portalFails) throw new Error("uncertain update");
          if (!options.noRecoveryRevision) state.profile.billing_revision = 72;
          Object.assign(state.subscriptions.data.at(-1), {
            status: "active",
            default_payment_method: "pm_portalnew",
          });
          method = { ...method, id: "pm_portalnew", card: { last4: "4242" } };
          invoice = { ...invoice, status: "paid", amount_paid: 599, amount_remaining: 0 };
          eventType = "invoice.paid";
          eventId = "evt_recovered";
        },
      };
    },
    companion: Object.fromEntries(
      ["expectPro", "expectRecoveryPro", "expectRecoveredPro", "expectRevoked"].map((method) => [
        method,
        async (proof) => {
          trace.push(method);
          return { phase: proof.phase };
        },
      ]),
    ),
  });
  if (options.resumeJournal) {
    state.openCheckouts.data = [session];
    url = session.url;
  }
  return {
    controller,
    state,
    record,
    session,
    item,
    trace,
    counts,
    journals,
    held: () => held,
    failRenewal: () => {
      if (!options.noFailureRevision) state.profile.billing_revision = 68;
      Object.assign(state.subscriptions.data.at(-1), {
        status: "past_due",
        latest_invoice: "in_renewal",
        default_payment_method: "pm_decline",
      });
      method = { ...method, id: "pm_decline", card: { last4: "0341" } };
      invoice = {
        ...invoice,
        id: "in_renewal",
        status: "open",
        billing_reason: "subscription_cycle",
        amount_paid: 0,
        amount_remaining: 599,
      };
      eventType = "invoice.payment_failed";
      eventId = "evt_failure";
    },
    revoke: () => {
      state.profile.billing_revision = 75;
      state.profile.is_pro = false;
      state.subscriptions.data.at(-1).status = "canceled";
      eventType = "customer.subscription.deleted";
      eventId = "evt_revoked";
    },
  };
}

const purchase = async (h) => {
  await h.controller.run("CHECKOUT");
  await h.controller.run("PAY_SUBMIT");
  await h.controller.run("EXPECT_PRO");
};
{
  const h = harness();
  await h.controller.run("CHECKOUT");
  const original = structuredClone(h.journals.at(-1));
  const input = {
    journal: original,
    record: h.record,
    state: h.state,
    session: h.session,
    items: h.item,
  };
  assert.equal(verifyUnpaidRecoveryResume(input).checkoutUrl, h.session.url);
  for (const mutate of [
    (x) => (x.journal.paymentAttempted = true),
    (x) => (x.journal.cardFillAttempted = true),
    (x) => (x.journal.cardSelectAttempted = true),
    (x) => (x.journal.resumedFrom = {}),
    (x) => (x.journal.phase = "payment-pending"),
    (x) => (x.journal.origin = "https://other.vercel.app"),
    (x) => (x.journal.baseline.billingRevision = 63),
    (x) => (x.state.profile.billing_revision = 63),
    (x) => (x.state.profile.is_pro = true),
    (x) => x.state.openCheckouts.data.push(structuredClone(x.session)),
    (x) => (x.state.subscriptions.data[0].status = "active"),
    (x) => (x.state.clock.status = "advancing"),
    (x) => (x.state.clock.id = "clock_other"),
    (x) => (x.session.livemode = true),
    (x) => (x.session.payment_status = "paid"),
    (x) => (x.session.customer = "cus_other"),
    (x) => (x.session.payment_intent = "pi_attempted"),
    (x) => (x.session.url = "https://other.test/cs_test_fixture"),
    (x) => (x.items.data[0].price = "price_other"),
  ]) {
    const bad = structuredClone(input);
    mutate(bad);
    assert.throws(() => verifyUnpaidRecoveryResume(bad));
  }
  const resumeJournal = {
    ...original,
    resumedFrom: {
      newCompanionSession: true,
      journalSha256: "a".repeat(64),
      phase: "checkout-verified",
      at: 1800000020000,
    },
  };
  const resumed = harness({ resumeJournal });
  assert.equal(resumed.held(), true);
  assert.deepEqual(resumed.controller.initialJournal(), resumeJournal);
  await assert.rejects(resumed.controller.run("CHECKOUT"));
  await assert.rejects(resumed.controller.run("SELECT_CARD"));
  assert.equal((await resumed.controller.run("INSPECT_CHECKOUT")).selectionAvailable, true);
  await resumed.controller.run("SELECT_CARD");
  assert.ok(
    resumed.trace.indexOf("persist:card-select-pending") < resumed.trace.indexOf("select-card"),
  );
  await assert.rejects(resumed.controller.run("SELECT_CARD"));
  await resumed.controller.run("PAY_CARD_FILL");
  await resumed.controller.run("PAY_CARD_SUBMIT");
  await resumed.controller.run("EXPECT_PRO");
  assert.equal(resumed.counts.click, 0, "Resume never creates another Checkout");
  assert.equal(resumed.counts.pay, 1);
  assert.deepEqual(resumed.journals.at(-1).resumedFrom, resumeJournal.resumedFrom);
}
for (const options of [{ structureInvalid: true }, { selectFails: true }]) {
  const h = harness(options);
  await h.controller.run("CHECKOUT");
  await h.controller.run("INSPECT_CHECKOUT");
  await assert.rejects(h.controller.run("SELECT_CARD"));
  assert.equal((await h.controller.run("STATUS")).uncertain, Boolean(options.selectFails));
  if (options.selectFails) await assert.rejects(h.controller.run("SELECT_CARD"));
  assert.equal(h.counts.pay, 0);
}
{
  let clicked = 0;
  const card = {
    count: async () => 1,
    isVisible: async () => true,
    isEnabled: async () => true,
    locator: (selector) => {
      assert.equal(selector, "#payment-method-label-card");
      return { count: async () => 1 };
    },
    click: async () => clicked++,
  };
  const page = {
    url: () => "https://checkout.stripe.com/c/pay/cs_test_fixture",
    locator: (selector) => {
      assert.equal(selector, ".card-accordion-item-cover");
      return card;
    },
  };
  await selectObservedRecoveryCard({ page, sessionId: "cs_test_fixture" });
  assert.equal(clicked, 1);
  card.isVisible = async () => false;
  await assert.rejects(selectObservedRecoveryCard({ page, sessionId: "cs_test_fixture" }));
  assert.equal(clicked, 1);
  assert.equal(
    observedRecoveryCard({
      surface: "stripe-checkout",
      inspectionOnly: true,
      truncated: false,
      matches: [],
    }),
    false,
  );
}
{
  const h = harness();
  await h.controller.run("STATUS");
  assert.equal(h.counts.click, 0);
  assert.equal(h.journals.length, 0);
  await assert.rejects(h.controller.run("RETURN"));
  await purchase(h);
  assert.ok(h.trace.indexOf("persist:checkout-pending") < h.trace.indexOf("click"));
  assert.ok(h.trace.indexOf("persist:payment-pending") < h.trace.indexOf("pay"));
  await assert.rejects(h.controller.run("PAY_SUBMIT"));
  await h.controller.run("RETURN");
  assert.equal(h.held(), false);
  await h.controller.run("ARM_RENEWAL");
  h.failRenewal();
  await h.controller.run("EXPECT_PAST_DUE");
  await assert.rejects(h.controller.run("PORTAL"), /RECOVERY_PAYMENT_WARNING_REQUIRED/);
  const start = h.trace.length;
  assert.equal((await h.controller.run("RETURN")).paymentWarningVerified, true);
  const flow = h.trace.slice(start);
  assert.ok(flow.indexOf("proof") < flow.indexOf("hold:false"));
  assert.ok(flow.indexOf("hold:false") < flow.indexOf("goto"));
  assert.ok(flow.indexOf("goto") < flow.indexOf("warning"));
  await h.controller.run("PORTAL");
  assert.equal(h.held(), true);
  await h.controller.run("ARM_PORTAL_UPDATE");
  await assert.rejects(h.controller.run("PORTAL_UPDATE"));
  assert.equal(h.journals.at(-1).phase, "portal-update-armed");
  assert.equal(h.journals.at(-1).portalUpdateAttempted, undefined);
  assert.equal((await h.controller.run("INSPECT_STRIPE")).inspectionOnly, true);
  assert.equal(h.counts.click, 2);
  assert.equal(h.counts.pay, 1);
  await assert.rejects(h.controller.run("PORTAL"));
  await assert.rejects(h.controller.run("EXPECT_RECOVERED"));
  assert.ok(!JSON.stringify(h.journals).includes("https://billing.stripe.com"));
}
{
  // Website reconciliation happens before the action; its increment is not
  // evidence that the later delivered webhook persisted the new billing state.
  const options = {
    portalHelper: true,
    reconcileOnReturn: true,
    noFailureRevision: true,
    noRecoveryRevision: true,
    reconciliationInFlight: true,
  };
  const h = harness(options);
  await purchase(h);
  await h.controller.run("RETURN");
  assert.equal(h.state.profile.billing_revision, 66);
  await assert.rejects(h.controller.run("ARM_RENEWAL"), /RECONCILIATION_IN_FLIGHT/);
  assert.equal(h.journals.at(-1).renewalArmedAt, undefined);
  options.reconciliationInFlight = false;
  await h.controller.run("ARM_RENEWAL");
  assert.equal(h.journals.at(-1).renewalBillingRevision, 66);
  h.failRenewal();
  await assert.rejects(h.controller.run("EXPECT_PAST_DUE"), /RECOVERY_ACTION_REVISION_REQUIRED/);
  assert.equal(h.trace.includes("expectRecoveryPro"), false);
  h.state.profile.billing_revision = 68;
  await h.controller.run("EXPECT_PAST_DUE");
  await h.controller.run("RETURN");
  assert.equal(h.state.profile.billing_revision, 69);
  await h.controller.run("PORTAL");
  await h.controller.run("ARM_PORTAL_UPDATE");
  const armedAt = h.journals.at(-1).portalUpdateArmedAt;
  assert.equal(h.journals.at(-1).portalUpdateBillingRevision, undefined);
  // A harmless late billing change during inspection must be included in the
  // claim-time boundary, not mistaken for evidence from the Portal update.
  h.state.profile.billing_revision = 70;
  await h.controller.run("PORTAL_UPDATE");
  assert.equal(h.journals.at(-1).portalUpdateBillingRevision, 70);
  assert.ok(h.journals.at(-1).portalUpdateClaimedAt > armedAt);
  await assert.rejects(h.controller.run("EXPECT_RECOVERED"), /RECOVERY_ACTION_REVISION_REQUIRED/);
  assert.equal(h.trace.includes("expectRecoveredPro"), false);
  h.state.profile.billing_revision = 71;
  await h.controller.run("EXPECT_RECOVERED");
  assert.equal(h.journals.at(-1).completion.actionBillingRevision, 70);
}
for (const uncertain of [false, true]) {
  const h = harness({ portalHelper: true, portalFails: uncertain });
  await purchase(h);
  await h.controller.run("RETURN");
  await h.controller.run("ARM_RENEWAL");
  h.failRenewal();
  await h.controller.run("EXPECT_PAST_DUE");
  await h.controller.run("RETURN");
  await h.controller.run("PORTAL");
  await h.controller.run("ARM_PORTAL_UPDATE");
  if (uncertain) {
    await assert.rejects(h.controller.run("PORTAL_UPDATE"));
    assert.equal((await h.controller.run("STATUS")).uncertain, true);
    await assert.rejects(h.controller.run("PORTAL_UPDATE"));
  } else {
    await h.controller.run("PORTAL_UPDATE");
    assert.ok(h.trace.indexOf("persist:portal-update-pending") < h.trace.indexOf("portal-update"));
    await assert.rejects(h.controller.run("PORTAL_UPDATE"));
    await h.controller.run("EXPECT_RECOVERED");
    await h.controller.run("RETURN");
    await h.controller.run("ARM_REVOCATION");
    h.revoke();
    await h.controller.run("EXPECT_REVOKED");
    await h.controller.run("RETURN");
    assert.equal(h.journals.at(-1).phase, "revoked");
    assert.equal(h.counts.pay, 1);
  }
}
for (const option of ["clickFails", "payFails"]) {
  const h = harness({ [option]: true });
  if (option === "payFails") await h.controller.run("CHECKOUT");
  await assert.rejects(h.controller.run(option === "clickFails" ? "CHECKOUT" : "PAY_SUBMIT"));
  assert.equal((await h.controller.run("STATUS")).uncertain, true);
  await assert.rejects(h.controller.run("CHECKOUT"), /RECOVERY_UNCERTAIN_ACTION_NO_RETRY/);
  await assert.rejects(h.controller.run("PAY_SUBMIT"), /RECOVERY_UNCERTAIN_ACTION_NO_RETRY/);
  await h.controller.run("INSPECT_STRIPE");
}
{
  const h = harness();
  await h.controller.run("CHECKOUT");
  await assert.rejects(h.controller.run("PAY_CARD_SUBMIT"));
  await h.controller.run("PAY_CARD_FILL");
  assert.ok(h.trace.indexOf("persist:card-fill-pending") < h.trace.indexOf("fill-card"));
  await assert.rejects(h.controller.run("PAY_CARD_FILL"));
  await assert.rejects(h.controller.run("PAY_SUBMIT"));
  await h.controller.run("PAY_CARD_SUBMIT");
  await h.controller.run("EXPECT_PRO");
  assert.ok(h.trace.indexOf("persist:payment-pending") < h.trace.indexOf("submit-card"));
  assert.equal(h.counts.pay, 1);
  await assert.rejects(h.controller.run("PAY_CARD_SUBMIT"));
}
{
  const h = harness({ savedMethodMissing: true });
  await h.controller.run("CHECKOUT");
  await assert.rejects(h.controller.run("PAY_SUBMIT"));
  assert.equal(h.counts.pay, 0);
  assert.equal(h.journals.at(-1).phase, "checkout-verified");
}
{
  const h = harness({ fillFails: true });
  await h.controller.run("CHECKOUT");
  await assert.rejects(h.controller.run("PAY_CARD_FILL"));
  assert.equal((await h.controller.run("STATUS")).uncertain, true);
  await assert.rejects(h.controller.run("PAY_CARD_FILL"));
  assert.equal(h.counts.pay, 0);
}
{
  const page = {
    getByText: (expression) => {
      assert.equal(expression.test("Visa •••• 4242"), true);
      return { count: async () => 1, isVisible: async () => true };
    },
  };
  await verifySavedTestMethod(page, async () => ({
    surface: "stripe-checkout",
    inputs: [],
    truncated: false,
  }));
  await assert.rejects(
    verifySavedTestMethod(page, async () => ({
      surface: "stripe-checkout",
      truncated: false,
      inputs: [{ visible: true, id: "cardNumber", labels: [] }],
    })),
  );
  await assert.rejects(
    verifySavedTestMethod(page, async () => ({
      surface: "stripe-checkout",
      inputs: [],
      truncated: true,
    })),
  );
}
{
  const h = harness({ saveFails: true });
  await assert.rejects(h.controller.run("CHECKOUT"));
  assert.equal(h.counts.click, 0);
}
{
  const h = harness({ noDelivery: true });
  await h.controller.run("CHECKOUT");
  await h.controller.run("PAY_SUBMIT");
  await assert.rejects(h.controller.run("EXPECT_PRO"), /RECOVERY_HOSTED_PURCHASE_REQUIRED/);
  await assert.rejects(h.controller.run("RETURN"));
  assert.ok(!h.trace.includes("goto"));
}
{
  const h = harness({ warningMissing: true });
  await purchase(h);
  await h.controller.run("RETURN");
  await h.controller.run("ARM_RENEWAL");
  h.failRenewal();
  await h.controller.run("EXPECT_PAST_DUE");
  await assert.rejects(h.controller.run("RETURN"), /RECOVERY_PAYMENT_WARNING_REQUIRED/);
  assert.equal(h.held(), true);
  await assert.rejects(h.controller.run("PORTAL"));
}
for (const mutate of [
  (h) => (h.session.livemode = true),
  (h) => (h.session.customer = "cus_wrong"),
  (h) => (h.item.data[0].price = "price_wrong"),
  (h) => (h.state.openCheckouts.has_more = true),
  (h) => (h.state.user.app_metadata.unimate_test_nonce = "wrong"),
]) {
  const h = harness();
  await h.controller.run("CHECKOUT");
  mutate(h);
  await assert.rejects(h.controller.run("PAY_SUBMIT"));
  assert.equal(h.counts.pay, 0);
}
{
  const h = harness();
  h.state.subscriptions.has_more = true;
  assert.throws(() => assertRecoverySnapshotLists(h.state, h.record));
  await assert.rejects(h.controller.run("CHECKOUT"));
  assert.equal(h.counts.click, 0);
}
{
  let seen;
  assert.equal(
    await verifyRecoveryWarning({
      getByText: (text, options) => {
        seen = { text, options };
        return { waitFor: async () => {}, count: async () => 1, isVisible: async () => true };
      },
    }),
    true,
  );
  assert.equal(seen.options.exact, true);
  assert.match(seen.text, /latest payment failed/);
}
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-recovery-offline-"));
try {
  await fs.chmod(directory, 0o700);
  const sessionId = "cs_test_resumeFixture";
  await assertNoRecoveryPaymentClaim(directory, sessionId);
  await assert.rejects(assertNoRecoveryPaymentClaim(directory, "cs_live_wrong"));
  const claimHash = createHash("sha256").update(sessionId).digest("hex");
  await fs.writeFile(path.join(directory, `payment-submit-${claimHash}.json`), "claimed", {
    mode: 0o600,
  });
  await assert.rejects(
    assertNoRecoveryPaymentClaim(directory, sessionId),
    /RECOVERY_PRIOR_PAYMENT_CLAIM_PRESENT/,
  );
  await fs.writeFile(path.join(directory, "protected-billing-checkout-v1.json"), "old-v1", {
    mode: 0o600,
  });
  await fs.writeFile(path.join(directory, "protected-billing-checkout-v2.json"), "old-v2", {
    mode: 0o600,
  });
  const persist = await createRecoveryJournal(directory);
  await persist({ phase: "ready" });
  await persist({ phase: "checkout-pending" });
  const originalText = await fs.readFile(path.join(directory, RECOVERY_JOURNAL), "utf8");
  const resumePersist = await createRecoveryJournal(directory, { resumeText: originalText });
  await resumePersist({ phase: "checkout-pending", resumedFrom: { original: true } });
  assert.equal(
    await fs.readFile(
      path.join(directory, `${RECOVERY_JOURNAL}.unpaid-resume-original.json`),
      "utf8",
    ),
    originalText,
  );
  await assert.rejects(createRecoveryJournal(directory, { resumeText: originalText }));
  await assert.rejects(createRecoveryJournal(directory));
  assert.equal((await fs.stat(path.join(directory, RECOVERY_JOURNAL))).mode & 0o077, 0);
  assert.equal(
    await fs.readFile(path.join(directory, "protected-billing-checkout-v1.json"), "utf8"),
    "old-v1",
  );
  assert.equal(
    await fs.readFile(path.join(directory, "protected-billing-checkout-v2.json"), "utf8"),
    "old-v2",
  );
  await fs.rename(path.join(directory, RECOVERY_JOURNAL), path.join(directory, "original.json"));
  await fs.symlink(path.join(directory, "original.json"), path.join(directory, RECOVERY_JOURNAL));
  await assert.rejects(persist({ phase: "unsafe" }));
  assert.equal(
    JSON.parse(await fs.readFile(path.join(directory, "original.json"), "utf8")).phase,
    "checkout-pending",
  );
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
console.log(
  "PASS offline recovery runner approval/scope guards, one-shot actions, proof-before-return, past-due warning, Portal inspection boundary and exclusive private journal",
);
