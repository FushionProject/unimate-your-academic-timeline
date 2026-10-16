import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  PROTECTED_BILLING_V2,
  matchesProtectedV2Baseline,
  verifyProtectedV2PriorRun,
} from "../../scripts/protected-billing-run-v2.mjs";
import { SetupError, TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";

const userId = "10000000-0000-4000-8000-000000000001";
const baseline = () => PROTECTED_BILLING_V2.baseline.map((id) => [id, "canceled"]);
function fixture() {
  return {
    origin: PROTECTED_BILLING_V2.origin,
    record: { userId },
    previous: {
      version: 1,
      account: TARGET.account,
      origin: PROTECTED_BILLING_V2.previousOrigin,
      userId,
      customerId: PROTECTED_BILLING_V2.customer,
      sessionId: PROTECTED_BILLING_V2.previousSession,
      subscriptionId: PROTECTED_BILLING_V2.previousSubscription,
      phase: "checkout-verified",
      paymentAttempted: true,
      portalAttempted: true,
      portalVerified: true,
      cancelAttempted: true,
      baselineRevision: 10,
      purchaseVerifiedRevision: 12,
      baseline: JSON.stringify(baseline().slice(0, 3)),
    },
    state: {
      scope: {
        account: TARGET.account,
        userId,
        customerId: PROTECTED_BILLING_V2.customer,
        clockStatus: "ready",
        subscriptions: baseline().map(([id, status]) => ({ id, status })),
      },
      open: [],
      profile: {
        id: userId,
        stripe_customer_id: PROTECTED_BILLING_V2.customer,
        is_pro: false,
        billing_revision: 13,
      },
    },
    session: {
      id: PROTECTED_BILLING_V2.previousSession,
      livemode: false,
      customer: PROTECTED_BILLING_V2.customer,
      client_reference_id: userId,
      metadata: { user_id: userId },
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      amount_total: 599,
      currency: "usd",
      subscription: PROTECTED_BILLING_V2.previousSubscription,
    },
  };
}
const verify = ({ previous, ...rest }) =>
  verifyProtectedV2PriorRun({ ...rest, previousText: JSON.stringify(previous) });

assert.equal(matchesProtectedV2Baseline(baseline()), true);
assert.equal(matchesProtectedV2Baseline(baseline().reverse()), true);
for (const bad of [
  undefined,
  null,
  {},
  [],
  baseline().slice(0, 3),
  [...baseline(), ["sub_extra", "canceled"]],
  [...baseline().slice(0, 3), baseline()[0]],
  [...baseline().slice(0, 3), ["sub_foreign", "canceled"]],
  [...baseline().slice(0, 3), [PROTECTED_BILLING_V2.previousSubscription, "active"]],
  [...baseline().slice(0, 3), [PROTECTED_BILLING_V2.previousSubscription, "canceled", true]],
  [...baseline().slice(0, 3), null],
])
  assert.equal(matchesProtectedV2Baseline(bad), false);

const valid = fixture();
const previousText = JSON.stringify(valid.previous);
assert.deepEqual(verify(valid), {
  previousJournalSha256: createHash("sha256").update(previousText).digest("hex"),
  previousFinalRevision: 13,
});
const expanded = fixture();
expanded.session.customer = { id: PROTECTED_BILLING_V2.customer };
expanded.session.subscription = { id: PROTECTED_BILLING_V2.previousSubscription };
expanded.state.scope.subscriptions.reverse();
assert.equal(verify(expanded).previousFinalRevision, 13);

const mutations = [
  ["origin", "https://unimate-other.vercel.app"],
  ["record.userId", "other-user"],
  ["previous.version", 2],
  ["previous.account", "acct_other"],
  ["previous.origin", PROTECTED_BILLING_V2.origin],
  ["previous.userId", "other-user"],
  ["previous.customerId", "cus_other"],
  ["previous.sessionId", "cs_test_other"],
  ["previous.subscriptionId", "sub_other"],
  ["previous.phase", "checkout-pending"],
  ["previous.paymentAttempted", false],
  ["previous.portalAttempted", false],
  ["previous.portalVerified", false],
  ["previous.cancelAttempted", false],
  ["previous.baselineRevision", -1],
  ["previous.baselineRevision", 10.5],
  ["previous.baselineRevision", "10"],
  ["previous.purchaseVerifiedRevision", 10],
  ["previous.purchaseVerifiedRevision", 9],
  ["previous.purchaseVerifiedRevision", "12"],
  ["previous.baseline", "not JSON"],
  ["previous.baseline", "null"],
  ["previous.baseline", JSON.stringify(baseline())],
  ["previous.baseline", JSON.stringify([baseline()[0], baseline()[0], baseline()[2]])],
  ["previous.baseline", JSON.stringify([...baseline().slice(0, 2), ["sub_other", "canceled"]])],
  ["previous.baseline", JSON.stringify([...baseline().slice(0, 2), [baseline()[2][0], "active"]])],
  ["state.scope.account", "acct_other"],
  ["state.scope.userId", "other-user"],
  ["state.scope.customerId", "cus_other"],
  ["state.scope.clockStatus", "advancing"],
  ["state.scope.subscriptions", []],
  ["state.scope.subscriptions.3.status", "active"],
  ["state.scope.subscriptions.3.id", "sub_other"],
  ["state.open", [{ id: "cs_test_pending" }]],
  ["state.open", null],
  ["state.profile.id", "other-user"],
  ["state.profile.stripe_customer_id", "cus_other"],
  ["state.profile.is_pro", true],
  ["state.profile.billing_revision", 12],
  ["state.profile.billing_revision", 11],
  ["state.profile.billing_revision", "13"],
  ["session.id", "cs_test_other"],
  ["session.livemode", true],
  ["session.customer", "cus_other"],
  ["session.client_reference_id", "other-user"],
  ["session.metadata.user_id", "other-user"],
  ["session.mode", "payment"],
  ["session.status", "open"],
  ["session.payment_status", "unpaid"],
  ["session.amount_total", 600],
  ["session.currency", "eur"],
  ["session.subscription", "sub_other"],
];
for (const [field, value] of mutations) {
  const input = fixture();
  const keys = field.split(".");
  const parent = keys.slice(0, -1).reduce((object, key) => object[key], input);
  parent[keys.at(-1)] = value;
  assert.throws(
    () => verify(input),
    (error) => error instanceof SetupError && error.code === "COMPLETED_EXACT_V1_RUN_REQUIRED",
    field,
  );
}
for (const previousText of ["", "{", "null", "[]", "{}"])
  assert.throws(
    () => verifyProtectedV2PriorRun({ ...fixture(), previousText }),
    /COMPLETED_EXACT_V1_RUN_REQUIRED/,
  );

console.log(
  `Protected billing v2 prior-run safety tests passed (${mutations.length} scope mutations).`,
);
