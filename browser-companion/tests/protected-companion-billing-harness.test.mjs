import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import {
  installProtectedBillingGuard,
  startProtectedCompanionBillingHarness,
} from "../../scripts/protected-companion-billing-harness.mjs";
import { installPreviewFetch } from "../../scripts/protected-companion-preview.mjs";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";

const app = "https://unimate-synthetic.vercel.app";
const record = {
  version: 1,
  marker: "unimate-stripe-sandbox-synthetic-v1",
  account: TARGET.account,
  price: TARGET.price,
  supabase: TARGET.supabase,
  nonce: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000002",
  password: "x".repeat(43),
};
record.email = `unimate-billing-${record.nonce}@example.test`;
const user = {
  id: record.userId,
  email: record.email,
  app_metadata: { unimate_test_marker: record.marker, unimate_test_nonce: record.nonce },
};
const conversation = "30000000-0000-4000-8000-000000000003";
const session = { user, access_token: "synthetic-access", refresh_token: "synthetic-refresh" };

async function fixture({ stored, decorate = true, origin = app } = {}) {
  const requests = [];
  let response = new Response(JSON.stringify(session));
  const world = vm.createContext({
    URL,
    Request,
    Response,
    Headers,
    AbortSignal,
    UNIMATE_COMPANION_CONFIG: { UNIMATE_API_URL: app },
    chrome: {
      storage: { local: { get: async () => ({ unimateCompanionSession: stored }) } },
      tabs: {},
    },
    fetch: async (request) => {
      requests.push(request);
      return response.clone();
    },
  });
  if (decorate)
    vm.runInContext(
      `(${installPreviewFetch.toString()})`,
      world,
    )({ origin: app, token: "synthetic-oidc", expiresAt: Date.now() + 300000 });
  await vm.runInContext(
    `(${installProtectedBillingGuard.toString()})`,
    world,
  )({ record, app: origin, supabase: TARGET.supabase });
  return {
    world,
    requests,
    reply: (body, status = 200) => {
      response = new Response(JSON.stringify(body), { status });
    },
  };
}
const authorization = { authorization: `Bearer ${session.access_token}` };
const passwordRequest = () =>
  new Request(`${TARGET.supabase}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: record.email, password: record.password }),
  });
await assert.rejects(fixture({ decorate: false }), /PROTECTED_SANDBOX_ORIGIN_REQUIRED/);
await assert.rejects(
  fixture({ origin: "http://localhost:8080" }),
  /PROTECTED_SANDBOX_ORIGIN_REQUIRED/,
);
await assert.rejects(
  fixture({ stored: { ...session, user: { ...user, id: "owner" } } }),
  /SYNTHETIC_PROFILE_SESSION_REQUIRED/,
);
await assert.rejects(
  startProtectedCompanionBillingHarness({ record: {} }),
  /SYNTHETIC_RECORD_INVALID/,
);

{
  const f = await fixture();
  await assert.rejects(
    f.world.fetch(`${app}/api/billing-status?reconcile=false`, { headers: authorization }),
    /REQUEST_BLOCKED/,
  );
  assert.equal(f.requests.length, 0);
  await f.world.fetch(passwordRequest());
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].method, "POST", "Both wrappers preserve a Request body's method");
  assert.deepEqual(await f.requests[0].clone().json(), {
    email: record.email,
    password: record.password,
  });
  assert.equal(f.requests[0].headers.has("x-vercel-trusted-oidc-idp-token"), false);
  assert.equal(f.requests[0].redirect, "manual");
  assert.equal(f.world.__protectedBillingStats.verifiedIdentity, true);
  f.reply({ isPro: false });
  await f.world.fetch(
    new Request(`${app}/api/billing-status?reconcile=false`, { headers: authorization }),
  );
  assert.equal(f.requests.at(-1).headers.get("x-vercel-trusted-oidc-idp-token"), "synthetic-oidc");
  assert.equal(f.requests.at(-1).redirect, "manual");
  f.world.__protectedBillingConversation = conversation;
  const paths = [
    `profiles?id=eq.${record.userId}&select=id,is_pro,billing_revision`,
    `companion_preferences?user_id=eq.${record.userId}&select=active_conversation_id&limit=1`,
    `companion_conversations?user_id=eq.${record.userId}&id=eq.${conversation}&select=id,user_id,title`,
    `companion_conversations?id=eq.${conversation}&user_id=eq.${record.userId}&select=id,title&limit=1`,
    `companion_chats?conversation_id=eq.${conversation}&select=id,message,role,created_at,conversation_id&order=created_at.desc,id.desc&limit=100`,
  ];
  for (const path of paths) {
    await f.world.fetch(`${TARGET.supabase}/rest/v1/${path}`, {
      headers: { ...authorization, "x-vercel-trusted-oidc-idp-token": "must-strip" },
    });
    assert.equal(f.requests.at(-1).headers.has("x-vercel-trusted-oidc-idp-token"), false);
  }
  const before = f.requests.length;
  for (const [url, options = {}] of [
    [`${app}/api/billing-status?reconcile=true`],
    [`${app}/api/billing-status?reconcile=false&reconcile=true`],
    [`${app}/api/create-checkout-session`, { method: "POST" }],
    [`${app}/api/dashboard-ai`, { method: "POST" }],
    [`${app}/api/analyze-screenshot`, { method: "POST" }],
    ["https://other.vercel.app/api/billing-status?reconcile=false"],
    ["http://127.0.0.1:8080/api/billing-status?reconcile=false"],
    [`${TARGET.supabase}/rest/v1/profiles?id=eq.owner&select=id,is_pro,billing_revision`],
    [
      `${TARGET.supabase}/rest/v1/profiles?id=eq.${record.userId}&id=eq.owner&select=id,is_pro,billing_revision`,
    ],
    [`${TARGET.supabase}/rest/v1/profiles?id=eq.${record.userId}&select=*,other_table(*)`],
    [
      `${TARGET.supabase}/rest/v1/profiles?id=eq.${record.userId}&select=id,is_pro,billing_revision&or=(id.eq.owner)`,
    ],
    [`${TARGET.supabase}/rest/v1/companion_conversations?id=eq.${conversation}&select=id`],
    [
      `${TARGET.supabase}/rest/v1/companion_chats?conversation_id=eq.other&select=id,message,role,created_at,conversation_id`,
    ],
    [
      `${TARGET.supabase}/rest/v1/companion_preferences?on_conflict=user_id`,
      { method: "POST", body: JSON.stringify({ user_id: record.userId }) },
    ],
    [
      `${TARGET.supabase}/rest/v1/profiles?id=eq.${record.userId}`,
      { method: "PATCH", body: '{"is_pro":true}' },
    ],
    [
      `${app}/api/billing-status?reconcile=false`,
      { headers: { authorization: "Bearer another-account" } },
    ],
    [`${TARGET.supabase}/auth/v1/logout`, { method: "POST" }],
  ])
    await assert.rejects(
      f.world.fetch(url, { headers: authorization, ...options }),
      /REQUEST_BLOCKED/,
    );
  await assert.rejects(f.world.fetch(passwordRequest()), /REQUEST_BLOCKED/);
  assert.equal(f.requests.length, before, "Forbidden requests never reach any remote transport");
  await assert.rejects(f.world.chrome.tabs.captureVisibleTab(), /CAPTURE_BLOCKED/);
  assert.equal(f.world.__protectedBillingStats.capture, 1);
  assert.equal(f.world.__protectedBillingStats.ai, 2);
  assert.equal(f.world.__protectedBillingStats.passwordGrants, 1);
  f.reply({}, 302);
  await assert.rejects(
    f.world.fetch(`${TARGET.supabase}/auth/v1/user`, { headers: authorization }),
    /REQUEST_BLOCKED/,
  );
}
{
  const f = await fixture({ stored: session });
  f.reply(user);
  await f.world.fetch(`${TARGET.supabase}/auth/v1/user`, { headers: authorization });
  f.reply({ ...session, access_token: "rotated-access", refresh_token: "rotated-refresh" });
  await f.world.fetch(
    new Request(`${TARGET.supabase}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    }),
  );
  await assert.rejects(
    f.world.fetch(`${app}/api/billing-status?reconcile=false`, { headers: authorization }),
    /REQUEST_BLOCKED/,
  );
  f.reply({ isPro: true });
  await f.world.fetch(`${app}/api/billing-status?reconcile=false`, {
    headers: { authorization: "Bearer rotated-access" },
  });
}
{
  const f = await fixture();
  f.reply({ ...session, user: { ...user, app_metadata: {}, user_metadata: user.app_metadata } });
  await assert.rejects(f.world.fetch(passwordRequest()), /REQUEST_BLOCKED/);
  assert.equal(f.world.__protectedBillingStats.verifiedIdentity, false);
}
// Structural lifecycle coverage complements the worker boundary unit tests.
// Actual same-panel screenshots are intentionally generated only by the operator.
const source = await fs.readFile(
  new URL("../../scripts/protected-companion-billing-harness.mjs", import.meta.url),
  "utf8",
);
assert.ok(
  source.indexOf("attachPreviewAccess(context, worker, verified)") <
    source.indexOf("worker.evaluate(installProtectedBillingGuard"),
);
assert.match(source, /COMPANION_PANEL_WAS_REPLACED/);
assert.match(source, /expect\("expect-pro", "expect-free", true\)/);
assert.match(source, /expect\("expect-revoked", "expect-pro", false\)/);
assert.match(source, /saveFixtureScreenshot\(page, fixtureOrigin, directory\)/);
assert.doesNotMatch(
  source,
  /process\.env\.(?:OPENAI_API_KEY|STRIPE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY)/,
);
console.log(
  "PASS continuous protected companion boundary: composed transport, synthetic identity, read-only scope, no AI/capture, ordered same-panel evidence (offline)",
);
