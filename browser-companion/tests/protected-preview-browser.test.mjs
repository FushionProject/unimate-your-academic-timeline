import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { attachProtectedPreviewBrowser } from "../../scripts/protected-preview-browser.mjs";
import { validatePreviewAccess } from "../../scripts/protected-companion-preview.mjs";

const origin = "https://unimate-synthetic-preview.vercel.app";
const project = {
  projectId: "prj_5XZ4ulni13tNLCvNzdL1gUPvashI",
  orgId: "team_MwJPMKdnqu1z8dxbKYBqdJCY",
};
const now = Date.now();
const token = `header.${Buffer.from(
  JSON.stringify({
    project_id: project.projectId,
    owner_id: project.orgId,
    environment: "development",
    exp: Math.floor(now / 1000) + 300,
  }),
).toString("base64url")}.synthetic`;
const access = validatePreviewAccess(
  origin,
  token,
  project,
  {
    url: new URL(origin).hostname,
    projectId: project.projectId,
    ownerId: project.orgId,
    target: null,
    readyState: "READY",
  },
  now,
);
const HEADER = "x-vercel-trusted-oidc-idp-token";

class Context extends EventEmitter {
  closed = 0;
  unroutes = 0;
  workers = [];
  serviceWorkers() {
    return this.workers;
  }
  async route(pattern, handler) {
    this.pattern = pattern;
    this.handler = handler;
  }
  async unroute(pattern, handler) {
    assert.equal(pattern, this.pattern);
    assert.equal(handler, this.handler);
    this.unroutes++;
  }
  async close() {
    this.closed++;
    this.emit("close");
  }
}
function fixture(url, { status = 200, location, headers = {}, worker, fetchError, wait } = {}) {
  const calls = [];
  const response = {
    status: () => status,
    headers: () => ({
      "content-type": "text/html",
      ...(location ? { location } : {}),
      [HEADER]: "never-echo",
    }),
    dispose: async () => {
      calls.push({ kind: "dispose" });
    },
  };
  const request = {
    url: () => url,
    allHeaders: async () => ({ authorization: "Bearer application-fixture", ...headers }),
    serviceWorker: () => worker,
  };
  return {
    calls,
    response,
    route: {
      request: () => request,
      continue: async (options) => {
        calls.push({ kind: "continue", options });
      },
      abort: async (code) => {
        calls.push({ kind: "abort", code });
      },
      fetch: async (options) => {
        calls.push({ kind: "fetch", options });
        if (wait) await wait();
        if (fetchError) throw new Error(`private transport detail ${token}`);
        return response;
      },
      fulfill: async (options) => {
        calls.push({ kind: "fulfill", options });
      },
    },
  };
}

for (const patch of [
  { origin: "http://localhost:8080" },
  { origin: `${origin}/` },
  { origin: "https://user:password@unimate-synthetic-preview.vercel.app" },
  { origin: "https://unimate.site" },
  { expiresAt: now },
  { expiresAt: "9999999999999" },
  { token: "" },
])
  await assert.rejects(
    attachProtectedPreviewBrowser(new Context(), { ...access, ...patch }),
    /Verified/,
  );
{
  const context = new Context();
  context.workers.push({});
  await assert.rejects(attachProtectedPreviewBrowser(context, access), /service workers/);
}
for (const debug of ["DEBUG", "PWDEBUG"]) {
  const previous = process.env[debug];
  process.env[debug] = "synthetic-debug";
  try {
    await assert.rejects(attachProtectedPreviewBrowser(new Context(), access), /debugging/);
  } finally {
    if (previous === undefined) delete process.env[debug];
    else process.env[debug] = previous;
  }
}
{
  const context = new Context();
  const dispose = await attachProtectedPreviewBrowser(context, access);
  await assert.rejects(attachProtectedPreviewBrowser(context, access), /already attached/);
  for (const pathname of [
    "/",
    "/assets/app.js",
    "/signin",
    "/api/billing-status?reconcile=false",
    "/api/create-checkout-session",
  ]) {
    const f = fixture(origin + pathname, { headers: { [HEADER.toUpperCase()]: "stale" } });
    await context.handler(f.route);
    assert.deepEqual(
      f.calls.map((call) => call.kind),
      ["fetch", "fulfill", "dispose"],
    );
    const options = f.calls[0].options;
    assert.equal(options.headers[HEADER], token);
    assert.equal(options.headers[HEADER.toUpperCase()], undefined);
    assert.equal(options.headers.authorization, "Bearer application-fixture");
    assert.equal(options.maxRedirects, 0);
    assert.equal(options.maxRetries, 0);
    assert(options.timeout > 0 && options.timeout <= 30_000);
    assert.equal(options.method, undefined, "Original method is not replaced");
    assert.equal(options.postData, undefined, "Original POST body is not replaced");
    assert.equal(f.calls[1].options.response, f.response);
    assert.equal(f.calls[1].options.headers[HEADER], undefined);
  }
  for (const url of [
    "https://checkout.stripe.com/c/pay/cs_test_fixture",
    "https://billing.stripe.com/p/session/test_fixture",
    "https://synthetic.supabase.co/auth/v1/token",
    "https://other.vercel.app/",
  ]) {
    const f = fixture(url, { headers: { [HEADER.toUpperCase()]: token, "x-other": "preserved" } });
    await context.handler(f.route);
    assert.deepEqual(
      f.calls.map((call) => call.kind),
      ["continue"],
    );
    assert.deepEqual(f.calls[0].options, {
      headers: { authorization: "Bearer application-fixture", "x-other": "preserved" },
    });
  }
  const sameOrigin = fixture(`${origin}/start`, { status: 302, location: "/signin" });
  await context.handler(sameOrigin.route);
  assert.equal(
    sameOrigin.calls.find((call) => call.kind === "fulfill").options.headers.location,
    "/signin",
  );
  assert.equal(context.closed, 0);
  await dispose();
  await dispose();
  assert.equal(context.closed, 1);
  assert.equal(context.unroutes, 1);
  assert.equal(context.listenerCount("serviceworker"), 0);
  const late = fixture(`${origin}/late`);
  await context.handler(late.route);
  assert.deepEqual(
    late.calls.map((call) => call.kind),
    ["abort"],
  );
}
for (const url of [
  "http://localhost:8080/",
  "http://localhost./",
  "http://127.1/",
  "http://0x7f000001/",
  "http://10.0.0.1/",
  "http://192.168.1.1/",
  "http://[::1]/",
  "http://[::ffff:127.0.0.1]/",
  "https://dev.local/",
  "https://metadata.internal/",
  "https://user:password@checkout.stripe.com/",
  `${origin}/#fragment`,
]) {
  const context = new Context();
  await attachProtectedPreviewBrowser(context, access);
  const f = fixture(url);
  await context.handler(f.route);
  assert.deepEqual(
    f.calls.map((call) => call.kind),
    ["abort"],
  );
  assert.equal(context.closed, 1);
}
for (const location of [
  "https://checkout.stripe.com/",
  "//attacker.example/",
  "http://localhost:8080/",
  "https://unimate-synthetic-preview.vercel.app.evil.example/",
  "https://user:password@unimate-synthetic-preview.vercel.app/",
  undefined,
]) {
  const context = new Context();
  await attachProtectedPreviewBrowser(context, access);
  const f = fixture(`${origin}/redirect`, { status: 307, location });
  await context.handler(f.route);
  assert.deepEqual(
    f.calls.map((call) => call.kind),
    ["fetch", "abort", "dispose"],
  );
  assert.equal(context.closed, 1);
}
for (const kind of ["transport", "serviceworker", "expiry", "in-flight-expiry", "timer"]) {
  const context = new Context();
  const originalNow = Date.now;
  const originalTimer = globalThis.setTimeout;
  let expire;
  if (kind === "timer")
    globalThis.setTimeout = (fn) => {
      expire = fn;
      return { unref() {} };
    };
  const dispose = await attachProtectedPreviewBrowser(context, access);
  globalThis.setTimeout = originalTimer;
  try {
    if (kind === "serviceworker") context.emit("serviceworker", {});
    else if (kind === "timer") expire();
    else {
      if (kind === "expiry") Date.now = () => access.expiresAt;
      const f = fixture(`${origin}/api/create-checkout-session`, {
        fetchError: kind === "transport",
        wait:
          kind === "in-flight-expiry"
            ? async () => {
                Date.now = () => access.expiresAt;
              }
            : undefined,
      });
      await context.handler(f.route);
      assert(!f.calls.some((call) => call.kind === "fulfill"));
      assert(f.calls.filter((call) => call.kind === "fetch").length <= 1);
      assert(f.calls.some((call) => call.kind === "abort"));
    }
    await dispose();
    assert.equal(context.closed, 1);
    assert.equal(context.unroutes, 1);
  } finally {
    Date.now = originalNow;
    globalThis.setTimeout = originalTimer;
  }
}
{
  const context = new Context();
  context.route = async () => {
    throw new Error(`private installation detail ${token}`);
  };
  await assert.rejects(
    attachProtectedPreviewBrowser(context, access),
    (error) => /context closed/.test(error.message) && !error.message.includes(token),
  );
  assert.equal(context.closed, 1);
}
console.log(
  "PASS website Preview transport: exact origin, no redirect/header leakage, no retries, private-host block, expiry/worker/cleanup guards (offline)",
);
