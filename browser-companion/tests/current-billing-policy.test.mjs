import assert from "node:assert/strict";
import {
  CURRENT_BILLING_SCOPE as C,
  CURRENT_BILLING_CONTINUATION as K,
  assertCurrentBaseline,
  assertCurrentOpenCheckout,
  assertCurrentPaid,
  assertCurrentCanceled,
  assertCurrentDeploymentQuoteEvidence,
  assertCurrentUnpaidContinuation,
  assertCurrentCardSelectionContinuation,
} from "../../scripts/current-billing-policy.mjs";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";
import { QUOTE_SCOPE } from "../../scripts/verify-current-sandbox-quote.mjs";
import { CURRENT_SANDBOX_TARGET } from "../../scripts/verify-current-stripe-sandbox-price.mjs";

const userId = "11111111-2222-3333-4444-555555555555";
const nonce = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const clone = structuredClone;
const list = (data) => ({ data, has_more: false });
const subscription = (id, status, price) => ({
  id,
  object: "subscription",
  livemode: false,
  customer: C.customer,
  metadata: { user_id: userId },
  status,
  created: 100,
  canceled_at: status === "canceled" ? 200 : null,
  ended_at: status === "canceled" ? 200 : null,
  latest_invoice: `in_${id.replaceAll("_", "")}`,
  items: list([
    {
      id: `si_${id.replaceAll("_", "")}`,
      price: { id: price },
      quantity: 1,
      current_period_start: 100,
      current_period_end: 300,
    },
  ]),
});
const delivery = (event) => ({
  event: clone(event),
  delivery: {
    eventId: event.id,
    eventType: event.type,
    httpStatus: 200,
    at: 1800000000000,
  },
});
function baselineInput() {
  return {
    record: {
      version: 1,
      marker: "unimate-stripe-sandbox-synthetic-v1",
      account: C.account,
      price: TARGET.price,
      supabase: TARGET.supabase,
      userId,
      nonce,
      email: `unimate-billing-${nonce}@example.test`,
      password: "not-in-evidence",
    },
    profile: { id: userId, stripe_customer_id: C.customer, is_pro: false, billing_revision: 80 },
    customer: {
      id: C.customer,
      livemode: false,
      metadata: { user_id: userId },
      test_clock: "clock_fixture",
    },
    subscriptions: list(
      Array.from({ length: 7 }, (_, i) => subscription(`sub_old${i}`, "canceled", TARGET.price)),
    ),
    open: list([]),
  };
}
function openInput() {
  return {
    userId,
    session: {
      id: "cs_test_fresh",
      object: "checkout.session",
      livemode: false,
      customer: C.customer,
      client_reference_id: userId,
      metadata: { user_id: userId },
      mode: "subscription",
      status: "open",
      payment_status: "unpaid",
      subscription: null,
      payment_intent: null,
      invoice: null,
      currency: "usd",
      amount_subtotal: 999,
      amount_total: 999,
      total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 },
      automatic_tax: { enabled: false },
      success_url: `${C.origin}/upgrade?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${C.origin}/upgrade?canceled=true`,
      url: "https://checkout.stripe.com/c/pay/cs_test_fresh#opaque",
    },
    lines: list([
      {
        id: "li_fresh",
        price: { id: C.price },
        quantity: 1,
        amount_subtotal: 999,
        amount_total: 999,
        currency: "usd",
      },
    ]),
  };
}
function paidInput() {
  const initial = baselineInput();
  const baseline = assertCurrentBaseline(initial);
  const open = openInput();
  const sub = subscription("sub_fresh", "active", C.price);
  sub.latest_invoice = "in_fresh";
  const invoice = {
    id: "in_fresh",
    object: "invoice",
    livemode: false,
    customer: C.customer,
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: { id: sub.id } },
    },
    status: "paid",
    billing_reason: "subscription_create",
    currency: "usd",
    amount_due: 999,
    amount_paid: 999,
    amount_remaining: 0,
    subtotal: 999,
    total: 999,
  };
  return {
    baseline,
    session: {
      ...open.session,
      status: "complete",
      payment_status: "paid",
      subscription: sub.id,
      invoice: invoice.id,
    },
    lines: open.lines,
    subscription: sub,
    invoice,
    profile: { ...initial.profile, is_pro: true, billing_revision: 82 },
    events: [
      delivery({
        id: "evt_paid",
        type: "invoice.paid",
        livemode: false,
        account: C.account,
        data: { object: invoice },
      }),
    ],
    subscriptions: list([...initial.subscriptions.data, clone(sub)]),
    open: list([]),
  };
}
function canceledInput() {
  const purchase = paidInput();
  const sub = {
    ...clone(purchase.subscription),
    status: "canceled",
    canceled_at: 400,
    ended_at: 400,
  };
  return {
    baseline: purchase.baseline,
    paid: assertCurrentPaid(purchase),
    subscription: sub,
    profile: { ...purchase.profile, is_pro: false, billing_revision: 85 },
    preCancelRevision: 84,
    subscriptions: list([...purchase.subscriptions.data.slice(0, 7), clone(sub)]),
    open: list([]),
    events: [
      delivery({
        id: "evt_deleted",
        type: "customer.subscription.deleted",
        livemode: false,
        data: { object: sub },
      }),
    ],
  };
}
function quoteEvidenceInput() {
  const opened = openInput();
  const rows = ["create-pending", "quote-verified", "expiry-pending", "expired-verified"].map(
    (phase, i) => ({
      version: 1,
      phase,
      at: 1800000000000 + i,
      account: C.account,
      price: C.price,
      customer: C.customer,
      deployment: C.deployment,
      source: C.source,
      baselineRevision: 80,
      accountBinding: "account_scoped_price_prewrite_guard",
      deployedKeyEqualityVerified: false,
      ...(i ? { sessionId: opened.session.id, amountCents: 999 } : {}),
    }),
  );
  return {
    userId,
    session: { ...opened.session, status: "expired", url: null },
    lines: opened.lines,
    journalText: rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  };
}
function changeQuoteRows(input, change) {
  const rows = input.journalText
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  change(rows);
  input.journalText = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}
function continuationInput() {
  const baseline = assertCurrentBaseline(baselineInput());
  const opened = openInput();
  opened.session.id = K.sessionId;
  opened.session.url = `https://checkout.stripe.com/c/pay/${K.sessionId}#private-checkout`;
  opened.session.created = 1792390923;
  const quote = assertCurrentDeploymentQuoteEvidence(quoteEvidenceInput());
  const times = [1792390907007, 1792390921971, 1792390924126];
  const rows = ["baseline", "create-pending", "stopped"].map((phase, index) => ({
    version: 1,
    sequence: index + 1,
    at: times[index],
    phase,
    account: C.account,
    price: C.price,
    origin: C.origin,
    source: C.source,
    ...(index === 0
      ? {
          baseline,
          history: {
            "protected-billing-checkout-v1.json": "1".repeat(64),
            "protected-billing-checkout-v2.json": "2".repeat(64),
            "current-price-quote-cb8a296-v1.jsonl": quote.journalSha256,
          },
          deployedQuote: quote,
          free: {
            action: "expect-free",
            isPro: false,
            billingRevision: baseline.billingRevision,
            sourceHash: "3".repeat(64),
            samePanelTransition: false,
            sameOpenPanelTransition: false,
            sessionReused: false,
            aiRequests: 0,
            captures: 0,
            extractions: 0,
            artifactPath: "/private/synthetic-evidence/free.png",
          },
          runDirectory: "/private/synthetic-evidence",
        }
      : index === 2
        ? { stage: "CHECKOUT", code: "CURRENT_STOP_AND_RECONCILE" }
        : {}),
  }));
  return {
    journalText: rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    session: opened.session,
    lines: opened.lines,
    baseline,
    open: list([clone(opened.session)]),
  };
}
function rejects(factory, verify, mutations) {
  for (const mutate of mutations) {
    const input = factory();
    mutate(input);
    assert.throws(() => verify(input), /CURRENT_BILLING_/, mutate.toString());
  }
}
function cardSelectionInput() {
  const original = continuationInput();
  const receipt = assertCurrentUnpaidContinuation(original);
  const first = JSON.parse(original.journalText.split("\n")[0]);
  first.continuation = receipt;
  first.history[C.journal] = receipt.sourceJournalSha256;
  first.at = 1792391000000;
  const rows = [
    first,
    ...["checkout-verified", "card-selection-pending", "card-selected"].map((phase, index) => ({
      version: 1,
      sequence: index + 2,
      at: first.at + index + 1,
      phase,
      account: C.account,
      price: C.price,
      origin: C.origin,
      source: C.source,
      sessionId: K.sessionId,
      ...(index === 0
        ? { amountCents: 999, continued: true }
        : index === 1
          ? { helperSha256: "4".repeat(64) }
          : {}),
    })),
  ];
  return {
    journalText: rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    baseline: original.baseline,
    originalSourceSha256: receipt.sourceJournalSha256,
  };
}

assert.equal(C.origin, QUOTE_SCOPE.origin);
assert.equal(C.source, QUOTE_SCOPE.source);
assert.equal(C.deployment, QUOTE_SCOPE.deployment);
assert.equal(C.price, CURRENT_SANDBOX_TARGET.price);
assert.equal(C.amountCents, 999);
assert.equal(C.journal, "current-billing-999-v1.jsonl");
const initial = baselineInput();
const baseline = assertCurrentBaseline(initial);
assert.ok(Object.isFrozen(baseline) && Object.isFrozen(baseline.subscriptions[0]));
assert.doesNotMatch(JSON.stringify(baseline), /password|not-in-evidence|example\.test/);
initial.subscriptions.data[0].status = "active";
assert.equal(baseline.subscriptions[0].status, "canceled", "baseline must not share input objects");
assert.equal(assertCurrentOpenCheckout(openInput()).amountCents, 999);
assert.equal(assertCurrentPaid(paidInput()).phase, "paid");
assert.equal(assertCurrentCanceled(canceledInput()).phase, "canceled");
const legacyInvoice = paidInput();
delete legacyInvoice.invoice.parent;
legacyInvoice.invoice.subscription = "sub_fresh";
legacyInvoice.events[0].event.data.object = clone(legacyInvoice.invoice);
assert.equal(
  assertCurrentPaid(legacyInvoice).invoiceId,
  "in_fresh",
  "legacy invoice subscription remains supported",
);

rejects(baselineInput, assertCurrentBaseline, [
  (x) => (x.record.marker = "owner"),
  (x) => (x.record.account = "acct_other"),
  (x) => (x.record.price = C.price),
  (x) => (x.record.email = "real@example.com"),
  (x) => (x.record.supabase = "https://other.test"),
  (x) => (x.record.userId = "not-a-uuid"),
  (x) => (x.customer.id = "cus_other"),
  (x) => (x.customer.livemode = true),
  (x) => (x.customer.metadata.user_id = "other"),
  (x) => (x.customer.test_clock = null),
  (x) => (x.profile.is_pro = true),
  (x) => (x.profile.billing_revision = -1),
  (x) => (x.profile.stripe_customer_id = "cus_other"),
  (x) => (x.subscriptions.has_more = true),
  (x) => x.subscriptions.data.pop(),
  (x) => (x.subscriptions.data[0] = clone(x.subscriptions.data[1])),
  (x) => (x.subscriptions.data[0].status = "active"),
  (x) => (x.subscriptions.data[0].items.data[0].price.id = C.price),
  (x) => (x.subscriptions.data[0].items.has_more = true),
  (x) => (x.subscriptions.data[0].created = {}),
  (x) => (x.subscriptions.data[0].items.data[0].current_period_end = "300"),
  (x) => (x.open.has_more = true),
  (x) => x.open.data.push({ id: "cs_test_other" }),
]);
rejects(openInput, assertCurrentOpenCheckout, [
  (x) => (x.session.livemode = true),
  (x) => (x.session.customer = "cus_other"),
  (x) => (x.session.client_reference_id = "other"),
  (x) => (x.session.metadata.user_id = "other"),
  (x) => (x.session.amount_total = 599),
  (x) => (x.session.amount_subtotal = 599),
  (x) => (x.session.currency = "eur"),
  (x) => (x.session.total_details.amount_tax = 1),
  (x) => (x.session.total_details.amount_discount = 1),
  (x) => (x.session.automatic_tax.enabled = true),
  (x) => (x.session.subscription = "sub_prior"),
  (x) => (x.session.payment_intent = "pi_prior"),
  (x) => (x.session.payment_status = "paid"),
  (x) => (x.session.status = "complete"),
  (x) => (x.session.success_url = "https://other.test"),
  (x) => (x.session.cancel_url = "https://other.test"),
  (x) => (x.session.url = "https://checkout.stripe.com/c/pay/cs_test_other"),
  (x) => (x.session.url = "https://checkout.stripe.com.evil.test/c/pay/cs_test_fresh"),
  (x) => (x.session.url = "https://user@checkout.stripe.com/c/pay/cs_test_fresh"),
  (x) => (x.lines.data[0].price.id = TARGET.price),
  (x) => (x.lines.data[0].quantity = 2),
  (x) => (x.lines.has_more = true),
  (x) => x.lines.data.push(clone(x.lines.data[0])),
]);
rejects(paidInput, assertCurrentPaid, [
  (x) => (x.baseline = { ...x.baseline, billingRevision: 0 }),
  (x) => (x.profile.is_pro = false),
  (x) => (x.profile.billing_revision = x.baseline.billingRevision),
  (x) => (x.session.payment_status = "unpaid"),
  (x) => (x.session.invoice = "in_other"),
  (x) => (x.session.subscription = "sub_other"),
  (x) => (x.subscription.latest_invoice = "in_other"),
  (x) => x.subscriptions.data[0].ended_at++,
  (x) => (x.subscriptions.data[0].metadata.user_id = "other"),
  (x) => x.subscriptions.data.push(subscription("sub_extra", "active", C.price)),
  (x) => (x.subscriptions.data.at(-1).status = "past_due"),
  (x) => (x.open.has_more = true),
  (x) => x.open.data.push({ id: "cs_test_extra" }),
  (x) => (x.invoice.status = "open"),
  (x) => (x.invoice.billing_reason = "subscription_cycle"),
  (x) => (x.invoice.amount_paid = 599),
  (x) => (x.invoice.amount_remaining = 999),
  (x) => (x.invoice.customer = "cus_other"),
  (x) => (x.invoice.parent.subscription_details.subscription.id = "sub_other"),
  (x) => {
    x.invoice.parent.type = "quote_details";
    x.invoice.subscription = "sub_fresh";
  },
  (x) => (x.events = []),
  (x) => (x.events = [null]),
  (x) => (x.events[0].delivery.httpStatus = 503),
  (x) => (x.events[0].delivery.eventId = "evt_other"),
  (x) => (x.events[0].delivery.eventType = "invoice.created"),
  (x) => (x.events[0].delivery.at = 0),
  (x) => (x.events[0].event.account = "acct_other"),
  (x) => (x.events[0].event.context = "acct_other"),
  (x) => (x.events[0].event.livemode = true),
  (x) => (x.events[0].event.data.object.id = "in_other"),
  (x) => (x.events[0].event.data.object.parent.subscription_details.subscription.id = "sub_other"),
  (x) => (x.events[0].event.data.object.customer = "cus_other"),
  (x) => (x.events[0].event.data.object.amount_due = 599),
  (x) => (x.events[0].event.data.object.amount_remaining = 999),
  (x) => (x.events[0].event.data.object.billing_reason = "subscription_cycle"),
]);
rejects(canceledInput, assertCurrentCanceled, [
  (x) => (x.paid = { ...x.paid, subscriptionId: "sub_other" }),
  (x) => (x.preCancelRevision = x.paid.billingRevision - 1),
  (x) => (x.profile.billing_revision = x.preCancelRevision),
  (x) => (x.profile.is_pro = true),
  (x) => (x.subscription.status = "active"),
  (x) => (x.subscription.id = "sub_other"),
  (x) => x.subscriptions.data[0].canceled_at++,
  (x) => (x.subscriptions.data.at(-1).items.data[0].price.id = TARGET.price),
  (x) => x.open.data.push({ id: "cs_test_open" }),
  (x) => (x.events = []),
  (x) => (x.events[0].delivery.httpStatus = 500),
  (x) => (x.events[0].delivery.eventId = "evt_other"),
  (x) => (x.events[0].event.data.object.id = "sub_other"),
  (x) => (x.events[0].event.data.object.status = "active"),
  (x) => (x.events[0].event.data.object.items.data[0].price.id = TARGET.price),
]);
const quoteEvidence = assertCurrentDeploymentQuoteEvidence(quoteEvidenceInput());
assert.equal(quoteEvidence.sessionId, "cs_test_fresh");
assert.equal(quoteEvidence.scope, "prior_same_deployment_unpaid_quote");
assert.equal(quoteEvidence.deployedKeyEqualityVerified, false);
assert.match(quoteEvidence.journalSha256, /^[a-f0-9]{64}$/);
assert.ok(Object.isFrozen(quoteEvidence));
assert.equal(
  "deploymentOverridesAbsent" in quoteEvidence,
  false,
  "prior quote is not env-override proof",
);
assert.doesNotMatch(JSON.stringify(quoteEvidence), /example\.test|success_url|password/);
rejects(quoteEvidenceInput, assertCurrentDeploymentQuoteEvidence, [
  (x) => (x.journalText = ""),
  (x) => (x.journalText = "{}\n".repeat(20000)),
  (x) => (x.journalText = x.journalText.trimEnd()),
  (x) => (x.journalText += "\n"),
  (x) => (x.journalText = "not JSON\n"),
  (x) => changeQuoteRows(x, (rows) => rows.pop()),
  (x) => changeQuoteRows(x, (rows) => rows.push(clone(rows.at(-1)))),
  (x) => changeQuoteRows(x, (rows) => rows.reverse()),
  (x) => changeQuoteRows(x, (rows) => (rows[2].phase = "expired-verified")),
  (x) => changeQuoteRows(x, (rows) => (rows[3].version = 2)),
  (x) => changeQuoteRows(x, (rows) => (rows[1].account = "acct_other")),
  (x) => changeQuoteRows(x, (rows) => (rows[1].price = TARGET.price)),
  (x) => changeQuoteRows(x, (rows) => (rows[1].customer = "cus_other")),
  (x) => changeQuoteRows(x, (rows) => (rows[1].deployment = "dpl_other")),
  (x) => changeQuoteRows(x, (rows) => (rows[1].source = "0".repeat(40))),
  (x) => changeQuoteRows(x, (rows) => rows[1].baselineRevision++),
  (x) => changeQuoteRows(x, (rows) => (rows[0].baselineRevision = -1)),
  (x) => changeQuoteRows(x, (rows) => (rows[1].accountBinding = "identical_test_key_sha256")),
  (x) => changeQuoteRows(x, (rows) => (rows[1].deployedKeyEqualityVerified = true)),
  (x) => changeQuoteRows(x, (rows) => (rows[1].sessionId = "cs_test_other")),
  (x) => changeQuoteRows(x, (rows) => (rows[1].amountCents = 599)),
  (x) => changeQuoteRows(x, (rows) => (rows[2].at = rows[0].at - 1)),
  (x) => changeQuoteRows(x, (rows) => (rows[0].at = 0)),
  (x) => changeQuoteRows(x, (rows) => (rows[0].sessionId = "cs_test_fresh")),
  (x) => changeQuoteRows(x, (rows) => (rows[3].deploymentOverridesAbsent = true)),
  (x) => (x.session.id = "cs_test_other"),
  (x) => (x.session.object = "invoice"),
  (x) => (x.session.status = "open"),
  (x) => (x.session.livemode = true),
  (x) => (x.session.payment_status = "paid"),
  (x) => (x.session.invoice = "in_paid"),
  (x) => (x.session.subscription = "sub_paid"),
  (x) => (x.session.payment_intent = "pi_paid"),
  (x) => (x.session.customer = "cus_other"),
  (x) => (x.userId = "99999999-8888-7777-6666-555555555555"),
  (x) => (x.session.amount_total = 599),
  (x) => (x.session.success_url = "https://other.vercel.app/upgrade"),
  (x) => (x.lines.data[0].price.id = TARGET.price),
  (x) => (x.lines.has_more = true),
]);
assert.ok(Object.isFrozen(K));
assert.equal(K.journal, "current-billing-999-continuation-v1.jsonl");
assert.equal(K.resumeJournal, "current-billing-999-continuation-v2.jsonl");
assert.equal(K.sessionId, "cs_test_a1nQZGsGq3n9YlmiBimUautrLwnwkcRk40ezjDf4wSrRQFWE0Q11aKiH5f");
const continued = assertCurrentUnpaidContinuation(continuationInput());
assert.ok(Object.isFrozen(continued));
assert.equal(continued.sessionId, K.sessionId);
assert.equal(continued.checkoutCreationAllowed, false);
assert.equal(continued.originalPanelContinuity, false);
assert.match(continued.sourceJournalSha256, /^[a-f0-9]{64}$/);
assert.doesNotMatch(
  JSON.stringify(continued),
  /private-checkout|synthetic-evidence|password|artifactPath/,
);
const changedWhitespace = continuationInput();
changedWhitespace.journalText = changedWhitespace.journalText.replace('{"version"', '{ "version"');
assert.notEqual(
  assertCurrentUnpaidContinuation(changedWhitespace).sourceJournalSha256,
  continued.sourceJournalSha256,
  "receipt binds the original raw journal bytes",
);
rejects(continuationInput, assertCurrentUnpaidContinuation, [
  (x) => (x.journalText = ""),
  (x) => (x.journalText = "{}\n".repeat(25000)),
  (x) => (x.journalText = x.journalText.trimEnd()),
  (x) => (x.journalText += "\n"),
  (x) => (x.journalText = "malformed\n"),
  (x) => changeQuoteRows(x, (rows) => rows.pop()),
  (x) => changeQuoteRows(x, (rows) => rows.push({ phase: "payment-pending" })),
  (x) => changeQuoteRows(x, (rows) => rows.reverse()),
  (x) => changeQuoteRows(x, (rows) => (rows[1].phase = "payment-pending")),
  (x) => changeQuoteRows(x, (rows) => (rows[1].sequence = 3)),
  (x) => changeQuoteRows(x, (rows) => (rows[1].version = 2)),
  (x) => changeQuoteRows(x, (rows) => rows[0].at++),
  (x) => changeQuoteRows(x, (rows) => rows[1].at++),
  (x) => changeQuoteRows(x, (rows) => rows[2].at++),
  (x) => changeQuoteRows(x, (rows) => (rows[1].account = "acct_other")),
  (x) => changeQuoteRows(x, (rows) => (rows[1].price = TARGET.price)),
  (x) => changeQuoteRows(x, (rows) => (rows[1].origin = "https://other.vercel.app")),
  (x) => changeQuoteRows(x, (rows) => (rows[1].source = "0".repeat(40))),
  (x) => changeQuoteRows(x, (rows) => (rows[2].stage = "PAY")),
  (x) => changeQuoteRows(x, (rows) => (rows[2].code = "UNEXPECTED_OTHER_ERROR")),
  (x) => changeQuoteRows(x, (rows) => (rows[1].paymentAttempted = false)),
  (x) => changeQuoteRows(x, (rows) => (rows[0].continuation = {})),
  (x) => changeQuoteRows(x, (rows) => rows[0].baseline.billingRevision++),
  (x) => {
    const fresh = baselineInput();
    fresh.profile.billing_revision++;
    x.baseline = assertCurrentBaseline(fresh);
  },
  (x) => {
    const fresh = baselineInput();
    fresh.subscriptions.data[0].ended_at++;
    x.baseline = assertCurrentBaseline(fresh);
  },
  (x) => changeQuoteRows(x, (rows) => delete rows[0].history["protected-billing-checkout-v1.json"]),
  (x) =>
    changeQuoteRows(x, (rows) => (rows[0].history["protected-billing-checkout-v1.json"] = "bad")),
  (x) => changeQuoteRows(x, (rows) => (rows[0].deployedQuote.sessionId = K.sessionId)),
  (x) => changeQuoteRows(x, (rows) => (rows[0].deployedQuote.journalSha256 = "f".repeat(64))),
  (x) => changeQuoteRows(x, (rows) => (rows[0].deployedQuote.deployedKeyEqualityVerified = true)),
  (x) => changeQuoteRows(x, (rows) => (rows[0].free.action = "expect-pro")),
  (x) => changeQuoteRows(x, (rows) => (rows[0].free.isPro = true)),
  (x) => changeQuoteRows(x, (rows) => rows[0].free.billingRevision++),
  (x) => changeQuoteRows(x, (rows) => (rows[0].free.sourceHash = "bad")),
  (x) => changeQuoteRows(x, (rows) => (rows[0].free.samePanelTransition = true)),
  (x) => changeQuoteRows(x, (rows) => (rows[0].free.sameOpenPanelTransition = true)),
  (x) => changeQuoteRows(x, (rows) => (rows[0].free.sessionReused = true)),
  (x) => changeQuoteRows(x, (rows) => (rows[0].free.aiRequests = 1)),
  (x) => changeQuoteRows(x, (rows) => (rows[0].free.captures = 1)),
  (x) => changeQuoteRows(x, (rows) => (rows[0].free.extractions = 1)),
  (x) => (x.open = undefined),
  (x) => (x.open.has_more = true),
  (x) => (x.open.data = []),
  (x) => x.open.data.push({ ...clone(x.session), id: "cs_test_another" }),
  (x) => (x.open.data[0].id = "cs_test_other"),
  (x) => (x.open.data[0].customer = "cus_other"),
  (x) => (x.open.data[0].payment_intent = "pi_started"),
  (x) => (x.open.data[0].subscription = "sub_started"),
  (x) => (x.open.data[0].invoice = "in_started"),
  (x) => (x.open.data[0].created = 1792390922),
  (x) => (x.session.id = "cs_test_other"),
  (x) => (x.session.created = 1792390921),
  (x) => (x.session.created = 1792390925),
  (x) => (x.session.created = "1792390923"),
  (x) => (x.session.status = "expired"),
  (x) => (x.session.payment_status = "paid"),
  (x) => (x.session.payment_intent = "pi_started"),
  (x) => (x.session.subscription = "sub_started"),
  (x) => (x.session.invoice = "in_started"),
  (x) => (x.session.amount_total = 599),
  (x) => (x.lines.data[0].price.id = TARGET.price),
]);
const selectedOnly = assertCurrentCardSelectionContinuation(cardSelectionInput());
assert.ok(Object.isFrozen(selectedOnly));
assert.equal(selectedOnly.scope, "pre_payment_card_selection_only");
assert.equal(selectedOnly.originalPanelContinuity, false);
assert.match(selectedOnly.priorContinuationSha256, /^[a-f0-9]{64}$/);
assert.doesNotMatch(
  JSON.stringify(selectedOnly),
  /private-checkout|synthetic-evidence|helperSha256|artifactPath/,
);
const whitespaceCard = cardSelectionInput();
whitespaceCard.journalText = whitespaceCard.journalText.replace('{"version"', '{ "version"');
assert.notEqual(
  assertCurrentCardSelectionContinuation(whitespaceCard).priorContinuationSha256,
  selectedOnly.priorContinuationSha256,
);
rejects(cardSelectionInput, assertCurrentCardSelectionContinuation, [
  (x) => (x.journalText = ""),
  (x) => (x.journalText = "not-json\n"),
  (x) => (x.journalText = "{}\n".repeat(25000)),
  (x) => (x.journalText = x.journalText.trimEnd()),
  (x) => (x.journalText += "\n"),
  (x) => (x.originalSourceSha256 = "bad"),
  (x) => (x.originalSourceSha256 = "f".repeat(64)),
  (x) => changeQuoteRows(x, (rows) => rows.pop()),
  (x) => changeQuoteRows(x, (rows) => rows.push({ phase: "fill-pending" })),
  (x) => changeQuoteRows(x, (rows) => rows.push({ phase: "payment-pending" })),
  (x) => changeQuoteRows(x, (rows) => rows.push({ phase: "stopped" })),
  (x) => changeQuoteRows(x, (rows) => rows.reverse()),
  (x) => changeQuoteRows(x, (rows) => (rows[2].phase = "fill-pending")),
  (x) => changeQuoteRows(x, (rows) => (rows[3].phase = "payment-pending")),
  (x) => changeQuoteRows(x, (rows) => (rows[1].sequence = 1)),
  (x) => changeQuoteRows(x, (rows) => (rows[1].version = 2)),
  (x) => changeQuoteRows(x, (rows) => (rows[1].account = "acct_other")),
  (x) => changeQuoteRows(x, (rows) => (rows[1].price = TARGET.price)),
  (x) => changeQuoteRows(x, (rows) => (rows[1].origin = "https://other.vercel.app")),
  (x) => changeQuoteRows(x, (rows) => (rows[1].source = "0".repeat(40))),
  (x) => changeQuoteRows(x, (rows) => (rows[1].at = 0)),
  (x) => changeQuoteRows(x, (rows) => (rows[1].at = rows[0].at - 1)),
  (x) => changeQuoteRows(x, (rows) => (rows[1].sessionId = "cs_test_other")),
  (x) => changeQuoteRows(x, (rows) => (rows[2].sessionId = "cs_test_other")),
  (x) => changeQuoteRows(x, (rows) => (rows[3].sessionId = "cs_test_other")),
  (x) => changeQuoteRows(x, (rows) => (rows[1].amountCents = 599)),
  (x) => changeQuoteRows(x, (rows) => (rows[1].continued = false)),
  (x) => changeQuoteRows(x, (rows) => (rows[2].helperSha256 = "bad")),
  (x) => changeQuoteRows(x, (rows) => (rows[3].paymentAttempted = false)),
  (x) => changeQuoteRows(x, (rows) => rows[0].baseline.billingRevision++),
  (x) => {
    const fresh = baselineInput();
    fresh.profile.billing_revision++;
    x.baseline = assertCurrentBaseline(fresh);
  },
  (x) => changeQuoteRows(x, (rows) => (rows[0].continuation.sessionId = "cs_test_other")),
  (x) => changeQuoteRows(x, (rows) => (rows[0].continuation.sourceJournalSha256 = "e".repeat(64))),
  (x) => changeQuoteRows(x, (rows) => (rows[0].continuation.baselineSha256 = "e".repeat(64))),
  (x) => changeQuoteRows(x, (rows) => (rows[0].continuation.created = 1792390924)),
  (x) => changeQuoteRows(x, (rows) => (rows[0].continuation.scope = "payment_retry")),
  (x) => changeQuoteRows(x, (rows) => (rows[0].continuation.checkoutCreationAllowed = true)),
  (x) => changeQuoteRows(x, (rows) => (rows[0].continuation.originalPanelContinuity = true)),
  (x) => changeQuoteRows(x, (rows) => delete rows[0].history[C.journal]),
  (x) => changeQuoteRows(x, (rows) => (rows[0].history[C.journal] = "d".repeat(64))),
  (x) => changeQuoteRows(x, (rows) => (rows[0].deployedQuote.journalSha256 = "d".repeat(64))),
  (x) => changeQuoteRows(x, (rows) => (rows[0].free.isPro = true)),
  (x) => changeQuoteRows(x, (rows) => rows[0].free.billingRevision++),
  (x) => changeQuoteRows(x, (rows) => (rows[0].free.sameOpenPanelTransition = true)),
  (x) => changeQuoteRows(x, (rows) => (rows[0].free.aiRequests = 1)),
]);
console.log(
  "PASS current $9.99 billing policy: fixed scope, immutable baseline, paid/deleted event binding, advancing access revisions (offline)",
);
