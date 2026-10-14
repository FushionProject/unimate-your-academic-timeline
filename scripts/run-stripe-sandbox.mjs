// Operator-only local supervisor. No raw child output is ever forwarded.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareSandbox, SetupError, TARGET } from "./prepare-stripe-sandbox.mjs";

const SELF = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const LISTEN_ARGS = Object.freeze([
  "--project-name",
  "unimate-sandbox",
  "--color",
  "off",
  "listen",
  "--skip-update",
  "--events-from",
  "@self",
  "--events",
  "checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.paused,customer.subscription.resumed,invoice.paid,invoice.payment_failed,invoice.payment_action_required,charge.refunded,charge.dispute.created,charge.dispute.closed",
  "--forward-to",
  "http://localhost:8080/api/stripe-webhook",
]);
const fail = (code) => {
  throw new SetupError(code);
};
export const PRIVATE_FS_DENY = [
  ".env",
  ".env.*",
  "*.{crt,pem}",
  "**/.git/**",
  "**/.stripe-sandbox.local/**",
  "**/.private-backups/**",
  "**/.vercel/**",
  "**/.codex/**",
  "**/.agents/**",
  "**/.dev.vars*",
  `${ROOT}dist/**`,
  "**/.output/**",
  "**/.wrangler/**",
];
const EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
]);
export function deliverySummary(line) {
  const clean = line.replace(/\x1b\[[0-9;]*m/g, "");
  const event = clean.match(/-->\s+([a-z_.]+)\s+\[evt_[A-Za-z0-9]+\]/)?.[1];
  if (EVENTS.has(event)) return `Webhook event: ${event}.`;
  const status = clean.match(/<--\s+\[([1-5][0-9]{2})\]\s+POST\s/)?.[1];
  return status ? `Webhook delivery status: ${status}.` : null;
}
export function listenerFailureCode(buffer) {
  if (/unknown flag|unknown command|invalid argument|must specify events/i.test(buffer))
    return "STRIPE_LISTENER_ARGUMENT_REJECTED";
  if (
    /invalid.*api.key|api.key.*invalid|unauthorized|authentication|status.code.*401/i.test(buffer)
  )
    return "STRIPE_LISTENER_AUTH_REJECTED";
  if (/permission|forbidden|status.code.*403/i.test(buffer))
    return "STRIPE_LISTENER_PERMISSION_DENIED";
  if (/no such host|network|connection|timeout|dial tcp|certificate|proxy/i.test(buffer))
    return "STRIPE_LISTENER_NETWORK_FAILED";
  return "STRIPE_LISTENER_START_FAILED";
}

export function environments(config, secret, inherited = process.env) {
  const { supa, stripe } = config;
  if (
    supa.VITE_SUPABASE_URL !== TARGET.supabase ||
    !/^[sr]k_test_[A-Za-z0-9]+$/.test(stripe.STRIPE_SECRET_KEY || "") ||
    stripe.STRIPE_PRICE_ID !== TARGET.price ||
    stripe.STRIPE_LIVE_MODE_ENABLED !== "false"
  )
    fail("EXACT_TEST_CONFIG_REQUIRED");
  const anon = supa.VITE_SUPABASE_ANON_KEY || "";
  if (!anon.startsWith("sb_publishable_")) {
    let claims;
    try {
      claims = JSON.parse(Buffer.from(anon.split(".")[1], "base64url").toString());
    } catch {
      fail("PUBLIC_SUPABASE_KEY_REQUIRED");
    }
    if (claims.role !== "anon" || claims.ref !== "gtqfaxsokdlrdxipcyqo")
      fail("PUBLIC_SUPABASE_KEY_REQUIRED");
  }
  if (secret && !/^whsec_[A-Za-z0-9]{16,}$/.test(secret)) fail("WEBHOOK_SECRET_INVALID");
  const base = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG"].filter((k) => inherited[k]).map((k) => [k, inherited[k]]),
  );
  return {
    listener: { ...base, STRIPE_API_KEY: stripe.STRIPE_SECRET_KEY },
    vite: {
      ...base,
      NODE_ENV: "development",
      UNIMATE_LOCAL_SANDBOX_CHILD: "approved",
      VITE_SUPABASE_URL: TARGET.supabase,
      VITE_SUPABASE_ANON_KEY: anon,
      SUPABASE_SERVICE_ROLE_KEY: supa.SUPABASE_SERVICE_ROLE_KEY,
      STRIPE_SECRET_KEY: stripe.STRIPE_SECRET_KEY,
      STRIPE_PRICE_ID: TARGET.price,
      STRIPE_LIVE_MODE_ENABLED: "false",
      STRIPE_WEBHOOK_SECRET: secret || "",
      UNIMATE_CANONICAL_ORIGIN: "http://localhost:8080",
      // Permit auth/Pro validation in empty-request fixtures without enabling
      // paid calls: all provider credentials are absent and both features off.
      AI_SYSTEM_MODE: "degraded",
      AI_WEB_SEARCH_ENABLED: "false",
      AI_SCREENSHOT_ENABLED: "false",
      OPENAI_API_KEY: "",
      SERPAPI_KEY: "",
      ALLOW_DEV_PRO_OVERRIDES: "false",
      DEV_PRO_USER_IDS: "",
      SIGNUPS_ENABLED: "false",
    },
  };
}

export async function assertPortFree() {
  // Wildcard bind checks both loopback addresses and other listeners; no app is served.
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new SetupError("PORT_8080_NOT_FREE")));
    probe.listen({ port: 8080, exclusive: true }, () =>
      probe.close((error) => (error ? reject(new SetupError("PORT_CHECK_FAILED")) : resolve())),
    );
  });
}

export function captureSecret(child, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const finish = (error, secret) => {
      clearTimeout(timer);
      child.off("error", failed);
      child.off("exit", failed);
      child.stdout.off("data", data);
      child.stderr.off("data", data);
      buffer = "";
      error ? reject(error) : resolve(secret);
    };
    const failed = () => finish(new SetupError(listenerFailureCode(buffer)));
    const data = (chunk) => {
      buffer = (buffer + chunk.toString()).slice(-8192);
      // Require a delimiter: stream chunks may split the secret itself.
      const match = buffer.match(/\b(whsec_[A-Za-z0-9]{16,})(?=[\s\x1b])/);
      if (match) finish(null, match[1]);
    };
    const timer = setTimeout(failed, timeoutMs);
    child.stdout.on("data", data);
    child.stderr.on("data", data);
    child.once("error", failed);
    child.once("exit", failed);
  });
}

export async function supervise({
  approved = false,
  verify = prepareSandbox,
  spawnImpl = spawn,
  portCheck = assertPortFree,
  report = console.log,
  signals = process,
} = {}) {
  if (!approved) fail("EXPLICIT_LISTENER_APPROVAL_REQUIRED");
  await portCheck();
  const config = await verify({ approved: true, verificationOnly: true });
  environments(config, ""); // Validate public config before starting a stream.
  const children = [];
  let stopping = false;
  let finish;
  const stopped = new Promise((resolve) => {
    finish = resolve;
  });
  const stop = async () => {
    if (stopping) return stopped;
    stopping = true;
    await Promise.all(
      children.map(
        (child) =>
          new Promise((resolve) => {
            if (!child.pid || child.exitCode !== null || child.signalCode) return resolve();
            const timer = setTimeout(() => {
              child.kill("SIGKILL");
            }, 5000);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
            child.kill("SIGTERM");
          }),
      ),
    );
    finish();
  };
  signals.once("SIGTERM", stop);
  signals.once("SIGINT", stop);
  const start = (command, args, env, ipc = false) => {
    const child = spawnImpl(command, args, {
      cwd: ROOT,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe", ...(ipc ? ["ipc"] : [])],
    });
    children.push(child);
    // Drain and discard ALL output, including event bodies, URLs and diagnostics.
    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    child.once("error", () => {
      void stop();
    });
    child.once("exit", () => {
      if (!stopping) {
        report("Sandbox child stopped; shutting down local test processes.");
        void stop();
      }
    });
    return child;
  };
  try {
    const listener = start("stripe", LISTEN_ARGS, environments(config, "").listener);
    for (const stream of [listener.stdout, listener.stderr]) {
      let pending = "";
      stream.on("data", (chunk) => {
        pending = (pending + chunk.toString()).slice(-8192);
        const lines = pending.split(/\r?\n/);
        pending = lines.pop();
        for (const line of lines) {
          const summary = deliverySummary(line);
          if (summary) report(summary);
        }
      });
    }
    const secret = await captureSecret(listener);
    if (stopping) fail("SANDBOX_START_INTERRUPTED");
    await portCheck(); // Do not forward secrets into an already-running app.
    if (stopping) fail("SANDBOX_START_INTERRUPTED");
    const vite = start(
      process.execPath,
      [SELF, "--vite-child"],
      environments(config, secret).vite,
      true,
    );
    const readyTimeout = setTimeout(() => {
      report("Local app startup timed out; shutting down.");
      void stop();
    }, 60000);
    vite.once("exit", () => clearTimeout(readyTimeout));
    vite.on("message", (message) => {
      if (message === "ready" && !stopping) {
        clearTimeout(readyTimeout);
        report(
          "Sandbox listener and local billing app ready at http://localhost:8080. AI credentials absent, paid calls disabled; public signup disabled and child output private.",
        );
      }
    });
    await stopped;
  } finally {
    await stop();
    signals.off("SIGTERM", stop);
    signals.off("SIGINT", stop);
  }
}

async function sandboxPluginList(options) {
  const resolved = await options;
  return Array.isArray(resolved)
    ? (await Promise.all(resolved.map(sandboxPluginList))).flat()
    : resolved
      ? [resolved]
      : [];
}

export async function sandboxStartPlugins(options) {
  const plugins = await sandboxPluginList(options);
  // This pinned Start plugin ignores Vite's envDir:false and imports all keys
  // from root env files during configResolved. Remove only that known loader.
  // A changed framework plugin shape requires review, never a silent bypass.
  const loaders = plugins.filter((plugin) => plugin.name === "tanstack-start-core:load-env");
  if (loaders.length !== 1) fail("SANDBOX_ENV_PLUGIN_CHANGED");
  return plugins.filter((plugin) => plugin !== loaders[0]);
}

// Export the real config factory for offline smoke tests without opening a port
// or reading private configuration. The supervised child uses this exact path.
export async function sandboxViteConfig() {
  const { default: tailwindcss } = await import("@tailwindcss/vite");
  const { default: tsConfigPaths } = await import("vite-tsconfig-paths");
  const { tanstackStart } = await import("@tanstack/react-start/plugin/vite");
  const { default: react } = await import("@vitejs/plugin-react");
  // Deliberately independent of app configs: no env loader/defines, deployment
  // adapter, hosted-preview tooling, or code-rewriting error loggers.
  return {
    resolve: {
      alias: { "@": path.join(ROOT, "src") },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: [path.join(ROOT, "tsconfig.json")] }),
      await sandboxStartPlugins(
        tanstackStart({
          server: { entry: "server" },
          importProtection: {
            behavior: "error",
            client: { files: ["**/server/**"], specifiers: ["server-only"] },
          },
        }),
      ),
      react(),
    ],
    root: ROOT,
    configFile: false,
    envDir: false,
    mode: "sandbox",
    server: {
      host: "localhost",
      port: 8080,
      strictPort: true,
      open: false,
      watch: { awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 } },
      fs: { deny: PRIVATE_FS_DENY },
    },
  };
}

async function viteChild() {
  if (process.env.UNIMATE_LOCAL_SANDBOX_CHILD !== "approved" || !process.send)
    fail("SUPERVISOR_REQUIRED");
  // src/server.ts calls loadEnvFile during development. Disable that route so
  // unrelated AI/hosting secrets cannot bypass the supervisor's allowlist.
  process.loadEnvFile = () => {
    throw new Error("Local sandbox env files are disabled");
  };
  const { createServer } = await import("vite");
  const server = await createServer(await sandboxViteConfig());
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    process.exit(0);
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  process.once("disconnect", close);
  await server.listen();
  process.send("ready");
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const main =
    process.argv[2] === "--vite-child"
      ? viteChild
      : () =>
          supervise({
            approved:
              process.argv.length === 3 &&
              process.argv[2] === "--listen" &&
              process.env.UNIMATE_STRIPE_TEST_LISTEN === "approved",
          });
  main().catch((error) => {
    console.error(
      `Sandbox supervisor stopped: ${error instanceof SetupError ? error.code : "LOCAL_SANDBOX_FAILED"}. Raw diagnostics withheld.`,
    );
    process.exitCode = 1;
  });
}
