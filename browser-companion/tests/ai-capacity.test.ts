import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  aiFeatureEnabled,
  aiSystemMode,
  capacityAdminEnabled,
  capacityErrorPayload,
  durableQuotasEnabled,
  needsWebSearch,
  quotaOverrideEnabled,
  requestIdFor,
  reserveAiCapacity,
} from "../../src/lib/ai-capacity.ts";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function resetEnv() {
  process.env = { ...originalEnv };
  delete process.env.AI_SYSTEM_MODE;
  delete process.env.AI_DURABLE_QUOTAS_ENABLED;
  delete process.env.AI_USAGE_ADMIN_USER_IDS;
  delete process.env.AI_QUOTA_OVERRIDE_USER_IDS;
}

try {
  resetEnv();
  assert.equal(aiSystemMode(), "normal");
  assert.equal(needsWebSearch("Solve 2x + 4 = 10"), false);
  assert.equal(needsWebSearch("What is the latest federal student aid rule?"), true);
  assert.equal(needsWebSearch("Search for a source about this"), true);

  process.env.AI_SYSTEM_MODE = "degraded";
  assert.equal(aiFeatureEnabled("web_search"), false);
  assert.equal(aiFeatureEnabled("screenshot"), false);
  process.env.AI_SYSTEM_MODE = "off";
  const off = await reserveAiCapacity({
    request: new Request("https://unimate.test/api/ask-unimate"),
    userId: "00000000-0000-4000-8000-000000000001",
    feature: "ask_unimate",
    entitlement: "free",
    input: "test",
  });
  assert.equal(off.allowed, false);
  assert.equal(off.code, "AI_SYSTEM_UNAVAILABLE");

  resetEnv();
  assert.equal(durableQuotasEnabled(), false);
  const requestId = "00000000-0000-4000-8000-000000000010";
  assert.equal(
    requestIdFor(
      new Request("https://unimate.test", { headers: { "X-UniMate-Request-Id": requestId } }),
    ),
    requestId,
  );

  process.env.AI_USAGE_ADMIN_USER_IDS = "user-a,user-b";
  process.env.AI_QUOTA_OVERRIDE_USER_IDS = "user-c";
  assert.equal(capacityAdminEnabled("user-b"), true);
  assert.equal(capacityAdminEnabled("user-c"), false);
  assert.equal(quotaOverrideEnabled("user-c"), true);

  process.env.AI_DURABLE_QUOTAS_ENABLED = "true";
  process.env.VITE_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.p_daily_limit, 20);
    assert.equal(body.p_feature, "ask_unimate");
    return new Response(
      JSON.stringify({
        allowed: calls === 1,
        code: calls === 1 ? "ALLOWED" : "FREE_DAILY_LIMIT_REACHED",
        retry_after_seconds: calls === 1 ? 0 : 120,
        daily_used: 20,
        daily_limit: 20,
      }),
      { status: 200 },
    );
  };
  const options = {
    request: new Request("https://unimate.test", {
      headers: { "X-UniMate-Request-Id": requestId },
    }),
    userId: "00000000-0000-4000-8000-000000000001",
    feature: "ask_unimate" as const,
    entitlement: "free" as const,
    input: "question",
  };
  const allowed = await reserveAiCapacity(options);
  const denied = await reserveAiCapacity({
    ...options,
    request: new Request("https://unimate.test"),
  });
  assert.equal(allowed.allowed, true);
  assert.equal(denied.allowed, false);
  assert.equal(capacityErrorPayload(denied).status, 429);
  assert.equal(capacityErrorPayload(denied).headers["retry-after"], "120");

  const seen = new Set<string>();
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const duplicate = seen.has(body.p_request_id);
    seen.add(body.p_request_id);
    await new Promise((resolve) => setTimeout(resolve, 2));
    return new Response(
      JSON.stringify({
        allowed: !duplicate,
        code: duplicate ? "DUPLICATE_IN_FLIGHT" : "ALLOWED",
        retry_after_seconds: duplicate ? 2 : 0,
      }),
    );
  };
  const duplicateRequest = new Request("https://unimate.test", {
    headers: { "X-UniMate-Request-Id": "00000000-0000-4000-8000-000000000099" },
  });
  const duplicateResults = await Promise.all([
    reserveAiCapacity({ ...options, request: duplicateRequest.clone() }),
    reserveAiCapacity({ ...options, request: duplicateRequest.clone() }),
  ]);
  assert.equal(duplicateResults.filter((result) => result.allowed).length, 1);
  const parallelResults = await Promise.all(
    Array.from({ length: 25 }, () =>
      reserveAiCapacity({ ...options, request: new Request("https://unimate.test") }),
    ),
  );
  assert.equal(
    parallelResults.every((result) => result.allowed),
    true,
  );

  const migration = await readFile("SUPABASE_USAGE_MIGRATION.sql", "utf8");
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on function public\.reserve_ai_usage[\s\S]*authenticated/);
  assert.match(migration, /unique \(user_id, request_id\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);

  console.log("AI capacity tests passed");
} finally {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
}
