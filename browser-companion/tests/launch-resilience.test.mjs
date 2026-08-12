import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [server, auth, planner, pdf, envExample] = await Promise.all([
  readFile(new URL("../../src/server.ts", import.meta.url), "utf8"),
  readFile(new URL("../../src/lib/auth-context.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../src/routes/planner.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../src/lib/pdf.ts", import.meta.url), "utf8"),
  readFile(new URL("../../.env.example", import.meta.url), "utf8"),
]);

assert.match(server, /MAX_AI_CONCURRENCY/);
assert.match(server, /withAiProviderCapacity/);
assert.match(server, /\/api\/signup-status/);
assert.match(server, /readRequestTextLimited/);
assert.match(server, /MAX_CANVAS_RESPONSE_BYTES/);
assert.match(server, /ai: aiReady \? "ready" : "paused"/);
assert.match(auth, /fetch\("\/api\/signup-status"/);
assert.match(planner, /MAX_PDF_BYTES/);
assert.match(pdf, /MAX_PDF_PAGES/);
assert.match(envExample, /SIGNUPS_ENABLED=true/);
assert.match(envExample, /MAX_AI_CONCURRENCY=8/);

console.log("Launch resilience guard checks passed.");
