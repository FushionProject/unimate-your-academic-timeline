import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mock } from "node:test";
import { createProtectedStripePreviewRelay } from "../../scripts/protected-stripe-preview-relay.mjs";
import { validatePreviewAccess } from "../../scripts/protected-companion-preview.mjs";

const origin = "https://unimate-synthetic-resumejuice-s-projects.vercel.app";
const project = {
  projectId: "prj_5XZ4ulni13tNLCvNzdL1gUPvashI",
  orgId: "team_MwJPMKdnqu1z8dxbKYBqdJCY",
};
const deployment = {
  url: new URL(origin).hostname,
  projectId: project.projectId,
  ownerId: project.orgId,
  target: null,
  readyState: "READY",
};
const account = "acct_1UQHj2IxB8W4eFUh",
  customerId = "cus_VRAVJnKW1RGQzr";
const secret = "whsec_" + "syntheticFixture" + "0".repeat(12);
const local = "http://127.0.0.1:8789/api/stripe-webhook";

async function fixture(test) {
  const state = {
    time: 1_800_000_000_000,
    calls: [],
    reports: [],
    responseStatus: 200,
    redirected: false,
    throws: false,
    wait: false,
  };
  const claims = {
    project_id: project.projectId,
    owner_id: project.orgId,
    environment: "development",
    exp: state.time / 1000 + 600,
  };
  const token = `synthetic.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
  const access = validatePreviewAccess(origin, token, project, deployment, state.time);
  const args = {
    access,
    project,
    deployment,
    webhookSecret: secret,
    account,
    customerId,
    now: () => state.time,
    report: (value) => state.reports.push(value),
    fetchImpl: async (url, init) => {
      state.calls.push({ url, init });
      if (state.throws) throw new Error(`Private ${token} ${secret} raw body`);
      if (state.wait)
        return new Promise((resolve, reject) => {
          state.release = resolve;
          init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      const response = new Response(
        [204, 205].includes(state.responseStatus) ? null : `private upstream ${secret}`,
        { status: state.responseStatus },
      );
      if (state.redirected) Object.defineProperty(response, "redirected", { value: true });
      return response;
    },
  };
  const relay = createProtectedStripePreviewRelay(args);
  const event = () => ({
    id: "evt_fixture",
    type: "customer.subscription.updated",
    livemode: false,
    data: {
      object: { id: "sub_fixture", object: "subscription", livemode: false, customer: customerId },
    },
  });
  const sign = (body, timestamp = Math.floor(state.time / 1000)) =>
    `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex")}`;
  const request = (body = JSON.stringify(event()), extra = {}) =>
    new Request(local, {
      method: "POST",
      headers: { "content-type": "application/json", "Stripe-Signature": sign(body) },
      body,
      ...extra,
    });
  try {
    await test({ state, relay, event, sign, request, args, token });
  } finally {
    await relay.stop();
  }
}

await fixture(async ({ state, relay, event, request, token }) => {
  const body = Buffer.from(` { "note": "synthetic café", ${JSON.stringify(event()).slice(1)}\n`);
  const response = await relay.handle(request(body));
  assert.equal(response.status, 200);
  assert.equal(state.calls.length, 1);
  const { url, init } = state.calls[0];
  assert.equal(url, `${origin}/api/stripe-webhook`);
  assert.deepEqual(init.body, body, "signature and forwarded bytes must not be reserialized");
  assert.equal(init.headers["Stripe-Signature"], request(body).headers.get("Stripe-Signature"));
  assert.equal(init.headers["x-vercel-trusted-oidc-idp-token"], token);
  assert.equal(init.redirect, "manual");
  assert.equal(init.method, "POST");
  assert.deepEqual(state.reports, [
    { eventId: "evt_fixture", eventType: "customer.subscription.updated", httpStatus: 200 },
  ]);
  assert.ok(!JSON.stringify(state.reports).includes(secret));
  assert.ok(!JSON.stringify(state.reports).includes(token));
  assert.equal(await response.text(), '{"code":"RELAY_DELIVERED"}');
});
for (const mutate of [
  (e) => (e.livemode = true),
  (e) => (e.data.object.livemode = true),
  (e) => (e.account = "acct_other"),
  (e) => (e.context = "acct_other"),
  (e) => (e.data.object.customer = "cus_other"),
  (e) => delete e.data.object.customer,
  (e) => (e.type = "customer.created"),
  (e) => (e.data.object.object = "invoice"),
  (e) => (e.id = "evt_private\nsecret"),
])
  await fixture(async ({ state, relay, event, request }) => {
    const value = event();
    mutate(value);
    assert.equal((await relay.handle(request(JSON.stringify(value)))).status, 400);
    assert.equal(state.calls.length, 0);
  });
await fixture(async ({ state, relay, event, request }) => {
  const value = event();
  value.account = account;
  value.context = account;
  value.data.object.customer = { id: customerId };
  assert.equal((await relay.handle(request(JSON.stringify(value)))).status, 200);
  assert.equal(state.calls.length, 1);
});
await fixture(async ({ state, relay, event, request }) => {
  const value = event();
  value.type = "charge.dispute.created";
  value.data.object = { object: "dispute", livemode: false, charge: "ch_fixture" };
  assert.equal((await relay.handle(request(JSON.stringify(value)))).status, 400);
  assert.equal(state.calls.length, 0);
});
await fixture(async ({ state, relay, request, sign, event }) => {
  const body = JSON.stringify(event());
  for (const signature of [
    "",
    sign(body, Math.floor(state.time / 1000) - 301),
    sign(body, Math.floor(state.time / 1000) + 301),
    sign("tampered"),
    `t=1,${sign(body)}`,
    "t=not-a-time,v1=not-a-digest",
  ]) {
    assert.equal(
      (
        await relay.handle(
          request(body, {
            headers: { "content-type": "application/json", "Stripe-Signature": signature },
          }),
        )
      ).status,
      400,
    );
  }
  assert.equal(state.calls.length, 0);
});
await fixture(async ({ state, relay, request }) => {
  const good = request();
  for (const target of [
    local + "?secret=forbidden",
    local.replace("stripe-webhook", "create-checkout-session"),
    local.replace("127.0.0.1", "evil.example"),
  ])
    assert.equal((await relay.handle(new Request(target, good.clone()))).status, 404);
  assert.equal((await relay.handle(new Request(local))).status, 404);
  assert.equal(
    (
      await relay.handle(
        request("{}", { headers: { "content-type": "text/plain", "Stripe-Signature": "x" } }),
      )
    ).status,
    415,
  );
  assert.equal((await relay.handle(request("x".repeat(512001)))).status, 413);
  assert.equal(
    (
      await relay.handle(
        request("{}", {
          headers: {
            "content-type": "application/json",
            "Stripe-Signature": "x",
            "content-length": "512001",
          },
        }),
      )
    ).status,
    413,
  );
  assert.equal(state.calls.length, 0);
});
for (const status of [200, 204, 400, 500])
  await fixture(async ({ state, relay, request }) => {
    state.responseStatus = status;
    const response = await relay.handle(request());
    assert.equal(response.status, status);
    assert.ok(!(await response.text()).includes(secret));
    assert.equal(state.calls.length, 1);
    assert.equal(state.reports[0].httpStatus, status);
  });
for (const status of [301, 302, 307, 308])
  await fixture(async ({ state, relay, request }) => {
    state.responseStatus = status;
    assert.equal((await relay.handle(request())).status, 502);
    assert.equal(state.calls.length, 1);
    assert.equal(state.reports.length, 0);
  });
await fixture(async ({ state, relay, request, token }) => {
  state.throws = true;
  const response = await relay.handle(request());
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.ok(!text.includes(token));
  assert.ok(!text.includes(secret));
  assert.equal(state.calls.length, 1);
});
await fixture(async ({ state, relay, request }) => {
  state.time += 596000;
  assert.equal((await relay.handle(request())).status, 503);
  assert.equal(state.calls.length, 0);
  await assert.rejects(relay.start(), /RELAY_START_REJECTED/);
});
await fixture(async ({ state, relay, request }) => {
  state.wait = true;
  const waiting = relay.handle(request());
  while (!state.calls.length) await new Promise((resolve) => setImmediate(resolve));
  await relay.stop();
  assert.equal((await waiting).status, 502);
  assert.equal(state.calls[0].init.signal.aborted, true);
  assert.equal((await relay.handle(request())).status, 503);
});
await fixture(async ({ state, relay, request }) => {
  state.wait = true;
  const waiting = Array.from({ length: 4 }, () => relay.handle(request()));
  while (state.calls.length < 4) await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await relay.handle(request())).status, 429);
  assert.equal(state.calls.length, 4);
  await relay.stop();
  await Promise.all(waiting);
});
await fixture(async ({ args }) => {
  for (const overrides of [
    { account: "acct_other" },
    { customerId: "cus_other" },
    { webhookSecret: "invalid" },
    { deployment: { ...deployment, target: "production" } },
    { deployment: { ...deployment, url: "other.vercel.app" } },
    { access: { ...args.access, expiresAt: args.access.expiresAt + 1000 } },
  ])
    assert.throws(
      () => createProtectedStripePreviewRelay({ ...args, ...overrides }),
      /SCOPE_REQUIRED|PREVIEW_ACCESS_REQUIRED/,
    );
});
// Advance only synthetic timers: prove the full-body deadline cancels a stalled
// request, and lifetime expiry stops future delivery without any socket/listener.
mock.timers.enable({ apis: ["setTimeout"] });
try {
  await fixture(async ({ relay, sign, state }) => {
    let canceled = false;
    const body = new ReadableStream({
      pull() {
        return new Promise(() => {});
      },
      cancel() {
        canceled = true;
      },
    });
    const pending = relay.handle(
      new Request(local, {
        method: "POST",
        duplex: "half",
        body,
        headers: { "content-type": "application/json", "Stripe-Signature": sign("{}") },
      }),
    );
    mock.timers.tick(15001);
    assert.equal((await pending).status, 502);
    assert.equal(canceled, true);
    assert.equal(state.calls.length, 0);
  });
  await fixture(async ({ relay, request, state }) => {
    state.wait = true;
    const pending = relay.handle(request());
    while (!state.calls.length) await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(15001);
    assert.equal((await pending).status, 502);
    assert.equal(state.calls.length, 1, "deadline never retries a potentially delivered webhook");
    assert.equal(state.calls[0].init.signal.aborted, true);
  });
  await fixture(async ({ relay, request, state }) => {
    mock.timers.tick(595001);
    assert.equal((await relay.handle(request())).status, 503);
    assert.equal(state.calls.length, 0);
  });
} finally {
  mock.timers.reset();
}
console.log(
  "Protected Stripe Preview relay offline tests passed; no listener or remote requests started.",
);
