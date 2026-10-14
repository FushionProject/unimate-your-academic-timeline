// Owner-only bounded runner. No arbitrary URLs/eval, payment submission, retries,
// persistent auth tokens, raw browser text, provider output, or secret logging.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
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
import { sandboxClock } from "./stripe-sandbox-clock.mjs";
import { captureSecret, LISTEN_ARGS } from "./run-stripe-sandbox.mjs";
import {
  loadVerifiedPreviewDeployment,
  validatePreviewAccess,
} from "./protected-companion-preview.mjs";
import { createProtectedStripePreviewRelay } from "./protected-stripe-preview-relay.mjs";
import { attachProtectedPreviewBrowser } from "./protected-preview-browser.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROJECT = "prj_5XZ4ulni13tNLCvNzdL1gUPvashI";
const TEAM = "team_MwJPMKdnqu1z8dxbKYBqdJCY";
const CUSTOMER = "cus_VRAVJnKW1RGQzr";
const COMMANDS = new Set([
  "STATUS",
  "PAGE",
  "CHECKOUT",
  "PAY",
  "INSPECT_STRIPE",
  "PAY_SUBMIT",
  "PORTAL",
  "PORTAL_CANCEL",
  "RETURN",
  "EXPECT_FREE",
  "EXPECT_PRO",
  "EXPECT_REVOKED",
  "STOP",
]);
const fail = (code) => {
  throw new SetupError(code);
};
const runCommand = promisify(execFile);
const objectId = (value) => (typeof value === "string" ? value : value?.id);
export const parseProtectedBillingCommand = (line) =>
  COMMANDS.has(line.trim()) ? line.trim() : null;

const STARTUP_STAGES = new Set([
  "CONFIG",
  "PRIVATE_SETUP",
  "DEPLOYMENT",
  "BASELINE",
  "OIDC",
  "RELAY",
  "LISTENER",
  "BROWSER_IMPORT",
  "BROWSER_LAUNCH",
  "BROWSER_CONTEXT",
  "WEBSITE_TRANSPORT",
  "WEBSITE_NAVIGATION",
  "WEBSITE_SIGNIN",
  "COMPANION_START",
  "COMPANION_FREE",
  "COMMAND_LOOP",
]);
export function protectedBillingStartupError(stage, error) {
  // The stage is selected by our code, never from external error text. Keep
  // explicitly classified failures, but never disclose raw child/browser errors.
  if (error instanceof SetupError) return error;
  return new SetupError(
    STARTUP_STAGES.has(stage) ? `PRIVATE_PREVIEW_${stage}_FAILED` : "PRIVATE_PREVIEW_RUN_FAILED",
  );
}

export async function validatedProtectedVercelCli(filename) {
  if (
    typeof filename !== "string" ||
    !path.isAbsolute(filename) ||
    path.basename(filename) !== "vc.js" ||
    path.basename(path.dirname(filename)) !== "dist"
  )
    fail("PINNED_CACHED_VERCEL_CLI_REQUIRED");
  const packagePath = path.join(path.dirname(filename), "../package.json");
  for (const candidate of [filename, packagePath]) {
    const stat = await fs.lstat(candidate);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o022)
      fail("PINNED_CACHED_VERCEL_CLI_REQUIRED");
  }
  const pkg = JSON.parse(await fs.readFile(packagePath, "utf8"));
  if (pkg.name !== "vercel" || pkg.version !== "63.1.2" || pkg.bin?.vercel !== "./dist/vc.js")
    fail("PINNED_CACHED_VERCEL_CLI_REQUIRED");
  return filename;
}

export function assertProtectedPaymentAttempt(journal, session, items, state, baseline) {
  if (
    !journal ||
    journal.phase !== "checkout-verified" ||
    journal.paymentAttempted ||
    !/^cs_test_[A-Za-z0-9]+$/.test(journal.sessionId || "")
  )
    fail("PAYMENT_PHASE_OR_RETRY_REJECTED");
  if (
    session?.id !== journal.sessionId ||
    session.livemode !== false ||
    objectId(session.customer) !== CUSTOMER ||
    session.client_reference_id !== journal.userId ||
    session.metadata?.user_id !== journal.userId ||
    session.mode !== "subscription" ||
    session.status !== "open" ||
    session.payment_status !== "unpaid" ||
    session.subscription != null ||
    session.amount_total !== 599 ||
    session.currency !== "usd" ||
    items?.has_more !== false ||
    items.data?.length !== 1 ||
    objectId(items.data[0].price) !== TARGET.price ||
    items.data[0].quantity !== 1 ||
    items.data[0].amount_total !== 599 ||
    items.data[0].currency !== "usd" ||
    state?.profile?.is_pro !== false ||
    state.profile.id !== journal.userId ||
    state.profile.stripe_customer_id !== CUSTOMER ||
    state.open?.length !== 1 ||
    state.open[0].id !== journal.sessionId ||
    JSON.stringify(state.scope?.subscriptions?.map((sub) => [sub.id, sub.status]).sort()) !==
      baseline
  )
    fail("EXACT_UNPAID_TEST_PAYMENT_SCOPE_REQUIRED");
}

export function assertProtectedCancelAttempt(journal, state) {
  const active = state?.scope?.subscriptions?.filter(
    (sub) => !["canceled", "incomplete_expired"].includes(sub.status),
  );
  if (
    !journal?.portalVerified ||
    journal.cancelAttempted ||
    !/^sub_[A-Za-z0-9]+$/.test(journal.subscriptionId || "") ||
    state?.profile?.is_pro !== true ||
    state.profile.id !== journal.userId ||
    state.profile.stripe_customer_id !== CUSTOMER ||
    active?.length !== 1 ||
    active[0].id !== journal.subscriptionId ||
    active[0].status !== "active" ||
    active[0].cancelAtPeriodEnd ||
    active[0].cancelAt
  )
    fail("EXACT_ACTIVE_PORTAL_CANCEL_SCOPE_REQUIRED");
}

// Pure proof policy used by STATUS and, freshly, by RETURN. A 200 delivery for
// the right customer is insufficient: it must concern this Checkout's new sub.
export function protectedBillingReturnProof({
  journal,
  profile,
  subscriptions,
  openCheckouts,
  session,
  events,
  purchaseRevision,
} = {}) {
  const no = { verified: false };
  if (
    !journal ||
    journal.customerId !== CUSTOMER ||
    !/^cs_test_[A-Za-z0-9]+$/.test(journal.sessionId || "") ||
    profile?.id !== journal.userId ||
    profile.stripe_customer_id !== CUSTOMER ||
    !Number.isSafeInteger(profile.billing_revision) ||
    !Number.isSafeInteger(journal.baselineRevision) ||
    profile.billing_revision <= journal.baselineRevision ||
    !Array.isArray(subscriptions) ||
    !Array.isArray(openCheckouts) ||
    openCheckouts.length ||
    !Array.isArray(events)
  )
    return no;
  let baseline;
  try {
    baseline = JSON.parse(journal.baseline);
  } catch {
    return no;
  }
  if (
    !Array.isArray(baseline) ||
    baseline.length !== 3 ||
    baseline.some((row) => !Array.isArray(row) || row.length !== 2 || row[1] !== "canceled") ||
    new Set(baseline.map((row) => row[0])).size !== 3 ||
    new Set(subscriptions.map((sub) => sub.id)).size !== subscriptions.length
  )
    return no;
  if (
    baseline.some(
      ([id]) => !subscriptions.some((sub) => sub.id === id && sub.status === "canceled"),
    )
  )
    return no;
  const newSubs = subscriptions.filter((sub) => !baseline.some(([id]) => id === sub.id));
  if (newSubs.length !== 1 || !/^sub_[A-Za-z0-9]+$/.test(newSubs[0].id)) return no;
  const subscriptionId = newSubs[0].id;
  if (
    (journal.subscriptionId && journal.subscriptionId !== subscriptionId) ||
    session?.id !== journal.sessionId ||
    session.livemode !== false ||
    objectId(session.customer) !== CUSTOMER ||
    session.client_reference_id !== journal.userId ||
    session.metadata?.user_id !== journal.userId ||
    session.mode !== "subscription" ||
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    session.amount_total !== 599 ||
    session.currency !== "usd" ||
    objectId(session.subscription) !== subscriptionId
  )
    return no;
  const revoking = journal.portalAttempted === true;
  if (
    revoking
      ? journal.subscriptionId !== subscriptionId ||
        newSubs[0].status !== "canceled" ||
        profile.is_pro !== false ||
        !Number.isSafeInteger(purchaseRevision) ||
        profile.billing_revision <= purchaseRevision
      : newSubs[0].status !== "active" || profile.is_pro !== true
  )
    return no;
  const related = events.some((event) => {
    const object = event?.data?.object;
    if (
      !/^evt_[A-Za-z0-9]+$/.test(event?.id || "") ||
      event.livemode !== false ||
      object?.livemode !== false ||
      objectId(object.customer) !== CUSTOMER ||
      (event.account !== undefined && event.account !== TARGET.account)
    )
      return false;
    if (revoking)
      return (
        event.type === "customer.subscription.deleted" &&
        object.object === "subscription" &&
        object.id === subscriptionId
      );
    if (
      ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(
        event.type,
      )
    )
      return (
        object.object === "checkout.session" &&
        object.id === journal.sessionId &&
        object.payment_status === "paid" &&
        objectId(object.subscription) === subscriptionId
      );
    if (event.type === "invoice.paid")
      return (
        object.object === "invoice" &&
        object.status === "paid" &&
        objectId(object.parent?.subscription_details?.subscription || object.subscription) ===
          subscriptionId
      );
    return (
      ["customer.subscription.created", "customer.subscription.updated"].includes(event.type) &&
      object.object === "subscription" &&
      object.id === subscriptionId
    );
  });
  return related
    ? {
        verified: true,
        subscriptionId,
        billingRevision: profile.billing_revision,
        phase: revoking ? "revoked" : "purchased",
      }
    : no;
}

export function assertProtectedBillingReturn(held, proof) {
  if (!held || proof?.verified !== true) fail("HOSTED_WEBHOOK_AND_PERSISTED_STATE_PROOF_REQUIRED");
}

export async function readyProtectedBillingButton(page, name) {
  const button = page.getByRole("button", { name, exact: true });
  await button.waitFor({ state: "visible", timeout: 15000 });
  if (!(await button.isEnabled())) fail("BILLING_BUTTON_NOT_READY");
  return button;
}

// Bound discovery to this attempt's recent events, with complete pagination.
// No token/URL/customer data from unrelated events is returned to output.
export async function recentProtectedPortalEvents(stripe, attemptedAt) {
  if (!Number.isSafeInteger(attemptedAt) || attemptedAt <= 0) fail("PORTAL_ATTEMPT_TIME_REQUIRED");
  const events = [],
    seen = new Set();
  let after;
  for (let page = 0; page < 3; page++) {
    const query = new URLSearchParams({
      type: "billing_portal.session.created",
      limit: "100",
      "created[gte]": String(Math.floor(attemptedAt / 1000) - 120),
    });
    if (after) query.set("starting_after", after);
    const result = await stripe(`/events?${query}`);
    if (
      !Array.isArray(result.data) ||
      typeof result.has_more !== "boolean" ||
      result.data.length > 100 ||
      (result.has_more && !result.data.length)
    )
      fail("COMPLETE_PORTAL_EVENT_LIST_REQUIRED");
    for (const event of result.data) {
      if (
        !/^evt_[A-Za-z0-9]+$/.test(event?.id || "") ||
        seen.has(event.id) ||
        event.type !== "billing_portal.session.created" ||
        event.livemode !== false
      )
        fail("COMPLETE_PORTAL_EVENT_LIST_REQUIRED");
      seen.add(event.id);
      events.push(event);
    }
    if (!result.has_more) return events;
    after = result.data.at(-1).id;
  }
  fail("COMPLETE_PORTAL_EVENT_LIST_REQUIRED");
}

export async function runProtectedBillingPreview({ origin, approved = false } = {}) {
  if (!approved || process.env.DEBUG || process.env.PWDEBUG || process.env.NODE_OPTIONS)
    fail("EXPLICIT_PRIVATE_RUN_APPROVAL_REQUIRED");
  const report = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const baseEnv = Object.fromEntries(
    ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG"]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  let relay, listener, browser, website, disposeWebsite, companion, input, lock, expiryTimer;
  let stopped = false,
    closing;
  let startupStage = "CONFIG";
  const stage = (name) => {
    startupStage = name;
    report({ kind: "startup", stage: name });
  };
  const directory = path.join(ROOT, ".stripe-sandbox.local");
  const lockPath = path.join(directory, "protected-billing-run.lock");
  const stop = () => {
    if (closing) return closing;
    stopped = true;
    closing = (async () => {
      clearTimeout(expiryTimer);
      input?.close();
      await companion?.close().catch(() => {});
      await disposeWebsite?.().catch(() => {});
      await website?.close().catch(() => {});
      await browser?.close().catch(() => {});
      await relay?.stop().catch(() => {});
      if (listener?.pid && listener.exitCode === null && !listener.signalCode) {
        await new Promise((resolve) => {
          const hard = setTimeout(() => listener.kill("SIGKILL"), 5000);
          listener.once("exit", () => {
            clearTimeout(hard);
            resolve();
          });
          listener.kill("SIGTERM");
        });
      }
    })();
    return closing;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const active = () => {
    if (stopped) fail("PRIVATE_RUN_STOPPED");
  };
  try {
    stage("CONFIG");
    const config = await prepareSandbox({ approved: true, verificationOnly: true });
    stage("PRIVATE_SETUP");
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.mode & 0o077 || stat.uid !== process.getuid())
      fail("PRIVATE_DIRECTORY_REQUIRED");
    lock = await fs.open(lockPath, "wx", 0o600);
    const record = JSON.parse(await readPrivate(path.join(ROOT, ARTIFACT)));
    validateRecord(record);
    const setup = JSON.parse(
      await readPrivate(path.join(directory, "protected-preview-setup-v1.json")),
    );
    if (
      setup.version !== 1 ||
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
      fail("PRIVATE_PREVIEW_SETUP_REQUIRED");
    stage("DEPLOYMENT");
    const project = JSON.parse(await fs.readFile(path.join(ROOT, ".vercel/project.json"), "utf8"));
    const cliPath = process.env.UNIMATE_VERCEL_CLI_PATH
      ? await validatedProtectedVercelCli(process.env.UNIMATE_VERCEL_CLI_PATH)
      : null;
    const vercel = (args, options) =>
      runCommand(
        cliPath ? process.execPath : "npx",
        cliPath ? [cliPath, ...args] : ["--yes", "vercel@63.1.2", ...args],
        options,
      );
    const deployment = await loadVerifiedPreviewDeployment(
      origin,
      project,
      (file, args, options) => {
        if (file !== "npx" || args[0] !== "--yes" || args[1] !== "vercel@63.1.2")
          fail("PINNED_VERCEL_COMMAND_REQUIRED");
        return vercel(args.slice(2), {
          ...options,
          env: { ...options.env, VERCEL_CLI_USE_NATIVE_BINARY: "0" },
        });
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
    const serviceHeaders = service.startsWith("sb_secret_")
      ? { apikey: service }
      : { apikey: service, Authorization: `Bearer ${service}` };
    const inspect = async () => {
      const scope = await sandboxClock({
        action: "status",
        approved: true,
        verify: async () => config,
      });
      if (
        scope.account !== TARGET.account ||
        scope.userId !== record.userId ||
        scope.customerId !== CUSTOMER ||
        scope.clockStatus !== "ready"
      )
        fail("SYNTHETIC_CUSTOMER_SCOPE_CHANGED");
      const profiles = await privateJson(
        fetch,
        `${TARGET.supabase}/rest/v1/profiles?${new URLSearchParams({ id: `eq.${record.userId}`, select: "id,is_pro,stripe_customer_id,billing_revision" })}`,
        { headers: serviceHeaders },
      );
      const profile = profiles?.[0];
      if (
        !Array.isArray(profiles) ||
        profiles.length !== 1 ||
        profile.id !== record.userId ||
        profile.stripe_customer_id !== CUSTOMER ||
        typeof profile.is_pro !== "boolean" ||
        !Number.isSafeInteger(profile.billing_revision)
      )
        fail("SYNTHETIC_PROFILE_MISMATCH");
      const open = await stripe(
        `/checkout/sessions?${new URLSearchParams({ customer: CUSTOMER, status: "open", limit: "100" })}`,
      );
      if (
        !Array.isArray(open.data) ||
        open.has_more !== false ||
        new Set(open.data.map((s) => s.id)).size !== open.data.length ||
        open.data.some(
          (s) =>
            s.livemode !== false ||
            objectId(s.customer) !== CUSTOMER ||
            s.status !== "open" ||
            !/^cs_test_[A-Za-z0-9]+$/.test(s.id),
        )
      )
        fail("EXACT_OPEN_CHECKOUT_LIST_REQUIRED");
      return { scope, profile, open: open.data };
    };
    stage("BASELINE");
    const initial = await inspect();
    if (
      initial.profile.is_pro ||
      initial.open.length ||
      initial.scope.subscriptions.length !== 3 ||
      initial.scope.subscriptions.some((s) => s.status !== "canceled")
    )
      fail("EXPECTED_FREE_THREE_CANCELED_BASELINE_REQUIRED");
    const baseline = JSON.stringify(
      initial.scope.subscriptions.map((s) => [s.id, s.status]).sort(),
    );
    const journalPath = path.join(directory, "protected-billing-checkout-v1.json");
    try {
      await readPrivate(journalPath);
      fail("PROTECTED_CHECKOUT_ALREADY_JOURNALED");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    // env run reads cwd .env.local after generating credentials. An empty owned
    // cwd prevents an expired local OIDC variable overriding the fresh token.
    stage("OIDC");
    const credentialCwd = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-preview-oidc-"));
    let token;
    try {
      const result = await vercel(
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
        {
          cwd: credentialCwd,
          env: { ...baseEnv, CI: "1", NO_COLOR: "1", VERCEL_CLI_USE_NATIVE_BINARY: "0" },
          timeout: 60000,
          maxBuffer: 64000,
        },
      );
      token = result.stdout.trim();
    } catch {
      fail("FRESH_PRIVATE_OIDC_FAILED");
    } finally {
      await fs.rm(credentialCwd, { recursive: true, force: true });
    }
    const access = validatePreviewAccess(origin, token, project, deployment);
    token = "";
    active();
    const webhookProof = [];
    stage("RELAY");
    relay = createProtectedStripePreviewRelay({
      access,
      project,
      deployment,
      webhookSecret: setup.webhookSecret,
      account: TARGET.account,
      customerId: CUSTOMER,
      report: (event) => {
        webhookProof.push({ ...event, at: Date.now() });
        if (webhookProof.length > 200) webhookProof.shift();
        report({ kind: "webhook", ...event });
      },
    });
    await relay.start();
    active();
    stage("LISTENER");
    const args = [...LISTEN_ARGS];
    args[args.indexOf("--forward-to") + 1] = "http://127.0.0.1:8789/api/stripe-webhook";
    listener = spawn("stripe", args, {
      cwd: ROOT,
      env: { ...baseEnv, STRIPE_API_KEY: config.stripe.STRIPE_SECRET_KEY },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Raw CLI output includes credentials and event payloads: drain, never print.
    listener.stdout.on("data", () => {});
    listener.stderr.on("data", () => {});
    listener.once("error", () => void stop());
    listener.once("exit", () => {
      if (!stopped) {
        report({ code: "PRIVATE_LISTENER_STOPPED" });
        void stop();
      }
    });
    if ((await captureSecret(listener)) !== setup.webhookSecret) fail("LISTENER_SECRET_MISMATCH");
    active();
    stage("BROWSER_IMPORT");
    const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
    const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
    active();
    stage("BROWSER_LAUNCH");
    browser = await chromium.launch({ channel: "chromium", headless: true, env: baseEnv });
    if (stopped) {
      await browser.close();
      fail("PRIVATE_RUN_STOPPED");
    }
    stage("BROWSER_CONTEXT");
    website = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 1280, height: 900 },
    });
    if (stopped) {
      await website.close();
      await browser.close();
      fail("PRIVATE_RUN_STOPPED");
    }
    stage("WEBSITE_TRANSPORT");
    disposeWebsite = await attachProtectedPreviewBrowser(website, access);
    website.once("close", () => {
      if (!stopped) void stop();
    });
    const page = await website.newPage();
    const websiteEvidence = { authResponses: [], pageErrors: 0, failedRequests: 0 };
    page.on("pageerror", () => websiteEvidence.pageErrors++);
    page.on("requestfailed", () => websiteEvidence.failedRequests++);
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin === TARGET.supabase && url.pathname === "/auth/v1/token")
        websiteEvidence.authResponses.push(response.status());
    });
    let holdUpgrade = false;
    // Registered after the OIDC transport, so this hold runs first. Do not load
    // application JS on a Stripe return until direct DB + hosted webhook proof
    // is established. Otherwise the Upgrade page could reconcile entitlement.
    await website.route(/^https?:\/\//, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (holdUpgrade && url.origin === origin && url.pathname === "/api/billing-status") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"code":"PRIVATE_TEST_RETURN_HELD"}',
        });
      } else if (
        holdUpgrade &&
        url.origin === origin &&
        url.pathname === "/upgrade" &&
        request.isNavigationRequest()
      ) {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<!doctype html><title>Private test verification</title><p>Payment received. Verifying private test.</p>",
        });
      } else {
        await route.fallback();
      }
    });
    page.setDefaultTimeout(15000);
    stage("WEBSITE_NAVIGATION");
    await page.goto(`${origin}/signin?next=upgrade`, { waitUntil: "domcontentloaded" });
    stage("WEBSITE_SIGNIN");
    report({
      kind: "signin-form",
      emailField: await page.locator("#signin-email").count(),
      passwordField: await page.locator("#signin-password").count(),
    });
    try {
      await page.locator("#signin-email").fill(record.email);
      await page.locator("#signin-password").fill(record.password);
      const authResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.origin === TARGET.supabase &&
          url.pathname === "/auth/v1/token" &&
          url.searchParams.get("grant_type") === "password"
        );
      });
      const [response] = await Promise.all([
        authResponse,
        page.getByRole("button", { name: "Sign in", exact: true }).click(),
      ]);
      if (response.status() !== 200) fail("SYNTHETIC_WEBSITE_SIGNIN_FAILED");
      const signedIn = await response.json();
      const user = signedIn.user;
      if (
        user?.id !== record.userId ||
        user.email !== record.email ||
        user.app_metadata?.unimate_test_marker !== record.marker ||
        user.app_metadata?.unimate_test_nonce !== record.nonce
      )
        fail("SYNTHETIC_WEBSITE_IDENTITY_MISMATCH");
      await page.waitForURL((url) => url.origin === origin && url.pathname === "/upgrade");
    } catch (error) {
      let currentPath = "closed";
      let messages = [];
      if (!page.isClosed()) {
        const url = new URL(page.url());
        currentPath =
          url.origin === origin && ["/signin", "/upgrade", "/dashboard"].includes(url.pathname)
            ? url.pathname
            : "other";
        const body = await page
          .locator("body")
          .innerText()
          .catch(() => "");
        messages = [
          "Welcome back",
          "Auth isn't configured yet",
          "That email or password did not match",
          "Check your email confirmation link",
          "We couldn't reach UniMate",
          "We couldn't sign you in",
          "Something went wrong",
        ].filter((text) => body.includes(text));
      }
      report({ kind: "signin-diagnostic", currentPath, messages, ...websiteEvidence });
      throw error;
    }
    // The separate extension keeps one fixture/panel throughout Free→Pro→Free.
    stage("COMPANION_START");
    const { startProtectedCompanionBillingHarness } =
      await import("./protected-companion-billing-harness.mjs");
    companion = await startProtectedCompanionBillingHarness({
      record,
      publicKey: config.supa.VITE_SUPABASE_ANON_KEY,
      access,
      project,
      deployment,
      privateDirectory: directory,
      modulePath,
    });
    if (stopped) {
      await companion.close();
      fail("PRIVATE_RUN_STOPPED");
    }
    stage("COMPANION_FREE");
    report({ kind: "companion", ...(await companion.expectFree()) });
    stage("COMMAND_LOOP");
    expiryTimer = setTimeout(() => void stop(), Math.max(1, access.expiresAt - Date.now() - 5000));
    expiryTimer.unref?.();
    let journal;
    let purchaseVerifiedRevision = null;
    let returnProven = false;
    const save = async (value) => {
      const temporary = `${journalPath}.${randomUUID()}.tmp`;
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(value));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, journalPath);
      journal = value;
    };
    const readReturnProof = async () => {
      const state = await inspect();
      if (!journal?.sessionId) return { state, proof: { verified: false } };
      const since = journal.portalAttemptedAt ?? journal.checkoutAttemptedAt;
      const delivered = webhookProof.filter(
        (event) => event.at >= since && event.httpStatus === 200,
      );
      const ids = [...new Set(delivered.map((event) => event.eventId))].slice(-12);
      const events = [];
      for (const id of ids) {
        const event = await stripe(`/events/${id}`);
        if (
          event.id !== id ||
          !delivered.some((entry) => entry.eventId === id && entry.eventType === event.type)
        )
          fail("HOSTED_EVENT_READBACK_MISMATCH");
        events.push(event);
      }
      const session = await stripe(`/checkout/sessions/${journal.sessionId}`);
      const proof = protectedBillingReturnProof({
        journal,
        profile: state.profile,
        subscriptions: state.scope.subscriptions,
        openCheckouts: state.open,
        session,
        events,
        purchaseRevision: purchaseVerifiedRevision,
      });
      if (proof.verified && proof.phase === "purchased") {
        if (purchaseVerifiedRevision === null) purchaseVerifiedRevision = proof.billingRevision;
        if (!journal.subscriptionId)
          await save({
            ...journal,
            subscriptionId: proof.subscriptionId,
            purchaseVerifiedRevision,
          });
      }
      return { state, proof };
    };
    const safePage = async () => {
      const url = new URL(page.url());
      const surface =
        url.origin === origin
          ? "unimate"
          : url.origin === "https://checkout.stripe.com"
            ? "stripe-checkout"
            : url.origin === "https://billing.stripe.com"
              ? "stripe-portal"
              : "unexpected";
      if (surface === "unexpected") fail("UNEXPECTED_BROWSER_SURFACE");
      const text = await page.locator("body").innerText();
      const messages = [
        "UniMate Pro is active",
        "Restart Pro",
        "Upgrade to Pro",
        "Manage billing",
        "Test mode",
        "Test Mode",
        "$5.99",
        "Subscribe",
        "Your card was declined",
      ].filter((value) => text.includes(value));
      // Return presence booleans, never arbitrary labels/values or page text.
      const fields = {};
      for (const name of [
        "cardNumber",
        "cardExpiry",
        "cardCvc",
        "billingName",
        "billingPostalCode",
      ])
        fields[name] = (await page.locator(`[name="${name}"]`).count()) > 0;
      return { surface, messages, fields, paymentSubmissionEnabled: false };
    };
    report({ kind: "ready", commands: [...COMMANDS], paymentSubmissionEnabled: false });
    input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of input) {
      const command = parseProtectedBillingCommand(line);
      if (!command) {
        report({ code: "FIXED_COMMAND_REQUIRED" });
        continue;
      }
      if (command === "STOP") break;
      try {
        active();
        if (command === "STATUS") {
          const { state, proof } = await readReturnProof();
          returnProven = proof.verified;
          report({
            kind: "status",
            isPro: state.profile.is_pro,
            billingRevision: state.profile.billing_revision,
            activeSubscriptions: state.scope.subscriptions.filter(
              (s) => !["canceled", "incomplete_expired"].includes(s.status),
            ).length,
            openCheckouts: state.open.length,
            hostedWebhookProofBeforeReturn: returnProven,
          });
        } else if (command === "RETURN") {
          const { proof } = await readReturnProof();
          assertProtectedBillingReturn(holdUpgrade, proof);
          holdUpgrade = false;
          await page.goto(`${origin}/upgrade`, { waitUntil: "domcontentloaded" });
          report({ kind: "return", hostedWebhookProofBeforeReturn: true });
        } else if (command === "PAGE" || command === "PAY") {
          report({
            kind: command === "PAY" ? "payment-inspection-only" : "page",
            ...(await safePage()),
          });
        } else if (command === "INSPECT_STRIPE") {
          const { inspectStripeSurface } = await import("./protected-stripe-browser-actions.mjs");
          report({ kind: "stripe-controls", ...(await inspectStripeSurface(page)) });
        } else if (command === "PAY_SUBMIT") {
          if (!journal?.sessionId) fail("PAYMENT_PHASE_OR_RETRY_REJECTED");
          const session = await stripe(`/checkout/sessions/${journal.sessionId}`);
          const items = await stripe(
            `/checkout/sessions/${journal.sessionId}/line_items?limit=100`,
          );
          assertProtectedPaymentAttempt(journal, session, items, await inspect(), baseline);
          const url = new URL(page.url());
          if (
            !holdUpgrade ||
            url.origin !== "https://checkout.stripe.com" ||
            !url.pathname.split("/").includes(journal.sessionId)
          )
            fail("EXACT_TEST_CHECKOUT_PAGE_REQUIRED");
          const { submitVerifiedTestPayment } =
            await import("./protected-stripe-browser-payment.mjs");
          if (typeof submitVerifiedTestPayment !== "function")
            fail("REVIEWED_PAYMENT_HELPER_REQUIRED");
          await save({ ...journal, paymentAttempted: true });
          await submitVerifiedTestPayment({ page, sessionId: journal.sessionId });
          report({ kind: "payment-action-submitted", testMode: true });
        } else if (command === "PORTAL_CANCEL") {
          assertProtectedCancelAttempt(journal, await inspect());
          if (!holdUpgrade || new URL(page.url()).origin !== "https://billing.stripe.com")
            fail("VERIFIED_PORTAL_PAGE_REQUIRED");
          const { cancelVerifiedTestSubscription } =
            await import("./protected-stripe-browser-cancel.mjs");
          if (typeof cancelVerifiedTestSubscription !== "function")
            fail("REVIEWED_CANCEL_HELPER_REQUIRED");
          await save({ ...journal, cancelAttempted: true });
          await cancelVerifiedTestSubscription({ page });
          report({ kind: "cancel-action-submitted", testMode: true });
        } else if (command.startsWith("EXPECT_")) {
          const method = {
            EXPECT_FREE: "expectFree",
            EXPECT_PRO: "expectPro",
            EXPECT_REVOKED: "expectRevoked",
          }[command];
          report({ kind: "companion", ...(await companion[method]()) });
        } else if (command === "CHECKOUT") {
          if (journal) fail("CHECKOUT_ALREADY_ATTEMPTED_NO_RETRY");
          const state = await inspect();
          if (
            state.profile.is_pro ||
            state.open.length ||
            JSON.stringify(state.scope.subscriptions.map((s) => [s.id, s.status]).sort()) !==
              baseline
          )
            fail("UNCHANGED_FREE_BASELINE_REQUIRED");
          if (new URL(page.url()).origin !== origin || new URL(page.url()).pathname !== "/upgrade")
            fail("UPGRADE_PAGE_REQUIRED");
          const checkoutButton = await readyProtectedBillingButton(
            page,
            /^(Restart Pro|Upgrade to Pro)$/,
          );
          journal = {
            version: 1,
            account: TARGET.account,
            userId: record.userId,
            customerId: CUSTOMER,
            origin,
            baseline,
            baselineRevision: state.profile.billing_revision,
            phase: "checkout-pending",
            checkoutAttemptedAt: Date.now(),
          };
          const handle = await fs.open(journalPath, "wx", 0o600);
          try {
            await handle.writeFile(JSON.stringify(journal));
            await handle.sync();
          } finally {
            await handle.close();
          }
          holdUpgrade = true;
          returnProven = false;
          await checkoutButton.click();
          await page.waitForURL((url) => url.origin === "https://checkout.stripe.com");
          const url = new URL(page.url());
          const sessionId = url.pathname
            .split("/")
            .find((part) => /^cs_test_[A-Za-z0-9]+$/.test(part));
          if (!sessionId || url.username || url.password) fail("TEST_CHECKOUT_REQUIRED");
          // Preserve resolved identity before API readback; never persist URL.
          await save({ ...journal, sessionId, phase: "checkout-resolved" });
          const session = await stripe(`/checkout/sessions/${sessionId}`);
          const items = await stripe(`/checkout/sessions/${sessionId}/line_items?limit=100`);
          const latest = await inspect();
          if (
            session.id !== sessionId ||
            session.livemode !== false ||
            objectId(session.customer) !== CUSTOMER ||
            session.client_reference_id !== record.userId ||
            session.metadata?.user_id !== record.userId ||
            session.mode !== "subscription" ||
            session.status !== "open" ||
            session.payment_status !== "unpaid" ||
            session.subscription != null ||
            session.amount_total !== 599 ||
            session.currency !== "usd" ||
            items.has_more !== false ||
            items.data?.length !== 1 ||
            objectId(items.data[0].price) !== TARGET.price ||
            items.data[0].quantity !== 1 ||
            items.data[0].amount_total !== 599 ||
            items.data[0].currency !== "usd" ||
            latest.open.length !== 1 ||
            latest.open[0].id !== sessionId ||
            latest.profile.is_pro ||
            JSON.stringify(latest.scope.subscriptions.map((s) => [s.id, s.status]).sort()) !==
              baseline
          )
            fail("EXACT_TEST_CHECKOUT_NOT_VERIFIED");
          await save({ ...journal, phase: "checkout-verified" });
          report({
            kind: "checkout",
            testMode: true,
            amount: 599,
            currency: "usd",
            verified: true,
          });
        } else if (command === "PORTAL") {
          if (
            !journal ||
            journal.portalAttempted ||
            holdUpgrade ||
            purchaseVerifiedRevision === null
          )
            fail("PORTAL_PHASE_OR_RETRY_REJECTED");
          const state = await inspect();
          if (
            !state.profile.is_pro ||
            state.scope.subscriptions.filter((s) => s.status === "active").length !== 1 ||
            !state.scope.subscriptions.some(
              (s) => s.id === journal.subscriptionId && s.status === "active",
            )
          )
            fail("SINGLE_ACTIVE_PRO_REQUIRED");
          await page.goto(`${origin}/upgrade`, { waitUntil: "domcontentloaded" });
          const portalButton = await readyProtectedBillingButton(page, "Manage billing");
          await save({ ...journal, portalAttempted: true, portalAttemptedAt: Date.now() });
          holdUpgrade = true;
          returnProven = false;
          await portalButton.click();
          await page.waitForURL((url) => url.origin === "https://billing.stripe.com");
          const portalUrl = page.url();
          const events = await recentProtectedPortalEvents(stripe, journal.portalAttemptedAt);
          const matches = events.filter((event) => event.data?.object?.url === portalUrl);
          if (
            matches.length !== 1 ||
            matches[0].livemode !== false ||
            matches[0].type !== "billing_portal.session.created" ||
            matches[0].data.object.livemode !== false ||
            objectId(matches[0].data.object.customer) !== CUSTOMER ||
            matches[0].data.object.return_url !== `${origin}/upgrade`
          )
            fail("PORTAL_CUSTOMER_PROOF_PENDING_OR_MISMATCH");
          await save({ ...journal, portalVerified: true });
          report({ kind: "portal", testMode: true, exactCustomerVerified: true });
        }
      } catch (error) {
        report({
          code: error instanceof SetupError ? error.code : "PRIVATE_COMMAND_FAILED_NO_RETRY",
        });
        // Uncertain browser/provider mutations remain journaled. Observation
        // commands and STOP stay available; no command automatically retries.
      }
    }
  } catch (error) {
    throw protectedBillingStartupError(startupStage, error);
  } finally {
    await stop();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    if (lock) {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const valid = process.argv.length === 4 && process.argv[2] === "--origin";
  runProtectedBillingPreview({
    origin: valid ? process.argv[3] : undefined,
    approved: valid && process.env.UNIMATE_PROTECTED_BILLING_RUN === "approved",
  }).catch((error) => {
    console.error(
      JSON.stringify({
        code: error instanceof SetupError ? error.code : "PRIVATE_PREVIEW_RUN_FAILED",
      }),
    );
    process.exitCode = 1;
  });
}
