import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Test the emitted deployment artifact, not a source mock. The subprocess gets
// no inherited credentials; its fetch stub rejects every non-fixture request.
if (!process.argv.includes("--isolated")) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--isolated"], {
    env: { PATH: process.env.PATH, NODE_ENV: "production" },
    stdio: "inherit",
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const root = new URL("../", import.meta.url);
const readJson = async (relative) => JSON.parse(await readFile(new URL(relative, root), "utf8"));
const deployment = await readJson("vercel.json");
assert.equal(deployment.buildCommand, "npm run build:vercel");
assert.equal(deployment.installCommand, "npm ci");
assert.equal(deployment.framework, null);
assert.equal(deployment.alias, undefined, "Preview config must not bind production domains");
const pkg = await readJson("package.json");
assert.equal(pkg.scripts.build, "vite build", "Cloudflare build remains unchanged");
assert.match(pkg.scripts.preview, /^wrangler dev /);

const output = await readJson(".vercel/output/config.json");
assert.equal(output.version, 3);
assert.ok(output.routes.some((route) => route.handle === "filesystem"));
assert.ok(output.routes.some((route) => route.src === "/(.*)" && route.dest === "/__server"));
const functionConfig = await readJson(".vercel/output/functions/__server.func/.vc-config.json");
assert.equal(functionConfig.runtime, "nodejs22.x");
assert.equal(functionConfig.maxDuration, 120);
assert.equal(functionConfig.supportsResponseStreaming, true);

let isPro = false;
const unexpectedRequests = [];
globalThis.fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.origin === "https://synthetic.invalid") {
    if (url.pathname === "/auth/v1/user")
      return Response.json({ id: "10000000-0000-4000-8000-000000000001" });
    if (url.pathname === "/rest/v1/profiles") return Response.json([{ is_pro: isPro }]);
  }
  unexpectedRequests.push(`${url.origin}${url.pathname}`);
  throw new Error("External traffic is prohibited in build verification");
};
const { default: handler } = await import(
  new URL(".vercel/output/functions/__server.func/index.mjs", root)
);
assert.equal(typeof handler.fetch, "function");
const request = (route, body, authenticated = false) =>
  handler.fetch(
    new Request(`https://preview.invalid${route}`, {
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(authenticated ? { authorization: "Bearer synthetic-token" } : {}),
      },
    }),
    { waitUntil() {} },
  );

const health = await request("/api/health");
assert.equal(health.status, 503);
assert.deepEqual(await health.json(), { status: "configuration_required", ai: "paused" });
assert.equal(health.headers.get("x-frame-options"), "DENY");
assert.equal(health.headers.get("cache-control"), "no-store");
assert.equal((await request("/api/readiness")).status, 404);

process.env.VITE_SUPABASE_URL = "https://synthetic.invalid";
process.env.VITE_SUPABASE_ANON_KEY = "synthetic-public-key";
assert.equal((await request("/api/health")).status, 200);
const routes = [
  ["/api/dashboard-ai", { type: "companion-chat", message: "Explain this sentence" }],
  ["/api/analyze-screenshot", { imageBase64: "data:image/png;base64,AAAA" }],
];
for (const [route, body] of routes) {
  assert.equal((await request(route, body)).status, 401, `${route} requires authentication`);
  const free = await request(route, body, true);
  assert.equal(free.status, 403, `${route} rejects Free users`);
  assert.equal((await free.json()).code, "PRO_REQUIRED");
}
isPro = true;
process.env.OPENAI_API_KEY = "synthetic-never-sent";
for (const [route, body] of routes) {
  const protectedResponse = await request(route, body, true);
  assert.equal(protectedResponse.status, 503, `${route} must retain production protection`);
  assert.equal((await protectedResponse.json()).code, "AI_CAPACITY_UNAVAILABLE");
}
const billing = await request("/api/billing-status?reconcile=false", undefined, true);
assert.equal(billing.status, 200);
assert.equal((await billing.json()).isPro, true);

// Exercise the TanStack SSR fallback after the custom API dispatcher too.
const home = await request("/");
assert.equal(home.status, 200);
assert.match(home.headers.get("content-type"), /text\/html/);
assert.match(await home.text(), /UniMate/);
assert.deepEqual(unexpectedRequests, [], "No paid or remote services may be contacted");
console.log(
  "PASS Vercel artifact: SSR, custom APIs, auth, Free/Pro, fail-closed quotas, no network",
);
// SSR imports may leave client-library refresh timers alive. All assertions
// and response bodies are complete; the isolated worker must not become a daemon.
process.exit(0);
