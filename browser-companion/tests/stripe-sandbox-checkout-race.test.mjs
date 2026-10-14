import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sandboxCheckoutRace } from "../../scripts/stripe-sandbox-checkout-race.mjs";
import { TARGET, ARTIFACT } from "../../scripts/prepare-stripe-sandbox.mjs";
import { APP } from "../../scripts/verify-stripe-sandbox-lifecycle.mjs";

async function fixture(test) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-checkout-race-fixture-"));
  try {
    await fs.mkdir(path.join(root, ".stripe-sandbox.local"), { mode: 0o700 });
    const userId = "10000000-0000-4000-8000-000000000001",
      nonce = "20000000-0000-4000-8000-000000000002";
    const record = {
      version: 1,
      userId,
      nonce,
      marker: "unimate-stripe-sandbox-synthetic-v1",
      account: TARGET.account,
      supabase: TARGET.supabase,
      price: TARGET.price,
      email: `unimate-billing-${nonce}@example.test`,
      password: "A".repeat(43),
    };
    await fs.writeFile(path.join(root, ARTIFACT), JSON.stringify(record), { mode: 0o600 });
    const state = {
      isPro: false,
      time: Date.now(),
      mode: "same",
      appCalls: 0,
      authCalls: 0,
      expireCalls: 0,
      wrongAuth: false,
      wrongPrice: false,
      wrongCustomer: false,
      incomplete: false,
      expireUnknown: false,
      expireAppliedUnknown: false,
      subscriptions: [{ id: "sub_old", status: "canceled" }],
      sessions: new Map(),
    };
    const makeSession = (sessionId) => ({
      id: sessionId,
      customer: "cus_fixture",
      livemode: false,
      client_reference_id: userId,
      metadata: { user_id: userId },
      status: "open",
      mode: "subscription",
      subscription: null,
      payment_status: "unpaid",
      currency: "usd",
      amount_total: 599,
    });
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
    let release;
    const bothStarted = new Promise((resolve) => {
      release = resolve;
    });
    const run = (action) =>
      sandboxCheckoutRace({
        action,
        approved: true,
        root,
        now: () => state.time,
        verify: async (args) => {
          assert.equal(args.verificationOnly, true);
          return {
            stripe: {
              STRIPE_SECRET_KEY: "sk_test_fixture",
              STRIPE_LIVE_MODE_ENABLED: "false",
              STRIPE_PRICE_ID: TARGET.price,
            },
            supa: {
              SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture",
              VITE_SUPABASE_ANON_KEY: "sb_publishable_fixture",
            },
          };
        },
        inspect: async (args) => {
          assert.equal(args.action, "status");
          return {
            account: TARGET.account,
            userId,
            customerId: "cus_fixture",
            clockId: "clock_fixture",
            clockStatus: "ready",
            subscriptions: structuredClone(state.subscriptions),
          };
        },
        fetchImpl: async (url, init) => {
          const parsed = new URL(url);
          assert.equal(init.redirect, "manual");
          if (parsed.origin === TARGET.supabase) {
            if (parsed.pathname.includes("/profiles")) {
              assert.equal(init.method, undefined);
              return json([{ id: userId, is_pro: state.isPro, stripe_customer_id: "cus_fixture" }]);
            }
            if (parsed.pathname.endsWith("/token")) {
              state.authCalls++;
              assert.equal(init.method, "POST");
              return json({ access_token: "PRIVATE_SESSION_TOKEN" });
            }
            if (parsed.pathname.endsWith("/user"))
              return json({
                id: state.wrongAuth ? "other" : userId,
                email: record.email,
                app_metadata: { unimate_test_marker: record.marker, unimate_test_nonce: nonce },
              });
            throw new Error("unexpected Supabase operation");
          }
          if (parsed.origin === APP) {
            assert.equal(parsed.pathname, "/api/create-checkout-session");
            assert.equal(init.method, "POST");
            assert.equal(init.body, "{}");
            assert.equal(init.headers.Authorization, "Bearer PRIVATE_SESSION_TOKEN");
            const call = ++state.appCalls;
            if (call === 2) release();
            await bothStarted;
            if (state.mode === "unknown" && call === 2) throw new Error("RAW_PRIVATE_FAILURE");
            if (state.mode === "reuse-unknown" && call > 2) throw new Error("RAW_PRIVATE_FAILURE");
            if (state.mode === "conflict" && call === 2)
              return json({ code: "CHECKOUT_IN_PROGRESS", error: "safe" }, 409);
            if (state.mode === "wrong-conflict" && call === 2) return json({ code: "OTHER" }, 409);
            const sessionId =
              state.mode === "duplicate" ? `cs_test_fixture${call}` : "cs_test_fixture";
            if (!state.sessions.has(sessionId))
              state.sessions.set(sessionId, makeSession(sessionId));
            if (state.mode === "unexpected-subscription" && call === 2)
              state.subscriptions.push({ id: "sub_new", status: "active" });
            return json({
              url: `https://${state.mode === "wrong-url" ? "untrusted.test" : "checkout.stripe.com"}/c/pay/${sessionId}#PRIVATE_BEARER_URL`,
            });
          }
          assert.equal(parsed.origin, "https://api.stripe.com");
          assert.equal(init.headers["Stripe-Version"], "2026-06-24.dahlia");
          if (parsed.pathname === "/v1/checkout/sessions") {
            assert.equal(parsed.searchParams.get("customer"), "cus_fixture");
            assert.equal(parsed.searchParams.get("status"), "open");
            return json({
              data: [...state.sessions.values()].filter((s) => s.status === "open"),
              has_more: state.incomplete,
            });
          }
          const match = parsed.pathname.match(
            /^\/v1\/checkout\/sessions\/(cs_test_[A-Za-z0-9]+)(?:\/(line_items|expire))?$/,
          );
          assert.ok(match, "only fixed session lookups/expiry");
          const session = state.sessions.get(match[1]);
          assert.ok(session);
          if (match[2] === "expire") {
            state.expireCalls++;
            assert.equal(init.method, "POST");
            assert.match(init.headers["Idempotency-Key"], /^unimate-checkout-expire-/);
            if (state.expireUnknown) throw new Error("RAW_EXPIRE_FAILURE");
            session.status = "expired";
            if (state.expireAppliedUnknown) throw new Error("RAW_EXPIRE_FAILURE");
            return json(session);
          }
          assert.equal(init.method, undefined);
          if (match[2] === "line_items")
            return json({
              has_more: false,
              data: [
                {
                  price: { id: state.wrongPrice ? "price_other" : TARGET.price },
                  quantity: 1,
                  amount_total: 599,
                  currency: "usd",
                },
              ],
            });
          return json({
            ...session,
            customer: state.wrongCustomer ? "cus_other" : session.customer,
          });
        },
      });
    await test({ state, run, root, makeSession });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
await assert.rejects(
  sandboxCheckoutRace({ action: "run" }),
  /EXPLICIT_CHECKOUT_RACE_APPROVAL_REQUIRED/,
);
await assert.rejects(
  sandboxCheckoutRace({ action: "arbitrary", approved: true }),
  /EXPLICIT_CHECKOUT_RACE_APPROVAL_REQUIRED/,
);
for (const mode of ["same", "conflict"])
  await fixture(async ({ state, run, root }) => {
    state.mode = mode;
    const result = await run("run");
    assert.equal(result.verified, true);
    assert.equal(state.appCalls, 2);
    assert.deepEqual(
      result.results.map((r) => r.status),
      mode === "same" ? [200, 200] : [200, 409],
    );
    assert(!/cs_test_|PRIVATE|https:/.test(JSON.stringify(result)));
    const journalPath = path.join(root, ".stripe-sandbox.local/checkout-race-v1.json");
    assert.equal((await fs.stat(journalPath)).mode & 0o777, 0o600);
    assert(!/PRIVATE|password|url/.test(await fs.readFile(journalPath, "utf8")));
    await assert.rejects(run("run"), /ALREADY_ATTEMPTED/);
    assert.equal(state.appCalls, 2);
    const cleanup = await run("cleanup");
    assert.equal(cleanup.openCheckouts, 0);
    assert.equal(state.expireCalls, 1);
    assert.equal((await run("status")).journalState, "cleaned");
    await assert.rejects(run("cleanup"), /VERIFIED_HELPER_CHECKOUT/);
    assert.equal(state.expireCalls, 1);
  });
for (const setup of [
  (s) => {
    s.isPro = true;
  },
  (s) => {
    s.subscriptions.push({ id: "sub_active", status: "active" });
  },
  (s, makeSession) => {
    s.sessions.set("cs_test_preexisting", makeSession("cs_test_preexisting"));
  },
  (s) => {
    s.incomplete = true;
  },
])
  await fixture(async ({ state, run, makeSession }) => {
    setup(state, makeSession);
    await assert.rejects(run("run"));
    assert.equal(state.appCalls, 0);
    assert.equal(state.expireCalls, 0);
  });
await fixture(async ({ state, run }) => {
  state.wrongAuth = true;
  await assert.rejects(run("run"), /AUTH_IDENTITY/);
  assert.equal(state.appCalls, 0);
});
for (const mode of [
  "unknown",
  "wrong-conflict",
  "duplicate",
  "wrong-url",
  "unexpected-subscription",
])
  await fixture(async ({ state, run }) => {
    state.mode = mode;
    await assert.rejects(
      run("run"),
      (error) => error.code && !error.message.includes("RAW_PRIVATE"),
    );
    await assert.rejects(run("run"));
    if (["unknown", "wrong-conflict"].includes(mode)) {
      const cleanup = await run("cleanup");
      assert.equal(cleanup.raceVerified, false);
      assert.equal(
        state.expireCalls,
        1,
        "only the successful response's exact recorded session is expired",
      );
    } else {
      await assert.rejects(run("cleanup"));
      assert.equal(state.expireCalls, 0);
    }
    assert.equal(state.appCalls, 2);
  });
for (const property of ["wrongPrice", "wrongCustomer"])
  await fixture(async ({ state, run }) => {
    state[property] = true;
    await assert.rejects(run("run"));
    assert.equal(state.appCalls, 2);
    assert.equal(state.expireCalls, 0);
  });
await fixture(async ({ state, run }) => {
  await run("run");
  state.expireUnknown = true;
  await assert.rejects(
    run("cleanup"),
    (error) => error.code && !error.message.includes("RAW_EXPIRE"),
  );
  await assert.rejects(run("cleanup"), /EXPIRY_UNKNOWN_NO_RETRY/);
  assert.equal(state.expireCalls, 1);
  assert.equal((await run("status")).journalState, "cleanup-pending");
});
await fixture(async ({ state, run }) => {
  await run("run");
  state.expireAppliedUnknown = true;
  await assert.rejects(run("cleanup"));
  const result = await run("cleanup");
  assert.equal(result.reconciledOnly, true);
  assert.equal(result.openCheckouts, 0);
  assert.equal(state.expireCalls, 1, "expiry reconciliation never resends the mutation");
});
await fixture(async ({ state, run, makeSession }) => {
  await run("run");
  state.sessions.set("cs_test_unrelated", makeSession("cs_test_unrelated"));
  await assert.rejects(run("cleanup"), /EXACT_HELPER_OPEN_CHECKOUT/);
  assert.equal(state.expireCalls, 0);
});
await fixture(async ({ state, run, root }) => {
  await run("run");
  const originalTime = state.time;
  state.time += 120000;
  const early = await run("verify-reuse-early");
  assert.equal(early.sameSession, true);
  assert.equal(early.elapsedSeconds, 120);
  assert.equal(state.appCalls, 3);
  await assert.rejects(run("verify-reuse-early"), /ALREADY_ATTEMPTED/);
  await assert.rejects(run("verify-reuse-late"), /TIMING_WINDOW_NOT_MET/);
  assert.equal(state.appCalls, 3, "too-early late check performs no request");
  state.time = originalTime + 301000;
  const late = await run("verify-reuse-late");
  assert.equal(late.sameSession, true);
  assert.equal(late.elapsedSeconds, 301);
  assert.equal(state.appCalls, 4);
  const timing = JSON.parse(
    await fs.readFile(
      path.join(root, ".stripe-sandbox.local/checkout-reuse-timing-v1.json"),
      "utf8",
    ),
  );
  assert.equal(timing.verifiedAtMs, originalTime);
  await run("cleanup");
  assert.equal(state.expireCalls, 1);
});
await fixture(async ({ state, run, root }) => {
  await run("run");
  const file = path.join(root, ".stripe-sandbox.local/checkout-race-v1.json");
  const legacy = JSON.parse(await fs.readFile(file, "utf8"));
  delete legacy.verifiedAtMs;
  await fs.writeFile(file, JSON.stringify(legacy), { mode: 0o600 });
  const seconds = Math.floor(state.time / 1000) - 100;
  await fs.utimes(file, seconds, seconds);
  await run("verify-reuse-early");
  const timing = JSON.parse(
    await fs.readFile(
      path.join(root, ".stripe-sandbox.local/checkout-reuse-timing-v1.json"),
      "utf8",
    ),
  );
  assert.equal(timing.source, "original-journal-mtime");
  assert.equal(timing.verifiedAtMs, seconds * 1000);
  await fs.utimes(file, seconds + 50, seconds + 50);
  state.time = seconds * 1000 + 301000;
  assert.equal(
    (await run("verify-reuse-late")).elapsedSeconds,
    301,
    "frozen anchor ignores later main-journal mtime changes",
  );
});
await fixture(async ({ state, run }) => {
  await run("run");
  state.time += 301000;
  await assert.rejects(run("verify-reuse-early"), /TIMING_WINDOW_NOT_MET/);
  assert.equal(state.appCalls, 2);
  await run("cleanup");
  assert.equal(state.expireCalls, 1);
});
await fixture(async ({ state, run }) => {
  await run("run");
  state.time += 1000;
  state.mode = "reuse-unknown";
  await assert.rejects(run("verify-reuse-early"));
  state.time += 301000;
  await assert.rejects(run("verify-reuse-late"), /OUTCOME_UNKNOWN_NO_RETRY/);
  assert.equal(state.appCalls, 3);
  await run("cleanup");
  assert.equal(
    state.expireCalls,
    1,
    "reuse uncertainty does not prevent exact known-session cleanup",
  );
});
await fixture(async ({ state, run }) => {
  await run("run");
  state.time += 1000;
  state.mode = "duplicate";
  await assert.rejects(run("verify-reuse-early"), /REUSE_DID_NOT_RETURN_ORIGINAL_SESSION/);
  assert.equal(state.appCalls, 3);
  await assert.rejects(run("cleanup"), /EXACT_HELPER_OPEN_CHECKOUT_REQUIRED/);
  assert.equal(state.expireCalls, 0, "unexpected extra checkout needs explicit reconciliation");
});
console.log(
  "PASS offline Checkout race: concurrent pair, shared-session/safe409 acceptance, exact Free scope, no payment or URL leak, journal-only expiry and unknown-outcome stop",
);
