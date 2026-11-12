import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const serverPath = new URL("../../src/server.ts", import.meta.url);
const source = await readFile(serverPath, "utf8");
const provider = await readFile(new URL("../../src/lib/ai-provider.ts", import.meta.url), "utf8");

assert.match(
  source,
  /async function requireCompanionEntitlement\(/,
  "Companion endpoints must share one server-side entitlement guard",
);
const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true);
for (const name of ["handleDashboardAI", "handleAnalyzeScreenshot", "handleStudyWorkspace"]) {
  const handler = ast.statements.find((node) => node.name?.text === name);
  assert.ok(handler, `Expected Companion entry point ${name}`);
  assert.match(
    handler.getText(ast),
    /await requireCompanionEntitlement\(request\)/,
    `${name} must invoke the shared server-side Companion entitlement guard`,
  );
}
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
  source.indexOf("async function aiTextCompletion"),
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
assert.match(provider, /new AiProviderError\(\s*"AI_RATE_LIMITED",\s*429,/);
assert.match(source, /error instanceof AiProviderError/);
assert.match(source, /retryable: error\.retryable/);
assert.match(source, /"retry-after": String\(error\.retryAfterSeconds\)/);
assert.doesNotMatch(
  source.slice(
    source.indexOf("async function handleAnalyzeScreenshot"),
    source.indexOf("async function handleCreateCheckoutSession"),
  ),
  /mock answer for testing/,
  "Screenshot analysis must never return believable mock academic output",
);

console.log("Backend Companion guard and timeout assertions passed.");
