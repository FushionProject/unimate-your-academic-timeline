// A single fixed navigation-only continuation, never a payment retry. The old
// pending journal and helper claim are immutable; this module does no writes,
// network, browser control, credential loading, or form approval.
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  PROTECTED_BILLING_RECOVERY_V2 as C,
  createRecoveryPolicy,
} from "./protected-billing-recovery-policy.mjs";
import { assertRecoveryPortalLocation } from "./protected-stripe-browser-recovery.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const PORTAL_NAVIGATION_CONTINUATION = Object.freeze({
  kind: "unimate-portal-navigation-continuation-v1",
  pendingSha256: "4973c60754acc9342330fb9dd29a081ee93c026a3083d2745cbde283b27510ea",
  claimSha256: "b6efbfb79d8ba6e3271c973165e7b1ec89204111d1721c50f8befe328b73303f",
  billingRevision: 75,
  journal: "protected-billing-recovery-v2-portal-continuation-v1.json",
});
const hash = (value) => createHash("sha256").update(value).digest("hex");
const validSha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value) => (typeof value === "string" ? value : value?.id);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const fail = (condition, code = "PORTAL_NAVIGATION_CONTINUATION_INELIGIBLE") => {
  if (!condition) throw new Error(code);
};
const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    fail(false);
  }
};
const seal = (body) => Object.freeze({ ...body, evidenceSha256: hash(JSON.stringify(body)) });

// Injection is for offline fixtures. The real inspector fixes reviewed pins.
export function createPortalNavigationContinuationPolicy({
  recoveryPolicy = createRecoveryPolicy(C),
  pins = PORTAL_NAVIGATION_CONTINUATION,
} = {}) {
  const config = recoveryPolicy.config;
  fail(
    config.kind === C.kind &&
      config.graceEnabled === false &&
      pins.kind === PORTAL_NAVIGATION_CONTINUATION.kind &&
      pins.journal === PORTAL_NAVIGATION_CONTINUATION.journal &&
      pins.billingRevision === 75 &&
      validSha(pins.pendingSha256) &&
      validSha(pins.claimSha256),
  );

  function assertReceipt(receipt) {
    const { evidenceSha256, ...body } = receipt || {};
    fail(
      body.version === 1 &&
        body.kind === pins.kind &&
        body.phase === "navigation-only-eligible" &&
        body.origin === config.origin &&
        body.source === config.source &&
        body.account === config.account &&
        body.customerId === config.customer &&
        body.billingRevision === pins.billingRevision &&
        positive(body.observedAt) &&
        body.pendingSha256 === pins.pendingSha256 &&
        body.claimSha256 === pins.claimSha256 &&
        body.noSubmissionCapability === true &&
        body.newCompanionSession === true &&
        body.originalPanelContinuity === false &&
        [body.baselineSha256, body.purchaseSha256, body.failureSha256].every(validSha) &&
        /^[a-f0-9-]{36}$/.test(body.userId || "") &&
        /^clock_[A-Za-z0-9]+$/.test(body.clockId || "") &&
        /^sub_[A-Za-z0-9]+$/.test(body.subscriptionId || "") &&
        /^in_[A-Za-z0-9]+$/.test(body.invoiceId || "") &&
        /^bps_[A-Za-z0-9]+$/.test(body.portalId || "") &&
        /^[a-f0-9-]{36}$/.test(body.claimAttemptId || "") &&
        evidenceSha256 === hash(JSON.stringify(body)),
      "PORTAL_NAVIGATION_RECEIPT_REQUIRED",
    );
    return receipt;
  }

  function checked({ pendingText, claimText, state, artifactsAbsent } = {}, checkAbsence = true) {
    fail(
      typeof pendingText === "string" &&
        hash(pendingText) === pins.pendingSha256 &&
        typeof claimText === "string" &&
        hash(claimText) === pins.claimSha256,
      "PORTAL_NAVIGATION_IMMUTABLE_ARTIFACTS_REQUIRED",
    );
    const pending = parse(pendingText),
      claim = parse(claimText);
    if (checkAbsence)
      fail(
        artifactsAbsent &&
          Object.keys(artifactsAbsent).sort().join(",") ===
            "approval,consumed,continuationJournal,formModule" &&
          Object.values(artifactsAbsent).every((value) => value === true),
        "PORTAL_NAVIGATION_NO_SUBMISSION_CAPABILITY_REQUIRED",
      );
    fail(
      pending.version === 2 &&
        pending.kind === config.kind &&
        pending.phase === "portal-update-pending" &&
        pending.origin === config.origin &&
        pending.source === config.source &&
        pending.account === config.account &&
        pending.customerId === config.customer &&
        pending.userId === state?.record?.userId &&
        pending.portalUpdateAttempted === true &&
        pending.portalUpdateBillingRevision === pins.billingRevision &&
        state.profile?.billing_revision === pins.billingRevision &&
        positive(pending.portalAttemptedAt) &&
        positive(pending.portalUpdateClaimedAt) &&
        pending.portalAttemptedAt <= pending.portalUpdateClaimedAt &&
        pending.portalUpdateClaimedAt <= state.observedAt &&
        pending.completion === undefined &&
        pending.revocation === undefined,
      "PORTAL_NAVIGATION_PENDING_STAGE_REQUIRED",
    );
    fail(
      claim.version === 1 &&
        claim.kind === "unimate-portal-recovery-form-v2" &&
        claim.stage === "payment-method-form" &&
        Object.keys(claim).sort().join(",") === "attemptId,kind,portalSha256,stage,version" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          claim.attemptId || "",
        ) &&
        /^bps_[A-Za-z0-9]+$/.test(pending.portalId || "") &&
        claim.portalSha256 === hash(pending.portalId),
      "PORTAL_NAVIGATION_CLAIM_REQUIRED",
    );
    const unchanged = recoveryPolicy.verifyUnchangedFailure({
      ...state,
      baseline: pending.baseline,
      purchase: pending.purchase,
      failure: pending.failure,
      actionStartedAt: pending.portalUpdateClaimedAt,
    });
    const portal = state.portal;
    fail(
      portal?.id === pending.portalId &&
        portal.customer === config.customer &&
        portal.return_url === `${config.origin}/upgrade`,
      "PORTAL_NAVIGATION_PORTAL_REQUIRED",
    );
    // Validate without navigating; this additionally rejects non-Stripe/opaque
    // URL changes. The URL is never copied into the receipt.
    assertRecoveryPortalLocation(portal.url, portal, true);
    fail(
      pending.portalAttemptedAt >= pending.failure.observedAt &&
        Array.isArray(state.events) &&
        state.events.some(
          (event) =>
            /^evt_[A-Za-z0-9]+$/.test(event?.id || "") &&
            event.type === "billing_portal.session.created" &&
            event.livemode === false &&
            (event.account === undefined || event.account === config.account) &&
            (event.context === undefined || event.context === config.account) &&
            event.created >= Math.floor(pending.portalAttemptedAt / 1000) - 120 &&
            event.created <= Math.ceil(state.observedAt / 1000) &&
            event.data?.object?.id === portal.id &&
            event.data.object.livemode === false &&
            id(event.data.object.customer) === config.customer &&
            event.data.object.url === portal.url &&
            event.data.object.return_url === portal.return_url,
        ),
      "PORTAL_NAVIGATION_PORTAL_REQUIRED",
    );
    return assertReceipt(
      seal({
        version: 1,
        kind: pins.kind,
        phase: "navigation-only-eligible",
        origin: config.origin,
        source: config.source,
        account: config.account,
        customerId: config.customer,
        userId: unchanged.userId,
        clockId: unchanged.clockId,
        billingRevision: unchanged.billingRevision,
        observedAt: unchanged.observedAt,
        subscriptionId: unchanged.subscriptionId,
        invoiceId: unchanged.invoiceId,
        baselineSha256: unchanged.baselineSha256,
        purchaseSha256: unchanged.purchaseSha256,
        failureSha256: unchanged.failureSha256,
        pendingSha256: pins.pendingSha256,
        claimSha256: pins.claimSha256,
        portalId: pending.portalId,
        claimAttemptId: claim.attemptId,
        noSubmissionCapability: true,
        newCompanionSession: true,
        originalPanelContinuity: false,
      }),
    );
  }
  const verify = (input) => checked(input);
  function verifyState({ receipt, ...input } = {}) {
    assertReceipt(receipt);
    // The startup receipt attests absence then. It is not a claim that a later
    // reviewed form module is still absent. Pending/claim bytes and provider
    // state must nevertheless remain unchanged before each new action.
    const current = checked(input, false);
    for (const key of Object.keys(receipt))
      if (key !== "observedAt" && key !== "evidenceSha256")
        fail(current[key] === receipt[key], "PORTAL_NAVIGATION_RECEIPT_STATE_CHANGED");
    fail(current.observedAt >= receipt.observedAt, "PORTAL_NAVIGATION_RECEIPT_STATE_CHANGED");
    return current;
  }
  return Object.freeze({ verify, assertReceipt, verifyState });
}

async function readPrivate(filename) {
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    fail(
      stat.isFile() &&
        stat.nlink === 1 &&
        stat.uid === process.getuid() &&
        !(stat.mode & 0o077) &&
        stat.size <= 512 * 1024,
      "PORTAL_NAVIGATION_PRIVATE_ARTIFACT_REQUIRED",
    );
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}
async function absent(filename) {
  try {
    await fs.lstat(filename);
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}

// Caller must supply authenticated readbacks. Return values are private; never
// print pendingText/claimText. This inspector deliberately does not save receipt.
export async function inspectPortalNavigationContinuation({ root = ROOT, state } = {}) {
  const directory = path.join(root, ".stripe-sandbox.local");
  const stat = await fs.lstat(directory);
  fail(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      stat.uid === process.getuid() &&
      !(stat.mode & 0o077),
    "PORTAL_NAVIGATION_PRIVATE_DIRECTORY_REQUIRED",
  );
  const pendingText = await readPrivate(path.join(directory, C.journal));
  fail(
    hash(pendingText) === PORTAL_NAVIGATION_CONTINUATION.pendingSha256,
    "PORTAL_NAVIGATION_IMMUTABLE_ARTIFACTS_REQUIRED",
  );
  const pending = parse(pendingText);
  fail(/^bps_[A-Za-z0-9]+$/.test(pending.portalId || ""));
  const stem = `portal-recovery-form-${hash(pending.portalId)}`;
  const claimText = await readPrivate(path.join(directory, `${stem}.claim.json`));
  const journalHashes = {};
  for (const version of ["v1", "v2"])
    journalHashes[version] = hash(
      await readPrivate(path.join(directory, `protected-billing-checkout-${version}.json`)),
    );
  const previousRecoveryText = await readPrivate(path.join(directory, C.previousRecoveryJournal));
  const artifactsAbsent = {
    approval: await absent(path.join(directory, `${stem}.approved.json`)),
    consumed: await absent(path.join(directory, `${stem}.consumed.json`)),
    formModule: await absent(path.join(root, "scripts/protected-stripe-browser-recovery-form.mjs")),
    continuationJournal: await absent(path.join(directory, PORTAL_NAVIGATION_CONTINUATION.journal)),
  };
  const receipt = createPortalNavigationContinuationPolicy().verify({
    pendingText,
    claimText,
    state: { ...state, journalHashes, previousRecoveryText },
    artifactsAbsent,
  });
  // A concurrent action cannot silently change the inspected pending evidence.
  fail(
    (await readPrivate(path.join(directory, C.journal))) === pendingText &&
      (await readPrivate(path.join(directory, `${stem}.claim.json`))) === claimText,
    "PORTAL_NAVIGATION_IMMUTABLE_ARTIFACTS_REQUIRED",
  );
  return Object.freeze({ receipt, pendingText, claimText });
}
