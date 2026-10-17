// Operator-only, one-shot sandbox recovery. Importing this module performs no
// I/O. No generic URLs, selectors, evaluation, card values or IDs are accepted.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  prepareSandbox,
  privateJson,
  TARGET,
  ARTIFACT,
  SetupError,
} from "./prepare-stripe-sandbox.mjs";
import { readPrivate } from "./verify-stripe-sandbox-lifecycle.mjs";
import { validateRecord } from "./verify-companion-sandbox-browser.mjs";
import {
  loadVerifiedPreviewDeployment,
  validatePreviewAccess,
} from "./protected-companion-preview.mjs";
import { attachProtectedPreviewBrowser } from "./protected-preview-browser.mjs";
import { createProtectedStripePreviewRelay } from "./protected-stripe-preview-relay.mjs";
import { startProtectedCompanionBillingHarness } from "./protected-companion-billing-harness.mjs";
import { captureSecret, LISTEN_ARGS } from "./run-stripe-sandbox.mjs";
import {
  validatedProtectedVercelCli,
  readyProtectedBillingButton,
  recentProtectedPortalEvents,
  assertProtectedPaymentAttempt,
} from "./run-protected-billing-preview.mjs";
import { submitVerifiedTestPayment } from "./protected-stripe-browser-payment.mjs";
import {
  fillVerifiedTestCard,
  submitVerifiedCardCheckout,
} from "./protected-stripe-browser-card.mjs";
import { inspectStripeSurface } from "./protected-stripe-browser-actions.mjs";
import { inspectContinuationFields } from "./continue-protected-sandbox-checkout.mjs";
import { inspectCheckoutCardStructure } from "./inspect-protected-sandbox-checkout.mjs";
import {
  PROTECTED_BILLING_RECOVERY as C,
  PROTECTED_BILLING_RECOVERY_V2,
  createRecoveryPolicy,
  assertRecoveryProof,
} from "./protected-billing-recovery-policy.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROJECT = "prj_5XZ4ulni13tNLCvNzdL1gUPvashI";
const TEAM = "team_MwJPMKdnqu1z8dxbKYBqdJCY";
export const RECOVERY_JOURNAL = "protected-billing-recovery-v1.json";
export const RECOVERY_V2_JOURNAL = "protected-billing-recovery-v2.json";
const COMMANDS = new Set([
  "STATUS",
  "CHECKOUT",
  "INSPECT_STRIPE",
  "INSPECT_CHECKOUT",
  "SELECT_CARD",
  "PAY_SUBMIT",
  "PAY_CARD_FILL",
  "PAY_CARD_SUBMIT",
  "RETURN",
  "EXPECT_PRO",
  "ARM_RENEWAL",
  "EXPECT_PAST_DUE",
  "PORTAL",
  "ARM_PORTAL_UPDATE",
  "PORTAL_UPDATE",
  "EXPECT_RECOVERED",
  "ARM_REVOCATION",
  "EXPECT_REVOKED",
  "STOP",
]);
const fail = (code) => {
  throw new SetupError(code);
};
const id = (value) => (typeof value === "string" ? value : value?.id);
const hash = (value) => createHash("sha256").update(value).digest("hex");
export const parseRecoveryCommand = (line) =>
  typeof line === "string" && line.length <= 80 && COMMANDS.has(line.trim()) ? line.trim() : null;
export const recoveryErrorCode = (error) =>
  error instanceof SetupError && /^RECOVERY_[A-Z_]+$/.test(error.code)
    ? error.code
    : "RECOVERY_STOP_AND_RECONCILE";

export async function fillReadyRecoverySignIn(page, record) {
  // DOMContentLoaded can precede React auth hydration. Never fill a form that
  // may still be replaced, or click before the sign-in handler is ready.
  await page.locator('html[data-unimate-auth-state="signed-out"]').waitFor({ state: "attached" });
  await page.locator("#signin-email").fill(record.email);
  await page.locator("#signin-password").fill(record.password);
}

export function assertRecoveryStart({ approved, env = process.env } = {}) {
  if (!approved || env.DEBUG || env.PWDEBUG || env.NODE_OPTIONS || env.NODE_INSPECT_RESUME_ON_START)
    fail("RECOVERY_EXPLICIT_PRIVATE_APPROVAL_REQUIRED");
}

export function assertRecoveryDeployment(raw, recoveryConfig = C) {
  const graceOff = recoveryConfig.graceEnabled === false;
  if (
    raw?.meta?.githubCommitSha !== recoveryConfig.source ||
    !Array.isArray(raw.alias) ||
    raw.alias.length ||
    raw?.target !== null ||
    raw?.readyState !== "READY" ||
    !Array.isArray(raw.env) ||
    raw.env.some((key) => typeof key !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(key)) ||
    raw.env.includes("STRIPE_PAST_DUE_GRACE_ENABLED") !== graceOff
  )
    fail("RECOVERY_EXACT_UNALIASED_SOURCE_REQUIRED");
  // V1's pinned source enables grace when absent. V2 must have the key, but
  // metadata exposes names only: its effective value still needs the separate
  // authenticated read-only runtime check. Never infer an encrypted value.
  return graceOff ? { runtimeGraceVerificationRequired: true } : { graceEnabled: true };
}

// Executed in the isolated, authenticated website context. The existing route
// transport attaches OIDC to this exact origin only. Return no token/user data.
export async function readRecoveryRuntimeStatus({ origin, accessToken }) {
  if (globalThis.location.origin !== origin) throw new Error("RECOVERY_RUNTIME_ORIGIN_REQUIRED");
  const response = await fetch(`${origin}/api/billing-status?reconcile=false`, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    credentials: "omit",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status !== 200) return { status: response.status };
  const body = await response.json();
  return { status: 200, pastDueGraceEnabled: body?.pastDueGraceEnabled };
}

export async function verifyRecoveryRuntimeGrace(page, origin, accessToken) {
  if (
    new URL(page.url()).origin !== origin ||
    typeof accessToken !== "string" ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)
  )
    fail("RECOVERY_RUNTIME_GRACE_OFF_REQUIRED");
  const result = await page.evaluate(readRecoveryRuntimeStatus, { origin, accessToken });
  if (result?.status !== 200 || result.pastDueGraceEnabled !== false)
    fail("RECOVERY_RUNTIME_GRACE_OFF_REQUIRED");
  return false;
}

export function assertRecoverySetup(setup, record) {
  if (
    setup?.version !== 1 ||
    setup.project !== PROJECT ||
    setup.team !== TEAM ||
    setup.branch !== "codex/unimate-premium-revival" ||
    setup.account !== TARGET.account ||
    setup.userId !== record.userId ||
    setup.phase !== "configured" ||
    ![
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_ID",
      "STRIPE_LIVE_MODE_ENABLED",
    ].every((key) => setup.completed?.includes(key)) ||
    !/^whsec_[A-Za-z0-9]{16,}$/.test(setup.webhookSecret || "")
  )
    fail("RECOVERY_VERIFIED_SETUP_REQUIRED");
}

function checkoutPage(page, sessionId) {
  const url = new URL(page.url());
  if (
    url.origin !== "https://checkout.stripe.com" ||
    url.username ||
    url.password ||
    !url.pathname.split("/").includes(sessionId)
  )
    fail("RECOVERY_EXACT_CHECKOUT_PAGE_REQUIRED");
}

// Only the known, still-unpaid zero-action checkpoint is resumable. Nothing
// resets a payment/card attempt; the original journal is retained byte-for-byte.
export function verifyUnpaidRecoveryResume({ journal, record, state, session, items }) {
  assertRecoverySnapshotLists(state, record);
  assertRecoveryProof(journal?.baseline, "baseline");
  const allowed = [
    "version",
    "kind",
    "account",
    "origin",
    "source",
    "userId",
    "customerId",
    "baseline",
    "phase",
    "checkoutAttemptedAt",
    "sessionId",
  ];
  if (
    journal.version !== 1 ||
    journal.kind !== C.kind ||
    journal.account !== C.account ||
    journal.origin !== C.origin ||
    journal.source !== C.source ||
    journal.userId !== record.userId ||
    journal.customerId !== C.customer ||
    journal.phase !== "checkout-verified" ||
    Object.keys(journal).some((key) => !allowed.includes(key)) ||
    journal.baseline.userId !== record.userId ||
    journal.baseline.billingRevision !== 62 ||
    state.profile.billing_revision !== 62 ||
    !Number.isSafeInteger(journal.checkoutAttemptedAt) ||
    journal.checkoutAttemptedAt < journal.baseline.observedAt ||
    state.origin !== C.origin ||
    state.source !== C.source ||
    state.journalHashes?.v1 !== C.journalHashes.v1 ||
    state.journalHashes?.v2 !== C.journalHashes.v2 ||
    state.clock?.id !== journal.baseline.clockId ||
    state.clock.livemode !== false ||
    state.clock.status !== "ready" ||
    id(state.customer.test_clock) !== state.clock.id ||
    session?.payment_intent != null ||
    session?.setup_intent != null
  )
    fail("RECOVERY_UNPAID_RESUME_NOT_ELIGIBLE");
  assertProtectedPaymentAttempt(
    journal,
    session,
    items,
    {
      profile: state.profile,
      open: state.openCheckouts.data,
      scope: { subscriptions: state.subscriptions.data },
    },
    JSON.stringify(C.baseline.map((value) => [value, "canceled"]).sort()),
  );
  let url;
  try {
    url = new URL(session.url);
  } catch {
    fail("RECOVERY_EXACT_CHECKOUT_PAGE_REQUIRED");
  }
  checkoutPage({ url: () => url.href }, journal.sessionId);
  return { baseline: journal.baseline, checkoutUrl: url.href };
}

// One additional restart after the first resume performed only observations.
// The two immutable checkpoints bind the same zero-action Checkout; neither
// old Companion session is represented as continuous with this new browser.
export function verifyInspectedUnpaidRecoveryResume(input) {
  const { journal, originalText, state } = input;
  let original;
  try {
    original = JSON.parse(originalText);
  } catch {
    fail("RECOVERY_INSPECTED_RESUME_CHAIN_REQUIRED");
  }
  const { resumedFrom, ...unchanged } = journal || {};
  verifyUnpaidRecoveryResume({ ...input, journal: original });
  const target = verifyUnpaidRecoveryResume({ ...input, journal: unchanged });
  const free = resumedFrom?.freeCompanion;
  if (
    JSON.stringify(unchanged) !== JSON.stringify(original) ||
    !resumedFrom ||
    Object.keys(resumedFrom).some(
      (key) =>
        !["journalSha256", "phase", "at", "newCompanionSession", "freeCompanion"].includes(key),
    ) ||
    resumedFrom.journalSha256 !== hash(originalText) ||
    resumedFrom.phase !== "checkout-verified" ||
    resumedFrom.newCompanionSession !== true ||
    !Number.isSafeInteger(resumedFrom.at) ||
    resumedFrom.at < original.checkoutAttemptedAt ||
    resumedFrom.at > state.observedAt ||
    !free ||
    Object.keys(free).some(
      (key) =>
        ![
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
        ].includes(key),
    ) ||
    free.action !== "expect-free" ||
    free.isPro !== false ||
    free.billingRevision !== 62 ||
    free.samePanelTransition !== false ||
    free.sameOpenPanelTransition !== false ||
    free.sessionReused !== false ||
    free.aiRequests !== 0 ||
    free.captures !== 0 ||
    free.extractions !== 0 ||
    !/^[a-f0-9]{64}$/.test(free.sourceHash || "") ||
    typeof free.artifactPath !== "string" ||
    !free.artifactPath.startsWith(path.join(ROOT, ".stripe-sandbox.local", "companion-")) ||
    !/^companion-[a-f0-9-]{36}\/result-[a-f0-9-]{36}\.png$/.test(
      path.relative(path.join(ROOT, ".stripe-sandbox.local"), free.artifactPath),
    )
  )
    fail("RECOVERY_INSPECTED_RESUME_CHAIN_REQUIRED");
  return target;
}

export function verifySetupFailureRecoveryResume(input) {
  const { journal, originalText, inspectedText, state } = input;
  let inspected;
  try {
    inspected = JSON.parse(inspectedText);
  } catch {
    fail("RECOVERY_SETUP_FAILURE_CHAIN_REQUIRED");
  }
  const { inspectedResume, ...unchanged } = journal || {};
  const target = verifyInspectedUnpaidRecoveryResume({ ...input, journal: unchanged });
  verifyInspectedUnpaidRecoveryResume({ ...input, journal: inspected });
  if (
    JSON.stringify(unchanged) !== JSON.stringify(inspected) ||
    !inspectedResume ||
    Object.keys(inspectedResume).some(
      (key) =>
        !["journalSha256", "originalJournalSha256", "phase", "at", "newCompanionSession"].includes(
          key,
        ),
    ) ||
    inspectedResume.journalSha256 !== hash(inspectedText) ||
    inspectedResume.originalJournalSha256 !== hash(originalText) ||
    inspectedResume.phase !== "checkout-verified" ||
    inspectedResume.newCompanionSession !== true ||
    !Number.isSafeInteger(inspectedResume.at) ||
    inspectedResume.at < unchanged.resumedFrom.at ||
    inspectedResume.at > state.observedAt
  )
    fail("RECOVERY_SETUP_FAILURE_CHAIN_REQUIRED");
  return target;
}

// Constructing this closure does no I/O. Only the post-readiness commit may
// preserve/extend the checkpoint. Browser/sign-in failures cannot consume it.
export function deferRecoveryJournal({ verifyReady, createWriter }) {
  let writer,
    committing = false,
    uncertain = false;
  return async (value) => {
    if (committing || uncertain) fail("RECOVERY_CHECKPOINT_COMMIT_UNCERTAIN");
    committing = true;
    try {
      if (!writer) {
        await verifyReady();
        uncertain = true;
        writer = await createWriter();
      }
      uncertain = true;
      await writer(value);
      uncertain = false;
    } finally {
      committing = false;
    }
  };
}

export async function assertNoRecoveryPaymentClaim(directory, sessionId) {
  if (!/^cs_test_[A-Za-z0-9]+$/.test(sessionId || "")) fail("RECOVERY_UNPAID_RESUME_NOT_ELIGIBLE");
  try {
    await fs.lstat(path.join(directory, `payment-submit-${hash(sessionId)}.json`));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  fail("RECOVERY_PRIOR_PAYMENT_CLAIM_PRESENT");
}

export async function assertFreshRecoveryV2Run(directory) {
  try {
    await fs.lstat(path.join(directory, RECOVERY_V2_JOURNAL));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  fail("RECOVERY_V2_ALREADY_JOURNALED_NO_RESUME");
}

export async function selectObservedRecoveryCard({ page, sessionId }) {
  checkoutPage(page, sessionId);
  const card = page.locator(".card-accordion-item-cover");
  if (
    (await card.count()) !== 1 ||
    (await card.locator("#payment-method-label-card").count()) !== 1 ||
    !(await card.isVisible()) ||
    !(await card.isEnabled())
  )
    fail("RECOVERY_OBSERVED_CARD_CONTROL_REQUIRED");
  await card.click();
}

export function observedRecoveryCard(structure) {
  return (
    structure?.surface === "stripe-checkout" &&
    structure.inspectionOnly === true &&
    structure.truncated === false &&
    Array.isArray(structure.matches) &&
    structure.matches.filter(
      (match) =>
        match.text === "Card" &&
        match.ancestors?.some((node) => node.id === "payment-method-label-card" && node.visible) &&
        match.ancestors.some(
          (node) => node.classes?.includes("card-accordion-item-cover") && node.visible,
        ),
    ).length === 1
  );
}

export function recoveryRouteDecision(
  { url: address, method, navigation },
  held,
  initialReadOnly = false,
  recoveryConfig = C,
) {
  const url = new URL(address);
  if (/analyze-screenshot|dashboard-ai|ask-unimate/.test(url.pathname)) return "block";
  if (
    (held || initialReadOnly) &&
    url.origin === recoveryConfig.origin &&
    url.pathname === "/api/billing-status"
  )
    return method === "GET" ? "read-only-status" : "block";
  if (held && url.origin === recoveryConfig.origin && url.pathname === "/upgrade" && navigation)
    return "hold-return";
  return "pass";
}

// A hold blocks new reconciliation, but cannot undo a request already sent.
// Require it to finish before recording an action's persisted revision. A
// failed/aborted request has an unknown server outcome and fences this run.
export function createRecoveryReconciliationFence() {
  const pending = new Set();
  let uncertain = false;
  return {
    started: (request) => pending.add(request),
    finished: (request) => pending.delete(request),
    failed: (request) => {
      if (pending.delete(request)) uncertain = true;
    },
    assertSettled: () => {
      if (uncertain) fail("RECOVERY_RECONCILIATION_OUTCOME_UNCERTAIN");
      if (pending.size) fail("RECOVERY_RECONCILIATION_IN_FLIGHT");
    },
  };
}

export function assertRecoverySnapshotLists(state, record) {
  if (
    state?.user?.id !== record.userId ||
    state.user.email !== record.email ||
    state.user.app_metadata?.unimate_test_marker !== record.marker ||
    state.user.app_metadata?.unimate_test_nonce !== record.nonce ||
    state.customer?.id !== C.customer ||
    state.customer.livemode !== false ||
    state.customer.deleted ||
    state.customer.metadata?.user_id !== record.userId ||
    state.profile?.id !== record.userId ||
    state.profile.stripe_customer_id !== C.customer ||
    typeof state.profile.is_pro !== "boolean" ||
    !Number.isSafeInteger(state.profile.billing_revision) ||
    state.subscriptions?.has_more !== false ||
    !Array.isArray(state.subscriptions.data) ||
    state.openCheckouts?.has_more !== false ||
    !Array.isArray(state.openCheckouts.data)
  )
    fail("RECOVERY_COMPLETE_SCOPE_REQUIRED");
  for (const [rows, prefix] of [
    [state.subscriptions.data, "sub"],
    [state.openCheckouts.data, "cs_test"],
  ]) {
    if (
      new Set(rows.map((row) => row?.id)).size !== rows.length ||
      rows.some(
        (row) =>
          !new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(row?.id || "") ||
          row.livemode !== false ||
          id(row.customer) !== C.customer ||
          row.metadata?.user_id !== record.userId,
      )
    )
      fail("RECOVERY_COMPLETE_SCOPE_REQUIRED");
  }
  if (
    state.openCheckouts.data.some((row) => row.status !== "open") ||
    state.subscriptions.data.some(
      (sub) =>
        sub.items?.has_more !== false ||
        sub.items.data?.length !== 1 ||
        id(sub.items.data[0].price) !== C.price ||
        sub.items.data[0].quantity !== 1,
    )
  )
    fail("RECOVERY_COMPLETE_SCOPE_REQUIRED");
  return state;
}

export async function verifyRecoveryWarning(page, graceEnabled = true) {
  const warning = page.getByText(
    graceEnabled
      ? "Your latest payment failed. Pro remains available during the recovery period; update your payment method to avoid interruption."
      : "Your latest payment failed. Pro access is paused until payment is resolved. Update your payment method to restore access.",
    { exact: true },
  );
  await warning.waitFor({ state: "visible", timeout: 15000 });
  if ((await warning.count()) !== 1 || !(await warning.isVisible()))
    fail("RECOVERY_PAYMENT_WARNING_REQUIRED");
  return true;
}

export async function verifySavedTestMethod(page, inspect = inspectStripeSurface) {
  const surface = await inspect(page);
  if (
    surface.surface !== "stripe-checkout" ||
    surface.truncated ||
    surface.inputs.some(
      (input) =>
        input.visible &&
        /card.?number|cc-number|card.?cvc|security.?code/i.test(
          [input.id, input.name, input.label, ...input.labels].join(" "),
        ),
    )
  )
    fail("RECOVERY_SAVED_TEST_METHOD_REQUIRED");
  const saved = page.getByText(/\bVisa[\s•·*]{1,32}4242\b/);
  if ((await saved.count()) !== 1 || !(await saved.isVisible()))
    fail("RECOVERY_SAVED_TEST_METHOD_REQUIRED");
}

// All supplied ports are local dependency injection for offline tests. The CLI
// below fixes every real service, identity, path and reviewed browser helper.
export function createRecoveryController({
  record,
  baseline,
  snapshot,
  stripe,
  deliveredEvents,
  page,
  companion,
  persist,
  hold,
  graceVerified,
  recoveryPolicy = createRecoveryPolicy(C),
  resumeJournal,
  inspectSurface = inspectStripeSurface,
  inspectFields = inspectContinuationFields,
  inspectCard = inspectCheckoutCardStructure,
  selectCard = selectObservedRecoveryCard,
  submitPayment = submitVerifiedTestPayment,
  fillCard = fillVerifiedTestCard,
  submitCard = submitVerifiedCardCheckout,
  savedMethodReady = verifySavedTestMethod,
  inspectWarning = verifyRecoveryWarning,
  assertReconciliationSettled = () => {},
  loadPortalHelper = () => import("./protected-stripe-browser-recovery.mjs"),
  now = Date.now,
}) {
  const C = recoveryPolicy.config;
  const {
    verifyBaseline: verifyRecoveryBaseline,
    verifyPurchase: verifyRecoveryPurchase,
    verifyFailure: verifyRecoveryFailure,
    verifyCompletion: verifyRecoveryCompletion,
    verifyRevocation: verifyRecoveryRevocation,
  } = recoveryPolicy;
  if (graceVerified !== (C.graceEnabled ?? true)) fail("RECOVERY_VERIFIED_GRACE_REQUIRED");
  const readSnapshot = async () => assertRecoverySnapshotLists(await snapshot(), record);
  let journal = resumeJournal
    ? structuredClone(resumeJournal)
    : {
        version: C.kind === PROTECTED_BILLING_RECOVERY_V2.kind ? 2 : 1,
        kind: C.kind,
        account: C.account,
        origin: C.origin,
        source: C.source,
        userId: record.userId,
        customerId: C.customer,
        baseline,
        phase: "ready",
      };
  let held = false,
    uncertain = false,
    busy = false,
    portal;
  let cardObserved = false;
  if (resumeJournal) {
    if (
      resumeJournal.phase !== "checkout-verified" ||
      resumeJournal.baseline?.evidenceSha256 !== baseline.evidenceSha256 ||
      resumeJournal.resumedFrom?.newCompanionSession !== true
    )
      fail("RECOVERY_UNPAID_RESUME_NOT_ELIGIBLE");
    held = true;
    hold(true);
  }
  const save = async (next) => {
    await persist(next);
    journal = next;
  };
  const setHold = (value) => {
    hold(value);
    held = value;
  };
  const evidence = async (phase) => {
    const state = await readSnapshot();
    if (phase === "revoked") {
      const { deliveries, events } = await deliveredEvents();
      return verifyRecoveryRevocation({
        ...state,
        baseline,
        completion:
          journal.revocationPredecessorPhase === "purchased"
            ? journal.purchase
            : journal.completion,
        deliveries,
        events,
        actionStartedAt: journal.revocationArmedAt,
        actionBillingRevision: journal.revocationBillingRevision,
        reconciliationHeld: held,
      });
    }
    const fresh = state.subscriptions.data.filter((sub) => !C.baseline.includes(sub.id));
    if (fresh.length !== 1) fail("RECOVERY_SINGLE_NEW_SUBSCRIPTION_REQUIRED");
    const sub = fresh[0];
    if (!/^in_[A-Za-z0-9]+$/.test(id(sub.latest_invoice) || ""))
      fail("RECOVERY_INVOICE_ID_REQUIRED");
    const invoice = await stripe(`/invoices/${id(sub.latest_invoice)}`);
    const methodId =
      id(sub.default_payment_method) || id(state.customer.invoice_settings?.default_payment_method);
    if (!/^pm_[A-Za-z0-9]+$/.test(methodId || "")) fail("RECOVERY_PAYMENT_METHOD_ID_REQUIRED");
    const paymentMethod = await stripe(`/payment_methods/${methodId}`);
    const { deliveries, events } = await deliveredEvents();
    const input = {
      ...state,
      baseline,
      purchase: journal.purchase,
      failure: journal.failure,
      invoice,
      paymentMethod,
      deliveries,
      events,
      reconciliationHeld: held,
      graceEnabled: graceVerified,
    };
    if (phase === "purchased")
      return verifyRecoveryPurchase({
        ...input,
        actionStartedAt: journal.checkoutAttemptedAt,
        session: await stripe(`/checkout/sessions/${journal.sessionId}`),
      });
    if (phase === "past-due")
      return verifyRecoveryFailure({
        ...input,
        actionStartedAt: journal.renewalArmedAt,
        actionBillingRevision: journal.renewalBillingRevision,
      });
    if (phase !== "recovered" || !portal || !journal.portalUpdateArmedAt)
      fail("RECOVERY_VERIFIED_PORTAL_REQUIRED");
    const payments = await stripe(
      `/invoice_payments?${new URLSearchParams({ invoice: invoice.id, status: "paid", limit: "100" })}`,
    );
    if (
      payments?.has_more !== false ||
      payments.data?.length !== 1 ||
      !/^pi_[A-Za-z0-9]+$/.test(id(payments.data[0].payment?.payment_intent) || "")
    )
      fail("RECOVERY_COMPLETE_INVOICE_PAYMENTS_REQUIRED");
    const paymentIntent = await stripe(
      `/payment_intents/${id(payments.data[0].payment.payment_intent)}`,
    );
    const portalEvents = await recentProtectedPortalEvents(stripe, journal.portalAttemptedAt);
    return verifyRecoveryCompletion({
      ...input,
      events: [...events, ...portalEvents],
      portal,
      portalAttemptedAt: journal.portalAttemptedAt,
      actionStartedAt: journal.portalUpdateClaimedAt,
      actionBillingRevision: journal.portalUpdateBillingRevision,
      invoicePayment: payments.data[0],
      paymentIntent,
    });
  };
  const requirePhase = (...phases) => {
    if (!phases.includes(journal.phase)) fail("RECOVERY_COMMAND_PHASE_REJECTED");
  };
  const run = async (line) => {
    const command = parseRecoveryCommand(line);
    if (!command) fail("RECOVERY_FIXED_COMMAND_REQUIRED");
    if (busy) fail("RECOVERY_CONCURRENT_COMMAND_REJECTED");
    busy = true;
    try {
      if (command === "STOP") return { kind: "stop" };
      if (command === "STATUS") {
        const state = await readSnapshot();
        return {
          kind: "status",
          phase: journal.phase,
          uncertain,
          returnHeld: held,
          isPro: state.profile.is_pro,
          billingRevision: state.profile.billing_revision,
          openCheckouts: state.openCheckouts.data.length,
          activeSubscriptions: state.subscriptions.data.filter(
            (sub) => !["canceled", "incomplete_expired"].includes(sub.status),
          ).length,
        };
      }
      if (command === "INSPECT_STRIPE")
        return { kind: "stripe-controls", ...(await inspectSurface(page)) };
      if (command === "INSPECT_CHECKOUT") {
        requirePhase("checkout-verified", "card-selected", "card-ready");
        checkoutPage(page, journal.sessionId);
        const fields = await inspectFields(page),
          structure = await inspectCard(page);
        cardObserved = observedRecoveryCard(structure);
        return { kind: "checkout-controls", fields, structure, selectionAvailable: cardObserved };
      }
      if (uncertain) fail("RECOVERY_UNCERTAIN_ACTION_NO_RETRY");
      if (command === "CHECKOUT") {
        requirePhase("ready");
        const current = verifyRecoveryBaseline(await readSnapshot());
        if (
          current.billingRevision !== baseline.billingRevision ||
          current.clockId !== baseline.clockId
        )
          fail("RECOVERY_BASELINE_CHANGED");
        const url = new URL(page.url());
        if (url.origin !== C.origin || url.pathname !== "/upgrade")
          fail("RECOVERY_UPGRADE_PAGE_REQUIRED");
        const button = await readyProtectedBillingButton(page, /^(Restart Pro|Upgrade to Pro)$/);
        await save({ ...journal, phase: "checkout-pending", checkoutAttemptedAt: now() });
        setHold(true);
        uncertain = true;
        await button.click();
        await page.waitForURL((url) => url.origin === "https://checkout.stripe.com");
        const sessionId = new URL(page.url()).pathname
          .split("/")
          .find((part) => /^cs_test_[A-Za-z0-9]+$/.test(part));
        checkoutPage(page, sessionId);
        if (!sessionId) fail("RECOVERY_TEST_CHECKOUT_REQUIRED");
        await save({ ...journal, phase: "checkout-resolved", sessionId });
        const session = await stripe(`/checkout/sessions/${sessionId}`);
        const items = await stripe(`/checkout/sessions/${sessionId}/line_items?limit=100`);
        const state = await readSnapshot();
        assertProtectedPaymentAttempt(
          { ...journal, phase: "checkout-verified" },
          session,
          items,
          {
            profile: state.profile,
            open: state.openCheckouts.data,
            scope: { subscriptions: state.subscriptions.data },
          },
          JSON.stringify(C.baseline.map((value) => [value, "canceled"]).sort()),
        );
        await save({ ...journal, phase: "checkout-verified" });
        uncertain = false;
        return { kind: "checkout", verified: true, testMode: true, amount: 599, currency: "usd" };
      }
      if (["PAY_SUBMIT", "PAY_CARD_FILL", "PAY_CARD_SUBMIT", "SELECT_CARD"].includes(command)) {
        if (command === "PAY_CARD_FILL") requirePhase("checkout-verified", "card-selected");
        else requirePhase(command === "PAY_CARD_SUBMIT" ? "card-ready" : "checkout-verified");
        checkoutPage(page, journal.sessionId);
        const session = await stripe(`/checkout/sessions/${journal.sessionId}`);
        const items = await stripe(`/checkout/sessions/${journal.sessionId}/line_items?limit=100`);
        const state = await readSnapshot();
        if (state.profile.billing_revision !== baseline.billingRevision)
          fail("RECOVERY_EXACT_BASELINE_REVISION_REQUIRED");
        assertProtectedPaymentAttempt(
          { ...journal, phase: "checkout-verified" },
          session,
          items,
          {
            profile: state.profile,
            open: state.openCheckouts.data,
            scope: { subscriptions: state.subscriptions.data },
          },
          JSON.stringify(C.baseline.map((value) => [value, "canceled"]).sort()),
        );
        if (!held) fail("RECOVERY_RECONCILIATION_HOLD_REQUIRED");
        if (command === "SELECT_CARD") {
          if (!cardObserved || journal.cardSelectAttempted)
            fail("RECOVERY_OBSERVED_CARD_CONTROL_REQUIRED");
          await save({ ...journal, phase: "card-select-pending", cardSelectAttempted: true });
          uncertain = true;
          await selectCard({ page, sessionId: journal.sessionId });
          await save({ ...journal, phase: "card-selected" });
          uncertain = false;
          cardObserved = false;
          return { kind: "test-card-selected", testMode: true, submitted: false };
        }
        if (command === "PAY_CARD_FILL") {
          await save({ ...journal, phase: "card-fill-pending", cardFillAttempted: true });
          uncertain = true;
          await fillCard({ page, sessionId: journal.sessionId });
          await save({ ...journal, phase: "card-ready" });
          uncertain = false;
          return { kind: "test-card-filled", testMode: true, submitted: false };
        }
        if (command === "PAY_SUBMIT") await savedMethodReady(page);
        await save({ ...journal, phase: "payment-pending", paymentAttempted: true });
        uncertain = true;
        await (command === "PAY_CARD_SUBMIT" ? submitCard : submitPayment)({
          page,
          sessionId: journal.sessionId,
        });
        uncertain = false;
        return { kind: "payment-submitted", testMode: true };
      }
      if (command === "EXPECT_PRO") {
        requirePhase("payment-pending");
        const purchase = await evidence("purchased");
        const result = await companion.expectPro(purchase);
        await save({ ...journal, phase: "purchased", purchase, companionPurchase: result });
        return { kind: "companion", ...result };
      }
      if (command === "RETURN") {
        requirePhase("purchased", "past-due", "recovered", "revoked");
        if (!held) fail("RECOVERY_RECONCILIATION_HOLD_REQUIRED");
        await evidence(journal.phase);
        setHold(false);
        try {
          await page.goto(`${C.origin}/upgrade`, { waitUntil: "domcontentloaded" });
          if (journal.phase === "past-due") {
            if ((await inspectWarning(page, graceVerified)) !== true)
              fail("RECOVERY_PAYMENT_WARNING_REQUIRED");
            await save({ ...journal, failureWarningVerified: true });
          }
          return {
            kind: "return",
            hostedWebhookProofBeforeReturn: true,
            paymentWarningVerified: journal.phase === "past-due",
          };
        } catch (error) {
          setHold(true);
          throw error;
        }
      }
      if (command === "ARM_RENEWAL") {
        requirePhase("purchased");
        if (journal.renewalArmedAt) fail("RECOVERY_ACTION_ALREADY_ARMED");
        setHold(true);
        assertReconciliationSettled();
        const current = await evidence("purchased");
        await save({
          ...journal,
          phase: "renewal-armed",
          renewalArmedAt: now(),
          renewalBillingRevision: current.billingRevision,
        });
        return { kind: "renewal-armed", externalApprovedActionRequired: true };
      }
      if (command === "EXPECT_PAST_DUE") {
        requirePhase("renewal-armed");
        const failure = await evidence("past-due");
        const result =
          await companion[graceVerified ? "expectRecoveryPro" : "expectRecoveryLocked"](failure);
        await save({ ...journal, phase: "past-due", failure, companionFailure: result });
        return { kind: "companion", ...result };
      }
      if (command === "PORTAL") {
        requirePhase("past-due");
        if (journal.failureWarningVerified !== true) fail("RECOVERY_PAYMENT_WARNING_REQUIRED");
        const location = new URL(page.url());
        if (
          location.origin !== C.origin ||
          location.pathname !== "/upgrade" ||
          location.username ||
          location.password
        )
          fail("RECOVERY_UPGRADE_PAGE_REQUIRED");
        setHold(true);
        assertReconciliationSettled();
        await evidence("past-due");
        // Keep reconciliation disabled while the website opens real Manage
        // billing. Its GET is served by the hold with reconcile=false only.
        const button = await readyProtectedBillingButton(page, "Manage billing");
        await save({ ...journal, phase: "portal-pending", portalAttemptedAt: now() });
        uncertain = true;
        await button.click();
        await page.waitForURL((url) => url.origin === "https://billing.stripe.com");
        const currentUrl = page.url();
        const events = await recentProtectedPortalEvents(stripe, journal.portalAttemptedAt);
        const matches = events.filter((event) => event.data?.object?.url === currentUrl);
        if (
          matches.length !== 1 ||
          matches[0].data.object.livemode !== false ||
          id(matches[0].data.object.customer) !== C.customer ||
          matches[0].data.object.return_url !== `${C.origin}/upgrade`
        )
          fail("RECOVERY_PORTAL_CUSTOMER_NOT_VERIFIED");
        portal = matches[0].data.object;
        await save({ ...journal, phase: "portal-verified", portalId: portal.id });
        uncertain = false;
        return {
          kind: "portal",
          exactCustomerVerified: true,
          testMode: true,
          updateSubmissionEnabled: false,
        };
      }
      if (command === "ARM_PORTAL_UPDATE") {
        requirePhase("portal-verified");
        if (!held || page.url() !== portal?.url) fail("RECOVERY_EXACT_PORTAL_PAGE_REQUIRED");
        await evidence("past-due");
        await save({ ...journal, phase: "portal-update-armed", portalUpdateArmedAt: now() });
        return {
          kind: "portal-update-armed",
          inspectionRequired: true,
          updateSubmissionEnabled: false,
        };
      }
      if (command === "EXPECT_RECOVERED") {
        requirePhase("portal-update-submitted");
        const completion = await evidence("recovered");
        const result = await companion.expectRecoveredPro(completion);
        await save({ ...journal, phase: "recovered", completion, companionRecovery: result });
        return { kind: "companion", ...result };
      }
      if (command === "PORTAL_UPDATE") {
        requirePhase("portal-update-armed");
        if (!held || page.url() !== portal?.url) fail("RECOVERY_EXACT_PORTAL_PAGE_REQUIRED");
        // Fixed lazy module only: the operator first inspects actual controls,
        // then authors/reviews this specific helper. An absent helper does not
        // consume the one-shot claim. No selector/module/eval comes from stdin.
        const helper = await loadPortalHelper();
        if (typeof helper.updateVerifiedRecoveryPaymentMethod !== "function")
          fail("RECOVERY_REVIEWED_PORTAL_HELPER_REQUIRED");
        let claimed = false;
        const claimUpdate = async () => {
          if (claimed || journal.portalUpdateAttempted)
            fail("RECOVERY_PORTAL_UPDATE_ALREADY_CLAIMED");
          if (!held || page.url() !== portal.url) fail("RECOVERY_EXACT_PORTAL_PAGE_REQUIRED");
          assertReconciliationSettled();
          const current = await evidence("past-due");
          await save({
            ...journal,
            phase: "portal-update-pending",
            portalUpdateAttempted: true,
            portalUpdateClaimedAt: now(),
            portalUpdateBillingRevision: current.billingRevision,
          });
          claimed = true;
          uncertain = true;
        };
        await helper.updateVerifiedRecoveryPaymentMethod({
          page,
          portal: structuredClone(portal),
          claimUpdate,
        });
        if (!claimed) fail("RECOVERY_PORTAL_UPDATE_CLAIM_REQUIRED");
        await save({ ...journal, phase: "portal-update-submitted" });
        uncertain = false;
        return { kind: "portal-update-submitted", testMode: true, recoveryNotYetVerified: true };
      }
      if (command === "ARM_REVOCATION") {
        requirePhase("purchased", "recovered");
        setHold(true);
        assertReconciliationSettled();
        const current = await evidence(journal.phase);
        await save({
          ...journal,
          phase: "revocation-armed",
          revocationArmedAt: now(),
          revocationPredecessorPhase: journal.phase,
          revocationBillingRevision: current.billingRevision,
        });
        return { kind: "revocation-armed", externalApprovedActionRequired: true };
      }
      if (command === "EXPECT_REVOKED") {
        requirePhase("revocation-armed");
        const revocation = await evidence("revoked");
        const result = await companion.expectRevoked(revocation);
        await save({ ...journal, phase: "revoked", revocation, companionRevocation: result });
        return { kind: "companion", ...result };
      }
      fail("RECOVERY_FIXED_COMMAND_REQUIRED");
    } finally {
      busy = false;
    }
  };
  return { run, initialJournal: () => structuredClone(journal) };
}

export async function createRecoveryJournal(
  directory,
  { resumeText, inspectedOriginalText, startupInspectedText, runVersion = 1 } = {},
) {
  if (
    ![1, 2].includes(runVersion) ||
    (runVersion === 2 &&
      [resumeText, inspectedOriginalText, startupInspectedText].some(
        (value) => value !== undefined,
      ))
  )
    fail("RECOVERY_RUN_VERSION_REQUIRED");
  const stat = await fs.lstat(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    stat.mode & 0o077
  )
    fail("RECOVERY_PRIVATE_DIRECTORY_REQUIRED");
  const filename = path.join(directory, runVersion === 2 ? RECOVERY_V2_JOURNAL : RECOVERY_JOURNAL);
  if (
    startupInspectedText !== undefined &&
    (typeof startupInspectedText !== "string" ||
      typeof inspectedOriginalText !== "string" ||
      (await readPrivate(`${filename}.inspected-unpaid-resume-original.json`)) !==
        startupInspectedText)
  )
    fail("RECOVERY_SETUP_FAILURE_CHAIN_REQUIRED");
  if (
    inspectedOriginalText !== undefined &&
    (typeof inspectedOriginalText !== "string" ||
      typeof resumeText !== "string" ||
      (await readPrivate(`${filename}.unpaid-resume-original.json`)) !== inspectedOriginalText)
  )
    fail("RECOVERY_INSPECTED_RESUME_CHAIN_REQUIRED");
  if (
    resumeText !== undefined &&
    (typeof resumeText !== "string" || (await readPrivate(filename)) !== resumeText)
  )
    fail("RECOVERY_RESUME_JOURNAL_CHANGED");
  const handle = await fs.open(
    resumeText === undefined
      ? filename
      : startupInspectedText !== undefined
        ? `${filename}.startup-failure-resume-original.json`
        : inspectedOriginalText === undefined
          ? `${filename}.unpaid-resume-original.json`
          : `${filename}.inspected-unpaid-resume-original.json`,
    "wx",
    0o600,
  );
  if (resumeText !== undefined) {
    await handle.writeFile(resumeText);
    await handle.sync();
  }
  await handle.close();
  let expected = resumeText ?? "";
  return async (value) => {
    const current = await fs.lstat(filename);
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.nlink !== 1 ||
      current.uid !== process.getuid() ||
      current.mode & 0o077
    )
      fail("RECOVERY_PRIVATE_JOURNAL_REQUIRED");
    if ((await readPrivate(filename)) !== expected) fail("RECOVERY_RESUME_JOURNAL_CHANGED");
    const temporary = `${filename}.${randomUUID()}.tmp`;
    const output = await fs.open(temporary, "wx", 0o600);
    try {
      await output.writeFile(JSON.stringify(value));
      await output.sync();
    } finally {
      await output.close();
    }
    await fs.rename(temporary, filename);
    expected = JSON.stringify(value);
  };
}

export async function runProtectedBillingRecovery({
  approved = false,
  runVersion = 1,
  resumeUnpaid = false,
  resumeInspectedUnpaid = false,
  resumeStartupFailure = false,
} = {}) {
  assertRecoveryStart({ approved });
  if (
    typeof resumeUnpaid !== "boolean" ||
    typeof resumeInspectedUnpaid !== "boolean" ||
    typeof resumeStartupFailure !== "boolean" ||
    [resumeUnpaid, resumeInspectedUnpaid, resumeStartupFailure].filter(Boolean).length > 1
  )
    fail("RECOVERY_UNPAID_RESUME_NOT_ELIGIBLE");
  const resuming = resumeUnpaid || resumeInspectedUnpaid || resumeStartupFailure;
  if (![1, 2].includes(runVersion) || (runVersion === 2 && resuming))
    fail("RECOVERY_RUN_VERSION_REQUIRED");
  const recoveryPolicy = createRecoveryPolicy(runVersion === 2 ? PROTECTED_BILLING_RECOVERY_V2 : C);
  const recoveryConfig = recoveryPolicy.config;
  // No operator-supplied baseline, origin, source or journal path is accepted.
  const selectedOrigin = recoveryConfig.origin;
  const deferredStart = runVersion === 2 || resumeStartupFailure;
  const report = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  let currentStage = "configuration";
  const stage = (name) => {
    currentStage = name;
    report({ kind: "startup", stage: name });
  };
  const directory = path.join(ROOT, ".stripe-sandbox.local");
  const environment = Object.fromEntries(
    ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG"]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  const execute = promisify(execFile);
  let lock, relay, listener, browser, context, dispose, companion, input, timer;
  let stopped = false,
    closing;
  const cleanup = async () => {
    await companion?.close().catch(() => {});
    await dispose?.().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await relay?.stop().catch(() => {});
    if (listener?.pid && listener.exitCode === null && !listener.signalCode)
      await new Promise((resolve) => {
        const hard = setTimeout(() => listener.kill("SIGKILL"), 5000);
        listener.once("exit", () => {
          clearTimeout(hard);
          resolve();
        });
        listener.kill("SIGTERM");
      });
  };
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    input?.close();
    return (closing ||= cleanup());
  };
  const active = () => {
    if (stopped) fail("RECOVERY_RUN_STOPPED");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    stage("configuration");
    const config = await prepareSandbox({ approved: true, verificationOnly: true });
    const dir = await fs.lstat(directory);
    if (
      !dir.isDirectory() ||
      dir.isSymbolicLink() ||
      dir.mode & 0o077 ||
      dir.uid !== process.getuid()
    )
      fail("RECOVERY_PRIVATE_DIRECTORY_REQUIRED");
    lock = await fs.open(path.join(directory, "protected-billing-run.lock"), "wx", 0o600);
    if (runVersion === 2) await assertFreshRecoveryV2Run(directory);
    const record = JSON.parse(await readPrivate(path.join(ROOT, ARTIFACT)));
    validateRecord(record);
    const setup = JSON.parse(
      await readPrivate(path.join(directory, "protected-preview-setup-v1.json")),
    );
    assertRecoverySetup(setup, record);
    const previousRecoveryText =
      runVersion === 2 ? await readPrivate(path.join(directory, RECOVERY_JOURNAL)) : undefined;
    const journalHashes = {};
    for (const version of ["v1", "v2"])
      journalHashes[version] = hash(
        await readPrivate(path.join(directory, `protected-billing-checkout-${version}.json`)),
      );
    stage("deployment");
    const project = JSON.parse(await fs.readFile(path.join(ROOT, ".vercel/project.json"), "utf8"));
    const cli = await validatedProtectedVercelCli(process.env.UNIMATE_VERCEL_CLI_PATH);
    const vercel = (args, options) =>
      execute(process.execPath, [cli, ...args], {
        ...options,
        env: { ...environment, CI: "1", NO_COLOR: "1", VERCEL_CLI_USE_NATIVE_BINARY: "0" },
      });
    let graceVerified;
    const deployment = await loadVerifiedPreviewDeployment(
      selectedOrigin,
      project,
      async (file, args, options) => {
        if (file !== "npx" || args[1] !== "vercel@63.1.2") fail("RECOVERY_PINNED_CLI_REQUIRED");
        const result = await vercel(args.slice(2), options);
        graceVerified = assertRecoveryDeployment(
          JSON.parse(result.stdout),
          recoveryConfig,
        ).graceEnabled;
        return result;
      },
    );
    const stripe = (endpoint) =>
      privateJson(fetch, `https://api.stripe.com/v1${endpoint}`, {
        headers: {
          Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
          "Stripe-Version": "2026-06-24.dahlia",
        },
      });
    const service = config.supa.SUPABASE_SERVICE_ROLE_KEY;
    const headers = service.startsWith("sb_secret_")
      ? { apikey: service }
      : { apikey: service, Authorization: `Bearer ${service}` };
    const snapshot = async () => {
      active();
      if (
        runVersion === 2 &&
        (await readPrivate(path.join(directory, RECOVERY_JOURNAL))) !== previousRecoveryText
      )
        fail("RECOVERY_PREVIOUS_JOURNAL_CHANGED");
      const user = await privateJson(
        fetch,
        `${TARGET.supabase}/auth/v1/admin/users/${record.userId}`,
        { headers },
      );
      const profiles = await privateJson(
        fetch,
        `${TARGET.supabase}/rest/v1/profiles?${new URLSearchParams({ id: `eq.${record.userId}`, select: "id,is_pro,stripe_customer_id,billing_revision" })}`,
        { headers },
      );
      if (profiles?.length !== 1 || profiles[0].id !== record.userId)
        fail("RECOVERY_EXACT_PROFILE_REQUIRED");
      const customer = await stripe(`/customers/${C.customer}`);
      const clockId = id(customer.test_clock);
      if (!/^clock_[A-Za-z0-9]+$/.test(clockId || "")) fail("RECOVERY_EXACT_CLOCK_REQUIRED");
      const clock = await stripe(`/test_helpers/test_clocks/${clockId}`);
      const subscriptions = await stripe(
        `/subscriptions?${new URLSearchParams({ customer: C.customer, status: "all", limit: "100" })}`,
      );
      const openCheckouts = await stripe(
        `/checkout/sessions?${new URLSearchParams({ customer: C.customer, status: "open", limit: "100" })}`,
      );
      return {
        origin: selectedOrigin,
        source: recoveryConfig.source,
        record,
        user,
        customer,
        clock,
        profile: profiles[0],
        subscriptions,
        openCheckouts,
        journalHashes,
        ...(runVersion === 2 ? { previousRecoveryText } : {}),
        observedAt: Date.now(),
      };
    };
    stage("baseline");
    const initial = await snapshot();
    let resumeJournal, resumeTarget, originalJournal;
    const resumeText = resuming
      ? await readPrivate(path.join(directory, RECOVERY_JOURNAL))
      : undefined;
    const inspectedOriginalText =
      resumeInspectedUnpaid || resumeStartupFailure
        ? await readPrivate(path.join(directory, `${RECOVERY_JOURNAL}.unpaid-resume-original.json`))
        : undefined;
    const startupInspectedText = resumeStartupFailure
      ? await readPrivate(
          path.join(directory, `${RECOVERY_JOURNAL}.inspected-unpaid-resume-original.json`),
        )
      : undefined;
    const verifyResume = resumeStartupFailure
      ? (value) =>
          verifySetupFailureRecoveryResume({
            ...value,
            originalText: inspectedOriginalText,
            inspectedText: startupInspectedText,
          })
      : resumeInspectedUnpaid
        ? (value) =>
            verifyInspectedUnpaidRecoveryResume({ ...value, originalText: inspectedOriginalText })
        : verifyUnpaidRecoveryResume;
    const resumeField = resumeStartupFailure
      ? "startupResume"
      : resumeInspectedUnpaid
        ? "inspectedResume"
        : "resumedFrom";
    if (resuming) {
      originalJournal = JSON.parse(resumeText);
      if (!/^cs_test_[A-Za-z0-9]+$/.test(originalJournal?.sessionId || ""))
        fail("RECOVERY_UNPAID_RESUME_NOT_ELIGIBLE");
      await assertNoRecoveryPaymentClaim(directory, originalJournal.sessionId);
      resumeTarget = verifyResume({
        journal: originalJournal,
        record,
        state: initial,
        session: await stripe(`/checkout/sessions/${originalJournal.sessionId}`),
        items: await stripe(`/checkout/sessions/${originalJournal.sessionId}/line_items?limit=100`),
      });
      resumeJournal = {
        ...originalJournal,
        [resumeField]: {
          journalSha256: hash(resumeText),
          ...(resumeInspectedUnpaid || resumeStartupFailure
            ? { originalJournalSha256: hash(inspectedOriginalText) }
            : {}),
          ...(resumeStartupFailure ? { inspectedJournalSha256: hash(startupInspectedText) } : {}),
          phase: originalJournal.phase,
          at: Date.now(),
          newCompanionSession: true,
        },
      };
    }
    const baseline = resumeTarget?.baseline || recoveryPolicy.verifyBaseline(initial);
    if (
      runVersion === 2
        ? baseline.billingRevision < recoveryConfig.baselineRevision
        : baseline.billingRevision !== 62
    )
      fail("RECOVERY_EXACT_BASELINE_REVISION_REQUIRED");
    const journalOptions = { resumeText, inspectedOriginalText, startupInspectedText, runVersion };
    let persist;
    if (!deferredStart) {
      persist = await createRecoveryJournal(directory, journalOptions);
      await persist(
        resumeJournal || {
          version: 1,
          kind: C.kind,
          origin: C.origin,
          source: C.source,
          baseline,
          phase: "preparing",
        },
      );
    }
    stage("OIDC");
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-recovery-oidc-"));
    let token;
    try {
      token = (
        await vercel(
          [
            "env",
            "run",
            "--scope",
            "resumejuice-s-projects",
            "--project",
            PROJECT,
            "--",
            process.execPath,
            "-e",
            'process.stdout.write(process.env.VERCEL_OIDC_TOKEN||"")',
          ],
          { cwd, timeout: 60000, maxBuffer: 64000 },
        )
      ).stdout.trim();
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
    const access = validatePreviewAccess(selectedOrigin, token, project, deployment);
    token = "";
    active();
    stage("listener");
    const deliveries = [];
    relay = createProtectedStripePreviewRelay({
      access,
      project,
      deployment,
      webhookSecret: setup.webhookSecret,
      account: TARGET.account,
      customerId: C.customer,
      report: (event) => {
        deliveries.push({ ...event, at: Date.now() });
        if (deliveries.length > 200) deliveries.shift();
        report({ kind: "webhook", httpStatus: event.httpStatus, eventType: event.eventType });
      },
    });
    await relay.start();
    active();
    const args = [...LISTEN_ARGS];
    args[args.indexOf("--forward-to") + 1] = "http://127.0.0.1:8789/api/stripe-webhook";
    listener = spawn("stripe", args, {
      cwd: ROOT,
      env: { ...environment, STRIPE_API_KEY: config.stripe.STRIPE_SECRET_KEY },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    listener.stdout.on("data", () => {});
    listener.stderr.on("data", () => {});
    listener.once("error", () => void stop());
    listener.once("exit", () => void stop());
    if ((await captureSecret(listener)) !== setup.webhookSecret)
      fail("RECOVERY_LISTENER_SECRET_MISMATCH");
    active();
    stage("website-browser-import");
    const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
    const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
    stage("website-browser-launch");
    browser = await chromium.launch({ channel: "chromium", headless: true, env: environment });
    active();
    stage("website-browser-context");
    context = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 1280, height: 900 },
    });
    dispose = await attachProtectedPreviewBrowser(context, access);
    context.once("close", () => void stop());
    let held = false,
      initialReadOnly = true;
    const reconciliation = createRecoveryReconciliationFence();
    context.on("requestfinished", reconciliation.finished);
    context.on("requestfailed", reconciliation.failed);
    await context.route(/^https?:\/\//, async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const decision = recoveryRouteDecision(
        { url: url.href, method: request.method(), navigation: request.isNavigationRequest() },
        held,
        initialReadOnly,
        recoveryConfig,
      );
      if (decision === "block") return route.abort("blockedbyclient");
      if (decision === "read-only-status") {
        // A read-only entitlement refresh is needed to render Manage billing;
        // never let the website reconcile the profile during evidence collection.
        return route.fallback({ url: `${selectedOrigin}/api/billing-status?reconcile=false` });
      }
      if (decision === "hold-return")
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>Private verification</title><p>Waiting for verified test evidence.</p>",
        });
      if (
        url.origin === selectedOrigin &&
        url.pathname === "/api/billing-status" &&
        request.method() === "GET" &&
        url.searchParams.get("reconcile") !== "false"
      )
        reconciliation.started(request);
      return route.fallback();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    stage("website-navigation");
    await page.goto(`${selectedOrigin}/signin?next=upgrade`, { waitUntil: "domcontentloaded" });
    stage("website-signin-readiness");
    await fillReadyRecoverySignIn(page, record);
    stage("website-signin-submit");
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.origin === TARGET.supabase &&
        url.pathname === "/auth/v1/token" &&
        url.searchParams.get("grant_type") === "password"
      );
    });
    const [response] = await Promise.all([
      responsePromise,
      page.getByRole("button", { name: "Sign in", exact: true }).click(),
    ]);
    stage("website-marked-session");
    const signedIn = response.status() === 200 ? await response.json() : null;
    const user = signedIn?.user;
    if (
      user?.id !== record.userId ||
      user.email !== record.email ||
      user.app_metadata?.unimate_test_marker !== record.marker ||
      user.app_metadata?.unimate_test_nonce !== record.nonce
    )
      fail("RECOVERY_MARKED_SIGNIN_REQUIRED");
    stage("website-upgrade-navigation");
    await page.waitForURL((url) => url.origin === selectedOrigin && url.pathname === "/upgrade");
    if (runVersion === 2) {
      stage("website-runtime-grace");
      graceVerified = await verifyRecoveryRuntimeGrace(
        page,
        selectedOrigin,
        signedIn?.access_token,
      );
    }
    stage("Companion");
    companion = await startProtectedCompanionBillingHarness({
      record,
      publicKey: config.supa.VITE_SUPABASE_ANON_KEY,
      access,
      project,
      deployment,
      privateDirectory: directory,
      modulePath,
      recoveryBaseline: baseline,
      recoveryPolicy,
    });
    const freeEvidence = await companion.expectFree();
    report({
      kind: "companion",
      ...freeEvidence,
      ...(resuming ? { freshSessionAfterUnpaidResume: true } : {}),
      ...(resumeInspectedUnpaid ? { freshSessionAfterInspectionOnlyStop: true } : {}),
      ...(resumeStartupFailure ? { freshSessionAfterSetupFailure: true } : {}),
    });
    if (resuming) {
      resumeTarget = verifyResume({
        journal: originalJournal,
        record,
        state: await snapshot(),
        session: await stripe(`/checkout/sessions/${originalJournal.sessionId}`),
        items: await stripe(`/checkout/sessions/${originalJournal.sessionId}/line_items?limit=100`),
      });
      resumeJournal = {
        ...resumeJournal,
        [resumeField]: { ...resumeJournal[resumeField], freeCompanion: freeEvidence },
      };
    }
    active();
    if (resumeStartupFailure) {
      held = true;
      initialReadOnly = false;
      stage("checkout-readiness");
      await page.goto(resumeTarget.checkoutUrl, { waitUntil: "domcontentloaded" });
      checkoutPage(page, originalJournal.sessionId);
      persist = deferRecoveryJournal({
        verifyReady: async () => {
          active();
          checkoutPage(page, originalJournal.sessionId);
          await assertNoRecoveryPaymentClaim(directory, originalJournal.sessionId);
          verifyResume({
            journal: originalJournal,
            record,
            state: await snapshot(),
            session: await stripe(`/checkout/sessions/${originalJournal.sessionId}`),
            items: await stripe(
              `/checkout/sessions/${originalJournal.sessionId}/line_items?limit=100`,
            ),
          });
        },
        createWriter: () => createRecoveryJournal(directory, journalOptions),
      });
    }
    if (runVersion === 2) {
      persist = deferRecoveryJournal({
        verifyReady: async () => {
          active();
          const location = new URL(page.url());
          if (location.origin !== selectedOrigin || location.pathname !== "/upgrade")
            fail("RECOVERY_UPGRADE_PAGE_REQUIRED");
          const current = recoveryPolicy.verifyBaseline(await snapshot());
          if (
            current.billingRevision !== baseline.billingRevision ||
            current.clockId !== baseline.clockId
          )
            fail("RECOVERY_BASELINE_CHANGED");
        },
        createWriter: () => createRecoveryJournal(directory, journalOptions),
      });
    }
    const deliveredEvents = async () => {
      const observed = deliveries.filter((entry) => entry.httpStatus === 200);
      const ids = [...new Set(observed.map((entry) => entry.eventId))];
      if (ids.length > 80 || ids.some((value) => !/^evt_[A-Za-z0-9]+$/.test(value || "")))
        fail("RECOVERY_BOUNDED_EVENT_LIST_REQUIRED");
      const events = [];
      for (const eventId of ids) {
        const event = await stripe(`/events/${eventId}`);
        if (
          event.id !== eventId ||
          !observed.some((entry) => entry.eventId === eventId && entry.eventType === event.type)
        )
          fail("RECOVERY_EVENT_READBACK_MISMATCH");
        events.push(event);
      }
      return { deliveries: observed, events };
    };
    const controller = createRecoveryController({
      record,
      baseline,
      snapshot,
      stripe,
      deliveredEvents,
      page,
      companion,
      persist,
      graceVerified,
      recoveryPolicy,
      resumeJournal,
      assertReconciliationSettled: reconciliation.assertSettled,
      hold: (value) => {
        initialReadOnly = false;
        held = value;
      },
    });
    await persist(controller.initialJournal());
    if (resuming && !resumeStartupFailure) {
      await page.goto(resumeTarget.checkoutUrl, { waitUntil: "domcontentloaded" });
      checkoutPage(page, originalJournal.sessionId);
    }
    timer = setTimeout(
      () => void stop(),
      Math.max(1, Math.min(45 * 60_000, access.expiresAt - Date.now() - 5000)),
    );
    timer.unref?.();
    report({ kind: "ready", commands: [...COMMANDS], portalUpdateSubmissionEnabled: false });
    input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    let count = 0;
    for await (const line of input) {
      if (++count > 80) fail("RECOVERY_COMMAND_LIMIT_REACHED");
      active();
      try {
        const result = await controller.run(line);
        report(result);
        if (result.kind === "stop") break;
      } catch (error) {
        report({ code: recoveryErrorCode(error) });
      }
    }
  } catch (error) {
    report({
      kind: "startup-stopped",
      stage: currentStage,
      category:
        error?.name === "TimeoutError"
          ? "timeout"
          : ["ENOENT", "ERR_MODULE_NOT_FOUND"].includes(error?.code)
            ? "missing-local-dependency"
            : "operation-failed",
    });
    throw new SetupError(recoveryErrorCode(error));
  } finally {
    await stop();
    await cleanup();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    if (lock) {
      await lock.close();
      await fs.unlink(path.join(directory, "protected-billing-run.lock"));
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runVersion = process.argv[2] === "--recovery-v2" ? 2 : 1;
  const resumeUnpaid = process.argv[3] === "--resume-unpaid";
  const resumeInspectedUnpaid = process.argv[3] === "--resume-inspected-unpaid";
  const resumeStartupFailure = process.argv[3] === "--resume-startup-failure";
  runProtectedBillingRecovery({
    approved:
      process.argv.length ===
        (resumeUnpaid || resumeInspectedUnpaid || resumeStartupFailure ? 4 : 3) &&
      ["--recovery-v1", "--recovery-v2"].includes(process.argv[2]) &&
      process.env.UNIMATE_PROTECTED_BILLING_RECOVERY === "approved",
    resumeUnpaid,
    resumeInspectedUnpaid,
    resumeStartupFailure,
    runVersion,
  }).catch((error) => {
    console.error(JSON.stringify({ code: recoveryErrorCode(error) }));
    process.exitCode = 1;
  });
}
