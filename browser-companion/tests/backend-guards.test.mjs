import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const serverPath = new URL("../../src/server.ts", import.meta.url);
const source = await readFile(serverPath, "utf8");

assert.match(
  source,
  /async function requireCompanionEntitlement\(/,
  "Companion endpoints must share one server-side entitlement guard",
);
assert.equal(
  source.match(/await requireCompanionEntitlement\(request\)/g)?.length,
  2,
  "Both Companion entry points must invoke the shared entitlement guard",
);
assert.match(
  source,
  /id=eq\.\$\{encodeURIComponent\(\s*authResult\.id,\s*\)\}/,
  "The entitlement lookup must be bound to the validated Auth user id",
);
assert.match(source, /code: "AUTH_REQUIRED", phase: "authentication"/);
assert.match(source, /code: "PRO_REQUIRED", phase: "entitlement"/);
assert.match(
  source,
  /"PRO_REQUIRED", phase: "entitlement" \},\s*403/,
  "Free users must receive a typed 403 rather than the former 402",
);

for (const code of ["AUTH_TIMEOUT", "ENTITLEMENT_TIMEOUT", "AI_TIMEOUT", "AI_NOT_CONFIGURED"]) {
  assert.ok(source.includes(`"${code}"`), `Expected typed ${code} handling`);
}
assert.match(
  source,
  /async function fetchWithTimeout[\s\S]*new AbortController\(\)[\s\S]*clearTimeout\(timer\)/,
  "Upstream calls must use AbortController and always clear their timers",
);
assert.match(
  source,
  /clientSignal\?\.addEventListener\("abort"[\s\S]*clientSignal\?\.removeEventListener/,
  "Client abandonment must cancel upstream work without leaking listeners",
);
const textCompletionSource = source.slice(
  source.indexOf("async function groqTextCompletion"),
  source.indexOf("async function handleDashboardAI"),
);
const visionSource = source.slice(
  source.indexOf("async function handleAnalyzeScreenshot"),
  source.indexOf("async function handleCreateCheckoutSession"),
);
assert.match(
  textCompletionSource,
  /fetchWithTimeout\([\s\S]*AI_PROVIDER_TIMEOUT_MS,/,
  "Companion text-model calls must have a bounded timeout",
);
assert.match(
  visionSource,
  /fetchWithTimeout\([\s\S]*AI_PROVIDER_TIMEOUT_MS,/,
  "Companion vision-model calls must have a bounded timeout",
);
assert.match(source, /code: "AI_RATE_LIMITED"[\s\S]*429/);
assert.doesNotMatch(
  source.slice(
    source.indexOf("async function handleAnalyzeScreenshot"),
    source.indexOf("async function handleCreateCheckoutSession"),
  ),
  /mock answer for testing/,
  "Screenshot analysis must never return believable mock academic output",
);

console.log("Backend Companion guard and timeout assertions passed.");
