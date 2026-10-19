// One exact, private, current-price operator run. Imports do no I/O. Historical
// $5.99 runners/identity/evidence remain untouched. Every action is separately
// requested and journaled before dispatch; an uncertain outcome stops the run.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  prepareSandbox,
  privateJson,
  TARGET,
  ARTIFACT,
  SetupError,
  assertIgnored,
} from "./prepare-stripe-sandbox.mjs";
import { readPrivate } from "./verify-stripe-sandbox-lifecycle.mjs";
import { validateRecord } from "./verify-companion-sandbox-browser.mjs";
import { verifyCurrentSandboxPrice } from "./verify-current-stripe-sandbox-price.mjs";
import {
  validatePreviewAccess,
  validatePreviewDeployment,
} from "./protected-companion-preview.mjs";
import { attachProtectedPreviewBrowser } from "./protected-preview-browser.mjs";
import { createProtectedStripePreviewRelay } from "./protected-stripe-preview-relay.mjs";
import { startProtectedCompanionBillingHarness } from "./protected-companion-billing-harness.mjs";
import { captureSecret, LISTEN_ARGS } from "./run-stripe-sandbox.mjs";
import { validatedProtectedVercelCli } from "./run-protected-billing-preview.mjs";
import {
  fillReadyRecoverySignIn,
  recoveryRouteDecision,
  assertRecoverySetup,
} from "./run-protected-billing-recovery.mjs";
import { inspectStripeSurface } from "./protected-stripe-browser-actions.mjs";
import {
  CURRENT_BILLING_SCOPE as C,
  assertCurrentBaseline,
  assertCurrentOpenCheckout,
  assertCurrentPaid,
  assertCurrentCanceled,
  assertCurrentDeploymentQuoteEvidence,
  CURRENT_BILLING_CONTINUATION as K,
  assertCurrentUnpaidContinuation,
  assertCurrentCardSelectionContinuation,
} from "./current-billing-policy.mjs";
import {
  fillCurrentTestCard,
  submitCurrentTestCheckout,
  fillCurrentStandardTestCard,
  submitCurrentStandardTestCheckout,
} from "./current-billing-browser.mjs";
import { RETIREMENT_SCOPE, assertRetiredCurrentAttempt } from "./current-billing-retirement.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROJECT = "prj_5XZ4ulni13tNLCvNzdL1gUPvashI";
const TEAM = "team_MwJPMKdnqu1z8dxbKYBqdJCY";
const STANDARD_JOURNAL = "current-billing-999-standard-v1.jsonl";
const command = promisify(execFile);
const fail = (code) => {
  throw new SetupError(code);
};
const id = (value) => (typeof value === "string" ? value : value?.id);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const COMMANDS = new Set([
  "STATUS",
  "CHECKOUT",
  "INSPECT",
  "SELECT_CARD",
  "FILL",
  "PAY",
  "CHALLENGE",
  "INSPECT_AUTH",
  "VERIFY_PAID",
  "CANCEL",
  "VERIFY_CANCELED",
  "STOP",
]);
export const currentBillingCommand = (value) =>
  typeof value === "string" && value.length < 80 && COMMANDS.has(value.trim())
    ? value.trim()
    : null;

export function assertCurrentPrivateDeployment(project, deployment, link) {
  validatePreviewDeployment(C.origin, link, deployment);
  if (
    project?.id !== PROJECT ||
    project.accountId !== TEAM ||
    !["all", "all_except_custom_domains"].includes(project.ssoProtection?.deploymentType) ||
    !project.protectionBypass ||
    Object.keys(project.protectionBypass).length ||
    project.autoAssignCustomDomains !== false ||
    !Array.isArray(project.env) ||
    project.env.some((e) => e.target?.includes("production")) ||
    deployment.id !== C.deployment ||
    deployment.meta?.githubCommitSha !== C.source ||
    !Array.isArray(deployment.alias) ||
    deployment.alias.length ||
    !Number.isSafeInteger(deployment.createdAt) ||
    !Array.isArray(deployment.env) ||
    !Array.isArray(deployment.build?.env)
  )
    fail("CURRENT_PRIVATE_DEPLOYMENT_REQUIRED");
  return true;
}

export async function runCurrentBillingSandbox({
  approved = false,
  continueUnpaid = false,
  continueCardSelection = false,
  freshStandardAfterAuthFailure = false,
} = {}) {
  if (
    !approved ||
    typeof continueUnpaid !== "boolean" ||
    typeof continueCardSelection !== "boolean" ||
    typeof freshStandardAfterAuthFailure !== "boolean" ||
    (continueCardSelection && !continueUnpaid) ||
    (freshStandardAfterAuthFailure && (continueUnpaid || continueCardSelection)) ||
    process.env.DEBUG ||
    process.env.PWDEBUG ||
    process.env.NODE_OPTIONS ||
    process.env.NODE_INSPECT_RESUME_ON_START
  )
    fail("CURRENT_EXPLICIT_PRIVATE_APPROVAL_REQUIRED");
  const baseEnv = Object.fromEntries(
    ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG"]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
  const report = (value) => process.stdout.write(JSON.stringify(value) + "\n");
  const directory = path.join(ROOT, ".stripe-sandbox.local");
  let stage = "configuration",
    lock,
    journal,
    input,
    relay,
    listener,
    browser,
    context,
    companion,
    dispose,
    expiry;
  let stopped = false,
    closing;
  const stop = () => {
    stopped = true;
    // Queue another cleanup pass when startup acquired a resource while an
    // earlier stop was already closing the previous resources.
    closing = Promise.resolve(closing).then(async () => {
      clearTimeout(expiry);
      input?.close();
      await companion?.close().catch(() => {});
      await dispose?.().catch(() => {});
      await context?.close().catch(() => {});
      await browser?.close().catch(() => {});
      await relay?.stop().catch(() => {});
      if (listener?.pid && listener.exitCode === null && !listener.signalCode) {
        await new Promise((resolve) => {
          const timer = setTimeout(() => listener.kill("SIGKILL"), 5000);
          listener.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
          listener.kill("SIGTERM");
        });
      }
    });
    return closing;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const enter = (value) => {
    if (stopped) fail("CURRENT_RUN_STOPPED");
    stage = value;
    report({ kind: "stage", stage });
  };
  let sequence = 0;
  const append = async (phase, data = {}) => {
    await journal.writeFile(
      JSON.stringify({
        version: 1,
        sequence: ++sequence,
        at: Date.now(),
        phase,
        account: TARGET.account,
        price: C.price,
        origin: C.origin,
        source: C.source,
        ...data,
      }) + "\n",
    );
    await journal.sync();
  };
  try {
    assertIgnored(ROOT);
    const stat = await fs.lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.mode & 0o077 ||
      stat.uid !== process.getuid()
    )
      fail("CURRENT_PRIVATE_DIRECTORY_REQUIRED");
    // Shared lock prevents any old operator runner from concurrently using this customer.
    lock = await fs.open(path.join(directory, "protected-billing-run.lock"), "wx", 0o600);
    const journalPath = path.join(
      directory,
      freshStandardAfterAuthFailure
        ? STANDARD_JOURNAL
        : continueCardSelection
          ? K.resumeJournal
          : continueUnpaid
            ? K.journal
            : C.journal,
    );
    try {
      await fs.lstat(journalPath);
      fail("CURRENT_RUN_ALREADY_CLAIMED_NO_RETRY");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const config = await prepareSandbox({ approved: true, verificationOnly: true });
    const record = JSON.parse(await readPrivate(path.join(ROOT, ARTIFACT)));
    validateRecord(record);
    const setup = JSON.parse(
      await readPrivate(path.join(directory, "protected-preview-setup-v1.json")),
    );
    assertRecoverySetup(setup, record);
    const link = JSON.parse(await fs.readFile(path.join(ROOT, ".vercel/project.json"), "utf8"));
    const cli = await validatedProtectedVercelCli(process.env.UNIMATE_VERCEL_CLI_PATH);
    const vc = async (args, options = {}) => {
      try {
        return (
          await command(process.execPath, [cli, ...args], {
            cwd: ROOT,
            env: { ...baseEnv, CI: "1", NO_COLOR: "1", VERCEL_CLI_USE_NATIVE_BINARY: "0" },
            timeout: 30000,
            maxBuffer: 2_000_000,
            ...options,
          })
        ).stdout;
      } catch {
        fail("CURRENT_VERCEL_READ_FAILED");
      }
    };
    const vcJson = async (endpoint) =>
      JSON.parse(await vc(["api", endpoint, "--scope", "resumejuice-s-projects", "--raw"]));
    const privateMetadata = async () => {
      const project = await vcJson(`/v9/projects/${PROJECT}?teamId=${TEAM}`);
      const deployment = await vcJson(`/v13/deployments/${C.deployment}?teamId=${TEAM}`);
      assertCurrentPrivateDeployment(project, deployment, link);
      // Only decrypt three non-secret configuration entries, never credentials.
      // These name lists include inherited values, not just overrides. Presence
      // and unchanged project Config values are drift checks, NOT secret/runtime
      // readback. The completed, canonically re-read sandbox quote below binds
      // the exact immutable deployment to the tested account and current Price.
      for (const [key, expected] of [
        ["STRIPE_LIVE_MODE_ENABLED", "false"],
        ["STRIPE_PRICE_ID", C.price],
        ["STRIPE_PRO_MONTHLY_AMOUNT_CENTS", "999"],
      ]) {
        const entries = project.env.filter((e) => e.key === key);
        const e = entries[0];
        if (
          entries.length !== 1 ||
          e.visibility !== "config" ||
          e.type === "sensitive" ||
          e.target?.length !== 1 ||
          e.target[0] !== "preview" ||
          e.gitBranch != null ||
          !Number.isSafeInteger(e.updatedAt) ||
          e.updatedAt > deployment.createdAt ||
          e.customEnvironmentIds?.length ||
          !deployment.env.includes(key) ||
          !deployment.build.env.includes(key)
        )
          fail("CURRENT_IMMUTABLE_BILLING_CONFIG_REQUIRED");
        const value = await vcJson(
          `/v1/projects/${PROJECT}/env/${encodeURIComponent(e.id)}?teamId=${TEAM}`,
        );
        if (
          value.id !== e.id ||
          value.key !== key ||
          value.decrypted !== true ||
          value.value !== expected ||
          value.updatedAt !== e.updatedAt
        )
          fail("CURRENT_BILLING_CONFIG_VALUE_MISMATCH");
      }
      return { project, deployment };
    };
    enter("private-deployment");
    const { deployment } = await privateMetadata();
    await verifyCurrentSandboxPrice({ approved: true, secretKey: config.stripe.STRIPE_SECRET_KEY });
    const stripe = (endpoint, init = {}) =>
      privateJson(fetch, `https://api.stripe.com/v1${endpoint}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
          "Stripe-Version": "2026-06-24.dahlia",
          ...init.headers,
        },
      });
    const service = config.supa.SUPABASE_SERVICE_ROLE_KEY;
    const serviceHeaders = service.startsWith("sb_secret_")
      ? { apikey: service }
      : { apikey: service, Authorization: `Bearer ${service}` };
    const inspect = async () => {
      const customer = await stripe(`/customers/${C.customer}`);
      const clock = await stripe(`/test_helpers/test_clocks/${id(customer.test_clock)}`);
      if (
        clock.id !== id(customer.test_clock) ||
        clock.livemode !== false ||
        clock.status !== "ready"
      )
        fail("CURRENT_READY_CLOCK_REQUIRED");
      const subscriptions = await stripe(
        `/subscriptions?${new URLSearchParams({ customer: C.customer, status: "all", limit: "100" })}`,
      );
      const open = await stripe(
        `/checkout/sessions?${new URLSearchParams({ customer: C.customer, status: "open", limit: "100" })}`,
      );
      const rows = await privateJson(
        fetch,
        `${TARGET.supabase}/rest/v1/profiles?${new URLSearchParams({ id: `eq.${record.userId}`, select: "id,is_pro,stripe_customer_id,billing_revision" })}`,
        { headers: serviceHeaders },
      );
      if (!Array.isArray(rows) || rows.length !== 1) fail("CURRENT_EXACT_PROFILE_REQUIRED");
      return { record, customer, subscriptions, open, profile: rows[0] };
    };
    enter("baseline");
    const startingState = await inspect();
    let continuation, continuedCheckout;
    if (continueUnpaid) {
      if (
        startingState.open.has_more !== false ||
        startingState.open.data?.length !== 1 ||
        startingState.open.data[0].id !== K.sessionId
      )
        fail("CURRENT_EXACT_UNPAID_CONTINUATION_REQUIRED");
      continuedCheckout = await stripe(`/checkout/sessions/${K.sessionId}`);
      continuation = assertCurrentUnpaidContinuation({
        journalText: await readPrivate(path.join(directory, C.journal)),
        session: continuedCheckout,
        open: startingState.open,
        lines: await stripe(`/checkout/sessions/${K.sessionId}/line_items?limit=100`),
        baseline: assertCurrentBaseline({ ...startingState, open: { data: [], has_more: false } }),
      });
    }
    const baseline = assertCurrentBaseline(
      continueUnpaid ? { ...startingState, open: { data: [], has_more: false } } : startingState,
    );
    const priorCardSelection = continueCardSelection
      ? assertCurrentCardSelectionContinuation({
          journalText: await readPrivate(path.join(directory, K.journal)),
          baseline,
          originalSourceSha256: continuation.sourceJournalSha256,
        })
      : undefined;
    const historyNames = [
      ...new Set([
        "protected-billing-checkout-v1.json",
        "protected-billing-checkout-v2.json",
        "current-price-quote-cb8a296-v1.jsonl",
        ...(continueUnpaid ? [C.journal] : []),
        ...(continueCardSelection ? [K.journal] : []),
        ...(freshStandardAfterAuthFailure
          ? [...RETIREMENT_SCOPE.sourceNames, RETIREMENT_SCOPE.journal]
          : []),
      ]),
    ];
    const history = Object.fromEntries(
      await Promise.all(
        historyNames.map(async (name) => [
          name,
          hash(await readPrivate(path.join(directory, name))),
        ]),
      ),
    );
    const retirement = freshStandardAfterAuthFailure
      ? assertRetiredCurrentAttempt({
          journalText: await readPrivate(path.join(directory, RETIREMENT_SCOPE.journal)),
          baseline,
          session: await stripe(`/checkout/sessions/${K.sessionId}`),
          lines: await stripe(`/checkout/sessions/${K.sessionId}/line_items?limit=100`),
          intent: await stripe(`/payment_intents/${RETIREMENT_SCOPE.intentId}`),
          history,
        })
      : undefined;
    if (retirement && history[RETIREMENT_SCOPE.journal] !== retirement.retirementSha256)
      fail("CURRENT_RETIREMENT_SOURCE_CHANGED");
    if (continuation && history[C.journal] !== continuation.sourceJournalSha256)
      fail("CURRENT_CONTINUATION_SOURCE_CHANGED");
    if (priorCardSelection && history[K.journal] !== priorCardSelection.priorContinuationSha256)
      fail("CURRENT_CONTINUATION_SOURCE_CHANGED");
    const journalText = await readPrivate(path.join(directory, historyNames[2]));
    const quoteRows = journalText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const quoteId = quoteRows[1]?.sessionId;
    if (!/^cs_test_[A-Za-z0-9]+$/.test(quoteId || "")) fail("CURRENT_HISTORICAL_QUOTE_MISMATCH");
    const oldQuote = await stripe(`/checkout/sessions/${quoteId}`);
    if (oldQuote.id !== quoteId) fail("CURRENT_HISTORICAL_QUOTE_MISMATCH");
    const deployedQuote = assertCurrentDeploymentQuoteEvidence({
      journalText,
      session: oldQuote,
      lines: await stripe(`/checkout/sessions/${quoteId}/line_items?limit=100`),
      userId: record.userId,
    });
    const checkHistory = async () => {
      for (const name of historyNames)
        if (hash(await readPrivate(path.join(directory, name))) !== history[name])
          fail("CURRENT_HISTORICAL_EVIDENCE_CHANGED");
    };
    enter("short-lived-access");
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-current-oidc-"));
    let token;
    try {
      token = (
        await vc(
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
          { cwd: temporary, timeout: 60000, maxBuffer: 64000 },
        )
      ).trim();
    } finally {
      await fs.rmdir(temporary).catch(() => {});
    }
    const access = validatePreviewAccess(C.origin, token, link, deployment);
    token = "";
    const active = () => {
      if (stopped || Date.now() >= access.expiresAt - 30000)
        fail("CURRENT_ACCESS_EXPIRED_OR_STOPPED");
    };
    const receipts = [];
    enter("signed-relay");
    relay = createProtectedStripePreviewRelay({
      access,
      project: link,
      deployment,
      webhookSecret: setup.webhookSecret,
      account: TARGET.account,
      customerId: C.customer,
      report: (event) => {
        receipts.push({ ...event, at: Date.now() });
        if (receipts.length > 200) receipts.shift();
        report({ kind: "delivery", ...event });
      },
    });
    await relay.start();
    const listenArgs = [...LISTEN_ARGS];
    listenArgs[listenArgs.indexOf("--forward-to") + 1] = "http://127.0.0.1:8789/api/stripe-webhook";
    listener = spawn("stripe", listenArgs, {
      cwd: ROOT,
      env: { ...baseEnv, STRIPE_API_KEY: config.stripe.STRIPE_SECRET_KEY },
      stdio: ["ignore", "pipe", "pipe"],
    });
    listener.stdout.on("data", () => {});
    listener.stderr.on("data", () => {});
    listener.once("error", () => void stop());
    listener.once("exit", () => {
      if (!stopped) {
        report({ code: "CURRENT_LISTENER_STOPPED" });
        void stop();
      }
    });
    if ((await captureSecret(listener)) !== setup.webhookSecret)
      fail("CURRENT_LISTENER_SECRET_MISMATCH");
    active();
    enter("isolated-browser");
    const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
    const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
    browser = await chromium.launch({ channel: "chromium", headless: true, env: baseEnv });
    context = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 1280, height: 900 },
    });
    dispose = await attachProtectedPreviewBrowser(context, access);
    let held = false,
      checkoutAllowed = false,
      checkoutRequests = 0,
      unexpectedWrites = 0;
    // Read-only billing from the very first navigation. No website or Companion
    // reconciliation can create the entitlement evidence attributed to webhooks.
    await context.route(/^https?:\/\//, async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const decision = recoveryRouteDecision(
        { url: url.href, method: request.method(), navigation: request.isNavigationRequest() },
        held,
        true,
        C,
      );
      if (decision === "block") {
        unexpectedWrites++;
        return route.abort("blockedbyclient");
      }
      if (decision === "read-only-status")
        return route.fallback({ url: `${C.origin}/api/billing-status?reconcile=false` });
      if (decision === "hold-return")
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>Private verification</title><p>Waiting for verified sandbox evidence.</p>",
        });
      if (url.origin === C.origin && request.method() !== "GET" && request.method() !== "HEAD") {
        if (
          url.pathname !== "/api/create-checkout-session" ||
          request.method() !== "POST" ||
          !checkoutAllowed ||
          checkoutRequests++
        ) {
          unexpectedWrites++;
          return route.abort("blockedbyclient");
        }
      }
      return route.fallback();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    enter("marked-test-signin");
    await page.goto(`${C.origin}/signin?next=upgrade`, { waitUntil: "domcontentloaded" });
    await fillReadyRecoverySignIn(page, record);
    const authPromise = page.waitForResponse((response) => {
      const u = new URL(response.url());
      return (
        u.origin === TARGET.supabase &&
        u.pathname === "/auth/v1/token" &&
        u.searchParams.get("grant_type") === "password"
      );
    });
    const [authResponse] = await Promise.all([
      authPromise,
      page.getByRole("button", { name: "Sign in", exact: true }).click(),
    ]);
    const session = authResponse.status() === 200 ? await authResponse.json() : null;
    const user = session?.user;
    if (
      user?.id !== record.userId ||
      user.email !== record.email ||
      user.app_metadata?.unimate_test_marker !== record.marker ||
      user.app_metadata?.unimate_test_nonce !== record.nonce
    )
      fail("CURRENT_MARKED_SIGNIN_REQUIRED");
    await page.waitForURL((url) => url.origin === C.origin && url.pathname === "/upgrade");
    const app = (endpoint) =>
      privateJson(fetch, `${C.origin}${endpoint}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "x-vercel-trusted-oidc-idp-token": access.token,
        },
      });
    if ((await app("/api/signup-status")).enabled !== false)
      fail("CURRENT_SIGNUP_MUST_REMAIN_CLOSED");
    if ((await app("/api/billing-status?reconcile=false")).isPro !== false)
      fail("CURRENT_HOSTED_FREE_REQUIRED");
    const runDirectory = await fs.mkdtemp(path.join(directory, "current-billing-999-"));
    enter("same-panel-companion-free");
    companion = await startProtectedCompanionBillingHarness({
      record,
      publicKey: config.supa.VITE_SUPABASE_ANON_KEY,
      access,
      project: link,
      deployment,
      privateDirectory: runDirectory,
      modulePath,
    });
    const free = await companion.expectFree();
    if (free.billingRevision !== baseline.billingRevision)
      fail("CURRENT_BASELINE_CHANGED_DURING_STARTUP");
    journal = await fs.open(journalPath, "wx", 0o600);
    await append("baseline", {
      baseline,
      history,
      deployedQuote,
      free,
      runDirectory,
      ...(continuation ? { continuation } : {}),
      ...(priorCardSelection ? { priorCardSelection } : {}),
      ...(retirement ? { retirement, cardProfile: "standard" } : {}),
    });
    expiry = setTimeout(() => void stop(), Math.max(1, access.expiresAt - Date.now() - 5000));
    expiry.unref?.();
    let phase = "baseline",
      sessionId,
      paid,
      checkoutAt,
      cancelRevision,
      cancelAt,
      selectedCard = false;
    if (continuation) {
      // Resume ONLY the exact canonically reconciled unpaid Checkout. No new
      // application billing write or repeated create/payment action is allowed.
      active();
      sessionId = K.sessionId;
      held = true;
      checkoutAt = Date.now();
      await checkHistory();
      await page.goto(continuedCheckout.url, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /^Subscribe/ }).waitFor({ state: "visible" });
      await append("checkout-verified", { sessionId, amountCents: 999, continued: true });
      phase = "checkout-verified";
    }
    const observedControls = async () => {
      // This fixed module is prepared/reviewed only after inspecting the real
      // Stripe controls. No command accepts arbitrary code, URLs or selectors.
      const filename = path.join(ROOT, "scripts/current-billing-observed.mjs");
      const stat = await fs.lstat(filename);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.uid !== process.getuid() ||
        stat.mode & 0o022 ||
        stat.size > 64000
      )
        fail("CURRENT_REVIEWED_CONTROLS_REQUIRED");
      const digest = hash(await fs.readFile(filename));
      const module = await import(`${pathToFileURL(filename).href}?reviewed=${digest}`);
      if (hash(await fs.readFile(filename)) !== digest) fail("CURRENT_CONTROLS_CHANGED");
      active();
      return { module, digest };
    };
    const checkout = async () => ({
      session: await stripe(`/checkout/sessions/${sessionId}`),
      lines: await stripe(`/checkout/sessions/${sessionId}/line_items?limit=100`),
    });
    const exactUnpaid = async () => {
      active();
      const state = await inspect();
      if (
        state.open.has_more !== false ||
        state.open.data?.length !== 1 ||
        state.open.data[0].id !== sessionId
      )
        fail("CURRENT_SINGLE_UNPAID_SESSION_REQUIRED");
      const next = assertCurrentBaseline({ ...state, open: { data: [], has_more: false } });
      if (JSON.stringify(next) !== JSON.stringify(baseline)) fail("CURRENT_BASELINE_CHANGED");
      const data = await checkout();
      assertCurrentOpenCheckout({ ...data, userId: record.userId });
      return data;
    };
    const events = async (since) => {
      const eligible = receipts.filter((r) => r.httpStatus === 200 && r.at >= since);
      const unique = [...new Map(eligible.map((r) => [r.eventId, r])).values()].slice(-30);
      return Promise.all(
        unique.map(async (delivery) => ({
          delivery,
          event: await stripe(`/events/${delivery.eventId}`),
        })),
      );
    };
    const readPaid = async () => {
      const state = await inspect(),
        data = await checkout();
      const subscriptionId = id(data.session.subscription);
      if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId || ""))
        fail("CURRENT_NEW_SUBSCRIPTION_NOT_READY");
      const subscription = await stripe(`/subscriptions/${subscriptionId}`);
      const invoice = await stripe(`/invoices/${id(subscription.latest_invoice)}`);
      return assertCurrentPaid({
        baseline,
        ...state,
        ...data,
        subscription,
        invoice,
        events: await events(checkoutAt),
      });
    };
    report({
      kind: "ready",
      phase,
      amountCents: 999,
      testMode: true,
      free,
      commands: [...COMMANDS].filter(
        (command) =>
          !freshStandardAfterAuthFailure || !["CHALLENGE", "INSPECT_AUTH"].includes(command),
      ),
    });
    input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of input) {
      const action = currentBillingCommand(line);
      if (!action) {
        report({ code: "CURRENT_UNKNOWN_COMMAND" });
        continue;
      }
      if (action === "STOP") break;
      active();
      stage = action;
      if (action === "STATUS") {
        const state = await inspect();
        report({
          kind: "status",
          phase,
          isPro: state.profile.is_pro,
          revision: state.profile.billing_revision,
          subscriptions: state.subscriptions.data.map((s) => ({ id: s.id, status: s.status })),
          open: state.open.data.length,
          unexpectedWrites,
        });
      } else if (action === "CHECKOUT") {
        if (continueUnpaid || phase !== "baseline") fail("CURRENT_CHECKOUT_ONCE_REQUIRED");
        await privateMetadata();
        await checkHistory();
        if (JSON.stringify(assertCurrentBaseline(await inspect())) !== JSON.stringify(baseline))
          fail("CURRENT_BASELINE_CHANGED");
        const button = page.getByRole("button", { name: "Upgrade to Pro", exact: true });
        if (
          (await button.count()) !== 1 ||
          !(await button.isVisible()) ||
          !(await button.isEnabled())
        )
          fail("CURRENT_UPGRADE_BUTTON_REQUIRED");
        const text = await page.locator("body").innerText();
        if (!text.includes("$9.99") || text.includes("$5.99"))
          fail("CURRENT_UPGRADE_PRICE_REQUIRED");
        active();
        checkoutAt = Date.now();
        await append("create-pending");
        active();
        phase = "create-pending";
        held = true;
        checkoutAllowed = true;
        const responsePromise = page
          .waitForResponse((r) => r.url() === `${C.origin}/api/create-checkout-session`)
          .then(async (response) => {
            // Read before the click's navigation wait can invalidate the body.
            try {
              return {
                status: response.status(),
                created: response.status() === 200 ? await response.json() : null,
              };
            } catch {
              fail("CURRENT_CREATE_RESPONSE_UNAVAILABLE_RECONCILE_ONLY");
            }
          });
        const [response] = await Promise.all([responsePromise, button.click()]);
        checkoutAllowed = false;
        if (response.status !== 200 || checkoutRequests !== 1)
          fail("CURRENT_CREATE_OUTCOME_UNCERTAIN");
        const created = response.created;
        const state = await inspect();
        if (state.open.has_more !== false || state.open.data?.length !== 1)
          fail("CURRENT_EXACT_CREATED_SESSION_REQUIRED");
        sessionId = state.open.data[0].id;
        const data = await exactUnpaid();
        if (created.url !== data.session.url) fail("CURRENT_CREATED_URL_MISMATCH");
        await page.waitForURL(
          (u) =>
            u.origin === "https://checkout.stripe.com" && u.pathname.split("/").includes(sessionId),
        );
        await append("checkout-verified", { sessionId, amountCents: 999 });
        phase = "checkout-verified";
        report({ kind: phase, sessionId, amountCents: 999 });
      } else if (action === "INSPECT") {
        const view = await inspectStripeSurface(page);
        report({ kind: "stripe-inspection", ...view });
      } else if (action === "SELECT_CARD") {
        if (phase !== "checkout-verified" || selectedCard)
          fail("CURRENT_CARD_SELECTION_ONCE_REQUIRED");
        await exactUnpaid();
        const { module, digest } = await observedControls();
        const selectCard = freshStandardAfterAuthFailure
          ? module.selectCurrentStandardCard
          : module.selectObservedCard;
        await selectCard({
          page,
          sessionId,
          assertActive: active,
          claim: async () => {
            active();
            selectedCard = true;
            await append("card-selection-pending", { sessionId, helperSha256: digest });
            active();
          },
        });
        await append("card-selected", { sessionId });
        report({ kind: "card-selected" });
      } else if (action === "FILL") {
        if (phase !== "checkout-verified") fail("CURRENT_FILL_ONCE_REQUIRED");
        await exactUnpaid();
        const fillCard = freshStandardAfterAuthFailure
          ? fillCurrentStandardTestCard
          : fillCurrentTestCard;
        await fillCard({
          page,
          sessionId,
          assertActive: active,
          claimFill: async () => {
            active();
            await append("fill-pending", { sessionId });
            active();
            phase = "fill-pending";
          },
        });
        await append("filled", { sessionId });
        phase = "filled";
        report({ kind: phase });
      } else if (action === "PAY") {
        if (phase !== "filled") fail("CURRENT_PAYMENT_ONCE_REQUIRED");
        await privateMetadata();
        await exactUnpaid();
        await checkHistory();
        active();
        await append("payment-pending", { sessionId });
        active();
        phase = "payment-pending";
        const submitCard = freshStandardAfterAuthFailure
          ? submitCurrentStandardTestCheckout
          : submitCurrentTestCheckout;
        await submitCard({ page, sessionId, assertActive: active });
        report({ kind: "submitted-once", challengeActionEnabled: false });
      } else if (action === "INSPECT_AUTH") {
        if (freshStandardAfterAuthFailure) fail("CURRENT_STANDARD_AUTH_ACTION_DISABLED");
        if (phase !== "payment-pending") fail("CURRENT_CHALLENGE_INSPECTION_ORDER_REQUIRED");
        const { module, digest } = await observedControls();
        const view = await module.inspectObservedChallenge({ page, sessionId });
        if (view?.inspectionOnly !== true) fail("CURRENT_READ_ONLY_CHALLENGE_REQUIRED");
        report({ kind: "authentication-inspection", helperSha256: digest, ...view });
      } else if (action === "CHALLENGE") {
        if (freshStandardAfterAuthFailure) fail("CURRENT_STANDARD_AUTH_ACTION_DISABLED");
        if (phase !== "payment-pending") fail("CURRENT_CHALLENGE_ONCE_REQUIRED");
        await privateMetadata();
        await checkHistory();
        const { module, digest } = await observedControls();
        const result = await module.completeObservedChallenge({
          page,
          sessionId,
          baseline,
          readStripe: (endpoint) => stripe(endpoint),
          inspect,
          assertActive: active,
          claim: async (proof) => {
            active();
            if (
              !/^pi_[A-Za-z0-9]+$/.test(proof?.paymentIntentId || "") ||
              proof.sessionId !== sessionId ||
              proof.isPro !== false
            )
              fail("CURRENT_UNFINISHED_CHALLENGE_PROOF_REQUIRED");
            await append("challenge-pending", {
              sessionId,
              paymentIntentId: proof.paymentIntentId,
              isPro: false,
              helperSha256: digest,
            });
            phase = "challenge-pending";
            active();
          },
        });
        if (result?.submitted !== true) fail("CURRENT_CHALLENGE_OUTCOME_UNCERTAIN");
        await append("challenge-submitted", { sessionId });
        phase = "challenge-submitted";
        report({ kind: "challenge-submitted", paymentSuccessClaimed: false });
      } else if (action === "VERIFY_PAID") {
        if (!["payment-pending", "challenge-submitted"].includes(phase))
          fail("CURRENT_PAID_PROOF_ORDER_REQUIRED");
        paid = await readPaid();
        await append("paid-proof", { paid });
        const pro = await companion.expectPro();
        if (
          pro.billingRevision < paid.billingRevision ||
          !pro.isPro ||
          !pro.sameOpenPanelTransition
        )
          fail("CURRENT_INSTALLED_PRO_REQUIRED");
        await append("companion-pro", { pro });
        phase = "companion-pro";
        report({ kind: phase, paid, pro });
      } else if (action === "CANCEL") {
        if (phase !== "companion-pro") fail("CURRENT_CANCEL_ONCE_AFTER_PRO_REQUIRED");
        await privateMetadata();
        await checkHistory();
        const fresh = await readPaid();
        if (
          fresh.subscriptionId !== paid.subscriptionId ||
          fresh.billingRevision < paid.billingRevision
        )
          fail("CURRENT_EXACT_CANCEL_SUBSCRIPTION_REQUIRED");
        cancelRevision = fresh.billingRevision;
        cancelAt = Date.now();
        active();
        await append("cancel-pending", {
          subscriptionId: paid.subscriptionId,
          preCancelRevision: cancelRevision,
        });
        phase = "cancel-pending";
        active();
        const canceled = await stripe(`/subscriptions/${paid.subscriptionId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "invoice_now=false&prorate=false",
        });
        if (
          canceled.id !== paid.subscriptionId ||
          canceled.status !== "canceled" ||
          canceled.livemode !== false
        )
          fail("CURRENT_CANCEL_OUTCOME_UNCERTAIN");
        report({ kind: "canceled-once", noProration: true });
      } else if (action === "VERIFY_CANCELED") {
        if (phase !== "cancel-pending") fail("CURRENT_REVOKED_PROOF_ORDER_REQUIRED");
        const state = await inspect();
        const subscription = await stripe(`/subscriptions/${paid.subscriptionId}`);
        const proof = assertCurrentCanceled({
          baseline,
          paid,
          ...state,
          subscription,
          events: await events(cancelAt),
          preCancelRevision: cancelRevision,
        });
        await append("revoked-proof", { proof });
        const revoked = await companion.expectRevoked();
        if (
          revoked.isPro ||
          revoked.billingRevision < proof.billingRevision ||
          !revoked.sameOpenPanelTransition
        )
          fail("CURRENT_INSTALLED_REVOCATION_REQUIRED");
        await checkHistory();
        await privateMetadata();
        if (unexpectedWrites) fail("CURRENT_UNEXPECTED_BROWSER_ACTION");
        await append("final", {
          proof,
          revoked,
          openCheckouts: 0,
          historicalEvidenceUnchanged: true,
          liveCharges: 0,
          directDeployedWebhook: false,
        });
        phase = "final";
        report({
          kind: "final",
          proof,
          revoked,
          openCheckouts: 0,
          historicalEvidenceUnchanged: true,
          testMode: true,
          directDeployedWebhook: false,
        });
        break;
      }
    }
  } catch (error) {
    const code =
      error instanceof SetupError && /^[A-Z_]+$/.test(error.code)
        ? error.code
        : /^CURRENT_BILLING_[A-Z_]+$/.test(error?.message || "")
          ? error.message
          : "CURRENT_STOP_AND_RECONCILE";
    if (journal) await append("stopped", { stage, code }).catch(() => {});
    report({ code, stage, automaticRetry: false });
    process.exitCode = 1;
  } finally {
    await stop();
    await journal?.close();
    if (lock) {
      await lock.close();
      await fs.unlink(path.join(directory, "protected-billing-run.lock"));
    }
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const standard =
    process.argv.length === 4 && process.argv[3] === "--fresh-standard-after-auth-failure";
  const cardSelection =
    process.argv.length === 4 && process.argv[3] === "--continue-card-selection";
  const continuation =
    cardSelection || (process.argv.length === 4 && process.argv[3] === "--continue-unpaid");
  if (
    (process.argv.length !== 3 && !continuation && !standard) ||
    process.argv[2] !== "--approved"
  ) {
    console.error("CURRENT_EXPLICIT_PRIVATE_APPROVAL_REQUIRED");
    process.exitCode = 1;
  } else
    await runCurrentBillingSandbox({
      approved: true,
      continueUnpaid: continuation,
      continueCardSelection: cardSelection,
      freshStandardAfterAuthFailure: standard,
    });
}
