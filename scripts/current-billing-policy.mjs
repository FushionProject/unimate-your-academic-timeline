// Pure fixed-run policy. Inputs must be authenticated canonical readbacks; a
// digest detects altered evidence, not authenticity. No I/O or provider actions.
import { createHash } from "node:crypto";
import { TARGET } from "./prepare-stripe-sandbox.mjs";
import { QUOTE_SCOPE, validateCurrentQuoteSession } from "./verify-current-sandbox-quote.mjs";
import { CURRENT_SANDBOX_TARGET } from "./verify-current-stripe-sandbox-price.mjs";

export const CURRENT_BILLING_SCOPE = Object.freeze({
  ...CURRENT_SANDBOX_TARGET,
  origin: QUOTE_SCOPE.origin,
  deployment: QUOTE_SCOPE.deployment,
  source: QUOTE_SCOPE.source,
  customer: QUOTE_SCOPE.customer,
  journal: "current-billing-999-v1.jsonl",
});
export const CURRENT_BILLING_CONTINUATION = Object.freeze({
  sessionId: "cs_test_a1nQZGsGq3n9YlmiBimUautrLwnwkcRk40ezjDf4wSrRQFWE0Q11aKiH5f",
  journal: "current-billing-999-continuation-v1.jsonl",
  resumeJournal: "current-billing-999-continuation-v2.jsonl",
});
const C = CURRENT_BILLING_SCOPE;
const marker = "unimate-stripe-sandbox-synthetic-v1";
const id = (value) => (typeof value === "string" ? value : value?.id);
const validId = (value, prefix) =>
  typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value);
const uuid = (value) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value || "");
const revision = (value) => Number.isSafeInteger(value) && value >= 0;
const require = (condition, code) => {
  if (!condition) throw new Error(`CURRENT_BILLING_${code}`);
};
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const seal = (value) => freeze({ ...value, evidenceSha256: digest(value) });
function proof(value, phase) {
  require(value && value.phase === phase, "PROOF_PHASE_REQUIRED");
  const { evidenceSha256, ...body } = value;
  require(evidenceSha256 === digest(body) &&
    body.account === C.account &&
    body.origin === C.origin &&
    body.source === C.source &&
    body.customerId === C.customer &&
    body.price === C.price &&
    uuid(body.userId) &&
    revision(body.billingRevision), "PROOF_INVALID");
}
function list(value, prefix) {
  require(value?.has_more === false &&
    Array.isArray(value.data) &&
    value.data.every((item) => validId(item?.id, prefix)) &&
    new Set(value.data.map((item) => item.id)).size ===
      value.data.length, "COMPLETE_LIST_REQUIRED");
  return value.data;
}
function profileScope(profile, userId, isPro) {
  require(profile?.id === userId &&
    profile.stripe_customer_id === C.customer &&
    profile.is_pro === isPro &&
    revision(profile.billing_revision), "PROFILE_SCOPE_REQUIRED");
}
function subSnapshot(sub, userId, price) {
  const item = sub?.items?.data?.[0];
  require(validId(sub?.id, "sub") &&
    sub.object === "subscription" &&
    sub.livemode === false &&
    id(sub.customer) === C.customer &&
    sub.metadata?.user_id === userId &&
    sub.items?.has_more === false &&
    Array.isArray(sub.items.data) &&
    sub.items.data.length === 1 &&
    id(item?.price) === price &&
    item.quantity === 1, "SUBSCRIPTION_SCOPE_REQUIRED");
  require((item.id == null || validId(item.id, "si")) &&
    (sub.latest_invoice == null || validId(id(sub.latest_invoice), "in")) &&
    [
      sub.created,
      sub.canceled_at,
      sub.ended_at,
      item.current_period_start ?? sub.current_period_start,
      item.current_period_end ?? sub.current_period_end,
    ].every((value) => value == null || revision(value)), "SUBSCRIPTION_FIELDS_INVALID");
  return {
    id: sub.id,
    status: sub.status,
    customer: id(sub.customer),
    userId,
    price,
    quantity: item.quantity,
    itemId: item.id ?? null,
    created: sub.created ?? null,
    canceledAt: sub.canceled_at ?? null,
    endedAt: sub.ended_at ?? null,
    periodStart: item.current_period_start ?? sub.current_period_start ?? null,
    periodEnd: item.current_period_end ?? sub.current_period_end ?? null,
    latestInvoice: id(sub.latest_invoice) ?? null,
  };
}
function currentState(baseline, subscriptions, open, subscription, status) {
  proof(baseline, "baseline");
  require(list(open, "cs_test").length === 0, "NO_OPEN_CHECKOUT_REQUIRED");
  const rows = list(subscriptions, "sub");
  require(baseline.subscriptions?.length === 7 &&
    rows.length === 8, "EXACT_NEW_SUBSCRIPTION_REQUIRED");
  for (const prior of baseline.subscriptions) {
    const current = rows.find((sub) => sub.id === prior.id);
    require(current &&
      JSON.stringify(subSnapshot(current, baseline.userId, TARGET.price)) ===
        JSON.stringify(prior), "HISTORICAL_BASELINE_CHANGED");
  }
  const fresh = rows.filter((sub) => !baseline.subscriptions.some((old) => old.id === sub.id));
  require(fresh.length === 1 &&
    fresh[0].id === subscription?.id &&
    subscription.status === status &&
    fresh[0].status === status, "EXACT_NEW_SUBSCRIPTION_REQUIRED");
  const snapshot = subSnapshot(subscription, baseline.userId, C.price);
  require(JSON.stringify(snapshot) ===
    JSON.stringify(
      subSnapshot(fresh[0], baseline.userId, C.price),
    ), "SUBSCRIPTION_READBACK_MISMATCH");
  return snapshot;
}
function sessionScope(session, lines, userId) {
  const line = lines?.data?.[0];
  require(validId(session?.id, "cs_test") &&
    session.object === "checkout.session" &&
    session.livemode === false &&
    id(session.customer) === C.customer &&
    session.client_reference_id === userId &&
    session.metadata?.user_id === userId &&
    uuid(userId) &&
    session.mode === "subscription" &&
    session.currency === "usd" &&
    session.amount_total === 999 &&
    session.amount_subtotal === 999 &&
    session.total_details?.amount_discount === 0 &&
    session.total_details?.amount_tax === 0 &&
    session.total_details?.amount_shipping === 0 &&
    session.automatic_tax?.enabled === false &&
    session.success_url === `${C.origin}/upgrade?success=true&session_id={CHECKOUT_SESSION_ID}` &&
    session.cancel_url === `${C.origin}/upgrade?canceled=true`, "EXACT_CHECKOUT_REQUIRED");
  require(lines?.has_more === false &&
    Array.isArray(lines.data) &&
    lines.data.length === 1 &&
    id(line?.price) === C.price &&
    line.quantity === 1 &&
    line.amount_total === 999 &&
    line.amount_subtotal === 999 &&
    line.currency === "usd", "EXACT_CHECKOUT_LINE_REQUIRED");
}
function invoiceSubscription(invoice) {
  return invoice.parent != null
    ? invoice.parent.type === "subscription_details"
      ? id(invoice.parent.subscription_details?.subscription)
      : null
    : id(invoice.subscription);
}
function delivered(events, type, matches) {
  require(Array.isArray(events), "DELIVERED_EVENT_REQUIRED");
  return events.find((entry) => {
    const { event, delivery } = entry || {};
    const object = event?.data?.object;
    return (
      validId(event?.id, "evt") &&
      event.type === type &&
      event.livemode === false &&
      (event.account === undefined || event.account === C.account) &&
      (event.context === undefined || event.context === C.account) &&
      delivery?.eventId === event.id &&
      delivery.eventType === type &&
      delivery.httpStatus === 200 &&
      Number.isSafeInteger(delivery.at) &&
      delivery.at > 0 &&
      object?.livemode === false &&
      id(object.customer) === C.customer &&
      matches(object)
    );
  })?.event.id;
}

// Prior actual behavior of this exact immutable deployment, not an inference
// from Vercel's env-name arrays. The canonical expired Checkout is retrieved
// separately under the verified test account. Never rerun the one-shot quote.
export function assertCurrentDeploymentQuoteEvidence({ journalText, session, lines, userId } = {}) {
  require(typeof journalText === "string" &&
    journalText.length > 0 &&
    journalText.length <= 65536 &&
    journalText.endsWith("\n"), "COMPLETE_PRIOR_QUOTE_REQUIRED");
  let rows;
  try {
    rows = journalText
      .slice(0, -1)
      .split("\n")
      .map((line) => JSON.parse(line));
  } catch {
    require(false, "COMPLETE_PRIOR_QUOTE_REQUIRED");
  }
  const phases = ["create-pending", "quote-verified", "expiry-pending", "expired-verified"];
  require(rows.length === phases.length && uuid(userId), "COMPLETE_PRIOR_QUOTE_REQUIRED");
  const baselineRevision = rows[0]?.baselineRevision;
  const sessionId = rows[1]?.sessionId;
  require(revision(baselineRevision) &&
    validId(sessionId, "cs_test"), "PRIOR_QUOTE_SCOPE_REQUIRED");
  const shared = [
    "version",
    "phase",
    "at",
    "account",
    "price",
    "customer",
    "deployment",
    "source",
    "baselineRevision",
    "accountBinding",
    "deployedKeyEqualityVerified",
  ];
  for (const [index, row] of rows.entries()) {
    const keys = index === 0 ? shared : [...shared, "sessionId", "amountCents"];
    require(row &&
      typeof row === "object" &&
      !Array.isArray(row) &&
      Object.keys(row).length === keys.length &&
      Object.keys(row).every((key) => keys.includes(key)) &&
      row.version === 1 &&
      row.phase === phases[index] &&
      Number.isSafeInteger(row.at) &&
      row.at > 0 &&
      (index === 0 || row.at >= rows[index - 1].at) &&
      row.account === C.account &&
      row.price === C.price &&
      row.customer === C.customer &&
      row.deployment === C.deployment &&
      row.source === C.source &&
      row.baselineRevision === baselineRevision &&
      row.accountBinding === "account_scoped_price_prewrite_guard" &&
      row.deployedKeyEqualityVerified === false &&
      (index === 0 ||
        (row.sessionId === sessionId && row.amountCents === 999)), "PRIOR_QUOTE_SCOPE_REQUIRED");
  }
  require(session?.id === sessionId &&
    session.object === "checkout.session" &&
    session.invoice == null, "PRIOR_QUOTE_SESSION_REQUIRED");
  try {
    validateCurrentQuoteSession(session, lines, userId, "expired");
  } catch {
    require(false, "PRIOR_QUOTE_CANONICAL_READBACK_REQUIRED");
  }
  return freeze({
    sessionId,
    journalSha256: createHash("sha256").update(journalText).digest("hex"),
    accountBinding: "account_scoped_price_prewrite_guard",
    deployedKeyEqualityVerified: false,
    scope: "prior_same_deployment_unpaid_quote",
  });
}

export function assertCurrentBaseline({ record, profile, customer, subscriptions, open } = {}) {
  require(record?.version === 1 &&
    record.marker === marker &&
    record.account === C.account &&
    record.price === TARGET.price &&
    record.supabase === TARGET.supabase &&
    uuid(record.userId) &&
    uuid(record.nonce) &&
    record.email === `unimate-billing-${record.nonce}@example.test`, "SYNTHETIC_RECORD_REQUIRED");
  require(customer?.id === C.customer &&
    customer.livemode === false &&
    !customer.deleted &&
    customer.metadata?.user_id === record.userId &&
    validId(id(customer.test_clock), "clock"), "SYNTHETIC_CUSTOMER_REQUIRED");
  profileScope(profile, record.userId, false);
  require(list(open, "cs_test").length === 0, "NO_OPEN_CHECKOUT_REQUIRED");
  const rows = list(subscriptions, "sub");
  require(rows.length === 7 &&
    rows.every((sub) => sub.status === "canceled"), "SEVEN_CANCELED_REQUIRED");
  return seal({
    phase: "baseline",
    account: C.account,
    origin: C.origin,
    source: C.source,
    customerId: C.customer,
    price: C.price,
    userId: record.userId,
    clockId: id(customer.test_clock),
    billingRevision: profile.billing_revision,
    subscriptions: rows
      .map((sub) => subSnapshot(sub, record.userId, TARGET.price))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export function assertCurrentExpiredCheckout({ session, lines, userId } = {}) {
  sessionScope(session, lines, userId);
  require(session.status === "expired" &&
    session.payment_status === "unpaid" &&
    session.subscription == null &&
    session.payment_intent == null &&
    session.invoice == null, "EXPIRED_UNPAID_CHECKOUT_REQUIRED");
  return freeze({ sessionId: session.id, unpaid: true, expired: true });
}

export function assertCurrentOpenCheckout({ session, lines, userId } = {}) {
  sessionScope(session, lines, userId);
  let url;
  try {
    url = new URL(session.url);
  } catch {
    require(false, "CHECKOUT_URL_REQUIRED");
  }
  require(session.status === "open" &&
    session.payment_status === "unpaid" &&
    session.subscription == null &&
    session.payment_intent == null &&
    session.invoice == null &&
    url.origin === "https://checkout.stripe.com" &&
    !url.username &&
    !url.password &&
    !url.port &&
    url.pathname.split("/").includes(session.id), "UNPAID_CHECKOUT_REQUIRED");
  return freeze({
    sessionId: session.id,
    customerId: C.customer,
    userId,
    price: C.price,
    amountCents: 999,
  });
}

// Only the inspected creation-only stop may continue. The caller retrieves the
// complete current open-session list and rebuilds the baseline from canonical
// profile/customer/subscription reads. This never authorizes another creation,
// payment retry, or continuity with the now-closed original Companion panel.
export function assertCurrentUnpaidContinuation({
  journalText,
  session,
  lines,
  baseline,
  open,
} = {}) {
  require(typeof journalText === "string" &&
    journalText.length > 0 &&
    journalText.length <= 65536 &&
    journalText.endsWith("\n"), "UNPAID_SOURCE_JOURNAL_REQUIRED");
  let rows;
  try {
    rows = journalText
      .slice(0, -1)
      .split("\n")
      .map((line) => JSON.parse(line));
  } catch {
    require(false, "UNPAID_SOURCE_JOURNAL_REQUIRED");
  }
  const exactKeys = (value, keys) =>
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key));
  const sha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const phases = ["baseline", "create-pending", "stopped"];
  const times = [1792390907007, 1792390921971, 1792390924126];
  const shared = ["version", "sequence", "at", "phase", "account", "price", "origin", "source"];
  const extra = [
    ["baseline", "history", "deployedQuote", "free", "runDirectory"],
    [],
    ["stage", "code"],
  ];
  require(rows.length === 3, "UNPAID_SOURCE_JOURNAL_REQUIRED");
  for (const [index, row] of rows.entries()) {
    require(exactKeys(row, [...shared, ...extra[index]]) &&
      row.version === 1 &&
      row.sequence === index + 1 &&
      row.at === times[index] &&
      row.phase === phases[index] &&
      row.account === C.account &&
      row.price === C.price &&
      row.origin === C.origin &&
      row.source === C.source, "UNPAID_SOURCE_PHASE_REQUIRED");
  }
  require(rows[2].stage === "CHECKOUT" &&
    rows[2].code === "CURRENT_STOP_AND_RECONCILE", "UNPAID_CREATION_ONLY_STOP_REQUIRED");
  const original = rows[0];
  proof(original.baseline, "baseline");
  proof(baseline, "baseline");
  require(JSON.stringify(original.baseline) ===
    JSON.stringify(baseline), "UNPAID_BASELINE_CHANGED");
  const historyNames = [
    "protected-billing-checkout-v1.json",
    "protected-billing-checkout-v2.json",
    "current-price-quote-cb8a296-v1.jsonl",
  ];
  require(exactKeys(original.history, historyNames) &&
    Object.values(original.history).every(sha256), "UNPAID_HISTORY_REQUIRED");
  const quote = original.deployedQuote;
  require(exactKeys(quote, [
    "sessionId",
    "journalSha256",
    "accountBinding",
    "deployedKeyEqualityVerified",
    "scope",
  ]) &&
    validId(quote.sessionId, "cs_test") &&
    quote.sessionId !== CURRENT_BILLING_CONTINUATION.sessionId &&
    quote.journalSha256 === original.history[historyNames[2]] &&
    quote.accountBinding === "account_scoped_price_prewrite_guard" &&
    quote.deployedKeyEqualityVerified === false &&
    quote.scope === "prior_same_deployment_unpaid_quote", "UNPAID_PRIOR_QUOTE_REQUIRED");
  const free = original.free;
  require(exactKeys(free, [
    "action",
    "isPro",
    "billingRevision",
    "sourceHash",
    "samePanelTransition",
    "sameOpenPanelTransition",
    "sessionReused",
    "aiRequests",
    "captures",
    "extractions",
    "artifactPath",
  ]) &&
    free.action === "expect-free" &&
    free.isPro === false &&
    free.billingRevision === baseline.billingRevision &&
    sha256(free.sourceHash) &&
    free.samePanelTransition === false &&
    free.sameOpenPanelTransition === false &&
    free.sessionReused === false &&
    free.aiRequests === 0 &&
    free.captures === 0 &&
    free.extractions === 0 &&
    typeof free.artifactPath === "string" &&
    free.artifactPath.startsWith("/") &&
    typeof original.runDirectory === "string" &&
    original.runDirectory.startsWith("/"), "UNPAID_ORIGINAL_FREE_REQUIRED");
  const opened = list(open, "cs_test");
  require(opened.length === 1 &&
    opened[0].id === CURRENT_BILLING_CONTINUATION.sessionId &&
    session?.id === CURRENT_BILLING_CONTINUATION.sessionId, "EXACT_UNPAID_CONTINUATION_REQUIRED");
  for (const current of [session, opened[0]]) {
    assertCurrentOpenCheckout({ session: current, lines, userId: baseline.userId });
    require(current.created === 1792390923 &&
      current.created * 1000 >= rows[1].at &&
      current.created * 1000 <= rows[2].at, "UNPAID_CREATION_TIME_REQUIRED");
  }
  return freeze({
    sessionId: CURRENT_BILLING_CONTINUATION.sessionId,
    sourceJournalSha256: createHash("sha256").update(journalText).digest("hex"),
    baselineSha256: baseline.evidenceSha256,
    created: session.created,
    scope: "exact_unpaid_checkout_navigation_continuation",
    checkoutCreationAllowed: false,
    originalPanelContinuity: false,
  });
}

// A separate clean stop after card selection, before either filling or paying.
// The original creation journal is validated independently by the unpaid guard;
// its raw hash must be supplied here and retained unchanged by the runner.
export function assertCurrentCardSelectionContinuation({
  journalText,
  baseline,
  originalSourceSha256,
} = {}) {
  const exactKeys = (value, keys) =>
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key));
  const sha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  require(typeof journalText === "string" &&
    journalText.length > 0 &&
    journalText.length <= 65536 &&
    journalText.endsWith("\n") &&
    sha256(originalSourceSha256), "CARD_SELECTION_SOURCE_REQUIRED");
  let rows;
  try {
    rows = journalText
      .slice(0, -1)
      .split("\n")
      .map((line) => JSON.parse(line));
  } catch {
    require(false, "CARD_SELECTION_SOURCE_REQUIRED");
  }
  const phases = ["baseline", "checkout-verified", "card-selection-pending", "card-selected"];
  const shared = ["version", "sequence", "at", "phase", "account", "price", "origin", "source"];
  const extra = [
    ["baseline", "history", "deployedQuote", "free", "runDirectory", "continuation"],
    ["sessionId", "amountCents", "continued"],
    ["sessionId", "helperSha256"],
    ["sessionId"],
  ];
  require(rows.length === 4, "CARD_SELECTION_PHASE_REQUIRED");
  for (const [index, row] of rows.entries()) {
    require(exactKeys(row, [...shared, ...extra[index]]) &&
      row.version === 1 &&
      row.sequence === index + 1 &&
      row.phase === phases[index] &&
      row.account === C.account &&
      row.price === C.price &&
      row.origin === C.origin &&
      row.source === C.source &&
      Number.isSafeInteger(row.at) &&
      row.at > 1792390924126 &&
      (index === 0 || row.at >= rows[index - 1].at) &&
      (index === 0 ||
        row.sessionId === CURRENT_BILLING_CONTINUATION.sessionId), "CARD_SELECTION_PHASE_REQUIRED");
  }
  require(rows[1].amountCents === 999 &&
    rows[1].continued === true &&
    sha256(rows[2].helperSha256), "CARD_SELECTION_ACTION_REQUIRED");
  const original = rows[0];
  proof(original.baseline, "baseline");
  proof(baseline, "baseline");
  require(JSON.stringify(original.baseline) ===
    JSON.stringify(baseline), "CARD_SELECTION_BASELINE_CHANGED");
  const previous = original.continuation;
  require(exactKeys(previous, [
    "sessionId",
    "sourceJournalSha256",
    "baselineSha256",
    "created",
    "scope",
    "checkoutCreationAllowed",
    "originalPanelContinuity",
  ]) &&
    previous.sessionId === CURRENT_BILLING_CONTINUATION.sessionId &&
    previous.sourceJournalSha256 === originalSourceSha256 &&
    previous.baselineSha256 === baseline.evidenceSha256 &&
    previous.created === 1792390923 &&
    previous.scope === "exact_unpaid_checkout_navigation_continuation" &&
    previous.checkoutCreationAllowed === false &&
    previous.originalPanelContinuity === false, "CARD_SELECTION_PRIOR_RECEIPT_REQUIRED");
  const historyNames = [
    "protected-billing-checkout-v1.json",
    "protected-billing-checkout-v2.json",
    "current-price-quote-cb8a296-v1.jsonl",
    C.journal,
  ];
  require(exactKeys(original.history, historyNames) &&
    Object.values(original.history).every(sha256) &&
    original.history[C.journal] === originalSourceSha256, "CARD_SELECTION_HISTORY_REQUIRED");
  const quote = original.deployedQuote;
  require(exactKeys(quote, [
    "sessionId",
    "journalSha256",
    "accountBinding",
    "deployedKeyEqualityVerified",
    "scope",
  ]) &&
    validId(quote.sessionId, "cs_test") &&
    quote.sessionId !== CURRENT_BILLING_CONTINUATION.sessionId &&
    quote.journalSha256 === original.history[historyNames[2]] &&
    quote.accountBinding === "account_scoped_price_prewrite_guard" &&
    quote.deployedKeyEqualityVerified === false &&
    quote.scope === "prior_same_deployment_unpaid_quote", "CARD_SELECTION_QUOTE_REQUIRED");
  const free = original.free;
  require(exactKeys(free, [
    "action",
    "isPro",
    "billingRevision",
    "sourceHash",
    "samePanelTransition",
    "sameOpenPanelTransition",
    "sessionReused",
    "aiRequests",
    "captures",
    "extractions",
    "artifactPath",
  ]) &&
    free.action === "expect-free" &&
    free.isPro === false &&
    free.billingRevision === baseline.billingRevision &&
    sha256(free.sourceHash) &&
    free.samePanelTransition === false &&
    free.sameOpenPanelTransition === false &&
    free.sessionReused === false &&
    free.aiRequests === 0 &&
    free.captures === 0 &&
    free.extractions === 0 &&
    typeof free.artifactPath === "string" &&
    free.artifactPath.startsWith("/") &&
    typeof original.runDirectory === "string" &&
    original.runDirectory.startsWith("/"), "CARD_SELECTION_FREE_REQUIRED");
  return freeze({
    priorContinuationSha256: createHash("sha256").update(journalText).digest("hex"),
    scope: "pre_payment_card_selection_only",
    originalPanelContinuity: false,
  });
}

export function assertCurrentPaid({
  baseline,
  session,
  lines,
  subscription,
  invoice,
  profile,
  events,
  subscriptions,
  open,
} = {}) {
  currentState(baseline, subscriptions, open, subscription, "active");
  profileScope(profile, baseline.userId, true);
  require(profile.billing_revision > baseline.billingRevision, "PAID_REVISION_REQUIRED");
  sessionScope(session, lines, baseline.userId);
  require(session.status === "complete" &&
    session.payment_status === "paid" &&
    id(session.subscription) === subscription.id &&
    id(session.invoice) === invoice?.id &&
    id(subscription.latest_invoice) === invoice?.id, "PAID_CHECKOUT_REQUIRED");
  require(validId(invoice?.id, "in") &&
    invoice.object === "invoice" &&
    invoice.livemode === false &&
    id(invoice.customer) === C.customer &&
    invoiceSubscription(invoice) === subscription.id &&
    invoice.status === "paid" &&
    invoice.billing_reason === "subscription_create" &&
    invoice.currency === "usd" &&
    invoice.amount_due === 999 &&
    invoice.amount_paid === 999 &&
    invoice.amount_remaining === 0 &&
    invoice.total === 999 &&
    invoice.subtotal === 999, "PAID_INVOICE_REQUIRED");
  const eventId = delivered(
    events,
    "invoice.paid",
    (object) =>
      object.object === "invoice" &&
      object.id === invoice.id &&
      object.status === "paid" &&
      object.currency === "usd" &&
      object.billing_reason === "subscription_create" &&
      object.amount_due === 999 &&
      object.amount_paid === 999 &&
      object.amount_remaining === 0 &&
      object.subtotal === 999 &&
      object.total === 999 &&
      invoiceSubscription(object) === subscription.id,
  );
  require(eventId, "HOSTED_PAID_EVENT_REQUIRED");
  return seal({
    phase: "paid",
    account: C.account,
    origin: C.origin,
    source: C.source,
    customerId: C.customer,
    price: C.price,
    userId: baseline.userId,
    baselineSha256: baseline.evidenceSha256,
    sessionId: session.id,
    subscriptionId: subscription.id,
    invoiceId: invoice.id,
    billingRevision: profile.billing_revision,
    eventId,
  });
}

export function assertCurrentCanceled({
  baseline,
  paid,
  subscription,
  profile,
  events,
  preCancelRevision,
  subscriptions,
  open,
} = {}) {
  proof(paid, "paid");
  currentState(baseline, subscriptions, open, subscription, "canceled");
  require(paid.baselineSha256 === baseline.evidenceSha256 &&
    paid.userId === baseline.userId &&
    subscription.id === paid.subscriptionId &&
    revision(preCancelRevision) &&
    preCancelRevision >= paid.billingRevision, "CANCEL_PREDECESSOR_REQUIRED");
  profileScope(profile, baseline.userId, false);
  require(profile.billing_revision > preCancelRevision, "CANCELED_REVISION_REQUIRED");
  const eventId = delivered(
    events,
    "customer.subscription.deleted",
    (object) =>
      object.object === "subscription" &&
      object.id === paid.subscriptionId &&
      object.status === "canceled" &&
      JSON.stringify(subSnapshot(object, baseline.userId, C.price)) ===
        JSON.stringify(subSnapshot(subscription, baseline.userId, C.price)),
  );
  require(eventId, "HOSTED_DELETED_EVENT_REQUIRED");
  return seal({
    phase: "canceled",
    account: C.account,
    origin: C.origin,
    source: C.source,
    customerId: C.customer,
    price: C.price,
    userId: baseline.userId,
    baselineSha256: baseline.evidenceSha256,
    paidSha256: paid.evidenceSha256,
    sessionId: paid.sessionId,
    subscriptionId: paid.subscriptionId,
    invoiceId: paid.invoiceId,
    billingRevision: profile.billing_revision,
    preCancelRevision,
    eventId,
  });
}
