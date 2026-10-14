import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

// Exercise factories without reading developer env files or opening a server.
if (!process.argv.includes("--isolated")) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--isolated"], {
    env: { PATH: process.env.PATH, NODE_ENV: "test" },
    stdio: "inherit",
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const root = new URL("../../", import.meta.url);
const dedupe = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@tanstack/react-query",
  "@tanstack/query-core",
];
const plain = (value) => JSON.parse(JSON.stringify(value));
const startOptions = {
  server: { entry: "server" },
  importProtection: {
    behavior: "error",
    client: { files: ["**/server/**"], specifiers: ["server-only"] },
  },
};

for (const filename of ["vite.config.ts", "vite.vercel.config.ts"]) {
  const url = new URL(filename, root);
  const source = await readFile(url, "utf8");
  assert.doesNotMatch(source, /@lovable|lovable-tagger/);
  // Evaluate the actual configuration expression, substituting only provider
  // factories/env access. This makes adapter/order/option changes observable.
  const emitted = ts.transpileModule(
    source.replaceAll("import.meta.url", JSON.stringify(url.href)),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } },
  ).outputText;
  const plugin = (name) => (options) => ({ name, options });
  const modules = {
    "@cloudflare/vite-plugin": { cloudflare: plugin("cloudflare") },
    "@tailwindcss/vite": plugin("tailwind"),
    "@tanstack/react-start/plugin/vite": { tanstackStart: plugin("start") },
    "@vitejs/plugin-react": plugin("react"),
    "vite-tsconfig-paths": plugin("paths"),
    "nitro/vite": { nitro: plugin("nitro") },
    "node:url": { fileURLToPath },
    vite: {
      defineConfig: (config) => config,
      loadEnv: (mode, cwd, prefix) => {
        assert.equal(mode, "production");
        assert.equal(cwd, fileURLToPath(root));
        assert.equal(prefix, "VITE_");
        return { VITE_PUBLIC_FIXTURE: "public-value" };
      },
    },
  };
  const exports = {};
  vm.runInNewContext(emitted, {
    exports,
    require: (name) => {
      assert.ok(Object.hasOwn(modules, name), `Unexpected config import: ${name}`);
      return modules[name];
    },
    process: { cwd: () => fileURLToPath(root) },
    URL,
  });
  for (const command of ["build", "serve"]) {
    const config = plain(await exports.default({ command, mode: "production" }));
    assert.equal(config.resolve.alias["@"], fileURLToPath(new URL("src", root)));
    assert.deepEqual(config.resolve.dedupe, dedupe);
    assert.deepEqual(config.define, { "import.meta.env.VITE_PUBLIC_FIXTURE": '"public-value"' });
    assert.deepEqual(config.plugins.find((p) => p.name === "start").options, startOptions);
    assert.equal(config.server.port, 8080);
    assert.equal(config.server.watch.awaitWriteFinish.stabilityThreshold, 1000);
    if (filename === "vite.config.ts") {
      assert.deepEqual(
        config.plugins.map((p) => p.name),
        ["tailwind", "paths", ...(command === "build" ? ["cloudflare"] : []), "start", "react"],
      );
      if (command === "build")
        assert.deepEqual(config.plugins[2].options, { viteEnvironment: { name: "ssr" } });
    } else {
      assert.deepEqual(
        config.plugins.map((p) => p.name),
        ["tailwind", "paths", "start", "react", "nitro"],
      );
      assert.deepEqual(config.plugins.at(-1).options, {
        preset: "vercel",
        vercel: { functions: { runtime: "nodejs22.x", maxDuration: 120 } },
      });
    }
  }
}

// Unlike mocked supervisor process tests, this loads every real sandbox plugin
// and the exact factory used by the child. No private env, ports or API calls.
process.loadEnvFile = () => {
  throw new Error("Environment files forbidden in smoke test");
};
globalThis.fetch = () => {
  throw new Error("Remote requests forbidden in smoke test");
};
const { sandboxViteConfig, sandboxStartPlugins, PRIVATE_FS_DENY } =
  await import("../../scripts/run-stripe-sandbox.mjs");
const sandbox = await sandboxViteConfig();
assert.equal(sandbox.configFile, false);
assert.equal(sandbox.envDir, false);
assert.equal(sandbox.define, undefined);
assert.equal(sandbox.mode, "sandbox");
assert.equal(sandbox.server.host, "localhost");
assert.equal(sandbox.server.port, 8080);
assert.equal(sandbox.server.strictPort, true);
assert.equal(sandbox.server.open, false);
assert.deepEqual(sandbox.server.fs.deny, PRIVATE_FS_DENY);
assert.deepEqual(sandbox.resolve.dedupe, dedupe);
const names = (await Promise.all(sandbox.plugins.flat(Infinity)))
  .flat(Infinity)
  .filter(Boolean)
  .map((p) => p.name);
assert(names.some((name) => name.includes("tailwind")));
assert(names.some((name) => name.includes("tanstack")));
assert(names.some((name) => name.includes("react")));
assert(!names.some((name) => /lovable|tagger|nitro|cloudflare|error-logger/.test(name)));
assert(!names.includes("tanstack-start-core:load-env"));
await assert.rejects(sandboxStartPlugins([]), /SANDBOX_ENV_PLUGIN_CHANGED/);
await assert.rejects(
  sandboxStartPlugins([
    { name: "tanstack-start-core:load-env" },
    { name: "tanstack-start-core:load-env" },
  ]),
  /SANDBOX_ENV_PLUGIN_CHANGED/,
);
const retained = { name: "retained" };
assert.deepEqual(
  await sandboxStartPlugins([
    Promise.resolve([false, retained]),
    [{ name: "tanstack-start-core:load-env" }],
  ]),
  [retained],
);

// Resolve the real plugins, including configResolved hooks. Before filtering,
// Start's loader bypassed envDir:false and process.loadEnvFile restrictions.
// Only synthetic files are used: this must never resolve the developer root.
const fixture = await mkdtemp(path.join(tmpdir(), "unimate-build-env-fixture-"));
try {
  await mkdir(path.join(fixture, "src", "routes"), { recursive: true });
  await writeFile(
    path.join(fixture, ".env.local"),
    [
      "UNIMATE_ENV_LOAD_CANARY=must-not-load",
      "OPENAI_API_KEY=synthetic-must-not-load",
      "VITE_PRIVATE_CANARY=must-not-define",
    ].join("\n"),
  );
  await writeFile(path.join(fixture, "src", "server.ts"), "export default {};");
  await writeFile(
    path.join(fixture, "src", "routes", "__root.tsx"),
    "import { createRootRoute } from '@tanstack/react-router'; export const Route = createRootRoute();",
  );
  await writeFile(path.join(fixture, "src", "router.tsx"), "export const getRouter = () => ({});");
  const { resolveConfig } = await import("vite");
  const resolved = await resolveConfig(
    { ...sandbox, root: fixture, logLevel: "silent" },
    "serve",
    "sandbox",
  );
  assert.equal(resolved.envDir, false);
  assert.equal(process.env.UNIMATE_ENV_LOAD_CANARY, undefined);
  assert.equal(process.env.OPENAI_API_KEY, undefined);
  assert.equal(process.env.VITE_PRIVATE_CANARY, undefined);
  assert.equal(resolved.env.VITE_PRIVATE_CANARY, undefined);
  assert(!JSON.stringify(resolved.define).includes("must-not"));
  assert(!resolved.plugins.some((plugin) => plugin.name === "tanstack-start-core:load-env"));
} finally {
  await rm(fixture, { recursive: true, force: true });
}
const lock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
for (const name of Object.keys(lock.packages))
  assert.doesNotMatch(name, /(?:^|\/)(?:@lovable\.dev|lovable-tagger|braces)(?:\/|$)/);
assert.equal(lock.packages["node_modules/nitro"].version, "3.0.260903-beta");
console.log(
  "PASS explicit build configs: adapter parity, public-only defines, real sandbox configResolved isolation",
);
process.exit(0);
