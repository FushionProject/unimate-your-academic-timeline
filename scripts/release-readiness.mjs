import fs from "node:fs";
import path from "node:path";

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

const root = process.cwd();
const localPath = path.join(root, ".env.local");
const local = fs.existsSync(localPath) ? parseEnv(fs.readFileSync(localPath, "utf8")) : {};
const env = { ...local, ...process.env };
const checks = [];
const add = (name, pass, detail, blocker = true) => checks.push({ name, pass, detail, blocker });
const configured = (name) => Boolean(env[name]?.trim());

add(
  "Supabase browser configuration",
  configured("VITE_SUPABASE_URL") && configured("VITE_SUPABASE_ANON_KEY"),
  "VITE_SUPABASE_URL and the publishable key must be configured.",
);
add("AI provider configuration", configured("GROQ_API_KEY"), "GROQ_API_KEY must be configured.");
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
  (env.OPERATIONS_READINESS_KEY?.trim().length || 0) >= 32 &&
    (env.AI_USAGE_HASH_SECRET?.trim().length || 0) >= 32,
  "Both privacy-safe operations secrets must contain at least 32 characters.",
);
add(
  "Canonical production origin",
  (() => {
    try {
      const url = new URL(env.UNIMATE_CANONICAL_ORIGIN || "");
      return url.protocol === "https:" && !["localhost", "127.0.0.1"].includes(url.hostname);
    } catch {
      return false;
    }
  })(),
  "UNIMATE_CANONICAL_ORIGIN must be a non-local HTTPS URL.",
);
add(
  "Durable capacity enforcement",
  env.AI_DURABLE_QUOTAS_ENABLED === "true" && env.AI_DURABLE_ENTITLEMENTS_ENABLED === "true",
  "Enable only after both reviewed AI migrations pass staging verification.",
);
add(
  "Live billing safety lock",
  env.STRIPE_LIVE_MODE_ENABLED !== "true" && !/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY || ""),
  "Release verification requires Stripe to remain in test mode.",
);
add(
  "Browser Companion Store listing",
  /^https:\/\/chromewebstore\.google\.com\//.test(env.VITE_COMPANION_STORE_URL || ""),
  "Add the approved Store listing URL after submission.",
  false,
);

for (const check of checks) {
  console.log(`${check.pass ? "PASS" : "BLOCKED"} ${check.name} — ${check.detail}`);
}
const blocking = checks.filter((check) => check.blocker && !check.pass);
console.log(
  `\n${checks.length - blocking.length}/${checks.length} checks are non-blocking; ${blocking.length} launch blockers remain.`,
);
process.exitCode = blocking.length ? 1 : 0;
