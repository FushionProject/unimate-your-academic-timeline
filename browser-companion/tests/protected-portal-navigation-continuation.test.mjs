import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  PROTECTED_BILLING_RECOVERY as V1,
  PROTECTED_BILLING_RECOVERY_V2 as C,
  createRecoveryPolicy,
} from "../../scripts/protected-billing-recovery-policy.mjs";
import {
  PORTAL_NAVIGATION_CONTINUATION as P,
  createPortalNavigationContinuationPolicy,
  inspectPortalNavigationContinuation,
} from "../../scripts/protected-portal-navigation-continuation.mjs";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";

const hash = (text) => createHash("sha256").update(text).digest("hex");
const seal = (value) => ({ ...value, evidenceSha256: hash(JSON.stringify(value)) });
const clone = structuredClone;
function fixture() {
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
  const scope = {
    kind: V1.kind,
    origin: V1.origin,
    source: V1.source,
    account: C.account,
    customerId: C.customer,
    userId,
    clockId: "clock_fixture",
    billingRevision: 62,
    observedAt: 1800000000000,
    v1Sha256: C.journalHashes.v1,
    v2Sha256: C.journalHashes.v2,
  };
  const baseline1 = seal({ ...scope, phase: "baseline" });
  const purchase1 = seal({
    ...scope,
    phase: "purchased",
    billingRevision: 65,
    baselineSha256: baseline1.evidenceSha256,
    subscriptionId: C.baseline.at(-1),
  });
  const revocation1 = seal({
    ...scope,
    phase: "revoked",
    billingRevision: 66,
    baselineSha256: baseline1.evidenceSha256,
    subscriptionId: C.baseline.at(-1),
    predecessorPhase: "purchased",
    completionSha256: purchase1.evidenceSha256,
  });
  const previousRecoveryText = JSON.stringify({
    version: 1,
    kind: V1.kind,
    phase: "revoked",
    account: C.account,
    customerId: C.customer,
    userId,
    origin: V1.origin,
    source: V1.source,
    baseline: baseline1,
    purchase: purchase1,
    revocation: revocation1,
  });
  const config = {
    ...C,
    previousRecoveryV1Sha256: hash(previousRecoveryText),
    previousRecoveryRevocationSha256: revocation1.evidenceSha256,
  };
  const recoveryPolicy = createRecoveryPolicy(config);
  const scope2 = {
    ...scope,
    kind: C.kind,
    origin: C.origin,
    source: C.source,
    previousRecoveryV1Sha256: config.previousRecoveryV1Sha256,
    graceEnabled: false,
  };
  const baseline = seal({ ...scope2, phase: "baseline", billingRevision: 67 });
  const purchase = seal({
    ...scope2,
    phase: "purchased",
    billingRevision: 70,
    observedAt: scope.observedAt + 1000,
    baselineSha256: baseline.evidenceSha256,
    subscriptionId: "sub_fresh",
    initialInvoiceId: "in_initial",
    originalMethodId: "pm_original",
  });
  const failure = seal({
    ...scope2,
    phase: "past-due",
    billingRevision: 74,
    observedAt: scope.observedAt + 2000,
    baselineSha256: baseline.evidenceSha256,
    purchaseSha256: purchase.evidenceSha256,
    subscriptionId: "sub_fresh",
    invoiceId: "in_renewal",
    declineMethodId: "pm_decline",
    originalMethodId: "pm_original",
  });
  const pending = {
    version: 2,
    kind: C.kind,
    origin: C.origin,
    source: C.source,
    account: C.account,
    customerId: C.customer,
    userId,
    phase: "portal-update-pending",
    baseline,
    purchase,
    failure,
    portalId: "bps_fixture",
    portalAttemptedAt: scope.observedAt + 3000,
    portalUpdateAttempted: true,
    portalUpdateClaimedAt: scope.observedAt + 4000,
    portalUpdateBillingRevision: 75,
  };
  const claim = {
    version: 1,
    kind: "unimate-portal-recovery-form-v2",
    stage: "payment-method-form",
    portalSha256: hash(pending.portalId),
    attemptId: "30000000-0000-4000-8000-000000000003",
  };
  const sub = (id, status) => ({
    id,
    status,
    livemode: false,
    customer: C.customer,
    metadata: { user_id: userId },
    items: {
      has_more: false,
      data: [{ price: C.price, quantity: 1, current_period_end: 1800500000 }],
    },
    collection_method: "charge_automatically",
    cancel_at_period_end: false,
    cancel_at: null,
    default_payment_method: "pm_decline",
    latest_invoice: "in_renewal",
  });
  const method = (id, last4) => ({
    id,
    customer: C.customer,
    livemode: false,
    type: "card",
    card: { last4 },
  });
  const portal = {
    id: pending.portalId,
    livemode: false,
    customer: C.customer,
    return_url: `${C.origin}/upgrade`,
    url: "https://billing.stripe.com/p/session/offline_fixture",
  };
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
      invoice_settings: { default_payment_method: null },
    },
    clock: { id: "clock_fixture", status: "ready", livemode: false, frozen_time: 1800000500 },
    profile: { id: userId, stripe_customer_id: C.customer, is_pro: false, billing_revision: 75 },
    subscriptions: {
      has_more: false,
      data: [...C.baseline.map((id) => sub(id, "canceled")), sub("sub_fresh", "past_due")],
    },
    openCheckouts: { has_more: false, data: [] },
    journalHashes: { ...C.journalHashes },
    previousRecoveryText,
    observedAt: scope.observedAt + 5000,
    graceEnabled: false,
    reconciliationHeld: true,
    invoice: {
      id: "in_renewal",
      livemode: false,
      customer: C.customer,
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_fresh" } },
      status: "open",
      billing_reason: "subscription_cycle",
      collection_method: "charge_automatically",
      currency: "usd",
      amount_due: 599,
      total: 599,
      amount_remaining: 599,
      amount_paid: 0,
      attempted: true,
      attempt_count: 1,
      lines: {
        has_more: false,
        data: [{ quantity: 1, pricing: { price_details: { price: C.price } } }],
      },
    },
    paymentMethod: method("pm_decline", "0341"),
    originalPaymentMethod: method("pm_original", "4242"),
    portal,
    events: [
      {
        id: "evt_portal",
        type: "billing_portal.session.created",
        livemode: false,
        created: Math.floor(pending.portalAttemptedAt / 1000),
        data: { object: clone(portal) },
      },
    ],
  };
  const pendingText = JSON.stringify(pending),
    claimText = JSON.stringify(claim);
  const pins = { ...P, pendingSha256: hash(pendingText), claimSha256: hash(claimText) };
  const policy = createPortalNavigationContinuationPolicy({ recoveryPolicy, pins });
  return {
    policy,
    recoveryPolicy,
    pins,
    pending,
    claim,
    input: {
      pendingText,
      claimText,
      state,
      artifactsAbsent: {
        approval: true,
        consumed: true,
        formModule: true,
        continuationJournal: true,
      },
    },
  };
}
const f = fixture();
const receipt = f.policy.verify(f.input);
assert.equal(receipt.billingRevision, 75);
assert.equal(receipt.originalPanelContinuity, false);
assert.equal(receipt.newCompanionSession, true);
assert.equal(receipt.subscriptionId, "sub_fresh");
assert.equal(receipt.failureSha256, f.pending.failure.evidenceSha256);
assert.equal(Object.isFrozen(receipt), true);
assert.doesNotMatch(
  JSON.stringify(receipt),
  /billing\.stripe|example\.test|sk_test|whsec|password/,
);
const later = clone(f.input);
delete later.artifactsAbsent;
later.state.observedAt += 1000;
assert.equal(f.policy.verifyState({ ...later, receipt }).billingRevision, 75);
assert.throws(() => f.policy.verify(later), /NO_SUBMISSION/);
assert.throws(
  () => f.policy.verifyState({ ...later, receipt: { ...receipt, billingRevision: 76 } }),
  /RECEIPT/,
);

for (const change of [
  (i) => (i.pendingText += " "),
  (i) => (i.claimText += " "),
  (i) => (i.artifactsAbsent.approval = false),
  (i) => (i.artifactsAbsent.consumed = false),
  (i) => (i.artifactsAbsent.formModule = false),
  (i) => (i.artifactsAbsent.continuationJournal = false),
  (i) => (i.artifactsAbsent.extra = true),
  (i) => (i.state.profile.is_pro = true),
  (i) => (i.state.profile.billing_revision = 76),
  (i) => (i.state.profile.billing_revision = 74),
  (i) => (i.state.graceEnabled = true),
  (i) => (i.state.reconciliationHeld = false),
  (i) => (i.state.invoice.attempt_count = 2),
  (i) => (i.state.invoice.amount_remaining = 0),
  (i) => (i.state.invoice.amount_due = 600),
  (i) => (i.state.invoice.status = "paid"),
  (i) => (i.state.invoice.amount_paid = 599),
  (i) => (i.state.invoice.customer = "cus_other"),
  (i) => (i.state.subscriptions.data.at(-1).status = "active"),
  (i) => (i.state.subscriptions.data.at(-1).cancel_at_period_end = true),
  (i) => (i.state.subscriptions.data[0].status = "active"),
  (i) => (i.state.subscriptions.has_more = true),
  (i) => i.state.openCheckouts.data.push({ id: "cs_test_other" }),
  (i) => (i.state.openCheckouts.has_more = true),
  (i) => (i.state.paymentMethod.id = "pm_other"),
  (i) => (i.state.paymentMethod.card.last4 = "4242"),
  (i) => (i.state.originalPaymentMethod.id = "pm_other"),
  (i) => (i.state.customer.invoice_settings.default_payment_method = "pm_other"),
  (i) => (i.state.customer.invoice_settings.default_payment_method = "pm_original"),
  (i) => (i.state.customer.invoice_settings.default_payment_method = "pm_decline"),
  (i) => delete i.state.customer.invoice_settings.default_payment_method,
  (i) => (i.state.subscriptions.data.at(-1).default_payment_method = null),
  (i) => (i.state.clock.status = "advancing"),
  (i) => (i.state.previousRecoveryText += " "),
  (i) => (i.state.journalHashes.v1 = "0".repeat(64)),
  (i) => (i.state.portal.id = "bps_other"),
  (i) => (i.state.portal.livemode = true),
  (i) => (i.state.events = []),
  (i) => (i.state.events[0].account = "acct_other"),
  (i) => (i.state.events[0].data.object.url += "different"),
  (i) => (i.state.events[0].data.object.return_url = "https://example.com"),
]) {
  const bad = clone(f.input);
  change(bad);
  assert.throws(() => f.policy.verify(bad), /PORTAL_|RECOVERY_/, change.toString());
}
// Even recomputed offline pins do not bypass structural/phase/claim guards.
for (const change of [
  (p) => (p.version = 1),
  (p) => (p.phase = "portal-update-submitted"),
  (p) => (p.portalUpdateAttempted = false),
  (p) => (p.portalUpdateBillingRevision = 74),
  (p) => (p.completion = {}),
  (p) => (p.portalUpdateClaimedAt = p.failure.observedAt - 1),
  (p) => (p.failure.subscriptionId = "sub_other"),
]) {
  const pending = clone(f.pending);
  change(pending);
  const text = JSON.stringify(pending);
  const policy = createPortalNavigationContinuationPolicy({
    recoveryPolicy: f.recoveryPolicy,
    pins: { ...f.pins, pendingSha256: hash(text) },
  });
  assert.throws(() => policy.verify({ ...f.input, pendingText: text }), /PORTAL_|RECOVERY_/);
}
// Read-only inspector fails on file permission/symlink/pin mismatch before any
// network or write. Only generated offline fixtures are used here.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-continuation-offline-"));
try {
  const dir = path.join(root, ".stripe-sandbox.local");
  await fs.mkdir(dir, { mode: 0o700 });
  const filename = path.join(dir, C.journal);
  await fs.writeFile(filename, f.input.pendingText, { mode: 0o644 });
  await assert.rejects(
    inspectPortalNavigationContinuation({ root, state: f.input.state }),
    /PRIVATE_ARTIFACT/,
  );
  await fs.chmod(filename, 0o600);
  await assert.rejects(
    inspectPortalNavigationContinuation({ root, state: f.input.state }),
    /IMMUTABLE_ARTIFACTS/,
  );
  assert.equal(await fs.readFile(filename, "utf8"), f.input.pendingText);
  assert.deepEqual(await fs.readdir(dir), [C.journal]);
} finally {
  await fs.rm(root, { recursive: true });
}
console.log("Portal navigation continuation eligibility checks passed.");
