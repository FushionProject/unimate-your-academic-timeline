import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CURRENT_BILLING_SCOPE as C,
  CURRENT_BILLING_CONTINUATION as K,
} from "../../scripts/current-billing-policy.mjs";
import {
  RETIREMENT_SCOPE as R,
  assertFailedCurrentIntent,
  assertRetiredCurrentIntent,
  assertFailedSourceHistory,
  assertRetiredCurrentAttempt,
  retireFailedCurrentAttempt,
} from "../../scripts/current-billing-retirement.mjs";
const sha = (x) => createHash("sha256").update(x).digest("hex");
const baseline = {
  phase: "baseline",
  billingRevision: 80,
  userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  evidenceSha256: "a".repeat(64),
};
const phases = [
  ["baseline", "create-pending", "stopped"],
  ["baseline", "checkout-verified", "card-selection-pending", "card-selected"],
  [
    "baseline",
    "checkout-verified",
    "card-selection-pending",
    "card-selected",
    "fill-pending",
    "filled",
    "payment-pending",
  ],
];
const texts = Object.fromEntries(
  R.sourceNames.slice(0, 3).map((name, i) => [
    name,
    phases[i]
      .map((phase, n) =>
        JSON.stringify({
          version: 1,
          sequence: n + 1,
          at: 1800000000000 + n,
          phase,
          account: C.account,
          price: C.price,
          origin: C.origin,
          source: C.source,
          ...(n === 0 ? { baseline } : {}),
          ...(i > 0 && n > 0 ? { sessionId: K.sessionId } : {}),
        }),
      )
      .join("\n") + "\n",
  ]),
);
texts[R.sourceNames[3]] = JSON.stringify({
  version: 1,
  phase: "claimed",
  sessionSha256: sha(K.sessionId),
  claimedAt: 1800000000001,
});
const history = assertFailedSourceHistory({ texts, baseline });
const intent = {
  id: R.intentId,
  object: "payment_intent",
  livemode: false,
  customer: C.customer,
  amount: 999,
  amount_received: 0,
  currency: "usd",
  status: "requires_payment_method",
  payment_method: null,
  next_action: null,
  last_payment_error: { code: "payment_intent_authentication_failure" },
};
const session = {
  id: K.sessionId,
  object: "checkout.session",
  livemode: false,
  customer: C.customer,
  client_reference_id: baseline.userId,
  metadata: { user_id: baseline.userId },
  mode: "subscription",
  currency: "usd",
  amount_total: 999,
  amount_subtotal: 999,
  total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 },
  automatic_tax: { enabled: false },
  success_url: `${C.origin}/upgrade?success=true&session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${C.origin}/upgrade?canceled=true`,
  status: "expired",
  payment_status: "unpaid",
  subscription: null,
  payment_intent: null,
  invoice: null,
};
const lines = {
  has_more: false,
  data: [{ price: C.price, quantity: 1, amount_total: 999, amount_subtotal: 999, currency: "usd" }],
};
const journalText =
  ["validated", "expire-pending", "final"]
    .map((phase, i) =>
      JSON.stringify({
        version: 1,
        sequence: i + 1,
        at: 1800000000000 + i,
        account: C.account,
        sessionId: K.sessionId,
        intentId: R.intentId,
        phase,
        ...(i === 1 ? {} : { baseline, history }),
        ...(i === 2 ? { expired: true, unpaid: true, openCheckouts: 0 } : {}),
      }),
    )
    .join("\n") + "\n";
const fixture = () => structuredClone({ journalText, baseline, session, lines, intent, history });
assert.equal(assertFailedCurrentIntent(intent), true);
const canceled = { ...intent, status: "canceled", last_payment_error: null };
assert.equal(assertRetiredCurrentIntent(canceled), true);
assert.throws(() => assertFailedCurrentIntent(canceled));
assert.throws(() => assertRetiredCurrentIntent({ ...canceled, amount_received: 999 }));
assert.throws(() => assertRetiredCurrentIntent({ ...canceled, customer: "cus_other" }));
assert.equal(
  assertRetiredCurrentAttempt({ ...fixture(), intent: canceled }).scope,
  "failed_authentication_retired_without_payment",
);
assert.equal(
  assertRetiredCurrentAttempt(fixture()).scope,
  "failed_authentication_retired_without_payment",
);
for (const mutate of [
  (x) => (x.intent.livemode = true),
  (x) => (x.intent.amount_received = 999),
  (x) => (x.intent.amount = 599),
  (x) => (x.intent.status = "succeeded"),
  (x) => (x.intent.status = "requires_action"),
  (x) => (x.intent.next_action = {}),
  (x) => (x.intent.payment_method = "pm_existing"),
  (x) => (x.intent.customer = "cus_other"),
  (x) => (x.intent.id = "pi_other"),
  (x) => (x.intent.last_payment_error.code = "other"),
  (x) => (x.session.status = "open"),
  (x) => (x.session.payment_status = "paid"),
  (x) => (x.session.subscription = "sub_paid"),
  (x) => (x.session.invoice = "in_paid"),
  (x) => (x.session.payment_intent = "pi_paid"),
  (x) => (x.session.id = "cs_test_other"),
  (x) => (x.session.amount_total = 599),
  (x) => (x.lines.has_more = true),
  (x) => (x.lines.data[0].price = "price_other"),
  (x) => (x.baseline.billingRevision = 81),
  (x) => (x.history[R.sourceNames[2]] = "b".repeat(64)),
  (x) => (x.journalText = x.journalText.trim()),
  (x) => (x.journalText = x.journalText.replace('"expired":true', '"expired":false')),
  (x) => (x.journalText = x.journalText.replace('"openCheckouts":0', '"openCheckouts":1')),
]) {
  const f = fixture();
  mutate(f);
  assert.throws(() => assertRetiredCurrentAttempt(f));
}
for (const mutate of [
  (x) => (x.baseline.billingRevision = 81),
  (x) => (x.texts[R.sourceNames[2]] += "{}\n"),
  (x) =>
    (x.texts[R.sourceNames[2]] = x.texts[R.sourceNames[2]].replace(
      '"payment-pending"',
      '"challenge-submitted"',
    )),
  (x) =>
    (x.texts[R.sourceNames[1]] = x.texts[R.sourceNames[1]].replace(K.sessionId, "cs_test_other")),
  (x) => (x.texts[R.sourceNames[3]] = x.texts[R.sourceNames[3]].replace('"claimed"', '"cleared"')),
  (x) => delete x.texts[R.sourceNames[0]],
]) {
  const f = structuredClone({ texts, baseline });
  mutate(f);
  assert.throws(() => assertFailedSourceHistory(f));
}
await assert.rejects(retireFailedCurrentAttempt());
console.log(
  "PASS known failed-auth retirement: exact unpaid fixture, immutable source/claim hashes, expired canonical receipt, fail closed (offline)",
);
