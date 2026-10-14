import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Execute the emitted fetch handler with synthetic transport, not a deployment
// or an authenticated Workers environment. No credentials are inherited.
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
const config = JSON.parse(await readFile(new URL("dist/server/wrangler.json", root), "utf8"));
assert.equal(config.name, "unimate");
assert.equal(config.main, "index.js");
assert.equal(config.compatibility_date, "2025-09-24");
assert.deepEqual(config.compatibility_flags, ["nodejs_compat"]);
assert.equal(config.assets.directory, "../client");
assert.deepEqual(config.vars, {});
const assets = await readdir(new URL("dist/client/assets/", root));
assert(assets.some((name) => /^styles-.*\.css$/.test(name)));
assert(assets.some((name) => /^index-.*\.js$/.test(name)));

const unexpected = [];
globalThis.fetch = async (input) => {
  unexpected.push(typeof input === "string" ? input : input.url);
  throw new Error("External traffic prohibited in artifact verification");
};
const { default: worker } = await import(new URL("dist/server/index.js", root));
assert.equal(typeof worker.fetch, "function");
const request = (pathname, body) =>
  worker.fetch(
    new Request(`https://preview.invalid${pathname}`, {
      ...(body
        ? {
            method: "POST",
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }
        : {}),
    }),
    {},
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
assert.equal(
  (await request("/api/dashboard-ai", { type: "companion-chat", message: "Explain" })).status,
  401,
);
const home = await request("/");
assert.equal(home.status, 200);
assert.match(home.headers.get("content-type"), /text\/html/);
const html = await home.text();
assert.match(html, /UniMate/);
assert.match(html, /type="module"/);
assert.match(html, /\/assets\/styles-.*?\.css/);
assert.deepEqual(unexpected, []);
console.log(
  "PASS Cloudflare artifact: preserved Worker config, CSS/client assets, custom API/auth, SSR, no network",
);
process.exit(0);
