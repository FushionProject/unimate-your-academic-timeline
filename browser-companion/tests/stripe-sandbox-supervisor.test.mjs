import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import picomatch from "picomatch";
import {
  environments,
  captureSecret,
  supervise,
  LISTEN_ARGS,
  deliverySummary,
  listenerFailureCode,
  PRIVATE_FS_DENY,
} from "../../scripts/run-stripe-sandbox.mjs";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";

const key = "sk_" + "test_fixture";
assert.equal(
  deliverySummary("2026-10-14 --> customer.subscription.updated [evt_private]"),
  "Webhook event: customer.subscription.updated.",
);
assert.equal(
  deliverySummary(
    "2026-10-14 <-- [200] POST http://localhost:8080/api/stripe-webhook [evt_private]",
  ),
  "Webhook delivery status: 200.",
);
assert.equal(deliverySummary("private email secret raw payload"), null);
assert.equal(deliverySummary("--> unknown.event [evt_private]"), null);
assert.equal(listenerFailureCode("unknown flag: secretvalue"), "STRIPE_LISTENER_ARGUMENT_REJECTED");
assert.equal(
  listenerFailureCode("Invalid API Key provided: secretvalue"),
  "STRIPE_LISTENER_AUTH_REJECTED",
);
assert(PRIVATE_FS_DENY.includes("**/.stripe-sandbox.local/**"));
// Match Vite's resolved fsDenyGlob construction, including basename expansion.
const denied = picomatch(
  PRIVATE_FS_DENY.map((pattern) => (pattern.includes("/") ? pattern : `**/${pattern}`)),
  { dot: true },
);
const repository = new URL("../../", import.meta.url).pathname;
for (const suffix of [
  ".dev.vars",
  "dist/server/.dev.vars",
  "dist/server/worker.js",
  ".stripe-sandbox.local/test-user.json",
  ".vercel/output/functions/index.func/.env",
  ".private-backups/backup.dump",
  ".env.local",
])
  assert(denied(repository + suffix));
assert(!denied(repository + "node_modules/example/dist/client.js"));
assert(LISTEN_ARGS.includes("--events"));
const secret = "whsec_" + "synthetic01234567890123456789";
const config = {
  supa: {
    VITE_SUPABASE_URL: TARGET.supabase,
    VITE_SUPABASE_ANON_KEY: "sb_publishable_fixture",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture",
  },
  stripe: {
    STRIPE_SECRET_KEY: key,
    STRIPE_PRICE_ID: TARGET.price,
    STRIPE_LIVE_MODE_ENABLED: "false",
  },
};
const env = environments(config, secret, {
  HOME: "/synthetic",
  PATH: "/bin",
  OPENAI_API_KEY: "never",
  DEBUG: "*",
  NODE_OPTIONS: "evil",
  VITE_SECRET_KEY: "never",
  STRIPE_LIVE_MODE_ENABLED: "true",
});
assert.deepEqual(Object.keys(env.listener).sort(), ["HOME", "PATH", "STRIPE_API_KEY"]);
assert.equal(env.vite.AI_SYSTEM_MODE, "degraded");
assert.equal(env.vite.AI_SCREENSHOT_ENABLED, "false");
assert.equal(env.vite.AI_WEB_SEARCH_ENABLED, "false");
assert.equal(env.vite.SERPAPI_KEY, "");
assert.equal(env.vite.STRIPE_LIVE_MODE_ENABLED, "false");
assert.equal(env.vite.OPENAI_API_KEY, "");
assert.equal(env.vite.ALLOW_DEV_PRO_OVERRIDES, "false");
assert.equal(env.vite.SIGNUPS_ENABLED, "false");
assert.equal(env.vite.DEBUG, undefined);
assert.equal(env.vite.NODE_OPTIONS, undefined);
assert.equal(env.vite.VITE_SECRET_KEY, undefined);
assert.deepEqual(
  Object.keys(env.vite)
    .filter((k) => k.startsWith("VITE_"))
    .sort(),
  ["VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_URL"],
);
assert(!LISTEN_ARGS.includes("--live"));
assert(LISTEN_ARGS.includes("@self"));
assert(LISTEN_ARGS.includes("unimate-sandbox"));
assert.throws(() =>
  environments(
    { ...config, stripe: { ...config.stripe, STRIPE_LIVE_MODE_ENABLED: "true" } },
    secret,
  ),
);
assert.throws(() =>
  environments(
    { ...config, stripe: { ...config.stripe, STRIPE_SECRET_KEY: "sk_" + "live_fixture" } },
    secret,
  ),
);
assert.throws(() =>
  environments(
    { ...config, supa: { ...config.supa, VITE_SUPABASE_ANON_KEY: "sb_secret_fixture" } },
    secret,
  ),
);
const child = () => {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.exitCode = null;
  c.pid = 100;
  c.kills = [];
  c.kill = (signal) => {
    c.kills.push(signal);
    c.exitCode = 0;
    queueMicrotask(() => c.emit("exit", 0));
    return true;
  };
  return c;
};
const fragmented = child();
const captured = captureSecret(fragmented);
fragmented.stdout.emit("data", `private data ${secret.slice(0, 15)}`);
fragmented.stdout.emit("data", `${secret.slice(15)}\n`);
assert.equal(await captured, secret);
const timeout = child();
await assert.rejects(captureSecret(timeout, 5), /STRIPE_LISTENER_START_FAILED/);
let verified = 0;
let checked = 0;
const children = [];
const logs = [];
const signals = new EventEmitter();
const done = supervise({
  approved: true,
  verify: async (options) => {
    verified++;
    assert.equal(options.verificationOnly, true);
    return config;
  },
  portCheck: async () => {
    checked++;
  },
  signals,
  report: (message) => logs.push(message),
  spawnImpl: (command, args, options) => {
    assert.equal(verified, 1);
    const c = child();
    children.push(c);
    assert.equal(options.shell, false);
    assert(!args.some((a) => a.includes(key) || a.includes(secret)));
    if (command === "stripe")
      queueMicrotask(() => c.stderr.emit("data", `private email + event + ${secret}\n`));
    else {
      assert.equal(options.env.STRIPE_WEBHOOK_SECRET, secret);
      queueMicrotask(() => {
        c.stdout.emit("data", "private provider payload");
        c.emit("message", "ready");
        signals.emit("SIGTERM");
      });
    }
    return c;
  },
});
await done;
assert.equal(checked, 2);
assert.equal(children.length, 2);
assert(children.every((c) => c.kills.includes("SIGTERM")));
assert(logs.some((line) => line.includes("ready")));
assert(!logs.join().includes(secret));
assert(!logs.join().includes("private provider"));
assert(!logs.join().includes("private email"));
await assert.rejects(
  supervise({
    approved: false,
    verify: () => assert.fail("must not read config"),
    portCheck: () => assert.fail("must not bind"),
  }),
  /EXPLICIT_LISTENER_APPROVAL_REQUIRED/,
);
await assert.rejects(
  supervise({
    approved: true,
    portCheck: async () => {
      throw new Error("port busy");
    },
    verify: () => assert.fail("must not read config"),
  }),
  /port busy/,
);
console.log(
  "PASS: sandbox supervisor test-only flags, private environment allowlist, split secret capture, output suppression, port/approval gates, and owned-child shutdown (offline).",
);
