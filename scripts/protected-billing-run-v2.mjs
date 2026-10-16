// A separate, one-shot re-verification of the October 16 private preview.
// Version one and its evidence are immutable. No general reset/replay option.
import { createHash } from "node:crypto";
import { SetupError, TARGET } from "./prepare-stripe-sandbox.mjs";

export const PROTECTED_BILLING_V2 = Object.freeze({
  origin: "https://unimate-2qsdme7qj-resumejuice-s-projects.vercel.app",
  previousOrigin: "https://unimate-fwcn4d8vz-resumejuice-s-projects.vercel.app",
  customer: "cus_VRAVJnKW1RGQzr",
  previousSubscription: "sub_1UQX6pIxB8W4eFUhZTXTf1no",
  previousSession: "cs_test_a1DEHTkCP3UVEh1TNdxArF1jzvBDxzBURFG3uTcrXwrr98OXzLuK4MqXkH",
  baseline: Object.freeze([
    "sub_1UQIBmIxB8W4eFUhONFxHWEw",
    "sub_1UQIKhIxB8W4eFUhlRBcz2Lm",
    "sub_1UQKfFIxB8W4eFUhmNFpzcf8",
    "sub_1UQX6pIxB8W4eFUhZTXTf1no",
  ]),
  journal: "protected-billing-checkout-v2.json",
});

export function matchesProtectedV2Baseline(rows) {
  return (
    Array.isArray(rows) &&
    rows.length === 4 &&
    new Set(rows.map((row) => row?.[0])).size === 4 &&
    rows.every(
      (row) =>
        Array.isArray(row) &&
        row.length === 2 &&
        PROTECTED_BILLING_V2.baseline.includes(row[0]) &&
        row[1] === "canceled",
    )
  );
}

export function verifyProtectedV2PriorRun({ origin, record, previousText, state, session } = {}) {
  const fail = () => {
    throw new SetupError("COMPLETED_EXACT_V1_RUN_REQUIRED");
  };
  let previous, baseline;
  try {
    previous = JSON.parse(previousText);
    baseline = JSON.parse(previous.baseline);
  } catch {
    fail();
  }
  const id = (value) => (typeof value === "string" ? value : value?.id);
  const expectedPrevious = PROTECTED_BILLING_V2.baseline.slice(0, 3);
  if (
    origin !== PROTECTED_BILLING_V2.origin ||
    previous.version !== 1 ||
    previous.account !== TARGET.account ||
    previous.origin !== PROTECTED_BILLING_V2.previousOrigin ||
    previous.userId !== record?.userId ||
    previous.customerId !== PROTECTED_BILLING_V2.customer ||
    previous.sessionId !== PROTECTED_BILLING_V2.previousSession ||
    previous.subscriptionId !== PROTECTED_BILLING_V2.previousSubscription ||
    previous.phase !== "checkout-verified" ||
    previous.paymentAttempted !== true ||
    previous.portalAttempted !== true ||
    previous.portalVerified !== true ||
    previous.cancelAttempted !== true ||
    !Number.isSafeInteger(previous.baselineRevision) ||
    previous.baselineRevision < 0 ||
    !Number.isSafeInteger(previous.purchaseVerifiedRevision) ||
    previous.purchaseVerifiedRevision <= previous.baselineRevision ||
    !Array.isArray(baseline) ||
    baseline.length !== 3 ||
    new Set(baseline.map((row) => row?.[0])).size !== 3 ||
    baseline.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== 2 ||
        !expectedPrevious.includes(row[0]) ||
        row[1] !== "canceled",
    ) ||
    state?.scope?.account !== TARGET.account ||
    state.scope.userId !== record?.userId ||
    state.scope.customerId !== PROTECTED_BILLING_V2.customer ||
    state.scope.clockStatus !== "ready" ||
    !matchesProtectedV2Baseline(state.scope.subscriptions?.map((sub) => [sub.id, sub.status])) ||
    !Array.isArray(state.open) ||
    state.open.length !== 0 ||
    state.profile?.id !== record?.userId ||
    state.profile.stripe_customer_id !== PROTECTED_BILLING_V2.customer ||
    state.profile.is_pro !== false ||
    !Number.isSafeInteger(state.profile.billing_revision) ||
    state.profile.billing_revision <= previous.purchaseVerifiedRevision ||
    session?.id !== previous.sessionId ||
    session.livemode !== false ||
    id(session.customer) !== PROTECTED_BILLING_V2.customer ||
    session.client_reference_id !== record?.userId ||
    session.metadata?.user_id !== record?.userId ||
    session.mode !== "subscription" ||
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    session.amount_total !== 599 ||
    session.currency !== "usd" ||
    id(session.subscription) !== previous.subscriptionId
  )
    fail();
  return {
    previousJournalSha256: createHash("sha256").update(previousText).digest("hex"),
    previousFinalRevision: state.profile.billing_revision,
  };
}
