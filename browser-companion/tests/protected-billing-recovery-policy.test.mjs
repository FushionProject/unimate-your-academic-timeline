import assert from "node:assert/strict";
import {
  PROTECTED_BILLING_RECOVERY as C,
  assertRecoveryProof,
  verifyRecoveryBaseline,
  verifyRecoveryPurchase,
  verifyRecoveryFailure,
  verifyRecoveryCompletion,
  verifyRecoveryRevocation,
} from "../../scripts/protected-billing-recovery-policy.mjs";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";

const clone = structuredClone;
function scenario() {
  const userId = "10000000-0000-4000-8000-000000000001";
  const nonce = "20000000-0000-4000-8000-000000000002";
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
  const method = (id, last4 = "4242") => ({
    id,
    customer: C.customer,
    livemode: false,
    type: "card",
    card: { last4 },
  });
  const invoice = (status, cycle = false) => ({
    object: "invoice",
    id: cycle ? "in_renewal" : "in_initial",
    livemode: false,
    customer: C.customer,
    status,
    billing_reason: cycle ? "subscription_cycle" : "subscription_create",
    collection_method: "charge_automatically",
    currency: "usd",
    amount_due: 599,
    total: 599,
    amount_remaining: status === "paid" ? 0 : 599,
    amount_paid: status === "paid" ? 599 : 0,
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
  });
  const base = {
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
    observedAt: 1800000000000,
  };
  const baseline = verifyRecoveryBaseline(base);
  const addEvent = (input, eventId, type, object) => {
    input.events = [{ id: eventId, type, livemode: false, account: C.account, data: { object } }];
    input.deliveries = [{ eventId, eventType: type, httpStatus: 200, at: input.observedAt - 100 }];
  };
  const bought = {
    ...clone(base),
    baseline,
    reconciliationHeld: true,
    graceEnabled: true,
    observedAt: base.observedAt + 10000,
    actionStartedAt: base.observedAt + 1000,
    paymentMethod: method("pm_original"),
    invoice: invoice("paid"),
    session: {
      id: "cs_test_fresh",
      livemode: false,
      customer: C.customer,
      client_reference_id: userId,
      metadata: { user_id: userId },
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      amount_total: 599,
      currency: "usd",
      subscription: "sub_recovery",
    },
  };
  bought.profile.is_pro = true;
  bought.profile.billing_revision = 65;
  bought.subscriptions.data.push(sub("sub_recovery", "active"));
  addEvent(bought, "evt_purchase", "invoice.paid", clone(bought.invoice));
  const purchase = verifyRecoveryPurchase(bought);
  const failed = {
    ...clone(bought),
    purchase,
    observedAt: bought.observedAt + 10000,
    actionStartedAt: bought.observedAt + 1000,
    actionBillingRevision: 67,
    invoice: invoice("open", true),
    paymentMethod: method("pm_decline", "0341"),
  };
  failed.profile.billing_revision = 68;
  Object.assign(failed.subscriptions.data.at(-1), {
    status: "past_due",
    latest_invoice: "in_renewal",
    default_payment_method: "pm_decline",
  });
  addEvent(failed, "evt_failure", "invoice.payment_failed", clone(failed.invoice));
  const failure = verifyRecoveryFailure(failed);
  const recovered = {
    ...clone(failed),
    failure,
    observedAt: failed.observedAt + 10000,
    actionStartedAt: failed.observedAt + 2000,
    actionBillingRevision: 71,
    portalAttemptedAt: failed.observedAt + 1000,
    invoice: invoice("paid", true),
    paymentMethod: method("pm_portalnew"),
    portal: {
      id: "bps_fixture",
      livemode: false,
      customer: C.customer,
      return_url: `${C.origin}/upgrade`,
      url: "https://billing.stripe.com/p/session/test_fixture",
    },
    invoicePayment: {
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
    paymentIntent: {
      id: "pi_fixture",
      livemode: false,
      customer: C.customer,
      status: "succeeded",
      amount: 599,
      amount_received: 599,
      currency: "usd",
      payment_method: "pm_portalnew",
    },
  };
  recovered.profile.billing_revision = 72;
  Object.assign(recovered.subscriptions.data.at(-1), {
    status: "active",
    default_payment_method: "pm_portalnew",
  });
  addEvent(recovered, "evt_recovered", "invoice.paid", clone(recovered.invoice));
  recovered.events.push({
    id: "evt_portal",
    type: "billing_portal.session.created",
    livemode: false,
    created: Math.floor(recovered.portalAttemptedAt / 1000),
    data: { object: clone(recovered.portal) },
  });
  return { base, bought, failed, recovered, baseline, purchase, failure };
}

const f = scenario();
const completed = verifyRecoveryCompletion(f.recovered);
assert.equal(completed.phase, "recovered");
assert.equal(completed.invoiceId, f.failure.invoiceId);
assert.equal(completed.paymentMethodId, "pm_portalnew");
assert.equal(completed.actionBillingRevision, 71);
assert.equal(f.failure.actionBillingRevision, 67);
assert.equal(Object.isFrozen(completed), true);
assertRecoveryProof(completed, "recovered");
assert.throws(
  () => assertRecoveryProof({ ...completed, billingRevision: 900 }, "recovered"),
  /PRIOR_PROOF/,
);
assert.throws(() => assertRecoveryProof(completed, "past-due"), /PRIOR_PROOF/);
assert.doesNotMatch(
  JSON.stringify(completed),
  /https:\/\/billing|example\.test|password|sk_test|whsec/,
);

function rejects(input, verify, changes, pattern = /RECOVERY_/) {
  for (const change of changes) {
    const altered = clone(input);
    change(altered);
    assert.throws(() => verify(altered), pattern, change.toString());
  }
}
rejects(f.base, verifyRecoveryBaseline, [
  (i) => {
    i.origin = "https://unimate-other.vercel.app";
  },
  (i) => {
    i.source = "72a0e29";
  },
  (i) => {
    i.journalHashes.v1 = "0".repeat(64);
  },
  (i) => {
    i.journalHashes.v2 = "0".repeat(64);
  },
  (i) => {
    i.record.account = "acct_live";
  },
  (i) => {
    i.user.app_metadata = {};
    i.user.user_metadata = {
      unimate_test_marker: i.record.marker,
      unimate_test_nonce: i.record.nonce,
    };
  },
  (i) => {
    i.customer.livemode = true;
  },
  (i) => {
    i.customer.metadata.user_id = "owner";
  },
  (i) => {
    i.customer.id = "cus_other";
  },
  (i) => {
    i.clock.status = "advancing";
  },
  (i) => {
    i.clock.id = "clock_other";
  },
  (i) => {
    i.profile.is_pro = true;
  },
  (i) => {
    i.profile.stripe_customer_id = "cus_other";
  },
  (i) => {
    i.profile.billing_revision = -1;
  },
  (i) => {
    i.subscriptions.has_more = true;
  },
  (i) => {
    i.subscriptions.data.pop();
  },
  (i) => {
    i.subscriptions.data[0].status = "active";
  },
  (i) => {
    i.subscriptions.data[0].id = i.subscriptions.data[1].id;
  },
  (i) => {
    i.subscriptions.data[0].items.data[0].price = "price_other";
  },
  (i) => {
    i.openCheckouts.data = [{ id: "cs_test_open" }];
  },
  (i) => {
    i.openCheckouts.has_more = true;
  },
]);
const sharedPhaseFailures = [
  (i) => {
    i.reconciliationHeld = false;
  },
  (i) => {
    i.graceEnabled = false;
  },
  (i) => {
    i.actionStartedAt = i.observedAt + 1;
  },
  (i) => {
    i.actionStartedAt = i.baseline.observedAt - 1;
  },
  (i) => {
    i.profile.is_pro = false;
  },
  (i) => {
    i.profile.billing_revision = i.baseline.billingRevision;
  },
  (i) => {
    i.subscriptions.data.push(clone(i.subscriptions.data.at(-1)));
  },
  (i) => {
    i.subscriptions.data.at(-1).cancel_at = 1805000000;
  },
  (i) => {
    i.invoice.customer = "cus_other";
  },
  (i) => {
    i.invoice.parent.subscription_details.subscription = "sub_other";
  },
  (i) => {
    i.invoice.amount_due = 600;
  },
  (i) => {
    i.invoice.lines.has_more = true;
  },
  (i) => {
    i.paymentMethod.customer = "cus_other";
  },
  (i) => {
    i.events = [];
  },
  (i) => {
    i.deliveries = [];
  },
  (i) => {
    i.deliveries[0].httpStatus = 500;
  },
  (i) => {
    i.deliveries[0].eventId = "evt_other";
  },
  (i) => {
    i.deliveries[0].at = i.actionStartedAt - 1;
  },
  (i) => {
    i.events[0].livemode = true;
  },
  (i) => {
    i.events[0].account = "acct_other";
  },
  (i) => {
    i.events[0].context = "acct_other";
  },
  (i) => {
    i.events[0].data.object.id = "in_other";
  },
];
for (const [input, verify] of [
  [f.bought, verifyRecoveryPurchase],
  [f.failed, verifyRecoveryFailure],
  [f.recovered, verifyRecoveryCompletion],
])
  rejects(input, verify, sharedPhaseFailures);
rejects(f.bought, verifyRecoveryPurchase, [
  (i) => {
    i.session.livemode = true;
  },
  (i) => {
    i.session.payment_status = "unpaid";
  },
  (i) => {
    i.session.subscription = C.baseline[0];
  },
  (i) => {
    i.session.client_reference_id = "owner";
  },
  (i) => {
    i.session.amount_total = 999;
  },
  (i) => {
    i.invoice.billing_reason = "subscription_cycle";
  },
]);
rejects(f.failed, verifyRecoveryFailure, [
  (i) => delete i.actionBillingRevision,
  (i) => (i.actionBillingRevision = -1),
  (i) => (i.actionBillingRevision = i.purchase.billingRevision - 1),
  (i) => (i.profile.billing_revision = i.actionBillingRevision),
  (i) => {
    i.profile.billing_revision = i.purchase.billingRevision;
  },
  (i) => {
    i.invoice.status = "paid";
  },
  (i) => {
    i.invoice.billing_reason = "subscription_create";
  },
  (i) => {
    i.invoice.attempted = false;
  },
  (i) => {
    i.invoice.attempt_count = 0;
  },
  (i) => {
    i.paymentMethod.card.last4 = "4242";
  },
  (i) => {
    i.subscriptions.data.at(-1).status = "active";
  },
]);
rejects(f.recovered, verifyRecoveryCompletion, [
  (i) => delete i.actionBillingRevision,
  (i) => (i.actionBillingRevision = "71"),
  (i) => (i.actionBillingRevision = i.failure.billingRevision - 1),
  (i) => (i.profile.billing_revision = i.actionBillingRevision),
  (i) => {
    i.profile.billing_revision = i.failure.billingRevision;
  },
  (i) => {
    i.invoice.id = "in_newcycle";
    i.subscriptions.data.at(-1).latest_invoice = "in_newcycle";
  },
  (i) => {
    i.subscriptions.data.at(-1).default_payment_method = "pm_decline";
  },
  (i) => {
    i.subscriptions.data.at(-1).default_payment_method = "pm_original";
    i.paymentMethod.id = "pm_original";
  },
  (i) => {
    i.portal.customer = "cus_other";
  },
  (i) => {
    i.portal.return_url = "https://unimate.site/upgrade";
  },
  (i) => {
    i.portal.url = "https://billing.stripe.com.evil.test/session";
  },
  (i) => {
    i.portalAttemptedAt = i.failure.observedAt - 1000;
  },
  (i) => {
    i.events.pop();
  },
  (i) => {
    i.events.at(-1).data.object.id = "bps_other";
  },
  (i) => {
    i.invoicePayment.invoice = "in_other";
  },
  (i) => {
    i.invoicePayment.livemode = true;
  },
  (i) => {
    i.invoicePayment.amount_requested = 600;
  },
  (i) => {
    i.invoicePayment.payment.payment_intent = "pi_other";
  },
  (i) => {
    i.paymentIntent.customer = "cus_other";
  },
  (i) => {
    i.paymentIntent.livemode = true;
  },
  (i) => {
    i.paymentIntent.payment_method = "pm_original";
  },
  (i) => {
    i.paymentIntent.amount_received = 0;
  },
  (i) => {
    i.paymentIntent.status = "requires_action";
  },
]);
// Both previously observed Portal session formats remain strictly event-bound.
for (const url of [
  "https://billing.stripe.com/p/session/test_fixture",
  "https://billing.stripe.com/p/session?session=synthetic-opaque-fixture",
]) {
  const input = clone(f.recovered);
  input.portal.url = url;
  input.events.at(-1).data.object.url = url;
  const proof = verifyRecoveryCompletion(input);
  assert.equal(proof.phase, "recovered");
  assert.ok(!JSON.stringify(proof).includes(url));
  assert.doesNotMatch(JSON.stringify(proof), /synthetic-opaque-fixture|billing\.stripe\.com/);
  input.events.at(-1).data.object.url = `${url}different`;
  assert.throws(() => verifyRecoveryCompletion(input), /RECOVERY_VERIFIED_PORTAL_REQUIRED/);
}
for (const url of [
  "http://billing.stripe.com/p/session/test_fixture",
  "https://billing.stripe.com.evil.test/p/session/test_fixture",
  "https://evil.test/p/session?session=synthetic",
  "https://user:password@billing.stripe.com/p/session/test_fixture",
  "https://billing.stripe.com:443/p/session/test_fixture",
  "https://billing.stripe.com:8443/p/session/test_fixture",
  "https://billing.stripe.com/p/session/test_fixture#fragment",
  "https://billing.stripe.com/p/session?session=synthetic#",
  "https://billing.stripe.com/p/session",
  "https://billing.stripe.com/p/session?",
  "https://billing.stripe.com/p/session/",
  "https://billing.stripe.com/p/session/test_fixture/extra",
  "https://billing.stripe.com/p/session/test_fixture?extra=1",
  "https://billing.stripe.com/p/other?session=synthetic",
  "https://billing.stripe.com/p/other/../session/test_fixture",
  "https://billing.stripe.com/p/session/%2Ftest_fixture",
  "https://billing.stripe.com/p/session?session=synthetic\\extra",
  "https://billing.stripe.com/p/session?session=synthetic\n",
  " https://billing.stripe.com/p/session/test_fixture",
]) {
  const input = clone(f.recovered);
  input.portal.url = url;
  input.events.at(-1).data.object.url = url;
  assert.throws(() => verifyRecoveryCompletion(input), /RECOVERY_VERIFIED_PORTAL_REQUIRED/);
}
// Portal may clear a subscription override and install the new customer default.
const cleared = clone(f.recovered);
cleared.subscriptions.data.at(-1).default_payment_method = null;
cleared.customer.invoice_settings.default_payment_method = "pm_portalnew";
assert.equal(verifyRecoveryCompletion(cleared).phase, "recovered");
// A genuine paid Checkout delivery is sufficient if invoice.paid is delayed.
const checkout = clone(f.bought);
checkout.events[0].type = checkout.deliveries[0].eventType = "checkout.session.completed";
checkout.events[0].data.object = { ...checkout.session, object: "checkout.session" };
assert.equal(verifyRecoveryPurchase(checkout).phase, "purchased");
function revocationInput(input, completion) {
  const revoked = {
    ...clone(input),
    completion,
    observedAt: input.observedAt + 10000,
    actionStartedAt: input.observedAt + 1000,
    actionBillingRevision: completion.billingRevision + 2,
  };
  revoked.profile.is_pro = false;
  revoked.profile.billing_revision = revoked.actionBillingRevision + 1;
  revoked.subscriptions.data.at(-1).status = "canceled";
  revoked.events = [
    {
      id: "evt_deleted",
      type: "customer.subscription.deleted",
      livemode: false,
      data: { object: { ...clone(revoked.subscriptions.data.at(-1)), object: "subscription" } },
    },
  ];
  revoked.deliveries = [
    {
      eventId: "evt_deleted",
      eventType: "customer.subscription.deleted",
      httpStatus: 200,
      at: revoked.observedAt - 100,
    },
  ];
  return revoked;
}
const revocationFailures = [
  (i) => delete i.actionBillingRevision,
  (i) => (i.actionBillingRevision = -1),
  (i) => (i.actionBillingRevision = i.completion.billingRevision - 1),
  (i) => (i.profile.billing_revision = i.actionBillingRevision),
  (i) => (i.completion = f.failure),
  (i) => (i.completion = f.baseline),
  (i) =>
    (i.completion = {
      ...i.completion,
      phase: "purchased" === i.completion.phase ? "recovered" : "purchased",
    }),
  (i) => (i.origin = "https://unimate-other.vercel.app"),
  (i) => (i.source = "72a0e29"),
  (i) => (i.journalHashes.v1 = "0".repeat(64)),
  (i) => (i.record.account = "acct_other"),
  (i) => (i.customer.livemode = true),
  (i) => (i.customer.id = "cus_other"),
  (i) => (i.clock.id = "clock_other"),
  (i) => (i.user.app_metadata = {}),
  (i) => (i.subscriptions.data[0].status = "active"),
  (i) => (i.subscriptions.has_more = true),
  (i) => i.subscriptions.data.push({ ...i.subscriptions.data.at(-1), id: "sub_extra" }),
  (i) => (i.subscriptions.data.at(-1).items.data[0].price = "price_other"),
  (i) => (i.openCheckouts.data = [{ id: "cs_test_open" }]),
  (i) => (i.actionStartedAt = i.completion.observedAt - 1),
  (i) => (i.actionStartedAt = i.observedAt + 1),
  (i) => {
    i.profile.is_pro = true;
  },
  (i) => {
    i.profile.billing_revision = i.completion.billingRevision;
  },
  (i) => {
    i.subscriptions.data.at(-1).status = "active";
  },
  (i) => {
    i.subscriptions.data.at(-1).id = "sub_other";
  },
  (i) => {
    i.reconciliationHeld = false;
  },
  (i) => {
    i.events[0].data.object.id = C.baseline[0];
  },
  (i) => {
    i.events[0].livemode = true;
  },
  (i) => (i.events[0].account = "acct_other"),
  (i) => (i.events[0].context = "acct_other"),
  (i) => (i.events[0].data.object.customer = "cus_other"),
  (i) => (i.events[0].data.object.status = "active"),
  (i) => (i.events = []),
  (i) => (i.deliveries = []),
  (i) => (i.deliveries[0].eventId = "evt_other"),
  (i) => {
    i.deliveries[0].httpStatus = 500;
  },
  (i) => {
    i.deliveries[0].at = i.actionStartedAt - 1;
  },
  (i) => (i.deliveries[0].at = i.observedAt + 1),
];
// Direct purchase cancellation must not claim the failed-renewal/Portal path.
for (const [input, predecessor] of [
  [f.bought, f.purchase],
  [f.recovered, completed],
]) {
  const revoked = revocationInput(input, predecessor);
  const proof = verifyRecoveryRevocation(revoked);
  assert.equal(proof.phase, "revoked");
  assert.equal(proof.predecessorPhase, predecessor.phase);
  assert.equal(proof.completionSha256, predecessor.evidenceSha256);
  assert.equal(proof.actionBillingRevision, revoked.actionBillingRevision);
  assert.equal(proof.subscriptionId, predecessor.subscriptionId);
  assertRecoveryProof(proof, "revoked");
  if (predecessor.phase === "purchased") {
    assert.equal(revoked.failure, undefined);
    assert.equal(revoked.portal, undefined);
    assert.equal(proof.failureSha256, undefined);
    assert.equal(proof.portalId, undefined);
  }
  rejects(revoked, verifyRecoveryRevocation, revocationFailures);
}
console.log(
  "PASS fixed private hosted recovery proof: exact preserved baseline, paid purchase, failed renewal, Portal invoice/payment graph, distinct direct/recovered revocation, pre-return delivery and revision guards (offline)",
);
