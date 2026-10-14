// One explicit completion of the already-journaled synthetic Portal flow.
// No API mutation, new portal, app credentials/OIDC, original-journal edits,
// or retry. The original relay and continuous Companion runner stay alive.
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ARTIFACT,
  TARGET,
  SetupError,
  prepareSandbox,
  privateJson,
} from "./prepare-stripe-sandbox.mjs";
import { readPrivate } from "./verify-stripe-sandbox-lifecycle.mjs";
import { validateRecord } from "./verify-companion-sandbox-browser.mjs";
import { sandboxClock } from "./stripe-sandbox-clock.mjs";
import { recentProtectedPortalEvents } from "./run-protected-billing-preview.mjs";
import { inspectStripeSurface } from "./protected-stripe-browser-actions.mjs";
import {
  continuationRoutePolicy,
  classifyContinuationFailure,
} from "./continue-protected-sandbox-checkout.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CUSTOMER = "cus_VRAVJnKW1RGQzr",
  PORTAL = "https://billing.stripe.com";
const fail = (code) => {
  throw new SetupError(code);
};
const id = (value) => (typeof value === "string" ? value : value?.id);
export const parsePortalCompletionCommand = (line) =>
  ["STATUS", "INSPECT", "REASON", "CONFIRM", "STOP"].includes(line.trim()) ? line.trim() : null;

export function verifyPortalCompletionScope(
  record,
  journal,
  { scope, profiles, events },
  now = Date.now(),
) {
  validateRecord(record);
  const origin = new URL(journal?.origin);
  if (
    journal.version !== 1 ||
    journal.account !== TARGET.account ||
    journal.userId !== record.userId ||
    journal.customerId !== CUSTOMER ||
    journal.portalVerified !== true ||
    journal.portalAttempted !== true ||
    journal.cancelAttempted !== true ||
    !/^sub_[A-Za-z0-9]+$/.test(journal.subscriptionId || "") ||
    !Number.isSafeInteger(journal.portalAttemptedAt) ||
    journal.portalAttemptedAt <= 0 ||
    !Number.isSafeInteger(journal.purchaseVerifiedRevision) ||
    journal.purchaseVerifiedRevision < 0 ||
    origin.origin !== journal.origin ||
    origin.protocol !== "https:" ||
    origin.port ||
    !/^[a-z0-9-]+\.vercel\.app$/.test(origin.hostname)
  )
    fail("EXACT_VERIFIED_PORTAL_JOURNAL_REQUIRED");
  let baseline;
  try {
    baseline = JSON.parse(journal.baseline);
  } catch {
    fail("PORTAL_BASELINE_REQUIRED");
  }
  const active = scope?.subscriptions?.filter((sub) => sub.id === journal.subscriptionId);
  if (
    !Array.isArray(baseline) ||
    baseline.length !== 3 ||
    new Set(baseline.map((row) => row?.[0])).size !== 3 ||
    baseline.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== 2 ||
        !/^sub_[A-Za-z0-9]+$/.test(row[0]) ||
        row[1] !== "canceled",
    ) ||
    scope?.account !== TARGET.account ||
    scope.userId !== record.userId ||
    scope.customerId !== CUSTOMER ||
    scope.clockStatus !== "ready" ||
    scope.subscriptions?.length !== 4 ||
    new Set(scope.subscriptions.map((sub) => sub.id)).size !== 4 ||
    baseline.some(
      ([old]) => !scope.subscriptions.some((sub) => sub.id === old && sub.status === "canceled"),
    ) ||
    active?.length !== 1 ||
    active[0].status !== "active" ||
    active[0].cancelAtPeriodEnd !== false ||
    active[0].cancelAt !== null ||
    !Number.isSafeInteger(active[0].periodEnd) ||
    active[0].periodEnd <= 0 ||
    profiles?.length !== 1 ||
    profiles[0].id !== record.userId ||
    profiles[0].stripe_customer_id !== CUSTOMER ||
    profiles[0].is_pro !== true ||
    !Number.isSafeInteger(profiles[0].billing_revision) ||
    profiles[0].billing_revision < journal.purchaseVerifiedRevision
  )
    fail("EXACT_UNSCHEDULED_PRO_SUBSCRIPTION_REQUIRED");
  const matching = events?.filter(
    (event) =>
      event.type === "billing_portal.session.created" &&
      event.livemode === false &&
      /^evt_[A-Za-z0-9]+$/.test(event.id || "") &&
      Number.isSafeInteger(event.created) &&
      event.created >= Math.floor(journal.portalAttemptedAt / 1000) &&
      event.created <= Math.floor(now / 1000) + 60 &&
      event.data?.object?.livemode === false &&
      id(event.data.object.customer) === CUSTOMER &&
      event.data.object.return_url === `${origin.origin}/upgrade`,
  );
  if (matching?.length !== 1) fail("UNIQUE_ORIGINAL_PORTAL_EVENT_REQUIRED");
  const url = new URL(matching[0].data.object.url);
  // The exact scoped Stripe event currently returns /p/session?<opaque bearer>,
  // as well as the older /p/session/<bearer> shape. Preserve its query verbatim
  // in memory; it is never accepted from CLI input, logged, or persisted.
  const sessionPath =
    /^\/p\/session\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
    (url.pathname === "/p/session" && url.search.length > 1);
  if (url.origin !== PORTAL || url.username || url.password || !sessionPath)
    fail("EXACT_STRIPE_PORTAL_URL_REQUIRED");
  return url.href;
}

export async function performPortalCompletion(command, phase, { save, action }) {
  const stages = {
    OPEN: ["ready", "opened"],
    REASON: ["opened", "reason-selected"],
    CONFIRM: ["reason-selected", "submitted"],
  };
  if (!stages[command] || phase !== stages[command][0]) fail("PORTAL_COMPLETION_PHASE_NO_RETRY");
  await save(`${command.toLowerCase()}-pending`);
  await action();
  await save(stages[command][1]);
}

export function assertPortalOpenRecovery(previous, record, journal) {
  if (
    previous?.version !== 1 ||
    previous.account !== TARGET.account ||
    previous.userId !== record.userId ||
    previous.customerId !== CUSTOMER ||
    previous.subscriptionId !== journal.subscriptionId ||
    previous.phase !== "open-pending" ||
    !Number.isSafeInteger(previous.createdAt) ||
    previous.createdAt <= 0 ||
    !Number.isSafeInteger(previous.updatedAt) ||
    previous.updatedAt < previous.createdAt ||
    !Array.isArray(previous.audit) ||
    previous.audit.length !== 2 ||
    previous.audit[0]?.phase !== "ready" ||
    previous.audit[1]?.phase !== "open-pending" ||
    previous.audit.some(
      (entry) =>
        !Number.isSafeInteger(entry.at) ||
        entry.at < previous.createdAt ||
        entry.at > previous.updatedAt ||
        Object.keys(entry).some((key) => !["phase", "at"].includes(key)),
    ) ||
    previous.audit[0].at > previous.audit[1].at ||
    Object.keys(previous).some(
      (key) =>
        ![
          "version",
          "account",
          "userId",
          "customerId",
          "subscriptionId",
          "createdAt",
          "updatedAt",
          "phase",
          "audit",
        ].includes(key),
    )
  )
    fail("NAVIGATION_ONLY_PORTAL_RECOVERY_NOT_ELIGIBLE");
}

export async function completeProtectedSandboxPortal({
  approved = false,
  resumeOpen = false,
} = {}) {
  if (!approved || process.env.DEBUG || process.env.PWDEBUG || process.env.NODE_OPTIONS)
    fail("EXPLICIT_PORTAL_COMPLETION_APPROVAL_REQUIRED");
  let browser,
    input,
    handle,
    stopped = false;
  const report = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const stop = async () => {
    stopped = true;
    input?.close();
    await browser?.close().catch(() => {});
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const config = await prepareSandbox({ approved: true, verificationOnly: true });
    const directory = path.join(ROOT, ".stripe-sandbox.local"),
      stat = await fs.lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid() ||
      stat.mode & 0o077
    )
      fail("PRIVATE_DIRECTORY_REQUIRED");
    const originalPath = path.join(directory, "protected-billing-checkout-v1.json"),
      original = await readPrivate(originalPath);
    const journal = JSON.parse(original),
      record = JSON.parse(await readPrivate(path.join(ROOT, ARTIFACT)));
    validateRecord(record);
    const completionPath = path.join(directory, "protected-portal-cancellation-completion-v1.json");
    const priorText = resumeOpen ? await readPrivate(completionPath) : null;
    const priorAttempt = priorText ? JSON.parse(priorText) : null;
    if (resumeOpen) assertPortalOpenRecovery(priorAttempt, record, journal);
    const stripe = (suffix) =>
      privateJson(fetch, `https://api.stripe.com/v1${suffix}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
          "Stripe-Version": "2026-06-24.dahlia",
        },
      });
    const service = config.supa.SUPABASE_SERVICE_ROLE_KEY,
      headers = service.startsWith("sb_secret_")
        ? { apikey: service }
        : { apikey: service, Authorization: `Bearer ${service}` };
    const read = async () => {
      if ((await readPrivate(originalPath)) !== original) fail("ORIGINAL_PORTAL_JOURNAL_CHANGED");
      if (resumeOpen && (await readPrivate(completionPath)) !== priorText)
        fail("ORIGINAL_PORTAL_COMPLETION_CHANGED");
      const scope = await sandboxClock({
        action: "status",
        approved: true,
        verify: async () => config,
      });
      const profiles = await privateJson(
        fetch,
        `${TARGET.supabase}/rest/v1/profiles?${new URLSearchParams({ id: `eq.${record.userId}`, select: "id,is_pro,stripe_customer_id,billing_revision" })}`,
        { headers },
      );
      const events = await recentProtectedPortalEvents(stripe, journal.portalAttemptedAt);
      return { scope, profiles, events };
    };
    const portalUrl = verifyPortalCompletionScope(record, journal, await read());
    handle = await fs.open(
      resumeOpen ? path.join(directory, "protected-portal-open-recovery-v1.json") : completionPath,
      "wx",
      0o600,
    );
    let attempt = {
      version: 1,
      account: TARGET.account,
      userId: record.userId,
      customerId: CUSTOMER,
      subscriptionId: journal.subscriptionId,
      createdAt: Date.now(),
      phase: "ready",
      audit: [],
      ...(resumeOpen ? { navigationRecovery: true, priorAttempt } : {}),
    };
    const save = async (phase) => {
      attempt = { ...attempt, phase, updatedAt: Date.now() };
      attempt.audit.push({ phase, at: attempt.updatedAt });
      await handle.truncate(0);
      await handle.write(JSON.stringify(attempt), 0, "utf8");
      await handle.sync();
    };
    await save("ready");
    const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
    const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
    const env = Object.fromEntries(
      ["PATH", "HOME", "TMPDIR", "LANG"]
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]]),
    );
    browser = await chromium.launch({ channel: "chromium", headless: true, env });
    if (stopped) fail("PORTAL_COMPLETION_STOPPED");
    const context = await browser.newContext({
        serviceWorkers: "block",
        viewport: { width: 1280, height: 1000 },
      }),
      page = await context.newPage();
    await context.route(/^https?:\/\//, async (route) => {
      try {
        const request = route.request(),
          url = new URL(request.url());
        const main = request.isNavigationRequest() && request.frame() === page.mainFrame();
        if (main && url.origin !== PORTAL)
          return await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<!doctype html><title>Private verification</title><p>Return held for signed webhook verification.</p>",
          });
        if (
          stopped ||
          continuationRoutePolicy({
            url: url.href,
            mainNavigation: false,
            previewOrigin: journal.origin,
            sessionId: "unused",
          }) !== "continue"
        )
          return await route.abort();
        await route.continue();
      } catch {
        await route.abort().catch(() => {});
      }
    });
    page.setDefaultTimeout(15000);
    await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    const assertPage = () => {
      if (new URL(page.url()).origin !== PORTAL) fail("STRIPE_PORTAL_PAGE_REQUIRED");
    };
    assertPage();
    const { openVerifiedCancellation } =
      await import("./protected-stripe-browser-cancel.mjs?phase=open");
    if (typeof openVerifiedCancellation !== "function") fail("REVIEWED_PORTAL_HELPER_REQUIRED");
    verifyPortalCompletionScope(record, journal, await read());
    if (stopped) fail("PORTAL_COMPLETION_STOPPED");
    await performPortalCompletion("OPEN", attempt.phase, {
      save,
      action: () => openVerifiedCancellation({ page }),
    });
    report({
      kind: "portal-completion-ready",
      phase: attempt.phase,
      commands: ["STATUS", "INSPECT", "REASON", "CONFIRM", "STOP"],
    });
    input = readline.createInterface({ input: process.stdin, terminal: false });
    for await (const line of input) {
      const command = parsePortalCompletionCommand(line);
      if (!command) {
        report({ code: "FIXED_PORTAL_COMMAND_REQUIRED" });
        continue;
      }
      if (command === "STOP" || stopped) break;
      try {
        if (command === "INSPECT") {
          assertPage();
          report(await inspectStripeSurface(page));
        } else if (command === "STATUS") {
          const state = await read(),
            sub = state.scope.subscriptions.find((sub) => sub.id === journal.subscriptionId);
          report({
            kind: "status",
            phase: attempt.phase,
            isPro: state.profiles?.[0]?.is_pro === true,
            subscriptionActive: sub?.status === "active",
            cancellationScheduled:
              sub?.cancelAtPeriodEnd === true ||
              (Number.isSafeInteger(sub?.cancelAt) && sub.cancelAt > 0),
          });
        } else {
          const helper =
            command === "REASON"
              ? await import("./protected-stripe-browser-cancel.mjs?phase=reason")
              : await import("./protected-stripe-browser-cancel.mjs?phase=confirm");
          const action =
            command === "REASON"
              ? helper.chooseVerifiedCancellationReason
              : helper.confirmVerifiedCancellation;
          if (typeof action !== "function") fail("REVIEWED_PORTAL_HELPER_REQUIRED");
          if (verifyPortalCompletionScope(record, journal, await read()) !== portalUrl)
            fail("ORIGINAL_PORTAL_EVENT_CHANGED");
          assertPage();
          if (stopped) fail("PORTAL_COMPLETION_STOPPED");
          await performPortalCompletion(command, attempt.phase, {
            save,
            action: () => action({ page }),
          });
          report({
            kind: "portal-completion-action",
            action: command,
            phase: attempt.phase,
            testMode: true,
          });
        }
      } catch (error) {
        report({
          code: error instanceof SetupError ? error.code : "PORTAL_COMPLETION_FAILED_NO_RETRY",
          classification: classifyContinuationFailure(error),
        });
      }
    }
  } catch (error) {
    throw error instanceof SetupError ? error : new SetupError("PRIVATE_PORTAL_COMPLETION_FAILED");
  } finally {
    await stop();
    await handle?.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const resumeOpen = process.argv.length === 3 && process.argv[2] === "--resume-open";
  completeProtectedSandboxPortal({
    approved:
      (process.argv.length === 2 || resumeOpen) &&
      process.env.UNIMATE_PORTAL_COMPLETION === "approved",
    resumeOpen,
  }).catch((error) => {
    console.error(
      JSON.stringify({
        code: error instanceof SetupError ? error.code : "PRIVATE_PORTAL_COMPLETION_FAILED",
      }),
    );
    process.exitCode = 1;
  });
}
