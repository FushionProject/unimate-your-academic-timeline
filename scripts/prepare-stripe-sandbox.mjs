// Local operator tool, never imported by the application or uploaded with it.
// Requires explicit approval before reading private config or making requests.
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
// Historical $5.99 lifecycle target: preserve this exact identity for existing
// journals and recovery tools. New $9.99 price verification is separate in
// verify-current-stripe-sandbox-price.mjs; never relabel these historical runs.
export const TARGET = Object.freeze({
  account: "acct_1UQHj2IxB8W4eFUh",
  product: "prod_VRA7ssPuHQrbbc",
  price: "price_1UQHp4IxB8W4eFUhP9PCN5MG",
  supabase: "https://gtqfaxsokdlrdxipcyqo.supabase.co",
});
export const ARTIFACT = ".stripe-sandbox.local/test-user.json";
const MARKER = "unimate-stripe-sandbox-synthetic-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class SetupError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new SetupError(code);
};

export function parseSelectedEnv(text, names) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || !names.includes(match[1])) continue;
    if (Object.hasOwn(result, match[1])) fail("DUPLICATE_CONFIG_KEY");
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    if (/\s|[\x00-\x1f]/.test(value) || value.length > 4096) fail("INVALID_CONFIG_VALUE");
    result[match[1]] = value;
  }
  return result;
}

async function readPrivate(file) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 65536 || stat.mode & 0o077 || stat.uid !== process.getuid())
      fail("PRIVATE_REGULAR_FILE_REQUIRED");
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

export function assertIgnored(root) {
  try {
    // Check each path independently; quiet mode only accepts a single path.
    for (const file of [ARTIFACT, ".env.local", ".env.stripe.local"])
      execFileSync("git", ["check-ignore", "--quiet", "--", file], { cwd: root, stdio: "ignore" });
  } catch {
    fail("PRIVATE_PATH_NOT_GIT_IGNORED");
  }
}

// Full-body timeout + cap, no redirects, retries, provider payloads or URLs in errors.
export async function privateJson(fetchImpl, url, init) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  try {
    const response = await fetchImpl(url, { ...init, redirect: "manual", signal: abort.signal });
    if (!response.ok) {
      await response.body?.cancel();
      fail("REMOTE_REQUEST_REJECTED");
    }
    const reader = response.body?.getReader();
    if (!reader) fail("REMOTE_RESPONSE_INVALID");
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65536) {
          await reader.cancel();
          fail("REMOTE_RESPONSE_TOO_LARGE");
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw error instanceof SetupError ? error : new SetupError("REMOTE_REQUEST_FAILED");
  } finally {
    clearTimeout(timer);
  }
}

function assertRecord(record) {
  if (
    record?.version !== 1 ||
    record.marker !== MARKER ||
    record.account !== TARGET.account ||
    record.price !== TARGET.price ||
    record.supabase !== TARGET.supabase ||
    !UUID.test(record.nonce) ||
    record.email !== `unimate-billing-${record.nonce}@example.test` ||
    !/^[A-Za-z0-9_-]{43}$/.test(record.password) ||
    (record.userId !== null && !UUID.test(record.userId))
  )
    fail("PRIVATE_RECORD_INVALID");
}

function assertUser(user, record) {
  if (
    !UUID.test(user?.id) ||
    (record.userId && record.userId !== user.id) ||
    user.email !== record.email ||
    user.app_metadata?.unimate_test_marker !== MARKER ||
    user.app_metadata?.unimate_test_nonce !== record.nonce
  )
    fail("SYNTHETIC_USER_IDENTITY_MISMATCH");
}

// Injectable dependencies are for deterministic offline fixtures only. The CLI
// fixes config locations and both service targets; it accepts no credentials.
export async function prepareSandbox({
  approved = false,
  root = ROOT,
  fetchImpl = fetch,
  checkIgnored = assertIgnored,
  verificationOnly = false,
} = {}) {
  if (!approved) fail("EXPLICIT_SETUP_APPROVAL_REQUIRED");
  try {
    checkIgnored(root);
    const supa = parseSelectedEnv(await readPrivate(path.join(root, ".env.local")), [
      "VITE_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "VITE_SUPABASE_ANON_KEY",
    ]);
    const stripe = parseSelectedEnv(await readPrivate(path.join(root, ".env.stripe.local")), [
      "STRIPE_SECRET_KEY",
      "STRIPE_PRICE_ID",
      "STRIPE_LIVE_MODE_ENABLED",
    ]);
    if (supa.VITE_SUPABASE_URL !== TARGET.supabase) fail("SUPABASE_TARGET_MISMATCH");
    const service = supa.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!service.startsWith("sb_secret_")) {
      let claims;
      try {
        claims = JSON.parse(Buffer.from(service.split(".")[1], "base64url").toString());
      } catch {
        fail("PRIVILEGED_SUPABASE_KEY_REQUIRED");
      }
      if (claims.role !== "service_role" || claims.ref !== "gtqfaxsokdlrdxipcyqo")
        fail("PRIVILEGED_SUPABASE_KEY_REQUIRED");
    }
    if (
      !/^[sr]k_test_[A-Za-z0-9]+$/.test(stripe.STRIPE_SECRET_KEY || "") ||
      stripe.STRIPE_LIVE_MODE_ENABLED !== "false" ||
      stripe.STRIPE_PRICE_ID !== TARGET.price
    )
      fail("EXACT_TEST_BILLING_CONFIG_REQUIRED");
    const stripeHeaders = {
      Authorization: `Bearer ${stripe.STRIPE_SECRET_KEY}`,
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

    // Internal supervisor composition only: never printed by either CLI.
    if (verificationOnly) return { supa, stripe };

    // Only after remote read-only identity checks may any local/remote writes occur.
    const directory = path.join(root, ".stripe-sandbox.local");
    await fs.mkdir(directory, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.mode & 0o077 || stat.uid !== process.getuid())
      fail("PRIVATE_DIRECTORY_REQUIRED");
    const artifact = path.join(root, ARTIFACT);
    const lock = await fs
      .open(path.join(directory, "setup.lock"), "wx", 0o600)
      .catch(() => fail("SETUP_ALREADY_RUNNING_OR_INTERRUPTED"));
    try {
      let record;
      try {
        record = JSON.parse(await readPrivate(artifact));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const headers = service.startsWith("sb_secret_")
        ? { apikey: service }
        : { apikey: service, Authorization: `Bearer ${service}` };
      let user;
      if (record) {
        assertRecord(record);
        // Unknown create outcomes require manual, read-only reconciliation. Never
        // blindly retry POST or replace a pending journal with another identity.
        if (!record.userId) fail("PENDING_CREATE_REQUIRES_RECONCILIATION");
        user = await privateJson(
          fetchImpl,
          `${TARGET.supabase}/auth/v1/admin/users/${record.userId}`,
          { headers },
        );
      } else {
        const nonce = randomUUID();
        record = {
          version: 1,
          marker: MARKER,
          account: TARGET.account,
          price: TARGET.price,
          supabase: TARGET.supabase,
          nonce,
          email: `unimate-billing-${nonce}@example.test`,
          password: randomBytes(32).toString("base64url"),
          userId: null,
        };
        await fs.writeFile(artifact, JSON.stringify(record), { flag: "wx", mode: 0o600 });
        user = await privateJson(fetchImpl, `${TARGET.supabase}/auth/v1/admin/users`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            email: record.email,
            password: record.password,
            email_confirm: true,
            app_metadata: { unimate_test_marker: MARKER, unimate_test_nonce: nonce },
            user_metadata: { display_name: "Synthetic UniMate billing test" },
          }),
        });
        assertUser(user, record);
        record.userId = user.id;
        const next = path.join(directory, `${nonce}.tmp`);
        await fs.writeFile(next, JSON.stringify(record), { flag: "wx", mode: 0o600 });
        await fs.rename(next, artifact);
      }
      assertUser(user, record);
      const query = new URLSearchParams({
        id: `eq.${record.userId}`,
        select: "id,is_pro,stripe_customer_id,billing_revision",
      });
      const profiles = await privateJson(
        fetchImpl,
        `${TARGET.supabase}/rest/v1/profiles?${query}`,
        { headers },
      );
      if (
        !Array.isArray(profiles) ||
        profiles.length !== 1 ||
        profiles[0].id !== record.userId ||
        profiles[0].is_pro !== false ||
        profiles[0].stripe_customer_id !== null ||
        profiles[0].billing_revision !== 0
      )
        fail("SYNTHETIC_PROFILE_NOT_PRISTINE_FREE");
      return { ready: true, artifact: ARTIFACT };
    } finally {
      await lock.close();
      await fs.unlink(path.join(directory, "setup.lock"));
    }
  } catch (error) {
    throw error instanceof SetupError ? error : new SetupError("PRIVATE_SETUP_FAILED");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (
    process.argv.length !== 3 ||
    process.argv[2] !== "--prepare" ||
    process.env.UNIMATE_STRIPE_TEST_SETUP !== "approved"
  ) {
    console.error(
      "No action taken. Requires --prepare and UNIMATE_STRIPE_TEST_SETUP=approved. Creates only a marked synthetic Free test user; saves credentials privately in .stripe-sandbox.local/test-user.json. No payments, listener, server, or cleanup actions.",
    );
    process.exitCode = 1;
  } else {
    prepareSandbox({ approved: true }).then(
      () =>
        console.log(
          "Sandbox and price verified; synthetic Free test user ready. Credentials remain in ignored .stripe-sandbox.local/test-user.json.",
        ),
      (error) => {
        console.error(
          `Setup stopped: ${error instanceof SetupError ? error.code : "PRIVATE_SETUP_FAILED"}. No automatic retry or cleanup; preserve the private journal.`,
        );
        process.exitCode = 1;
      },
    );
  }
}
