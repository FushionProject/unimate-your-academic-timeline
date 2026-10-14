import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sandboxPortalIsolation } from "../../scripts/stripe-sandbox-portal-isolation.mjs";
import { TARGET, ARTIFACT } from "../../scripts/prepare-stripe-sandbox.mjs";
import { APP } from "../../scripts/verify-stripe-sandbox-lifecycle.mjs";

async function fixture(test) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-portal-fixture-"));
  try {
    const dir = path.join(root, ".stripe-sandbox.local");
    await fs.mkdir(dir, { mode: 0o700 });
    const primary = {
      version: 1,
      marker: "unimate-stripe-sandbox-synthetic-v1",
      nonce: "20000000-0000-4000-8000-000000000002",
      userId: "10000000-0000-4000-8000-000000000001",
      account: TARGET.account,
      price: TARGET.price,
      supabase: TARGET.supabase,
      password: "A".repeat(43),
    };
    primary.email = `unimate-billing-${primary.nonce}@example.test`;
    await fs.writeFile(path.join(root, ARTIFACT), JSON.stringify(primary), { mode: 0o600 });
    const secondaryId = "30000000-0000-4000-8000-000000000003";
    const user = (record) => ({
      id: record.userId,
      email: record.email,
      app_metadata: {
        unimate_test_marker: record.marker,
        unimate_test_nonce: record.nonce,
        ...(record.purpose ? { unimate_test_purpose: record.purpose } : {}),
      },
    });
    const state = {
      adminCreates: 0,
      appCalls: [],
      secondary: null,
      unknownCreate: false,
      unknownPortal: false,
      wrongAuth: false,
      pro: false,
      bound: false,
      attackSuccess: false,
      hostileUrl: false,
      events: [],
      more: false,
      live: false,
      wrongAccount: false,
      time: Date.now(),
    };
    const url = "https://billing.stripe.com/p/session/test_fixtureBearer";
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
    const run = (action, extra = {}) =>
      sandboxPortalIsolation({
        action,
        approved: true,
        root,
        now: () => state.time,
        verify: async () => ({
          stripe: {
            STRIPE_SECRET_KEY: state.live ? "sk_live_forbidden" : "sk_test_fixture",
            STRIPE_PRICE_ID: TARGET.price,
            STRIPE_LIVE_MODE_ENABLED: "false",
          },
          supa: {
            SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture",
            VITE_SUPABASE_ANON_KEY: "sb_publishable_fixture",
          },
        }),
        inspect: async () => ({
          account: state.wrongAccount ? "acct_other" : TARGET.account,
          userId: primary.userId,
          customerId: "cus_primary",
          subscriptions: [],
        }),
        fetchImpl: async (raw, init) => {
          const parsed = new URL(raw);
          assert.equal(init.redirect, "manual");
          if (parsed.origin === TARGET.supabase) {
            if (parsed.pathname === "/auth/v1/admin/users") {
              assert.equal(init.method, "POST");
              const body = JSON.parse(init.body);
              assert.equal(body.email_confirm, true);
              assert.ok(body.email.endsWith("@example.test"));
              assert.equal(body.app_metadata.unimate_test_purpose, "portal-isolation-v1");
              assert.ok(!Object.hasOwn(body, "user_metadata"));
              state.adminCreates++;
              state.secondary = {
                id: secondaryId,
                email: body.email,
                app_metadata: body.app_metadata,
              };
              if (state.unknownCreate) throw new Error("private raw provider details");
              return json(state.secondary);
            }
            if (parsed.pathname === `/auth/v1/admin/users/${secondaryId}`)
              return json(state.secondary);
            if (parsed.pathname === "/rest/v1/profiles") {
              assert.equal(init.method, undefined);
              assert.equal(parsed.searchParams.get("id"), `eq.${secondaryId}`);
              return json([
                {
                  id: secondaryId,
                  is_pro: state.pro,
                  stripe_customer_id: state.bound ? "cus_other" : null,
                  billing_revision: 0,
                },
              ]);
            }
            if (parsed.pathname === "/auth/v1/token") {
              const body = JSON.parse(init.body);
              return json({
                access_token: body.email === primary.email ? "token_primary" : "token_secondary",
              });
            }
            if (parsed.pathname === "/auth/v1/user")
              return json(
                state.wrongAuth
                  ? user(primary)
                  : init.headers.Authorization === "Bearer token_primary"
                    ? user(primary)
                    : state.secondary,
              );
          }
          if (parsed.origin === APP) {
            assert.equal(parsed.pathname, "/api/create-portal-session");
            assert.equal(init.method, "POST");
            state.appCalls.push({
              query: parsed.search,
              body: JSON.parse(init.body),
              authorization: init.headers.Authorization,
            });
            if (!init.headers.Authorization) return json({ code: "AUTH_REQUIRED" }, 401);
            if (init.headers.Authorization === "Bearer token_secondary")
              return state.attackSuccess
                ? json({ url })
                : json({ error: "No Stripe subscription is connected to this account." }, 409);
            if (state.unknownPortal) throw new Error("private URL");
            return json({ url: state.hostileUrl ? "https://evil.example/p/session/test" : url });
          }
          if (parsed.origin === "https://api.stripe.com") {
            assert.equal(parsed.pathname, "/v1/events");
            assert.equal(parsed.searchParams.get("type"), "billing_portal.session.created");
            assert.equal(init.method, undefined);
            return json({ data: state.events, has_more: state.more });
          }
          throw new Error("Unexpected fixture request");
        },
        ...extra,
      });
    const event = () => ({
      id: "evt_fixture",
      type: "billing_portal.session.created",
      livemode: false,
      created: Math.floor(state.time / 1000),
      data: {
        object: {
          id: "bps_fixture",
          object: "billing_portal.session",
          livemode: false,
          customer: "cus_primary",
          return_url: `${APP}/upgrade`,
          url,
        },
      },
    });
    await test({ run, state, event, dir, primary, url });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

await fixture(async ({ run, state, event, dir, url }) => {
  assert.equal((await run("status")).secondaryState, "absent");
  assert.equal((await run("prepare-secondary")).secondaryFree, true);
  assert.equal((await run("prepare-secondary")).alreadyCreated, true);
  assert.equal(state.adminCreates, 1);
  assert.equal((await fs.stat(path.join(dir, "portal-secondary-user.json"))).mode & 0o077, 0);
  const proof = await run("verify-isolation");
  assert.equal(proof.forgedBodyRejected, true);
  assert.equal(state.appCalls.length, 3);
  assert.equal(state.appCalls[0].body.customer, "cus_primary");
  assert.match(state.appCalls[1].query, /stripe_customer_id=cus_primary/);
  await assert.rejects(run("verify-isolation"), /ALREADY_ATTEMPTED/);
  assert.equal((await run("create-primary-portal")).stripeOriginVerified, true);
  assert.equal((await run("verify-primary-portal")).customerProof, "pending-event-correlation");
  state.events = [event()];
  const ownProof = await run("verify-primary-portal");
  assert.equal(ownProof.exactSyntheticCustomerVerified, true);
  assert.ok(!JSON.stringify([proof, ownProof]).includes(url));
  assert.ok(!JSON.stringify([proof, ownProof]).includes("token_"));
  await assert.rejects(run("create-primary-portal"), /ALREADY_ATTEMPTED/);
});
await fixture(async ({ run, state }) => {
  state.unknownCreate = true;
  await assert.rejects(run("prepare-secondary"), /REMOTE_REQUEST_FAILED/);
  await assert.rejects(run("prepare-secondary"), /SECONDARY_CREATION_UNRESOLVED/);
  assert.equal(state.adminCreates, 1);
});
for (const flag of ["pro", "bound", "wrongAuth", "attackSuccess"])
  await fixture(async ({ run, state }) => {
    await run("prepare-secondary");
    state[flag] = true;
    await assert.rejects(run("verify-isolation"), /SYNTHETIC|REJECTION_NOT_PROVEN/);
    if (flag !== "attackSuccess") assert.equal(state.appCalls.length, 0);
  });
for (const flag of ["unknownPortal", "hostileUrl"])
  await fixture(async ({ run, state }) => {
    state[flag] = true;
    await assert.rejects(run("create-primary-portal"), /REMOTE_REQUEST_FAILED|RESPONSE_INVALID/);
    await assert.rejects(run("create-primary-portal"), /ALREADY_ATTEMPTED/);
    assert.equal(state.appCalls.length, 1);
  });
for (const mutate of [
  (e) => (e.data.object.customer = "cus_other"),
  (e) => (e.livemode = true),
  (e) => (e.data.object.livemode = true),
  (e) => (e.data.object.return_url = "https://evil.example"),
  (e) => (e.created = 1),
])
  await fixture(async ({ run, state, event }) => {
    await run("create-primary-portal");
    const e = event();
    mutate(e);
    state.events = [e];
    await assert.rejects(run("verify-primary-portal"), /CUSTOMER_PROOF_MISMATCH/);
  });
await fixture(async ({ run, state, event }) => {
  await run("create-primary-portal");
  state.events = [event()];
  state.more = true;
  await assert.rejects(run("verify-primary-portal"), /COMPLETE_PORTAL_EVENT_LIST_REQUIRED/);
});
for (const flag of ["live", "wrongAccount"])
  await fixture(async ({ run, state }) => {
    state[flag] = true;
    await assert.rejects(run("prepare-secondary"), /CONFIG_REQUIRED|SCOPE_REQUIRED/);
    assert.equal(state.adminCreates, 0);
  });
await assert.rejects(
  sandboxPortalIsolation({
    action: "prepare-secondary",
    verify: () => assert.fail("gate must precede private config"),
  }),
  /APPROVAL_REQUIRED/,
);
console.log("Stripe portal isolation offline fixtures passed (no remote calls).");
