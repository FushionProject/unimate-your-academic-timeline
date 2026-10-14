// Separate owner-only continuation of one already-journaled sandbox Checkout.
// Never creates Checkout, edits the original journal, loads app return JS, or
// retries payment. One explicit, separately journaled selection-only recovery
// is allowed. The original relay/Companion runner stays alive.
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { isIP } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ARTIFACT,
  TARGET,
  SetupError,
  prepareSandbox,
  privateJson,
} from "./prepare-stripe-sandbox.mjs";
import { readPrivate } from "./verify-stripe-sandbox-lifecycle.mjs";
import { sandboxClock } from "./stripe-sandbox-clock.mjs";
import { validateRecord } from "./verify-companion-sandbox-browser.mjs";
import {
  verifyDiagnosticCheckout,
  diagnosticFrameScope,
  redactDiagnosticText,
  inspectCheckoutCardStructure,
} from "./inspect-protected-sandbox-checkout.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CUSTOMER = "cus_VRAVJnKW1RGQzr";
const CHECKOUT = "https://checkout.stripe.com";
const COMMANDS = new Set(["STATUS", "INSPECT", "SELECT_CARD", "FILL_CARD", "SUBMIT", "STOP"]);
const fail = (code) => {
  throw new SetupError(code);
};
export const parseCheckoutContinuationCommand = (line) =>
  COMMANDS.has(line.trim()) ? line.trim() : null;

export function assertSelectionRecovery(previous, record, journal) {
  if (
    previous?.version !== 1 ||
    previous.account !== TARGET.account ||
    previous.userId !== record.userId ||
    previous.customerId !== CUSTOMER ||
    previous.sessionId !== journal.sessionId ||
    previous.phase !== "select_card-pending" ||
    !Number.isSafeInteger(previous.createdAt) ||
    previous.createdAt <= 0 ||
    !Number.isSafeInteger(previous.updatedAt) ||
    previous.updatedAt < previous.createdAt ||
    Object.keys(previous).some(
      (key) =>
        ![
          "version",
          "account",
          "userId",
          "customerId",
          "sessionId",
          "createdAt",
          "updatedAt",
          "phase",
          "lastFailure",
        ].includes(key),
    )
  )
    fail("SELECTION_ONLY_RECOVERY_NOT_ELIGIBLE");
}

export function assertReadySelectionRestart(recovery, previous, record, journal) {
  assertSelectionRecovery(previous, record, journal);
  if (
    recovery?.version !== 1 ||
    recovery.account !== TARGET.account ||
    recovery.userId !== record.userId ||
    recovery.customerId !== CUSTOMER ||
    recovery.sessionId !== journal.sessionId ||
    recovery.phase !== "ready" ||
    recovery.selectionRecovery !== true ||
    recovery.selectionRecoveryAttemptedAt !== undefined ||
    recovery.restartAt !== undefined ||
    recovery.lastFailure !== undefined ||
    JSON.stringify(recovery.priorAttempt) !== JSON.stringify(previous) ||
    !Number.isSafeInteger(recovery.createdAt) ||
    recovery.createdAt <= 0 ||
    !Number.isSafeInteger(recovery.updatedAt) ||
    recovery.updatedAt < recovery.createdAt ||
    !Array.isArray(recovery.audit) ||
    !recovery.audit.length ||
    recovery.audit.length > 10 ||
    recovery.audit.some(
      (entry) =>
        entry?.phase !== "ready" ||
        !Number.isSafeInteger(entry.at) ||
        entry.at < recovery.createdAt ||
        entry.at > recovery.updatedAt ||
        Object.keys(entry).some((key) => !["phase", "at"].includes(key)),
    ) ||
    Object.keys(recovery).some(
      (key) =>
        ![
          "version",
          "account",
          "userId",
          "customerId",
          "sessionId",
          "createdAt",
          "updatedAt",
          "phase",
          "selectionRecovery",
          "priorAttempt",
          "audit",
        ].includes(key),
    )
  )
    fail("ZERO_ACTION_SELECTION_RESTART_NOT_ELIGIBLE");
}

export function classifyContinuationFailure(error) {
  // Inspect bounded diagnostics only in memory; never return message or stack.
  const text = String(error?.message || "").slice(0, 20000);
  if (/intercepts pointer events|intercepted|another element.*receiv/i.test(text))
    return "interception";
  if (/not visible|element is hidden|not in the viewport/i.test(text)) return "not_visible";
  if (error?.name === "TimeoutError" || /timeout|timed out/i.test(text)) return "timeout";
  return "unknown";
}

export function verifyContinuationScope(record, journal, state) {
  const url = verifyDiagnosticCheckout(record, journal, state.session, state.items);
  let baseline;
  try {
    baseline = JSON.parse(journal.baseline);
  } catch {
    fail("CONTINUATION_BASELINE_REQUIRED");
  }
  if (
    !Array.isArray(baseline) ||
    baseline.length !== 3 ||
    baseline.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== 2 ||
        !/^sub_[A-Za-z0-9]+$/.test(row[0]) ||
        row[1] !== "canceled",
    ) ||
    new Set(baseline.map((row) => row[0])).size !== 3 ||
    state.scope?.account !== TARGET.account ||
    state.scope.userId !== record.userId ||
    state.scope.customerId !== CUSTOMER ||
    state.scope.clockStatus !== "ready" ||
    !Array.isArray(state.scope.subscriptions) ||
    JSON.stringify(state.scope.subscriptions.map((sub) => [sub.id, sub.status]).sort()) !==
      JSON.stringify([...baseline].sort()) ||
    state.profiles?.length !== 1 ||
    state.profiles[0].id !== record.userId ||
    state.profiles[0].stripe_customer_id !== CUSTOMER ||
    state.profiles[0].is_pro !== false ||
    !Number.isSafeInteger(state.profiles[0].billing_revision) ||
    state.session.payment_intent != null ||
    state.session.setup_intent != null ||
    state.open?.has_more !== false ||
    state.open.data?.length !== 1 ||
    state.open.data[0].id !== journal.sessionId ||
    state.open.data[0].livemode !== false ||
    state.open.data[0].customer !== CUSTOMER ||
    state.open.data[0].status !== "open"
  )
    fail("CONTINUATION_UNCHANGED_FREE_SCOPE_REQUIRED");
  const origin = new URL(journal.origin);
  if (
    origin.origin !== journal.origin ||
    origin.protocol !== "https:" ||
    origin.port ||
    !/^[a-z0-9-]+\.vercel\.app$/.test(origin.hostname)
  )
    fail("CONTINUATION_PREVIEW_ORIGIN_REQUIRED");
  return url;
}

export function assertContinuationAction(command, phase) {
  const expected = { SELECT_CARD: "ready", FILL_CARD: "card-selected", SUBMIT: "card-filled" };
  if (!Object.hasOwn(expected, command) || phase !== expected[command])
    fail("CONTINUATION_ACTION_PHASE_NO_RETRY");
}

export async function performContinuationAction(command, phase, { save, action }) {
  assertContinuationAction(command, phase);
  await save(`${command.toLowerCase()}-pending`);
  await action();
  await save(
    { SELECT_CARD: "card-selected", FILL_CARD: "card-filled", SUBMIT: "submitted" }[command],
  );
}

export function continuationRoutePolicy({ url, mainNavigation, previewOrigin, sessionId }) {
  const parsed = new URL(url);
  // All top-level departures are held, including the Preview success return.
  // The separate browser never needs UniMate credentials or application JS.
  if (
    mainNavigation &&
    !(parsed.origin === CHECKOUT && parsed.pathname.split("/").includes(sessionId))
  )
    return "hold";
  if (parsed.origin === previewOrigin) return "block";
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    isIP(hostname) ||
    !hostname.includes(".") ||
    /(?:^|\.)(?:local|localhost|internal)$/.test(hostname)
  )
    return "block";
  return "continue";
}

export async function inspectContinuationFields(page) {
  const frames = page.frames();
  if (frames.length > 64) fail("CONTINUATION_FRAME_LIMIT");
  const results = [];
  for (const [index, frame] of frames.entries()) {
    if (!diagnosticFrameScope(frame).stripe) continue;
    const fields = await frame
      .locator('input,select,textarea,[role="radio"],button')
      .evaluateAll((elements) => {
        if (elements.length > 100) throw new Error("bounded inspection");
        return elements.map((element) => {
          const rect = element.getBoundingClientRect(),
            style = getComputedStyle(element);
          const attr = (name) => (element.getAttribute(name) || "").slice(0, 200);
          return {
            tag: element.tagName.toLowerCase(),
            id: attr("id"),
            name: attr("name"),
            type: attr("type"),
            role: attr("role"),
            label: attr("aria-label"),
            // Labels only, never values, HTML, href/src or surrounding page text.
            labels: [...(element.labels || [])]
              .slice(0, 2)
              .map((label) =>
                label.querySelector("input,select,textarea")
                  ? ""
                  : (label.textContent || "").slice(0, 200),
              ),
            visible: !!(
              rect.width &&
              rect.height &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              style.visibility !== "collapse"
            ),
            disabled: element.matches(":disabled") || attr("aria-disabled") === "true",
            checked: element.matches(":checked") || attr("aria-checked") === "true",
          };
        });
      });
    if (!diagnosticFrameScope(frame).stripe) fail("CONTINUATION_FRAME_CHANGED");
    results.push({
      frame: index,
      fields: fields.map((field) =>
        Object.fromEntries(
          Object.entries(field).map(([key, value]) => [
            key,
            Array.isArray(value)
              ? value.map((label) => redactDiagnosticText(label, 120))
              : typeof value === "string"
                ? redactDiagnosticText(value, 120)
                : value,
          ]),
        ),
      ),
    });
  }
  return { inspectionOnly: true, frames: results };
}

export async function continueProtectedSandboxCheckout({
  approved = false,
  resumeSelection = false,
  resumeSelectionReady = false,
} = {}) {
  if (resumeSelectionReady) resumeSelection = true;
  if (!approved || process.env.DEBUG || process.env.PWDEBUG || process.env.NODE_OPTIONS)
    fail("EXPLICIT_CHECKOUT_CONTINUATION_APPROVAL_REQUIRED");
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
    const directory = path.join(ROOT, ".stripe-sandbox.local");
    const stat = await fs.lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid() ||
      stat.mode & 0o077
    )
      fail("PRIVATE_DIRECTORY_REQUIRED");
    const originalPath = path.join(directory, "protected-billing-checkout-v1.json");
    const original = await readPrivate(originalPath);
    const journal = JSON.parse(original);
    const record = JSON.parse(await readPrivate(path.join(ROOT, ARTIFACT)));
    validateRecord(record);
    const continuationPath = path.join(directory, "protected-checkout-card-continuation-v1.json");
    const failedSelectionText = resumeSelection ? await readPrivate(continuationPath) : null;
    const failedSelection = failedSelectionText ? JSON.parse(failedSelectionText) : null;
    if (resumeSelection) assertSelectionRecovery(failedSelection, record, journal);
    const stripe = (suffix) =>
      privateJson(fetch, `https://api.stripe.com/v1${suffix}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
          "Stripe-Version": "2026-06-24.dahlia",
        },
      });
    if (!/^cs_test_[A-Za-z0-9]+$/.test(journal.sessionId || ""))
      fail("EXACT_CHECKOUT_JOURNAL_REQUIRED");
    const service = config.supa.SUPABASE_SERVICE_ROLE_KEY;
    const headers = service.startsWith("sb_secret_")
      ? { apikey: service }
      : { apikey: service, Authorization: `Bearer ${service}` };
    const read = async () => {
      if ((await readPrivate(originalPath)) !== original) fail("ORIGINAL_CHECKOUT_JOURNAL_CHANGED");
      if (resumeSelection && (await readPrivate(continuationPath)) !== failedSelectionText)
        fail("FAILED_SELECTION_JOURNAL_CHANGED");
      const session = await stripe(`/checkout/sessions/${journal.sessionId}`);
      const items = await stripe(`/checkout/sessions/${journal.sessionId}/line_items?limit=100`);
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
      const open = await stripe(
        `/checkout/sessions?${new URLSearchParams({ customer: CUSTOMER, status: "open", limit: "100" })}`,
      );
      return { session, items, scope, profiles, open };
    };
    const url = verifyContinuationScope(record, journal, await read());
    const attemptPath = resumeSelection
      ? path.join(directory, "protected-checkout-card-selection-recovery-v1.json")
      : continuationPath;
    let restarted;
    if (resumeSelectionReady) {
      restarted = JSON.parse(await readPrivate(attemptPath));
      assertReadySelectionRestart(restarted, failedSelection, record, journal);
      // Retained exclusive marker permits one explicit zero-action restart.
      // Both older attempts remain untouched; no pending action is reset.
      const claim = await fs.open(`${attemptPath}.restart-lock`, "wx", 0o600);
      await claim.close();
      handle = await fs.open(attemptPath, constants.O_RDWR | constants.O_NOFOLLOW);
      const current = await handle.stat();
      if (
        !current.isFile() ||
        current.uid !== process.getuid() ||
        current.mode & 0o077 ||
        current.size > 65536
      )
        fail("PRIVATE_REGULAR_FILE_REQUIRED");
      restarted = JSON.parse(await handle.readFile("utf8"));
      assertReadySelectionRestart(restarted, failedSelection, record, journal);
    } else handle = await fs.open(attemptPath, "wx", 0o600);
    let attempt = {
      version: 1,
      account: TARGET.account,
      userId: record.userId,
      customerId: CUSTOMER,
      sessionId: journal.sessionId,
      createdAt: Date.now(),
      phase: "ready",
      ...(resumeSelection
        ? { selectionRecovery: true, priorAttempt: failedSelection, audit: [] }
        : {}),
    };
    if (restarted) {
      attempt = { ...restarted, restartAt: Date.now() };
      attempt.audit.push({ phase: "ready", at: attempt.restartAt, restartAt: attempt.restartAt });
    }
    const save = async (phase) => {
      attempt = { ...attempt, phase, updatedAt: Date.now() };
      if (
        resumeSelection &&
        phase === "select_card-pending" &&
        !attempt.selectionRecoveryAttemptedAt
      )
        attempt.selectionRecoveryAttemptedAt = attempt.updatedAt;
      if (resumeSelection)
        attempt.audit.push({
          phase,
          at: attempt.updatedAt,
          ...(attempt.lastFailure ? { failure: attempt.lastFailure } : {}),
        });
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
    if (stopped) fail("CONTINUATION_STOPPED");
    const context = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 1280, height: 1000 },
    });
    const page = await context.newPage();
    await context.route(/^https?:\/\//, async (route) => {
      try {
        const request = route.request();
        const policy = continuationRoutePolicy({
          url: request.url(),
          mainNavigation: request.isNavigationRequest() && request.frame() === page.mainFrame(),
          previewOrigin: journal.origin,
          sessionId: journal.sessionId,
        });
        if (policy === "hold")
          return await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<!doctype html><title>Private verification</title><p>Return held for signed webhook verification.</p>",
          });
        if (policy === "block" || stopped) return await route.abort();
        await route.continue();
      } catch {
        await route.abort().catch(() => {});
      }
    });
    page.setDefaultTimeout(15000);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const assertPage = () => {
      const current = new URL(page.url());
      if (current.origin !== CHECKOUT || !current.pathname.split("/").includes(journal.sessionId))
        fail("EXACT_CHECKOUT_PAGE_REQUIRED");
    };
    assertPage();
    report({ kind: "continuation-ready", testMode: true, amount: 599, commands: [...COMMANDS] });
    input = readline.createInterface({ input: process.stdin, terminal: false });
    for await (const line of input) {
      const command = parseCheckoutContinuationCommand(line);
      if (!command) {
        report({ code: "FIXED_CONTINUATION_COMMAND_REQUIRED" });
        continue;
      }
      if (command === "STOP" || stopped) break;
      try {
        if (command === "STATUS") {
          const state = await read();
          report({
            kind: "status",
            phase: attempt.phase,
            checkoutOpen: state.session.status === "open",
            checkoutPaid: state.session.payment_status === "paid",
            isPro: state.profiles?.[0]?.is_pro === true,
            billingRevision: Number.isSafeInteger(state.profiles?.[0]?.billing_revision)
              ? state.profiles[0].billing_revision
              : null,
            activeSubscriptions: state.scope.subscriptions.filter(
              (sub) => !["canceled", "incomplete_expired"].includes(sub.status),
            ).length,
          });
        } else if (command === "INSPECT") {
          assertPage();
          report(await inspectContinuationFields(page));
          report(await inspectCheckoutCardStructure(page));
        } else {
          assertContinuationAction(command, attempt.phase);
          verifyContinuationScope(record, journal, await read());
          assertPage();
          let action;
          if (command === "SELECT_CARD") {
            // Stripe's button has a zero-size box and a CSS-expanded hit area
            // covering this observed Card container. Clicking the container
            // lets the browser deliver the click to that descendant normally.
            const card = page.locator(".card-accordion-item-cover");
            if (
              (await card.count()) !== 1 ||
              (await card.locator("#payment-method-label-card").count()) !== 1 ||
              !(await card.isVisible()) ||
              !(await card.isEnabled())
            )
              fail("OBSERVED_CARD_CONTROL_REQUIRED");
            action = () => card.click();
          } else {
            // The owner supplies this fixed reviewed helper after observing the
            // real fields. Missing helpers consume no action; no arbitrary module.
            const helper = await import("./protected-stripe-browser-card.mjs");
            const fn =
              command === "FILL_CARD"
                ? helper.fillVerifiedTestCard
                : helper.submitVerifiedCardCheckout;
            if (typeof fn !== "function") fail("REVIEWED_CARD_HELPER_REQUIRED");
            action = () => fn({ page, sessionId: journal.sessionId });
          }
          if (stopped) fail("CONTINUATION_STOPPED");
          await performContinuationAction(command, attempt.phase, { save, action });
          report({
            kind: "continuation-action",
            action: command,
            phase: attempt.phase,
            testMode: true,
          });
        }
      } catch (error) {
        const classification = classifyContinuationFailure(error);
        if (
          ["SELECT_CARD", "FILL_CARD", "SUBMIT"].includes(command) &&
          attempt.phase === `${command.toLowerCase()}-pending`
        ) {
          attempt.lastFailure = { command, classification };
          await save(attempt.phase).catch(() => {});
        }
        report({
          code: error instanceof SetupError ? error.code : "CONTINUATION_ACTION_FAILED_NO_RETRY",
          classification,
        });
      }
    }
  } catch (error) {
    throw error instanceof SetupError
      ? error
      : new SetupError("PRIVATE_CHECKOUT_CONTINUATION_FAILED");
  } finally {
    await stop();
    await handle?.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const resumeSelection = process.argv.length === 3 && process.argv[2] === "--resume-selection";
  const resumeSelectionReady =
    process.argv.length === 3 && process.argv[2] === "--resume-selection-ready";
  continueProtectedSandboxCheckout({
    approved:
      (process.argv.length === 2 || resumeSelection || resumeSelectionReady) &&
      process.env.UNIMATE_CHECKOUT_CONTINUATION === "approved",
    resumeSelection,
    resumeSelectionReady,
  }).catch((error) => {
    console.error(
      JSON.stringify({
        code: error instanceof SetupError ? error.code : "PRIVATE_CHECKOUT_CONTINUATION_FAILED",
      }),
    );
    process.exitCode = 1;
  });
}
