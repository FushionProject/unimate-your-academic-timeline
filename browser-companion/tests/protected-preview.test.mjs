import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import vm from "node:vm";
import {
  attachPreviewAccess,
  installPreviewFetch,
  loadVerifiedPreviewDeployment,
  validatePreviewAccess,
  validatePreviewDeployment,
} from "../../scripts/protected-companion-preview.mjs";

const origin = "https://unimate-synthetic-deploy.vercel.app";
const project = {
  projectId: "prj_5XZ4ulni13tNLCvNzdL1gUPvashI",
  orgId: "team_MwJPMKdnqu1z8dxbKYBqdJCY",
};
const deployment = {
  url: new URL(origin).hostname,
  projectId: project.projectId,
  ownerId: project.orgId,
  project: { id: project.projectId },
  team: { id: project.orgId },
  target: null,
  readyState: "READY",
};
const now = Date.now();
const claims = {
  project_id: project.projectId,
  owner_id: project.orgId,
  environment: "development",
  exp: Math.floor(now / 1000) + 300,
};
const jwt = (payload) =>
  `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.synthetic`;
const token = jwt(claims);
const access = validatePreviewAccess(origin, token, project, deployment, now);
for (const invalid of [
  "http://unimate-synthetic-deploy.vercel.app",
  `${origin}/`,
  `${origin}/api`,
  `${origin}?x=1`,
  "https://unimate.site",
  "https://a.vercel.app.evil.invalid",
  "https://a.vercel.app:8443",
  "https://user:pass@a.vercel.app",
]) {
  assert.throws(() => validatePreviewAccess(invalid, token, project, deployment, now));
}
for (const invalid of [
  jwt({ ...claims, exp: now / 1000 - 1 }),
  jwt({ ...claims, exp: String(claims.exp) }),
  jwt({ ...claims, project_id: "prj_other" }),
  jwt({ ...claims, owner_id: "team_other" }),
  jwt({ ...claims, environment: "production" }),
  "bad",
  jwt(null),
]) {
  assert.throws(() => validatePreviewAccess(origin, invalid, project, deployment, now));
}
assert.throws(() =>
  validatePreviewAccess(origin, token, { ...project, projectId: "prj_other" }, deployment, now),
);
for (const patch of [
  { url: "other.vercel.app" },
  { projectId: "prj_other" },
  { ownerId: "team_other" },
  { project: { id: "prj_other" } },
  { team: { id: "team_other" } },
  { target: "production" },
  { target: undefined },
  { readyState: "ERROR" },
  { readyState: "BUILDING" },
]) {
  assert.throws(() =>
    validatePreviewAccess(origin, token, project, { ...deployment, ...patch }, now),
  );
}
// Even a valid project-scoped token must never be sent to an arbitrary Vercel
// hostname or an alias which resolves to the same deployment.
assert.throws(() =>
  validatePreviewAccess("https://attacker.vercel.app", token, project, deployment, now),
);
assert.throws(() =>
  validatePreviewAccess("https://unimate-branch-alias.vercel.app", token, project, deployment, now),
);
assert.throws(() => validatePreviewDeployment(origin, project, undefined));
const verified = await loadVerifiedPreviewDeployment(
  origin,
  project,
  async (command, args, options) => {
    assert.equal(command, "npx");
    assert.deepEqual(args, [
      "--yes",
      "vercel@63.1.2",
      "api",
      `/v13/deployments/${deployment.url}?teamId=${project.orgId}`,
      "--scope",
      "resumejuice-s-projects",
      "--raw",
    ]);
    for (const key of [
      "VERCEL_OIDC_TOKEN",
      "DEBUG",
      "PWDEBUG",
      "OPENAI_API_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ])
      assert.equal(options.env[key], undefined);
    assert.equal(options.timeout, 30_000);
    return { stdout: JSON.stringify({ ...deployment, env: { private: "fixture-suppressed" } }) };
  },
);
assert.equal(verified.env, undefined);
assert.equal(validatePreviewAccess(origin, token, project, verified, now).origin, origin);
await assert.rejects(
  loadVerifiedPreviewDeployment(origin, project, async () => {
    throw new Error("raw-private-cli-error");
  }),
  (error) => !error.message.includes("raw-private") && /authenticate/.test(error.message),
);

const calls = [];
let clock = now;
let redirect = false;
const originalFetch = async (request) => {
  calls.push(request);
  return new Response("fixture", { status: redirect ? 302 : 200 });
};
const sandbox = vm.createContext({
  Request,
  Response,
  Headers,
  URL,
  Map,
  Date: { now: () => clock },
  fetch: originalFetch,
  UNIMATE_COMPANION_CONFIG: { UNIMATE_API_URL: "http://localhost:8080" },
});
vm.runInContext(`(${installPreviewFetch.toString()})`, sandbox)(access);
const decorated = sandbox.fetch;
const header = "x-vercel-trusted-oidc-idp-token";
assert.equal(sandbox.UNIMATE_COMPANION_CONFIG.UNIMATE_API_URL, origin);
await sandbox.fetch(`${origin}/api/health`);
assert.equal(calls.at(-1).headers.get(header), token);
assert.equal(calls.at(-1).redirect, "manual");
const signal = new AbortController().signal;
await sandbox.fetch(`${origin}/api/analyze-screenshot`, {
  method: "POST",
  headers: { authorization: "Bearer owner-fixture" },
  body: "synthetic screenshot",
  signal,
});
assert.equal(calls.at(-1).headers.get("authorization"), "Bearer owner-fixture");
assert.equal(await calls.at(-1).text(), "synthetic screenshot");
assert.equal(calls.at(-1).signal.aborted, false);
for (const url of [
  "https://synthetic.supabase.co/auth/v1/token",
  "https://coursework.invalid/page",
  "https://other.vercel.app/api/health",
  "http://localhost:8080/api/health",
]) {
  await sandbox.fetch(
    new Request(url, { headers: { [header]: token, authorization: "Bearer preserved" } }),
  );
  assert.equal(calls.at(-1).headers.has(header), false);
  assert.equal(calls.at(-1).headers.get("authorization"), "Bearer preserved");
}
let count = calls.length;
await assert.rejects(sandbox.fetch(`${origin}/api/stripe-webhook`), /allowlist/);
await assert.rejects(sandbox.fetch(`${origin}/api/dashboard-ai`), /allowlist/);
assert.equal(calls.length, count);
redirect = true;
await assert.rejects(sandbox.fetch(`${origin}/api/billing-status`), /redirects/);
assert.equal(calls.at(-1).redirect, "manual");
redirect = false;
clock = access.expiresAt;
count = calls.length;
await assert.rejects(sandbox.fetch(`${origin}/api/health`), /expired/);
assert.equal(calls.length, count);
clock = now;

// Compose the same outer diagnostic-fetch pattern as the live verifier.
const diagnostics = [];
sandbox.fetch = async (input, init) => {
  const response = await decorated(input, init);
  diagnostics.push({ status: response.status });
  return response;
};
await sandbox.fetch(`${origin}/api/health`);
assert.deepEqual(diagnostics, [{ status: 200 }]);
sandbox.fetch = decorated; // verifier finally restores its saved original
sandbox.__unimatePreviewAccess.dispose();
assert.equal(sandbox.fetch, originalFetch);
assert.equal(sandbox.UNIMATE_COMPANION_CONFIG.UNIMATE_API_URL, "http://localhost:8080");
assert.equal(sandbox.__unimatePreviewAccess, undefined);
await assert.rejects(decorated(`${origin}/api/health`), /closed/);

class FixtureWorker extends EventEmitter {
  async evaluate(fn, arg) {
    return vm.runInContext(`(${fn.toString()})`, sandbox)(arg);
  }
}
class FixtureContext extends EventEmitter {
  closeCount = 0;
  async close() {
    this.closeCount++;
  }
}
for (const restart of [false, true]) {
  const context = new FixtureContext();
  const worker = new FixtureWorker();
  const dispose = await attachPreviewAccess(context, worker, access);
  if (restart) context.emit("serviceworker", new FixtureWorker());
  else worker.emit("close");
  assert.equal(context.closeCount, 1, "Worker loss must close the isolated preview");
  await dispose();
  assert.equal(worker.listenerCount("close"), 0);
  assert.equal(context.listenerCount("serviceworker"), 0);
  assert.equal(sandbox.fetch, originalFetch);
}
const expiringContext = new FixtureContext();
const expiringWorker = new FixtureWorker();
const disposeExpired = await attachPreviewAccess(expiringContext, expiringWorker, {
  ...access,
  expiresAt: Date.now() + 5_010,
});
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(expiringContext.closeCount, 1, "Expiry must close the isolated preview");
await disposeExpired();
const failedContext = new FixtureContext();
const failedWorker = new FixtureWorker();
failedWorker.evaluate = async () => {
  throw new Error("fixture installation failure");
};
await assert.rejects(attachPreviewAccess(failedContext, failedWorker, access), /Could not prepare/);
assert.equal(failedContext.closeCount, 1);
assert.equal(failedWorker.listenerCount("close"), 0);
assert.equal(failedContext.listenerCount("serviceworker"), 0);

// Execute the runner's real bootstrap without importing its network/browser
// entrypoint. Only synthetic worker code and synthetic access metadata run.
const runnerSource = fs.readFileSync(
  new URL("../../scripts/preview-companion.mjs", import.meta.url),
  "utf8",
);
const bootstrapStart = runnerSource.indexOf(
  "  context = await chromium.launchPersistentContext(profile, browserOptions);",
);
const bootstrapEnd = runnerSource.indexOf("  const page = context.pages()[0]");
assert.ok(bootstrapStart > 0 && bootstrapEnd > bootstrapStart);
const bootstrap = runnerSource.slice(bootstrapStart, bootstrapEnd);
assert.ok(
  runnerSource.indexOf("await loadVerifiedPreviewDeployment(") <
    runnerSource.indexOf("process.env.VERCEL_OIDC_TOKEN ||"),
  "Authenticated deployment ownership must be checked before reading OIDC",
);
assert.ok(
  runnerSource.indexOf("delete process.env.VERCEL_OIDC_TOKEN") < bootstrapStart,
  "Browser launch must not inherit the preview token",
);
assert.ok(
  bootstrapEnd < runnerSource.indexOf("await page.goto("),
  "Page navigation and auth checks must follow worker verification and decoration",
);
for (const scenario of [
  { name: "fresh-current", resumed: false, revisions: [true] },
  { name: "resumed-current", resumed: true, revisions: [true, true] },
  { name: "resumed-stale", resumed: true, revisions: [false, true] },
  { name: "replacement-discovery", resumed: true, revisions: [false, true], dormant: true },
  { name: "fresh-stale", resumed: false, revisions: [false], failure: /cached older/ },
  { name: "still-stale", resumed: true, revisions: [false, false], failure: /cached older/ },
  {
    name: "reload-failure",
    resumed: true,
    revisions: [false],
    reloadFails: true,
    failure: /fixture reload/,
  },
]) {
  const events = [];
  const contexts = [];
  const fixtureAccess = { ...access };
  const fixtureProfile = "/private/tmp/unimate-companion-live-preview-synthetic";
  const browserOptions = { headless: true };
  const chromium = {
    async launchPersistentContext(profile, options) {
      assert.equal(profile, fixtureProfile, "Relaunch must reuse only the same isolated profile");
      assert.equal(options, browserOptions);
      const index = contexts.length;
      assert.ok(index < scenario.revisions.length, "Recovery must not loop launches");
      events.push(`launch:${index}`);
      const worker = new EventEmitter();
      const workerWorld = vm.createContext({
        setTimeout: (callback) => queueMicrotask(callback),
        chrome: {
          runtime: {
            reload() {
              events.push(`reload:${index}`);
              worker.emit("close");
            },
          },
        },
      });
      if (scenario.revisions[index]) {
        vm.runInContext(
          "function captureStep() {} function captureSenderTab() { return 'documentId'; } function compatibleContentResponse() {}",
          workerWorld,
        );
      }
      worker.evaluate = async (fn) => {
        if (fn.toString().includes("chrome.runtime.reload")) {
          if (scenario.reloadFails) {
            worker.emit("close");
            throw new Error("fixture reload failure");
          }
        } else events.push(`inspect:${index}`);
        return vm.runInContext(`(${fn.toString()})()`, workerWorld);
      };
      const context = new EventEmitter();
      context.serviceWorkers = () => (scenario.dormant && index === 1 ? [] : [worker]);
      context.waitForEvent = async (event) => {
        assert.equal(event, "serviceworker");
        events.push(`discover:${index}`);
        return worker;
      };
      context.close = async () => {
        events.push(`close:${index}`);
        context.emit("close");
      };
      contexts.push({ context, worker });
      return context;
    },
  };
  const world = vm.createContext({
    chromium,
    profile: fixtureProfile,
    browserOptions,
    requestedProfile: scenario.resumed ? fixtureProfile : undefined,
    previewAccess: fixtureAccess,
    context: undefined,
    disposeAccess: undefined,
    setTimeout,
    clearTimeout,
    console: { log() {} },
    attachPreviewAccess: async (context, worker, candidateAccess) => {
      const current = contexts.at(-1);
      assert.equal(context, current.context);
      assert.equal(worker, current.worker);
      assert.equal(candidateAccess.token, token);
      assert.equal(events.at(-1), `inspect:${contexts.length - 1}`);
      events.push("decorate");
      return async () => {};
    },
  });
  const execution = vm.runInContext(`(async () => {${bootstrap}})()`, world);
  if (scenario.failure) {
    await assert.rejects(execution, scenario.failure, scenario.name);
    assert.equal(events.includes("decorate"), false, scenario.name);
  } else {
    await execution;
    assert.equal(events.at(-1), "decorate", scenario.name);
    assert.equal(fixtureAccess.token, "", "Parent token reference must be scrubbed after attach");
    assert.equal(world.previewAccess, undefined);
  }
  if (scenario.revisions.length === 2) {
    assert.deepEqual(events.slice(0, 5), [
      "launch:0",
      "inspect:0",
      "reload:0",
      "close:0",
      "launch:1",
    ]);
  } else assert.equal(contexts.length, 1, scenario.name);
}
console.log(
  "PASS protected preview: canonical origin, project/expiry, no header leaks, manual redirects, cleanup, worker loss, verifier composition, stale-worker bootstrap ordering",
);
