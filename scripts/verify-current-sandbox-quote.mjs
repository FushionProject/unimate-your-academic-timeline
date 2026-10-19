// One-shot operator check of the approved private Preview's $9.99 quote.
// Never pays, creates a subscription, follows a Checkout URL, or replays an
// uncertain operation. Existing $5.99 identity/evidence files stay immutable.
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
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
import { validatePreviewAccess } from "./protected-companion-preview.mjs";
import {
  CURRENT_SANDBOX_TARGET,
  verifyCurrentSandboxPrice,
} from "./verify-current-stripe-sandbox-price.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const QUOTE_SCOPE = Object.freeze({
  origin: "https://unimate-8kp8pqpcg-resumejuice-s-projects.vercel.app",
  deployment: "dpl_8n8fDcJhc1SwUjaFHtgYfHZntuGF",
  source: "cb8a296362a743f58e6eb31511bdab2eb122ae15",
  customer: "cus_VRAVJnKW1RGQzr",
  journal: "current-price-quote-cb8a296-v1.jsonl",
});
const fail = (code) => {
  throw new SetupError(code);
};
const objectId = (value) => (typeof value === "string" ? value : value?.id);
const sessionId = (value) => typeof value === "string" && /^cs_test_[A-Za-z0-9]+$/.test(value);
const stripeUrl = (value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "checkout.stripe.com" &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
};

export function assertQuoteIgnored(root) {
  assertIgnored(root);
  try {
    execFileSync(
      "git",
      ["check-ignore", "--quiet", "--", `.stripe-sandbox.local/${QUOTE_SCOPE.journal}`],
      {
        cwd: root,
        stdio: "ignore",
      },
    );
  } catch {
    fail("QUOTE_JOURNAL_NOT_GIT_IGNORED");
  }
}

export function validateCurrentQuoteSession(session, lines, userId, expected = "open") {
  if (
    !sessionId(session?.id) ||
    session.livemode !== false ||
    objectId(session.customer) !== QUOTE_SCOPE.customer ||
    session.client_reference_id !== userId ||
    session.metadata?.user_id !== userId ||
    session.status !== expected ||
    session.mode !== "subscription" ||
    session.subscription != null ||
    session.payment_intent != null ||
    session.payment_status !== "unpaid" ||
    session.currency !== "usd" ||
    session.amount_total !== 999 ||
    session.amount_subtotal !== 999 ||
    session.total_details?.amount_discount !== 0 ||
    session.total_details?.amount_tax !== 0 ||
    session.total_details?.amount_shipping !== 0 ||
    session.automatic_tax?.enabled !== false ||
    session.success_url !==
      `${QUOTE_SCOPE.origin}/upgrade?success=true&session_id={CHECKOUT_SESSION_ID}` ||
    session.cancel_url !== `${QUOTE_SCOPE.origin}/upgrade?canceled=true` ||
    (expected === "open" && !stripeUrl(session.url))
  )
    fail("EXACT_CURRENT_UNPAID_QUOTE_REQUIRED");
  const line = lines?.data?.[0];
  if (
    lines?.has_more !== false ||
    !Array.isArray(lines.data) ||
    lines.data.length !== 1 ||
    objectId(line.price) !== CURRENT_SANDBOX_TARGET.price ||
    line.quantity !== 1 ||
    line.amount_total !== 999 ||
    line.amount_subtotal !== 999 ||
    line.currency !== "usd"
  )
    fail("EXACT_CURRENT_QUOTE_LINE_REQUIRED");
  return true;
}

// Dependencies are injectable for deterministic OFFLINE tests only. A real
// operator supplies authenticated Vercel metadata, a fresh deployment-bound
// billingProof from the verified pre-build Preview environment snapshot (and
// proof this exact build had no env overrides), and tokens in memory. This is
// NOT runtime secret readback, and current project settings alone are not proof
// of an older deployment's environment. Sensitive/write-only keys can use the
// separately audited cb8 pre-write guard: the live lock rejects live keys and
// the exact account-scoped test Price must be fetched before any billing write.
// That alternative does NOT claim deployed/local key equality. No CLI
// accepts credentials, arbitrary origins, customers or journal filenames.
export async function verifyCurrentSandboxQuote({
  approved = false,
  access,
  project,
  deployment,
  billingProof,
  appAccessToken,
  root = ROOT,
  fetchImpl = fetch,
  verify = prepareSandbox,
  checkIgnored = assertQuoteIgnored,
  now = Date.now,
} = {}) {
  if (!approved) fail("EXPLICIT_QUOTE_AND_EXPIRY_APPROVAL_REQUIRED");
  let journal;
  try {
    if (
      access?.origin !== QUOTE_SCOPE.origin ||
      deployment?.id !== QUOTE_SCOPE.deployment ||
      deployment?.meta?.githubCommitSha !== QUOTE_SCOPE.source ||
      !Array.isArray(deployment.alias) ||
      deployment.alias.length !== 0 ||
      !["all", "all_except_custom_domains"].includes(project?.ssoProtection?.deploymentType) ||
      !project?.protectionBypass ||
      Object.keys(project.protectionBypass).length !== 0
    )
      fail("EXACT_PROTECTED_QUOTE_DEPLOYMENT_REQUIRED");
    if (
      billingProof?.deployment !== QUOTE_SCOPE.deployment ||
      billingProof.source !== QUOTE_SCOPE.source ||
      billingProof.configurationSource !== "verified_preview_build_configuration" ||
      billingProof.deploymentOverridesAbsent !== true ||
      billingProof.priceId !== CURRENT_SANDBOX_TARGET.price ||
      billingProof.amountCents !== 999 ||
      billingProof.currency !== "usd" ||
      billingProof.liveModeEnabled !== false ||
      !Number.isSafeInteger(billingProof.verifiedAt) ||
      billingProof.verifiedAt > now() ||
      now() - billingProof.verifiedAt > 300_000
    )
      fail("FRESH_DEPLOYED_TEST_PRICE_PROOF_REQUIRED");
    const sameKey = billingProof.keyBinding === "identical_test_key_sha256";
    const prewriteGuard = billingProof.keyBinding === "account_scoped_price_prewrite_guard";
    if (
      (!sameKey && !prewriteGuard) ||
      (sameKey && billingProof.secretKeyMode !== "test") ||
      (prewriteGuard &&
        (billingProof.secretKeyMode !== "test_enforced_before_mutation" ||
          billingProof.secretKeyPresenceVerified !== true ||
          billingProof.secretKeySha256 !== undefined ||
          billingProof.prewriteGuard?.source !== QUOTE_SCOPE.source ||
          billingProof.prewriteGuard.liveKeyRejectedWhileLocked !== true ||
          billingProof.prewriteGuard.exactPriceVerifiedBeforeBillingMutation !== true))
    )
      fail("EXACT_DEPLOYED_KEY_BINDING_PROOF_REQUIRED");
    const validated = validatePreviewAccess(
      access.origin,
      access.token,
      project,
      deployment,
      now(),
    );
    if (
      typeof appAccessToken !== "string" ||
      appAccessToken.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(appAccessToken)
    )
      fail("PRIVATE_SYNTHETIC_ACCESS_TOKEN_REQUIRED");
    checkIgnored(root);
    const directory = path.join(root, ".stripe-sandbox.local");
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.mode & 0o077 || stat.uid !== process.getuid())
      fail("PRIVATE_DIRECTORY_REQUIRED");
    const record = JSON.parse(await readPrivate(path.join(root, ARTIFACT)));
    validateRecord(record);
    const journalPath = path.join(directory, QUOTE_SCOPE.journal);
    try {
      await fs.lstat(journalPath);
      fail("QUOTE_ALREADY_CLAIMED_NO_RETRY");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const config = await verify({ approved: true, verificationOnly: true, root, fetchImpl });
    const key = config.stripe?.STRIPE_SECRET_KEY;
    if (
      !/^[sr]k_test_[A-Za-z0-9]+$/.test(key || "") ||
      config.stripe.STRIPE_LIVE_MODE_ENABLED !== "false" ||
      config.stripe.STRIPE_PRICE_ID !== TARGET.price ||
      config.supa?.VITE_SUPABASE_URL !== TARGET.supabase
    )
      fail("EXACT_LEGACY_TEST_CONFIG_REQUIRED");
    if (sameKey && billingProof.secretKeySha256 !== createHash("sha256").update(key).digest("hex"))
      fail("DEPLOYED_TEST_KEY_MISMATCH");
    await verifyCurrentSandboxPrice({ approved: true, secretKey: key, fetchImpl });
    const stripe = (endpoint, init = {}) =>
      privateJson(fetchImpl, `https://api.stripe.com/v1${endpoint}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${key}`,
          "Stripe-Version": "2026-06-24.dahlia",
          ...init.headers,
        },
      });
    const auth = {
      apikey: config.supa.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${appAccessToken}`,
    };
    if (typeof auth.apikey !== "string" || !auth.apikey || /\s/.test(auth.apikey))
      fail("PUBLIC_SUPABASE_KEY_REQUIRED");
    const user = await privateJson(fetchImpl, `${TARGET.supabase}/auth/v1/user`, { headers: auth });
    if (
      user?.id !== record.userId ||
      user.email !== record.email ||
      user.app_metadata?.unimate_test_marker !== record.marker ||
      user.app_metadata?.unimate_test_nonce !== record.nonce
    )
      fail("EXACT_SYNTHETIC_USER_REQUIRED");
    const readProfile = async () => {
      const rows = await privateJson(
        fetchImpl,
        `${TARGET.supabase}/rest/v1/profiles?${new URLSearchParams({
          id: `eq.${record.userId}`,
          select: "id,is_pro,stripe_customer_id,billing_revision",
        })}`,
        { headers: auth },
      );
      if (
        !Array.isArray(rows) ||
        rows.length !== 1 ||
        rows[0].id !== record.userId ||
        rows[0].is_pro !== false ||
        rows[0].stripe_customer_id !== QUOTE_SCOPE.customer ||
        !Number.isSafeInteger(rows[0].billing_revision) ||
        rows[0].billing_revision < 0
      )
        fail("EXACT_SYNTHETIC_FREE_PROFILE_REQUIRED");
      return rows[0].billing_revision;
    };
    const customer = await stripe(`/customers/${QUOTE_SCOPE.customer}`);
    if (
      customer?.id !== QUOTE_SCOPE.customer ||
      customer.deleted ||
      customer.livemode !== false ||
      customer.metadata?.user_id !== record.userId ||
      !/^clock_[A-Za-z0-9]+$/.test(objectId(customer.test_clock) || "")
    )
      fail("EXACT_SYNTHETIC_CUSTOMER_REQUIRED");
    const clock = await stripe(`/test_helpers/test_clocks/${objectId(customer.test_clock)}`);
    if (
      clock?.id !== objectId(customer.test_clock) ||
      clock.status !== "ready" ||
      clock.livemode !== false
    )
      fail("READY_SYNTHETIC_CLOCK_REQUIRED");
    const subscriptions = async () => {
      const list = await stripe(
        `/subscriptions?${new URLSearchParams({ customer: QUOTE_SCOPE.customer, status: "all", limit: "100" })}`,
      );
      if (
        !Array.isArray(list.data) ||
        list.has_more !== false ||
        new Set(list.data.map((s) => s.id)).size !== list.data.length ||
        list.data.some(
          (s) =>
            !/^sub_[A-Za-z0-9]+$/.test(s.id) ||
            s.livemode !== false ||
            objectId(s.customer) !== QUOTE_SCOPE.customer ||
            s.metadata?.user_id !== record.userId ||
            !["canceled", "incomplete_expired"].includes(s.status),
        )
      )
        fail("ONLY_TERMINAL_SYNTHETIC_SUBSCRIPTIONS_REQUIRED");
      return JSON.stringify(list.data.map((s) => [s.id, s.status]).sort());
    };
    const opens = async () => {
      const list = await stripe(
        `/checkout/sessions?${new URLSearchParams({ customer: QUOTE_SCOPE.customer, status: "open", limit: "100" })}`,
      );
      if (
        !Array.isArray(list.data) ||
        list.has_more !== false ||
        new Set(list.data.map((s) => s.id)).size !== list.data.length ||
        list.data.some(
          (s) =>
            !sessionId(s.id) ||
            s.livemode !== false ||
            objectId(s.customer) !== QUOTE_SCOPE.customer ||
            s.status !== "open",
        )
      )
        fail("COMPLETE_SCOPED_CHECKOUT_LIST_REQUIRED");
      return list.data;
    };
    const baseline = await subscriptions();
    const revision = await readProfile();
    if ((await opens()).length !== 0) fail("NO_OPEN_CHECKOUTS_REQUIRED");
    const app = (endpoint, method = "GET") => {
      if (now() >= validated.expiresAt - 30_000) fail("PREVIEW_ACCESS_EXPIRED");
      return privateJson(fetchImpl, `${QUOTE_SCOPE.origin}${endpoint}`, {
        method,
        headers: {
          Authorization: auth.Authorization,
          Origin: QUOTE_SCOPE.origin,
          "x-vercel-trusted-oidc-idp-token": validated.token,
          "Content-Type": "application/json",
        },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
    };
    const status = await app("/api/billing-status?reconcile=false");
    if (
      status?.isPro !== false ||
      status.state !== "free" ||
      status.canManage !== true ||
      status.pastDueGraceEnabled !== true
    )
      fail("HOSTED_FREE_BASELINE_REQUIRED");
    const signup = await app("/api/signup-status");
    if (signup?.enabled !== false) fail("PRIVATE_SIGNUP_CLOSED_REQUIRED");
    // Atomic exclusive claim persists forever, including an unknown outcome.
    journal = await fs
      .open(journalPath, "wx", 0o600)
      .catch(() => fail("QUOTE_ALREADY_CLAIMED_NO_RETRY"));
    const save = async (phase, extra = {}) => {
      await journal.writeFile(
        JSON.stringify({
          version: 1,
          phase,
          at: now(),
          account: CURRENT_SANDBOX_TARGET.account,
          price: CURRENT_SANDBOX_TARGET.price,
          customer: QUOTE_SCOPE.customer,
          deployment: QUOTE_SCOPE.deployment,
          source: QUOTE_SCOPE.source,
          baselineRevision: revision,
          accountBinding: billingProof.keyBinding,
          deployedKeyEqualityVerified: sameKey,
          ...extra,
        }) + "\n",
      );
      await journal.sync();
    };
    await save("create-pending");
    const created = await app("/api/create-checkout-session", "POST");
    if (!created || Object.keys(created).length !== 1 || !stripeUrl(created.url))
      fail("EXACT_CHECKOUT_RESPONSE_REQUIRED");
    const open = await opens();
    if (open.length !== 1) fail("SINGLE_NEW_CHECKOUT_REQUIRED");
    const id = open[0].id;
    const inspect = async (expected) => {
      const session = await stripe(`/checkout/sessions/${id}`);
      const lines = await stripe(`/checkout/sessions/${id}/line_items?limit=100`);
      if (session?.id !== id) fail("EXACT_CREATED_SESSION_REQUIRED");
      validateCurrentQuoteSession(session, lines, record.userId, expected);
      return session;
    };
    const quote = await inspect("open");
    if (quote.url !== created.url) fail("HOSTED_CHECKOUT_URL_MISMATCH");
    await save("quote-verified", { sessionId: id, amountCents: 999 });
    if ((await subscriptions()) !== baseline || (await readProfile()) !== revision)
      fail("SYNTHETIC_BASELINE_CHANGED");
    await save("expiry-pending", { sessionId: id, amountCents: 999 });
    // Only this verified, newly-created, unpaid session is ever expired.
    const expired = await stripe(`/checkout/sessions/${id}/expire`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
    });
    if (expired?.id !== id || expired.status !== "expired")
      fail("EXPIRY_OUTCOME_UNVERIFIED_NO_RETRY");
    await inspect("expired");
    if (
      (await opens()).length !== 0 ||
      (await subscriptions()) !== baseline ||
      (await readProfile()) !== revision
    )
      fail("FINAL_SYNTHETIC_BASELINE_CHANGED");
    await save("expired-verified", { sessionId: id, amountCents: 999 });
    return {
      verified: true,
      scope: "hosted_unpaid_quote_only",
      amountCents: 999,
      currency: "usd",
      checkoutExpired: true,
      openCheckouts: 0,
      paymentRequests: 0,
      subscriptionMutations: 0,
      userRemainsFree: true,
      historicalEvidenceReused: false,
      accountBinding: billingProof.keyBinding,
      deployedKeyEqualityVerified: sameKey,
    };
  } catch (error) {
    throw error instanceof SetupError
      ? error
      : new SetupError("PRIVATE_QUOTE_CHECK_STOPPED_NO_RETRY");
  } finally {
    await journal?.close();
  }
}
