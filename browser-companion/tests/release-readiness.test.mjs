import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildReleaseReadiness,
  runReleaseReadiness,
  RELEASE_PRO_CONTRACT,
} from "../../scripts/release-readiness.mjs";

// Invented offline fixtures only. Importing the evaluator never reads .env files.
const env = {
  VITE_SUPABASE_URL: "https://offline-fixture.supabase.co",
  VITE_SUPABASE_ANON_KEY: "publishable-offline-fixture",
  OPENAI_API_KEY: "provider-offline-fixture",
  STRIPE_SECRET_KEY: "sk_test_fixture",
  STRIPE_PRICE_ID: "price_fixture",
  STRIPE_WEBHOOK_SECRET: "whsec_fixture",
  SUPABASE_SERVICE_ROLE_KEY: "server-offline-fixture",
  OPERATIONS_READINESS_KEY: "operations-fixture-".repeat(3),
  AI_USAGE_HASH_SECRET: "usage-fixture-".repeat(3),
  UNIMATE_CANONICAL_ORIGIN: "https://release.example.com",
  AI_DURABLE_QUOTAS_ENABLED: "true",
  AI_DURABLE_ENTITLEMENTS_ENABLED: "true",
  STRIPE_LIVE_MODE_ENABLED: "false",
  ALLOW_DEV_PRO_OVERRIDES: "false",
  STRIPE_PAST_DUE_GRACE_ENABLED: "true",
  VITE_COMPANION_STORE_URL: `https://chromewebstore.google.com/detail/offline-fixture/${"a".repeat(32)}`,
};
const check = (values, name) =>
  buildReleaseReadiness(values).checks.find((row) => row.name === name).pass;
const report = buildReleaseReadiness(env);
assert.equal(report.configurationReady, true);
assert.equal(report.blockingCount, 0);
assert.equal(report.launchCertified, false);
assert.equal(report.scope, "configuration_only");
const safe = JSON.stringify(report);
for (const value of Object.values(env).filter(
  (value) => value.includes("fixture") || value.includes("example.com"),
))
  assert.ok(
    !safe.includes(value),
    "No credential, URL or supplied input value may appear in reports",
  );
assert.equal(
  check({ ...env, STRIPE_SECRET_KEY: "rk_test_fixture" }, "Stripe test configuration"),
  true,
);

for (const origin of [
  "https://user:password@release.example.com",
  "https://release.example.com/upgrade",
  "https://release.example.com?private=token",
  "https://release.example.com#private",
  "https://localhost",
  "https://a.localhost",
  "https://a.local",
  "https://a.internal",
  "https://localhost.",
  "https://a.local.",
  "https://a..com",
  "https://-example.com",
  "https://example-.com",
  `https://${"a".repeat(64)}.com`,
  "https://127.0.0.2",
  "https://10.0.0.1",
  "https://[::1]",
  "https://2130706433",
  "http://release.example.com",
  "https://release.example.com:8443",
  "https://release.example.com:443",
  " https://release.example.com",
  "https://release.example.com ",
  "https://intranet",
  "not-a-url",
])
  assert.equal(
    check({ ...env, UNIMATE_CANONICAL_ORIGIN: origin }, "Canonical release origin"),
    false,
    origin,
  );
assert.equal(
  check(
    { ...env, UNIMATE_CANONICAL_ORIGIN: `${env.UNIMATE_CANONICAL_ORIGIN}/` },
    "Canonical release origin",
  ),
  true,
);
for (const flag of [undefined, "true", "TRUE", " false "])
  assert.equal(
    check({ ...env, STRIPE_LIVE_MODE_ENABLED: flag }, "Live billing safety lock"),
    false,
  );
for (const key of ["sk_live_fixture", "rk_live_fixture"])
  assert.equal(buildReleaseReadiness({ ...env, STRIPE_SECRET_KEY: key }).configurationReady, false);
for (const values of [
  { ALLOW_DEV_PRO_OVERRIDES: "true" },
  { ALLOW_DEV_PRO_OVERRIDES: "TRUE" },
  { DEV_PRO_USER_IDS: "10000000-0000-4000-8000-000000000001" },
])
  assert.equal(check({ ...env, ...values }, "Release entitlement overrides disabled"), false);
for (const values of [
  { STRIPE_PRO_MONTHLY_AMOUNT_CENTS: "999" },
  { STRIPE_PRO_MONTHLY_AMOUNT_CENTS: "0" },
  { STRIPE_PRO_MONTHLY_AMOUNT_CENTS: "NaN" },
  { STRIPE_PRO_CURRENCY: "eur" },
])
  assert.equal(
    check({ ...env, ...values }, "Advertised Pro price matches server expectation"),
    false,
  );
for (const flag of [undefined, "", "yes", "FALSE", "false "])
  assert.equal(
    check({ ...env, STRIPE_PAST_DUE_GRACE_ENABLED: flag }, "Explicit past-due grace configuration"),
    false,
  );
for (const flag of ["true", "false"])
  assert.equal(
    check({ ...env, STRIPE_PAST_DUE_GRACE_ENABLED: flag }, "Explicit past-due grace configuration"),
    true,
  );
assert.equal(buildReleaseReadiness({}).configurationReady, false);

// Keep the offline price guard tied to the current customer-facing contract;
// changing a launch price requires updating both deliberately.
const catalog = await fs.readFile(
  new URL("../../src/lib/plan-catalog.ts", import.meta.url),
  "utf8",
);
assert.ok(
  catalog.includes(`monthlyPrice: "$${(RELEASE_PRO_CONTRACT.amountCents / 100).toFixed(2)}"`),
);
assert.equal(RELEASE_PRO_CONTRACT.currency, "usd");

// CLI formatting and local/process precedence use a generated fixture directory,
// never the actual workspace .env or private sandbox files.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-readiness-offline-"));
try {
  await fs.writeFile(path.join(root, ".env.local"), "STRIPE_LIVE_MODE_ENABLED=true\n", {
    mode: 0o600,
  });
  const lines = [];
  const result = runReleaseReadiness({ root, environment: env, write: (line) => lines.push(line) });
  assert.equal(
    result.configurationReady,
    true,
    "Explicit process config must override local defaults",
  );
  assert.match(lines.join("\n"), /Configuration preflight only/);
  assert.match(lines.join("\n"), /no provider calls or public-launch certification/);
  assert.doesNotMatch(lines.join("\n"), /0 launch blockers|ready to launch/i);
  for (const value of Object.values(env).filter((value) => value.includes("fixture")))
    assert.ok(!lines.join("\n").includes(value));
  const blocked = runReleaseReadiness({
    root,
    environment: { ...env, STRIPE_LIVE_MODE_ENABLED: "true" },
    write: () => {},
  });
  assert.equal(blocked.configurationReady, false);
} finally {
  await fs.rm(root, { recursive: true });
}
console.log(
  "PASS configuration-only release preflight: safe origins, locked billing, explicit grace, price alignment, no Pro overrides and secret-free output",
);
