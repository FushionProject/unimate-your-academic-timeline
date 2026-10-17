// Explicit operator-only diagnosis. No recovery journal, Checkout, Portal,
// payment, entitlement reconciliation, AI, Companion, screenshot or trace.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareSandbox, privateJson, TARGET, ARTIFACT } from "./prepare-stripe-sandbox.mjs";
import { readPrivate } from "./verify-stripe-sandbox-lifecycle.mjs";
import { validateRecord } from "./verify-companion-sandbox-browser.mjs";
import {
  loadVerifiedPreviewDeployment,
  validatePreviewAccess,
} from "./protected-companion-preview.mjs";
import { attachProtectedPreviewBrowser } from "./protected-preview-browser.mjs";
import {
  validatedProtectedVercelCli,
  assertProtectedPaymentAttempt,
} from "./run-protected-billing-preview.mjs";
import {
  assertRecoveryStart,
  assertRecoveryDeployment,
  assertRecoverySnapshotLists,
} from "./run-protected-billing-recovery.mjs";
import { PROTECTED_BILLING_RECOVERY as C } from "./protected-billing-recovery-policy.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const id = (value) => (typeof value === "string" ? value : value?.id);
const fail = () => {
  throw new Error("STARTUP_PROBE_SCOPE_REJECTED");
};
export function startupProbeFailure(error) {
  if (error?.name === "TimeoutError") return "timeout";
  if (["ERR_MODULE_NOT_FOUND", "ENOENT"].includes(error?.code)) return "missing-local-dependency";
  if (error?.name === "SyntaxError") return "invalid-response-shape";
  return "operation-failed";
}

export function startupProbeIdentity(user, record) {
  return (
    user?.id === record.userId &&
    user.email === record.email &&
    user.app_metadata?.unimate_test_marker === record.marker &&
    user.app_metadata?.unimate_test_nonce === record.nonce
  );
}

export function startupProbeRoute({ url: address, method, navigation, body, attempts }, record) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return "block";
  }
  if (url.username || url.password || url.hash || url.port || url.protocol !== "https:")
    return "block";
  if (url.origin === C.origin) {
    if (method !== "GET" && method !== "HEAD") return "block";
    if (url.pathname === "/api/billing-status")
      return method === "GET" ? "read-only-status" : "block";
    if (url.pathname.startsWith("/api/")) return "block";
    if (navigation && !["/signin", "/upgrade"].includes(url.pathname)) return "block";
    return "preview-read";
  }
  if (url.origin !== TARGET.supabase) return "block";
  if (url.pathname === "/auth/v1/user" && method === "GET" && !url.search) return "auth-read";
  if (
    url.pathname !== "/auth/v1/token" ||
    method !== "POST" ||
    url.search !== "?grant_type=password" ||
    attempts !== 0
  )
    return "block";
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return "block";
  }
  if (
    !data ||
    data.email !== record.email ||
    data.password !== record.password ||
    Object.keys(data).some((key) => !["email", "password", "gotrue_meta_security"].includes(key)) ||
    (data.gotrue_meta_security !== undefined &&
      (!data.gotrue_meta_security ||
        Array.isArray(data.gotrue_meta_security) ||
        Object.keys(data.gotrue_meta_security).length !== 0))
  )
    return "block";
  return "synthetic-signin";
}

export function assertStartupProbeSnapshot(state, record, session, items) {
  assertRecoverySnapshotLists(state, record);
  if (
    state.profile.billing_revision !== 62 ||
    state.clock?.status !== "ready" ||
    state.clock.livemode !== false ||
    !/^clock_[A-Za-z0-9]+$/.test(state.clock.id || "") ||
    id(state.customer.test_clock) !== state.clock.id
  )
    fail();
  assertProtectedPaymentAttempt(
    { phase: "checkout-verified", userId: record.userId, sessionId: session?.id },
    session,
    items,
    {
      profile: state.profile,
      open: state.openCheckouts.data,
      scope: { subscriptions: state.subscriptions.data },
    },
    JSON.stringify(C.baseline.map((value) => [value, "canceled"]).sort()),
  );
}

export async function inspectProtectedRecoveryStartup({ approved = false } = {}) {
  assertRecoveryStart({ approved });
  const report = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  let currentStage = "configuration",
    browser,
    context,
    dispose,
    page,
    finished = false;
  const stage = (value) => {
    currentStage = value;
    report({ kind: "startup-probe", stage: value });
  };
  const close = async () => {
    finished = true;
    await dispose?.().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  const active = () => {
    if (finished) fail();
  };
  const environment = Object.fromEntries(
    ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG"]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  try {
    stage("configuration");
    const config = await prepareSandbox({ approved: true, verificationOnly: true });
    const record = JSON.parse(await readPrivate(path.join(ROOT, ARTIFACT)));
    validateRecord(record);
    const service = config.supa.SUPABASE_SERVICE_ROLE_KEY;
    const headers = service.startsWith("sb_secret_")
      ? { apikey: service }
      : { apikey: service, Authorization: `Bearer ${service}` };
    const stripe = (endpoint) =>
      privateJson(fetch, `https://api.stripe.com/v1${endpoint}`, {
        headers: {
          Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
          "Stripe-Version": "2026-06-24.dahlia",
        },
      });
    const verifyScope = async () => {
      const user = await privateJson(
        fetch,
        `${TARGET.supabase}/auth/v1/admin/users/${record.userId}`,
        { headers },
      );
      const profiles = await privateJson(
        fetch,
        `${TARGET.supabase}/rest/v1/profiles?${new URLSearchParams({
          id: `eq.${record.userId}`,
          select: "id,is_pro,stripe_customer_id,billing_revision",
        })}`,
        { headers },
      );
      if (profiles?.length !== 1) fail();
      const customer = await stripe(`/customers/${C.customer}`);
      if (!/^clock_[A-Za-z0-9]+$/.test(id(customer.test_clock) || "")) fail();
      const clock = await stripe(`/test_helpers/test_clocks/${id(customer.test_clock)}`);
      const subscriptions = await stripe(
        `/subscriptions?${new URLSearchParams({ customer: C.customer, status: "all", limit: "100" })}`,
      );
      const openCheckouts = await stripe(
        `/checkout/sessions?${new URLSearchParams({ customer: C.customer, status: "open", limit: "100" })}`,
      );
      if (
        openCheckouts?.data?.length !== 1 ||
        !/^cs_test_[A-Za-z0-9]+$/.test(openCheckouts.data[0].id)
      )
        fail();
      const session = openCheckouts.data[0];
      const items = await stripe(`/checkout/sessions/${session.id}/line_items?limit=100`);
      assertStartupProbeSnapshot(
        { user, customer, clock, profile: profiles[0], subscriptions, openCheckouts },
        record,
        session,
        items,
      );
      return session.id;
    };
    stage("baseline-read");
    const initialSessionId = await verifyScope();
    active();
    stage("deployment");
    const project = JSON.parse(await fs.readFile(path.join(ROOT, ".vercel/project.json"), "utf8"));
    const cli = await validatedProtectedVercelCli(process.env.UNIMATE_VERCEL_CLI_PATH);
    const execute = promisify(execFile);
    const vercel = (args, options) =>
      execute(process.execPath, [cli, ...args], {
        ...options,
        env: { ...environment, CI: "1", NO_COLOR: "1", VERCEL_CLI_USE_NATIVE_BINARY: "0" },
      });
    const deployment = await loadVerifiedPreviewDeployment(
      C.origin,
      project,
      async (file, args, options) => {
        if (file !== "npx" || args[1] !== "vercel@63.1.2") fail();
        const result = await vercel(args.slice(2), options);
        assertRecoveryDeployment(JSON.parse(result.stdout));
        return result;
      },
    );
    stage("OIDC");
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-startup-probe-"));
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
            project.projectId,
            "--",
            process.execPath,
            "-e",
            'process.stdout.write(process.env.VERCEL_OIDC_TOKEN||"")',
          ],
          { cwd: temporary, timeout: 60000, maxBuffer: 64000 },
        )
      ).stdout.trim();
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
    const access = validatePreviewAccess(C.origin, token, project, deployment);
    token = "";
    active();
    stage("browser-import");
    const { chromium } = await import(
      process.env.PLAYWRIGHT_MODULE_PATH
        ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
        : "playwright"
    );
    stage("browser-launch");
    browser = await chromium.launch({ channel: "chromium", headless: true, env: environment });
    active();
    stage("browser-context");
    context = await browser.newContext({ serviceWorkers: "block" });
    dispose = await attachProtectedPreviewBrowser(context, access);
    let attempts = 0,
      blocked = 0,
      responses = 0;
    await context.route(/^https?:\/\//, async (route) => {
      const request = route.request();
      const decision = startupProbeRoute(
        {
          url: request.url(),
          method: request.method(),
          navigation: request.isNavigationRequest(),
          body: request.postData(),
          attempts,
        },
        record,
      );
      if (decision === "block") {
        blocked++;
        return route.abort("blockedbyclient");
      }
      if (decision === "synthetic-signin") attempts++;
      if (decision === "read-only-status")
        return route.fallback({ url: `${C.origin}/api/billing-status?reconcile=false` });
      return route.fallback();
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("response", (response) => {
      const url = new URL(response.url());
      const resource =
        url.origin === TARGET.supabase && url.pathname === "/auth/v1/token"
          ? "password-grant"
          : url.origin === C.origin && url.pathname === "/signin"
            ? "signin-document"
            : url.origin === C.origin && url.pathname === "/api/billing-status"
              ? "billing-read-only"
              : null;
      if (resource && ++responses <= 20)
        report({ kind: "response", resource, status: response.status() });
    });
    stage("signin-navigation");
    await page.goto(`${C.origin}/signin?next=upgrade`, { waitUntil: "domcontentloaded" });
    report({
      kind: "selectors",
      email: await page.locator("#signin-email").count(),
      password: await page.locator("#signin-password").count(),
      submit: await page.getByRole("button", { name: "Sign in", exact: true }).count(),
    });
    stage("hydration-ready");
    await page.locator('html[data-unimate-auth-state="signed-out"]').waitFor({ state: "attached" });
    stage("email-fill");
    await page.locator("#signin-email").fill(record.email);
    stage("password-fill");
    await page.locator("#signin-password").fill(record.password);
    stage("signin-submit");
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.origin === TARGET.supabase &&
        url.pathname === "/auth/v1/token" &&
        url.search === "?grant_type=password"
      );
    });
    const [response] = await Promise.all([
      responsePromise,
      page.getByRole("button", { name: "Sign in", exact: true }).click(),
    ]);
    stage("marked-session");
    if (response.status() !== 200 || !startupProbeIdentity((await response.json()).user, record))
      fail();
    stage("upgrade-navigation");
    await page.waitForURL((url) => url.origin === C.origin && url.pathname === "/upgrade");
    stage("final-scope-read");
    if ((await verifyScope()) !== initialSessionId) fail();
    return {
      kind: "startup-probe-complete",
      markedSyntheticSignin: true,
      billingRevision: 62,
      passwordAttempts: attempts,
      blockedRequests: blocked,
      checkoutActions: 0,
      aiRequests: 0,
    };
  } catch (error) {
    return {
      kind: "startup-probe-stopped",
      stage: currentStage,
      category: startupProbeFailure(error),
    };
  } finally {
    await close();
    process.off("SIGINT", close);
    process.off("SIGTERM", close);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  inspectProtectedRecoveryStartup({
    approved:
      process.argv.length === 2 && process.env.UNIMATE_RECOVERY_STARTUP_PROBE === "approved",
  })
    .then((result) => {
      console.log(JSON.stringify(result));
      if (result.kind !== "startup-probe-complete") process.exitCode = 1;
    })
    .catch((error) => {
      console.log(
        JSON.stringify({
          kind: "startup-probe-stopped",
          stage: "approval",
          category: startupProbeFailure(error),
        }),
      );
      process.exitCode = 1;
    });
}
