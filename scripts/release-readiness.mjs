import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line
            .slice(separator + 1)
            .trim()
            .replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
}

// Must stay aligned with src/lib/plan-catalog.ts and the server defaults. This
// is the currently advertised contract, not approval of a future launch price.
export const RELEASE_PRO_CONTRACT = Object.freeze({ amountCents: 599, currency: "usd" });

function canonicalReleaseOrigin(value) {
  if (typeof value !== "string" || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      [url.origin, `${url.origin}/`].includes(value) &&
      hostname.includes(".") &&
      hostname.length <= 253 &&
      hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
      !isIP(hostname) &&
      !/(?:^|\.)(?:localhost|local|internal)$/.test(hostname)
    );
  } catch {
    return false;
  }
}

// Pure configuration preflight: no files, network or credential values in its
// result. Passing does not verify a provider, deployment, Store or launch gate.
export function buildReleaseReadiness(env = {}) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail, blocker: true });
  const configured = (name) => typeof env[name] === "string" && Boolean(env[name].trim());
  add(
    "Supabase browser configuration",
    configured("VITE_SUPABASE_URL") && configured("VITE_SUPABASE_ANON_KEY"),
    "VITE_SUPABASE_URL and the publishable key must be configured.",
  );
  add(
    "AI provider configuration",
    configured("OPENAI_API_KEY"),
    "OPENAI_API_KEY must be configured; retired Groq/Qwen defaults are no longer used.",
  );
  add(
    "Stripe test configuration",
    /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || "") &&
      /^price_/.test(env.STRIPE_PRICE_ID || "") &&
      /^whsec_/.test(env.STRIPE_WEBHOOK_SECRET || ""),
    "A test/restricted test key, Price ID, and webhook signing secret are required.",
  );
  add(
    "Server entitlement writer",
    configured("SUPABASE_SERVICE_ROLE_KEY"),
    "SUPABASE_SERVICE_ROLE_KEY must be a server-only deployment secret.",
  );
  add(
    "Operations keys",
    configured("OPERATIONS_READINESS_KEY") &&
      env.OPERATIONS_READINESS_KEY.trim().length >= 32 &&
      configured("AI_USAGE_HASH_SECRET") &&
      env.AI_USAGE_HASH_SECRET.trim().length >= 32,
    "Both privacy-safe operations secrets must contain at least 32 characters.",
  );
  add(
    "Canonical release origin",
    canonicalReleaseOrigin(env.UNIMATE_CANONICAL_ORIGIN),
    "Set an exact non-local HTTPS origin without credentials, port, path, query or fragment; this does not prove ownership or public deployment.",
  );
  add(
    "Durable capacity enforcement",
    env.AI_DURABLE_QUOTAS_ENABLED === "true" && env.AI_DURABLE_ENTITLEMENTS_ENABLED === "true",
    "Enable only after both reviewed AI migrations pass staging verification.",
  );
  add(
    "Live billing safety lock",
    env.STRIPE_LIVE_MODE_ENABLED === "false" && !/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || ""),
    "Set STRIPE_LIVE_MODE_ENABLED=false explicitly; this preflight never authorizes live billing.",
  );
  add(
    "Release entitlement overrides disabled",
    [undefined, "false"].includes(env.ALLOW_DEV_PRO_OVERRIDES) && !configured("DEV_PRO_USER_IDS"),
    "Disable development Pro overrides and clear the test-user allowlist in release configuration.",
  );
  add(
    "Advertised Pro price matches server expectation",
    Number(env.STRIPE_PRO_MONTHLY_AMOUNT_CENTS || "599") === RELEASE_PRO_CONTRACT.amountCents &&
      (env.STRIPE_PRO_CURRENCY || "usd").toLowerCase() === RELEASE_PRO_CONTRACT.currency,
    "Current public catalog is USD $5.99/month. Any price decision must update the catalog, server expectation and verified Stripe Price together.",
  );
  add(
    "Explicit past-due grace configuration",
    ["true", "false"].includes(env.STRIPE_PAST_DUE_GRACE_ENABLED),
    "Set the owner-chosen grace policy explicitly. Runtime defaults to grace on; a flag alone is neither owner approval nor hosted verification.",
  );
  add(
    "Browser Companion Store listing",
    /^https:\/\/chromewebstore\.google\.com\/detail\/[^/]+\/[a-p]{32}\/?(?:\?.*)?$/.test(
      env.VITE_COMPANION_STORE_URL || "",
    ),
    "Configure the approved Store listing URL after submission; URL shape alone does not verify publication.",
  );
  const blockingCount = checks.filter((check) => !check.pass).length;
  return Object.freeze({
    scope: "configuration_only",
    launchCertified: false,
    configurationReady: blockingCount === 0,
    blockingCount,
    checks,
  });
}

export function runReleaseReadiness({
  root = process.cwd(),
  environment = process.env,
  write = console.log,
} = {}) {
  // Preserve the existing explicit local-env + process-env sources. Do not
  // silently load separate sandbox key files or inspect private evidence.
  const localPath = path.join(root, ".env.local");
  const local = fs.existsSync(localPath) ? parseEnv(fs.readFileSync(localPath, "utf8")) : {};
  const report = buildReleaseReadiness({ ...local, ...environment });
  write("Configuration preflight only — no provider calls or public-launch certification.");
  for (const check of report.checks)
    write(`${check.pass ? "PASS" : "BLOCKED"} ${check.name} — ${check.detail}`);
  write(
    `\n${report.checks.length - report.blockingCount}/${report.checks.length} configuration checks pass; ${report.blockingCount} configuration blockers remain.`,
  );
  write(
    "Still verify hosted lifecycle evidence, deployment protection, direct webhook delivery, email, Store publication and owner/legal sign-off separately. Keep live billing disabled.",
  );
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = runReleaseReadiness().configurationReady ? 0 : 1;
