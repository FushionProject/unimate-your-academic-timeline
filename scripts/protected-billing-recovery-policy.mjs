// Pure, one-run evidence policy. No credentials, I/O, provider calls or mutations.
// The operator must supply authenticated provider readbacks and actual relay
// delivery observations while application reconciliation is held.
import { createHash } from "node:crypto";
import { SetupError, TARGET } from "./prepare-stripe-sandbox.mjs";
import { PROTECTED_BILLING_V2 } from "./protected-billing-run-v2.mjs";

export const PROTECTED_BILLING_RECOVERY = Object.freeze({
  kind: "unimate-protected-billing-recovery-v1",
  origin: "https://unimate-rvrhmln07-resumejuice-s-projects.vercel.app",
  source: "561ecc27764debc97f9c96f3a7fb93410b40f717",
  account: TARGET.account,
  customer: PROTECTED_BILLING_V2.customer,
  price: TARGET.price,
  baseline: Object.freeze([...PROTECTED_BILLING_V2.baseline, "sub_1URHqOIxB8W4eFUh6AvhlN7u"]),
  journalHashes: Object.freeze({
    v1: "b0bdbbc5f7054ec6652dc897299a1c2a832066f8b7b6b3f1e364a8b5cfde75ec",
    v2: "c7e9ff1519b33e63bc73a0db82d3dc4a65f573157668c4c7eb98ed96e7517475",
  }),
});
const C = PROTECTED_BILLING_RECOVERY;
const MARKER = "unimate-stripe-sandbox-synthetic-v1";
const uuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value || "");
const id = (value) => (typeof value === "string" ? value : value?.id);
const validId = (value, prefix) =>
  typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const revision = (value) => Number.isSafeInteger(value) && value >= 0;
const fail = (code) => {
  throw new SetupError(code);
};
const require = (condition, code) => {
  if (!condition) fail(code);
};
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const seal = (value) => Object.freeze({ ...value, evidenceSha256: digest(value) });

// Digest detects accidental evidence alteration, not authenticity. Authenticity
// is the caller's authenticated readback + relay boundary, never this hash.
export function assertRecoveryProof(proof, phase) {
  const { evidenceSha256, ...body } = proof || {};
  require(body.kind === C.kind &&
    body.phase === phase &&
    body.origin === C.origin &&
    body.source === C.source &&
    body.account === C.account &&
    body.customerId === C.customer &&
    uuid(body.userId) &&
    validId(body.clockId, "clock") &&
    revision(body.billingRevision) &&
    positive(body.observedAt) &&
    body.v1Sha256 === C.journalHashes.v1 &&
    body.v2Sha256 === C.journalHashes.v2 &&
    evidenceSha256 === digest(body), "RECOVERY_PRIOR_PROOF_REQUIRED");
  return proof;
}

function snapshot(input) {
  const { record, user, customer, clock, profile, subscriptions, openCheckouts } = input;
  require(input.origin === C.origin &&
    input.source === C.source &&
    positive(input.observedAt) &&
    input.journalHashes?.v1 === C.journalHashes.v1 &&
    input.journalHashes?.v2 === C.journalHashes.v2 &&
    record?.version === 1 &&
    record.marker === MARKER &&
    record.account === C.account &&
    record.price === C.price &&
    record.supabase === TARGET.supabase &&
    uuid(record.userId) &&
    uuid(record.nonce) &&
    record.email === `unimate-billing-${record.nonce}@example.test` &&
    user?.id === record.userId &&
    user.email === record.email &&
    user.app_metadata?.unimate_test_marker === MARKER &&
    user.app_metadata?.unimate_test_nonce === record.nonce &&
    customer?.id === C.customer &&
    customer.livemode === false &&
    !customer.deleted &&
    customer.metadata?.user_id === record.userId &&
    validId(id(customer.test_clock), "clock") &&
    clock?.id === id(customer.test_clock) &&
    clock.livemode === false &&
    clock.status === "ready" &&
    positive(clock.frozen_time) &&
    profile?.id === record.userId &&
    profile.stripe_customer_id === C.customer &&
    typeof profile.is_pro === "boolean" &&
    revision(profile.billing_revision) &&
    Array.isArray(subscriptions?.data) &&
    subscriptions.has_more === false &&
    Array.isArray(openCheckouts?.data) &&
    openCheckouts.has_more === false &&
    openCheckouts.data.length === 0, "RECOVERY_EXACT_SYNTHETIC_SNAPSHOT_REQUIRED");
  const rows = subscriptions.data;
  require(new Set(rows.map((sub) => sub?.id)).size ===
    rows.length, "RECOVERY_COMPLETE_SUBSCRIPTIONS_REQUIRED");
  for (const sub of rows)
    require(validId(sub?.id, "sub") &&
      sub.livemode === false &&
      id(sub.customer) === C.customer &&
      sub.metadata?.user_id === record.userId &&
      sub.items?.has_more === false &&
      sub.items.data?.length === 1 &&
      id(sub.items.data[0].price) === C.price &&
      sub.items.data[0].quantity === 1, "RECOVERY_SUBSCRIPTION_SCOPE_MISMATCH");
  require(C.baseline.every((old) =>
    rows.some((sub) => sub.id === old && sub.status === "canceled"),
  ), "RECOVERY_IMMUTABLE_BASELINE_REQUIRED");
  return {
    kind: C.kind,
    origin: C.origin,
    source: C.source,
    account: C.account,
    customerId: C.customer,
    userId: record.userId,
    clockId: clock.id,
    billingRevision: profile.billing_revision,
    observedAt: input.observedAt,
    v1Sha256: input.journalHashes.v1,
    v2Sha256: input.journalHashes.v2,
  };
}

export function verifyRecoveryBaseline(input = {}) {
  const scope = snapshot(input);
  require(input.subscriptions.data.length === 5 &&
    input.profile.is_pro === false, "RECOVERY_FREE_FIVE_CANCELED_REQUIRED");
  return seal({ ...scope, phase: "baseline" });
}

function current(input, previous, previousPhase) {
  const scope = snapshot(input);
  assertRecoveryProof(input.baseline, "baseline");
  assertRecoveryProof(previous, previousPhase);
  require(input.reconciliationHeld === true &&
    input.graceEnabled === true &&
    positive(input.actionStartedAt) &&
    input.actionStartedAt >= previous.observedAt &&
    input.observedAt >= input.actionStartedAt &&
    input.baseline.userId === scope.userId &&
    previous.userId === scope.userId &&
    input.baseline.clockId === scope.clockId &&
    previous.clockId === scope.clockId &&
    scope.billingRevision > previous.billingRevision &&
    input.profile.is_pro === true &&
    (previousPhase === "baseline" ||
      previous.baselineSha256 ===
        input.baseline.evidenceSha256), "RECOVERY_PRE_RETURN_REVISION_PROOF_REQUIRED");
  const fresh = input.subscriptions.data.filter((sub) => !C.baseline.includes(sub.id));
  require(input.subscriptions.data.length === 6 &&
    fresh.length === 1, "RECOVERY_SINGLE_NEW_SUBSCRIPTION_REQUIRED");
  const sub = fresh[0];
  require(sub.collection_method === "charge_automatically" &&
    sub.cancel_at_period_end === false &&
    sub.cancel_at == null &&
    sub.pause_collection == null &&
    sub.schedule == null &&
    positive(sub.items.data[0].current_period_end) &&
    (previousPhase === "baseline" ||
      sub.id === previous.subscriptionId), "RECOVERY_UNSCHEDULED_SUBSCRIPTION_REQUIRED");
  return { scope, sub };
}

function invoiceScope(invoice, sub, reason, status) {
  const line = invoice?.lines?.data?.[0];
  require(validId(invoice?.id, "in") &&
    id(sub.latest_invoice) === invoice.id &&
    invoice.livemode === false &&
    id(invoice.customer) === C.customer &&
    invoice.parent?.type === "subscription_details" &&
    id(invoice.parent.subscription_details?.subscription) === sub.id &&
    invoice.status === status &&
    invoice.billing_reason === reason &&
    invoice.collection_method === "charge_automatically" &&
    invoice.currency === "usd" &&
    invoice.amount_due === 599 &&
    invoice.total === 599 &&
    invoice.lines?.has_more === false &&
    Array.isArray(invoice.lines.data) &&
    invoice.lines.data.length === 1 &&
    line.quantity === 1 &&
    id(line.pricing?.price_details?.price ?? line.price) === C.price &&
    (status === "paid"
      ? invoice.amount_remaining === 0 && invoice.amount_paid === 599
      : invoice.amount_remaining === 599 &&
        invoice.amount_paid === 0 &&
        invoice.attempted === true &&
        positive(invoice.attempt_count)), "RECOVERY_EXACT_INVOICE_REQUIRED");
}

function actionRevision(input, previous) {
  require(revision(input.actionBillingRevision) &&
    input.actionBillingRevision >= previous.billingRevision &&
    input.profile.billing_revision >
      input.actionBillingRevision, "RECOVERY_ACTION_REVISION_REQUIRED");
}

function delivered(input, type, matches) {
  require(Array.isArray(input.events) &&
    Array.isArray(input.deliveries), "RECOVERY_HOSTED_DELIVERY_REQUIRED");
  const found = input.events.find((event) => {
    const object = event?.data?.object;
    return (
      validId(event?.id, "evt") &&
      event.type === type &&
      event.livemode === false &&
      (event.account === undefined || event.account === C.account) &&
      (event.context === undefined || event.context === C.account) &&
      object?.livemode === false &&
      id(object.customer) === C.customer &&
      matches(object) &&
      input.deliveries.some(
        (entry) =>
          entry?.eventId === event.id &&
          entry.eventType === type &&
          entry.httpStatus === 200 &&
          positive(entry.at) &&
          entry.at >= input.actionStartedAt &&
          entry.at <= input.observedAt,
      )
    );
  });
  return found?.id;
}
const effectiveMethod = (sub, customer) =>
  id(sub.default_payment_method) || id(customer.invoice_settings?.default_payment_method);
function methodScope(method, expected) {
  require(validId(expected, "pm") &&
    method?.id === expected &&
    method.livemode === false &&
    id(method.customer) === C.customer &&
    method.type === "card", "RECOVERY_PAYMENT_METHOD_SCOPE_REQUIRED");
}
// Accept only the two observed hosted-session shapes. The opaque query stays
// in memory and must still match the authenticated Stripe event byte-for-byte.
// Checking the raw authority also rejects an explicit default :443 port, which
// URL parsing would normalize away.
function portalSessionUrl(value) {
  if (
    typeof value !== "string" ||
    !/^https:\/\/billing\.stripe\.com\/p\/session(?:\?[^\s#\\]+|\/[A-Za-z0-9_-]+)$/.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      url.origin === "https://billing.stripe.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      url.href === value &&
      ((url.pathname === "/p/session" && url.search.length > 1) ||
        (/^\/p\/session\/[A-Za-z0-9_-]+$/.test(url.pathname) && !url.search))
    );
  } catch {
    return false;
  }
}
const invoiceEvent = (invoice, sub, status) => (object) =>
  object.object === "invoice" &&
  object.id === invoice.id &&
  object.status === status &&
  object.currency === "usd" &&
  object.amount_due === 599 &&
  id(object.parent?.subscription_details?.subscription ?? object.subscription) === sub.id;

export function verifyRecoveryPurchase(input = {}) {
  const { scope, sub } = current(input, input.baseline, "baseline");
  const { invoice, session } = input;
  invoiceScope(invoice, sub, "subscription_create", "paid");
  require(sub.status === "active" &&
    validId(session?.id, "cs_test") &&
    session.livemode === false &&
    id(session.customer) === C.customer &&
    session.client_reference_id === scope.userId &&
    session.metadata?.user_id === scope.userId &&
    session.mode === "subscription" &&
    session.status === "complete" &&
    session.payment_status === "paid" &&
    session.amount_total === 599 &&
    session.currency === "usd" &&
    id(session.subscription) === sub.id, "RECOVERY_PAID_CHECKOUT_REQUIRED");
  const methodId = effectiveMethod(sub, input.customer);
  methodScope(input.paymentMethod, methodId);
  const eventId =
    delivered(input, "invoice.paid", invoiceEvent(invoice, sub, "paid")) ||
    delivered(
      input,
      "checkout.session.completed",
      (object) =>
        object.object === "checkout.session" &&
        object.id === session.id &&
        object.payment_status === "paid" &&
        id(object.subscription) === sub.id,
    );
  require(eventId, "RECOVERY_HOSTED_PURCHASE_REQUIRED");
  return seal({
    ...scope,
    phase: "purchased",
    baselineSha256: input.baseline.evidenceSha256,
    subscriptionId: sub.id,
    initialInvoiceId: invoice.id,
    sessionId: session.id,
    originalMethodId: methodId,
    eventId,
  });
}

export function verifyRecoveryFailure(input = {}) {
  const { scope, sub } = current(input, input.purchase, "purchased");
  actionRevision(input, input.purchase);
  invoiceScope(input.invoice, sub, "subscription_cycle", "open");
  const declineId = effectiveMethod(sub, input.customer);
  methodScope(input.paymentMethod, declineId);
  require(sub.status === "past_due" &&
    input.invoice.id !== input.purchase.initialInvoiceId &&
    declineId !== input.purchase.originalMethodId &&
    input.paymentMethod.card?.last4 === "0341", "RECOVERY_FAILED_RENEWAL_REQUIRED");
  const eventId = delivered(
    input,
    "invoice.payment_failed",
    invoiceEvent(input.invoice, sub, "open"),
  );
  require(eventId, "RECOVERY_HOSTED_FAILURE_REQUIRED");
  return seal({
    ...scope,
    phase: "past-due",
    baselineSha256: input.baseline.evidenceSha256,
    purchaseSha256: input.purchase.evidenceSha256,
    subscriptionId: sub.id,
    invoiceId: input.invoice.id,
    declineMethodId: declineId,
    originalMethodId: input.purchase.originalMethodId,
    actionBillingRevision: input.actionBillingRevision,
    eventId,
  });
}

export function verifyRecoveryCompletion(input = {}) {
  const { scope, sub } = current(input, input.failure, "past-due");
  actionRevision(input, input.failure);
  assertRecoveryProof(input.purchase, "purchased");
  require(input.failure.purchaseSha256 ===
    input.purchase.evidenceSha256, "RECOVERY_PURCHASE_CHAIN_REQUIRED");
  invoiceScope(input.invoice, sub, "subscription_cycle", "paid");
  const methodId = effectiveMethod(sub, input.customer);
  methodScope(input.paymentMethod, methodId);
  require(sub.status === "active" &&
    input.invoice.id === input.failure.invoiceId &&
    methodId !== input.failure.declineMethodId &&
    methodId !== input.failure.originalMethodId, "RECOVERY_NEW_PORTAL_METHOD_REQUIRED");
  const { portal, invoicePayment, paymentIntent } = input;
  require(validId(portal?.id, "bps") &&
    portal.livemode === false &&
    id(portal.customer) === C.customer &&
    portal.return_url === `${C.origin}/upgrade` &&
    portalSessionUrl(portal.url) &&
    positive(input.portalAttemptedAt) &&
    input.portalAttemptedAt >= input.failure.observedAt &&
    input.portalAttemptedAt <= input.actionStartedAt &&
    Array.isArray(input.events) &&
    input.events.some(
      (event) =>
        event?.type === "billing_portal.session.created" &&
        validId(event.id, "evt") &&
        event.livemode === false &&
        (event.account === undefined || event.account === C.account) &&
        (event.context === undefined || event.context === C.account) &&
        event.created >= Math.floor(input.portalAttemptedAt / 1000) - 120 &&
        event.created <= Math.ceil(input.observedAt / 1000) &&
        event.data?.object?.id === portal.id &&
        event.data.object.livemode === false &&
        id(event.data.object.customer) === C.customer &&
        event.data.object.url === portal.url &&
        event.data.object.return_url === portal.return_url,
    ), "RECOVERY_VERIFIED_PORTAL_REQUIRED");
  require(invoicePayment?.object === "invoice_payment" &&
    validId(invoicePayment.id, "inpay") &&
    invoicePayment.livemode === false &&
    id(invoicePayment.invoice) === input.invoice.id &&
    invoicePayment.status === "paid" &&
    invoicePayment.amount_paid === 599 &&
    invoicePayment.amount_requested === 599 &&
    invoicePayment.currency === "usd" &&
    invoicePayment.payment?.type === "payment_intent" &&
    id(invoicePayment.payment.payment_intent) === paymentIntent?.id &&
    validId(paymentIntent?.id, "pi") &&
    paymentIntent.livemode === false &&
    id(paymentIntent.customer) === C.customer &&
    paymentIntent.status === "succeeded" &&
    paymentIntent.amount === 599 &&
    paymentIntent.amount_received === 599 &&
    paymentIntent.currency === "usd" &&
    id(paymentIntent.payment_method) === methodId, "RECOVERY_INVOICE_PAYMENT_GRAPH_REQUIRED");
  const eventId = delivered(input, "invoice.paid", invoiceEvent(input.invoice, sub, "paid"));
  require(eventId &&
    eventId !== input.purchase.eventId &&
    eventId !== input.failure.eventId, "RECOVERY_HOSTED_RECOVERY_REQUIRED");
  return seal({
    ...scope,
    phase: "recovered",
    baselineSha256: input.baseline.evidenceSha256,
    failureSha256: input.failure.evidenceSha256,
    subscriptionId: sub.id,
    invoiceId: input.invoice.id,
    paymentMethodId: methodId,
    portalId: portal.id,
    actionBillingRevision: input.actionBillingRevision,
    eventId,
  });
}

export function verifyRecoveryRevocation(input = {}) {
  const scope = snapshot(input);
  assertRecoveryProof(input.baseline, "baseline");
  // A direct paid-purchase cancellation is distinct from a completed recovery.
  // Neither a failed renewal nor an unverified UI observation is a predecessor.
  const predecessorPhase = input.completion?.phase;
  require(["purchased", "recovered"].includes(
    predecessorPhase,
  ), "RECOVERY_REVOCATION_PREDECESSOR_REQUIRED");
  assertRecoveryProof(input.completion, predecessorPhase);
  actionRevision(input, input.completion);
  const fresh = input.subscriptions.data.filter((sub) => !C.baseline.includes(sub.id));
  require(input.reconciliationHeld === true &&
    positive(input.actionStartedAt) &&
    input.actionStartedAt >= input.completion.observedAt &&
    input.observedAt >= input.actionStartedAt &&
    input.completion.baselineSha256 === input.baseline.evidenceSha256 &&
    input.completion.userId === scope.userId &&
    input.baseline.userId === scope.userId &&
    input.completion.clockId === scope.clockId &&
    input.baseline.clockId === scope.clockId &&
    input.subscriptions.data.length === 6 &&
    fresh.length === 1 &&
    fresh[0].id === input.completion.subscriptionId &&
    fresh[0].status === "canceled" &&
    input.profile.is_pro === false &&
    scope.billingRevision >
      input.completion.billingRevision, "RECOVERY_TERMINAL_FREE_PROOF_REQUIRED");
  const eventId = delivered(
    input,
    "customer.subscription.deleted",
    (object) =>
      object.object === "subscription" && object.id === fresh[0].id && object.status === "canceled",
  );
  require(eventId, "RECOVERY_HOSTED_REVOCATION_REQUIRED");
  return seal({
    ...scope,
    phase: "revoked",
    baselineSha256: input.baseline.evidenceSha256,
    completionSha256: input.completion.evidenceSha256,
    predecessorPhase,
    actionBillingRevision: input.actionBillingRevision,
    subscriptionId: fresh[0].id,
    eventId,
  });
}
