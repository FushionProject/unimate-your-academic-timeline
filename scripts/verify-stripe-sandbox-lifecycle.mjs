// Operator-only synthetic lifecycle checks. Never imported into the app.
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TARGET,
  ARTIFACT,
  SetupError,
  parseSelectedEnv,
  privateJson,
  assertIgnored,
} from "./prepare-stripe-sandbox.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const APP = "http://localhost:8080";
const MARKER = "unimate-stripe-sandbox-synthetic-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTIONS = ["baseline", "checkout", "status", "portal"];
const fail = (code) => {
  throw new SetupError(code);
};

export async function readPrivate(file) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.mode & 0o077 || stat.uid !== process.getuid() || stat.size > 65536)
      fail("PRIVATE_REGULAR_FILE_REQUIRED");
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

export async function verifyLifecycle({
  action,
  approved = false,
  root = ROOT,
  fetchImpl = fetch,
  checkIgnored = assertIgnored,
} = {}) {
  if (!approved || !ACTIONS.includes(action)) fail("EXPLICIT_LIFECYCLE_APPROVAL_REQUIRED");
  try {
    checkIgnored(root);
    const directory = path.join(root, ".stripe-sandbox.local");
    const dir = await fs.lstat(directory);
    if (!dir.isDirectory() || dir.mode & 0o077 || dir.uid !== process.getuid())
      fail("PRIVATE_DIRECTORY_REQUIRED");
    const record = JSON.parse(await readPrivate(path.join(root, ARTIFACT)));
    if (
      record.version !== 1 ||
      record.marker !== MARKER ||
      record.account !== TARGET.account ||
      record.price !== TARGET.price ||
      record.supabase !== TARGET.supabase ||
      !UUID.test(record.nonce) ||
      !UUID.test(record.userId) ||
      record.email !== `unimate-billing-${record.nonce}@example.test` ||
      !/^[A-Za-z0-9_-]{43}$/.test(record.password)
    )
      fail("SYNTHETIC_RECORD_INVALID");
    const env = parseSelectedEnv(await readPrivate(path.join(root, ".env.local")), [
      "VITE_SUPABASE_URL",
      "VITE_SUPABASE_ANON_KEY",
    ]);
    if (env.VITE_SUPABASE_URL !== TARGET.supabase) fail("SUPABASE_TARGET_MISMATCH");
    const publicKey = env.VITE_SUPABASE_ANON_KEY || "";
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publicKey)) {
      let claims;
      try {
        claims = JSON.parse(Buffer.from(publicKey.split(".")[1], "base64url").toString());
      } catch {
        fail("PUBLIC_SUPABASE_KEY_REQUIRED");
      }
      if (claims.role !== "anon" || claims.ref !== "gtqfaxsokdlrdxipcyqo")
        fail("PUBLIC_SUPABASE_KEY_REQUIRED");
    }
    const billing = parseSelectedEnv(await readPrivate(path.join(root, ".env.stripe.local")), [
      "STRIPE_SECRET_KEY",
      "STRIPE_PRICE_ID",
      "STRIPE_LIVE_MODE_ENABLED",
    ]);
    if (
      !/^[sr]k_test_[A-Za-z0-9]+$/.test(billing.STRIPE_SECRET_KEY || "") ||
      billing.STRIPE_PRICE_ID !== TARGET.price ||
      billing.STRIPE_LIVE_MODE_ENABLED !== "false"
    )
      fail("EXACT_TEST_BILLING_CONFIG_REQUIRED");
    const stripeHeaders = {
      Authorization: `Bearer ${billing.STRIPE_SECRET_KEY}`,
      "Stripe-Version": "2026-06-24.dahlia",
    };
    const account = await privateJson(fetchImpl, "https://api.stripe.com/v1/account", {
      headers: stripeHeaders,
    });
    if (account.id !== TARGET.account) fail("STRIPE_ACCOUNT_MISMATCH");
    const price = await privateJson(fetchImpl, `https://api.stripe.com/v1/prices/${TARGET.price}`, {
      headers: stripeHeaders,
    });
    if (
      price.id !== TARGET.price ||
      price.product !== TARGET.product ||
      price.livemode !== false ||
      price.active !== true ||
      price.currency !== "usd" ||
      price.unit_amount !== 599 ||
      price.recurring?.interval !== "month" ||
      price.recurring.interval_count !== 1
    )
      fail("STRIPE_PRICE_MISMATCH");

    const session = await privateJson(
      fetchImpl,
      `${TARGET.supabase}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: { apikey: publicKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: record.email, password: record.password }),
      },
    );
    if (
      typeof session.access_token !== "string" ||
      !session.access_token ||
      typeof session.refresh_token !== "string" ||
      !session.refresh_token
    )
      fail("INVALID_TEST_SESSION");
    const auth = { apikey: publicKey, Authorization: `Bearer ${session.access_token}` };
    const user = await privateJson(fetchImpl, `${TARGET.supabase}/auth/v1/user`, { headers: auth });
    if (
      user.id !== record.userId ||
      user.email !== record.email ||
      user.app_metadata?.unimate_test_marker !== MARKER ||
      user.app_metadata?.unimate_test_nonce !== record.nonce
    )
      fail("SYNTHETIC_USER_IDENTITY_MISMATCH");
    // Read the persisted webhook result BEFORE any application billing endpoint.
    const query = new URLSearchParams({
      id: `eq.${record.userId}`,
      select: "id,is_pro,stripe_customer_id,billing_revision",
    });
    const profiles = await privateJson(fetchImpl, `${TARGET.supabase}/rest/v1/profiles?${query}`, {
      headers: auth,
    });
    if (
      !Array.isArray(profiles) ||
      profiles.length !== 1 ||
      profiles[0].id !== record.userId ||
      typeof profiles[0].is_pro !== "boolean" ||
      !Number.isSafeInteger(profiles[0].billing_revision) ||
      profiles[0].billing_revision < 0 ||
      !(
        profiles[0].stripe_customer_id === null ||
        /^cus_[A-Za-z0-9]+$/.test(profiles[0].stripe_customer_id)
      )
    )
      fail("INVALID_SYNTHETIC_PROFILE");
    const profile = profiles[0];
    if (
      action === "baseline" &&
      (profile.is_pro || profile.stripe_customer_id !== null || profile.billing_revision !== 0)
    )
      fail("BASELINE_NOT_PRISTINE_FREE");
    const appHeaders = {
      Authorization: auth.Authorization,
      "Content-Type": "application/json",
      Origin: APP,
    };
    const status = await privateJson(fetchImpl, `${APP}/api/billing-status?reconcile=false`, {
      headers: appHeaders,
    });
    if (status.isPro !== profile.is_pro) fail("PERSISTED_BILLING_STATE_MISMATCH");
    // Empty body cannot reach quota/provider work: entitlement runs first, then
    // disabled screenshot feature (503), then required image validation (400).
    let gateStatus;
    const gate = await privateJson(
      async (url, init) => {
        const response = await fetchImpl(url, init);
        gateStatus = response.status;
        if (![400, 403, 503].includes(response.status)) {
          await response.body?.cancel();
          fail("UNEXPECTED_COMPANION_PROBE_STATUS");
        }
        return new Response(response.body, { status: 200 });
      },
      `${APP}/api/analyze-screenshot`,
      { method: "POST", headers: appHeaders, body: "{}" },
    );
    const gatePassed = profile.is_pro
      ? (gateStatus === 400 && gate.error === "imageBase64 is required") ||
        (gateStatus === 503 && gate.code === "SCREENSHOT_UNAVAILABLE")
      : gateStatus === 403 && gate.code === "PRO_REQUIRED";
    if (!gatePassed) fail("COMPANION_ENTITLEMENT_PROBE_FAILED");

    const run = randomUUID();
    const sessionArtifact = `.stripe-sandbox.local/session-${run}.json`;
    await fs.writeFile(
      path.join(root, sessionArtifact),
      JSON.stringify({
        version: 1,
        marker: MARKER,
        userId: user.id,
        account: TARGET.account,
        supabase: TARGET.supabase,
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
      }),
      { flag: "wx", mode: 0o600 },
    );
    let url;
    if (action === "checkout" || action === "portal") {
      const endpoint = action === "checkout" ? "create-checkout-session" : "create-portal-session";
      const result = await privateJson(fetchImpl, `${APP}/api/${endpoint}`, {
        method: "POST",
        headers: appHeaders,
        body: "{}",
      });
      const parsed = new URL(result.url);
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.port ||
        (action === "checkout"
          ? parsed.hostname !== "checkout.stripe.com" || !parsed.pathname.includes("cs_test_")
          : parsed.hostname !== "billing.stripe.com")
      )
        fail("UNEXPECTED_SANDBOX_REDIRECT");
      url = parsed.href;
    }
    const artifact = `.stripe-sandbox.local/lifecycle-${action}-${run}.json`;
    const result = {
      action,
      userId: user.id,
      account: TARGET.account,
      app: APP,
      profile: {
        isPro: profile.is_pro,
        hasCustomer: profile.stripe_customer_id !== null,
        billingRevision: profile.billing_revision,
      },
      billingIsPro: status.isPro,
      gate: { status: gateStatus, code: gate.code || "IMAGE_VALIDATION" },
      sessionArtifact,
      artifact,
      ...(url ? { url } : {}),
    };
    await fs.writeFile(path.join(root, artifact), JSON.stringify(result), {
      flag: "wx",
      mode: 0o600,
    });
    return result;
  } catch (error) {
    throw error instanceof SetupError ? error : new SetupError("PRIVATE_LIFECYCLE_FAILED");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyLifecycle({
    action: process.argv.length === 3 ? process.argv[2] : undefined,
    approved: process.env.UNIMATE_STRIPE_TEST_LIFECYCLE === "approved",
  }).then(
    (result) => console.log(JSON.stringify(result, null, 2)),
    (error) => {
      console.error(
        `Lifecycle stopped: ${error instanceof SetupError ? error.code : "PRIVATE_LIFECYCLE_FAILED"}. No automatic retry; preserve private artifacts.`,
      );
      process.exitCode = 1;
    },
  );
}
