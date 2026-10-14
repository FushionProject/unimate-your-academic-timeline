import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyLifecycle, APP } from "../../scripts/verify-stripe-sandbox-lifecycle.mjs";
import { TARGET, ARTIFACT } from "../../scripts/prepare-stripe-sandbox.mjs";

async function fixture({
  action = "status",
  pro = false,
  disabled = false,
  wrongUser = false,
  live = false,
  redirect = false,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-lifecycle-fixture-"));
  const calls = [];
  try {
    const nonce = "10000000-0000-4000-8000-000000000001";
    const userId = "20000000-0000-4000-8000-000000000002";
    const marker = "unimate-stripe-sandbox-synthetic-v1";
    const record = {
      version: 1,
      marker,
      nonce,
      userId,
      email: `unimate-billing-${nonce}@example.test`,
      password: "x".repeat(43),
      account: TARGET.account,
      price: TARGET.price,
      supabase: TARGET.supabase,
    };
    await fs.mkdir(path.join(root, ".stripe-sandbox.local"), { mode: 0o700 });
    await fs.writeFile(path.join(root, ARTIFACT), JSON.stringify(record), { mode: 0o600 });
    await fs.writeFile(
      path.join(root, ".env.local"),
      `VITE_SUPABASE_URL=${TARGET.supabase}\nVITE_SUPABASE_ANON_KEY=sb_publishable_fixture\nSUPABASE_SERVICE_ROLE_KEY=NEVER_USE_THIS\n`,
      { mode: 0o600 },
    );
    await fs.writeFile(
      path.join(root, ".env.stripe.local"),
      `STRIPE_SECRET_KEY=${live ? "sk_live_fixture" : "sk_test_fixture"}\nSTRIPE_PRICE_ID=${TARGET.price}\nSTRIPE_LIVE_MODE_ENABLED=false\n`,
      { mode: 0o600 },
    );
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      assert.equal(init.redirect, "manual");
      assert.ok(init.signal);
      assert.equal(JSON.stringify(init).includes("NEVER_USE_THIS"), false);
      const parsed = new URL(url);
      assert.ok([TARGET.supabase, APP, "https://api.stripe.com"].includes(parsed.origin));
      if (parsed.origin === "https://api.stripe.com") {
        assert.equal(init.method, undefined);
        if (parsed.pathname === "/v1/account") return json({ id: TARGET.account });
        return json({
          id: TARGET.price,
          product: TARGET.product,
          livemode: false,
          active: true,
          currency: "usd",
          unit_amount: 599,
          recurring: { interval: "month", interval_count: 1 },
        });
      }
      if (parsed.pathname === "/auth/v1/token")
        return json({
          access_token: "PRIVATE_ACCESS_SENTINEL",
          refresh_token: "PRIVATE_REFRESH_SENTINEL",
          expires_at: 1999999999,
        });
      if (parsed.pathname === "/auth/v1/user")
        return json({
          id: userId,
          email: record.email,
          app_metadata: {
            unimate_test_marker: wrongUser ? "wrong" : marker,
            unimate_test_nonce: nonce,
          },
        });
      if (parsed.pathname === "/rest/v1/profiles") {
        assert.equal(parsed.searchParams.get("id"), `eq.${userId}`);
        return json([{ id: userId, is_pro: pro, stripe_customer_id: null, billing_revision: 0 }]);
      }
      if (parsed.pathname === "/api/billing-status") {
        assert.equal(parsed.search, "?reconcile=false");
        return json({ isPro: pro });
      }
      if (parsed.pathname === "/api/analyze-screenshot") {
        assert.equal(init.body, "{}");
        return pro
          ? disabled
            ? json({ code: "SCREENSHOT_UNAVAILABLE" }, 503)
            : json({ error: "imageBase64 is required" }, 400)
          : json({ code: "PRO_REQUIRED" }, 403);
      }
      if (parsed.pathname === "/api/create-checkout-session")
        return redirect
          ? new Response(null, { status: 302, headers: { location: "https://wrong.test" } })
          : json({ url: "https://checkout.stripe.com/c/pay/cs_test_fixture" });
      if (parsed.pathname === "/api/create-portal-session")
        return json({ url: "https://billing.stripe.com/p/session/test_fixture" });
      throw new Error("Unexpected fixture request");
    };
    const operation = verifyLifecycle({
      action,
      approved: true,
      root,
      fetchImpl,
      checkIgnored: () => {},
    });
    if (live || wrongUser || redirect) {
      await assert.rejects(operation, (error) =>
        /^(EXACT_TEST_BILLING_CONFIG_REQUIRED|SYNTHETIC_USER_IDENTITY_MISMATCH|REMOTE_REQUEST_REJECTED)$/.test(
          error.code,
        ),
      );
      if (live) assert.equal(calls.length, 0);
      if (wrongUser)
        assert.equal(
          calls.some(({ url }) => url.startsWith(APP)),
          false,
        );
      return;
    }
    const result = await operation;
    assert.equal(result.profile.isPro, pro);
    assert.equal(result.gate.status, pro ? (disabled ? 503 : 400) : 403);
    assert.equal(JSON.stringify(result).includes("PRIVATE_"), false);
    assert.ok(
      calls.findIndex(({ url }) => url.includes("/rest/v1/profiles")) <
        calls.findIndex(({ url }) => url.startsWith(APP)),
    );
    const mutations = calls
      .filter(({ init }) => init.method === "POST")
      .map(({ url }) => new URL(url).pathname);
    assert.deepEqual(mutations, [
      "/auth/v1/token",
      "/api/analyze-screenshot",
      ...(["checkout", "portal"].includes(action) ? [`/api/create-${action}-session`] : []),
    ]);
    for (const file of [result.sessionArtifact, result.artifact])
      assert.equal((await fs.stat(path.join(root, file))).mode & 0o777, 0o600);
    assert.equal(
      JSON.parse(await fs.readFile(path.join(root, result.sessionArtifact), "utf8")).access_token,
      "PRIVATE_ACCESS_SENTINEL",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
await assert.rejects(
  verifyLifecycle({ action: "checkout" }),
  /EXPLICIT_LIFECYCLE_APPROVAL_REQUIRED/,
);
for (const action of ["baseline", "checkout", "status", "portal"]) await fixture({ action });
await fixture({ pro: true });
await fixture({ pro: true, disabled: true });
await fixture({ wrongUser: true });
await fixture({ live: true });
await fixture({ action: "checkout", redirect: true });
console.log(
  "PASS offline sandbox lifecycle: exact targets, marked user, profile-before-status, no-AI gate, private tokens, test-only mutations, and redirect refusal",
);
