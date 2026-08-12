import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [server, policy] = await Promise.all([
  readFile(new URL("../../src/server.ts", import.meta.url), "utf8"),
  readFile(new URL("../../src/lib/ai-entitlements.ts", import.meta.url), "utf8"),
]);

assert.match(server, /const requestId = crypto\.randomUUID\(\)/);
assert.doesNotMatch(server, /requestIdFor\(options\.request\)/);
assert.match(server, /feature: "syllabus"/);
assert.match(server, /feature: "text"/);
assert.match(server, /feature: "screenshot"/);
assert.match(server, /capacityFeature: "browser_companion"/);
assert.match(server, /code: "PRO_REQUIRED"/);
assert.match(server, /code: entitlement\.code \|\| "ENTITLEMENT_UNAVAILABLE"/);
assert.match(policy, /reserve_ai_entitlement_usage/);
assert.match(policy, /AI_DURABLE_ENTITLEMENTS_ENABLED/);

console.log("AI entitlement server wiring assertions passed.");
