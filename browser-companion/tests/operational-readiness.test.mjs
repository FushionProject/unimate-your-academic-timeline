import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildOperationalReadiness,
  readinessKeyMatches,
} from "../../src/lib/operational-readiness.ts";

const source = fs.readFileSync(
  new URL("../../src/lib/operational-readiness.ts", import.meta.url),
  "utf8",
);
const server = fs.readFileSync(new URL("../../src/server.ts", import.meta.url), "utf8");

assert.match(source, /never environment values, key fragments, project URLs/);
assert.doesNotMatch(source, /slice\([^)]*key|substring\([^)]*key/i);
assert.match(source, /startsWith\("sk_test_"\)/);
assert.match(source, /startsWith\("sk_live_"\)/);
assert.match(source, /provided\.length !== expected\.length/);
assert.match(source, /mismatch \|=/);
assert.match(server, /url\.pathname === "\/api\/readiness"/);
assert.match(server, /x-unimate-readiness-key/);
assert.match(server, /\{ error: "Not found" \}, 404/);
assert.match(server, /"cache-control": "no-store"/);
assert.doesNotMatch(server, /OPERATIONS_READINESS_KEY[^\n]*(console|JSON\.stringify)/);

const report = buildOperationalReadiness(
  {
    VITE_SUPABASE_URL: "https://private-project.supabase.co",
    VITE_SUPABASE_ANON_KEY: "publishable-private-value",
    GROQ_API_KEY: "provider-private-value",
    SUPABASE_SERVICE_ROLE_KEY: "server-only-private-value",
    AI_DURABLE_QUOTAS_ENABLED: "true",
    AI_DURABLE_ENTITLEMENTS_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_private-value",
  },
  new Date("2026-08-11T12:00:00.000Z"),
);
const serialized = JSON.stringify(report);
assert.equal(report.status, "configuration_ready");
assert.equal(report.billingMode, "test");
assert.ok(!serialized.includes("private"), "readiness output must not contain input values");
const readinessKey = "correct-readiness-key-at-least-32-chars";
assert.equal(readinessKeyMatches(readinessKey, readinessKey), true);
assert.equal(readinessKeyMatches("wrong-key", readinessKey), false);
assert.equal(readinessKeyMatches(null, readinessKey), false);
assert.equal(readinessKeyMatches("short", "short"), false);

console.log("PASS privacy-safe operational readiness checks");
