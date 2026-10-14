import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ARTIFACT,
  TARGET,
  prepareSandbox,
  parseSelectedEnv,
  privateJson,
  assertIgnored,
} from "../../scripts/prepare-stripe-sandbox.mjs";

const id = "00000000-0000-4000-8000-000000000001";
const roots = [];
async function fixture({
  account = TARGET.account,
  price = {},
  key = "sk_" + "test_fixture",
  outcome = "ok",
  profile = {},
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-sandbox-fixture-"));
  roots.push(root);
  await fs.writeFile(
    path.join(root, ".env.local"),
    `VITE_SUPABASE_URL=${TARGET.supabase}\nSUPABASE_SERVICE_ROLE_KEY=sb_secret_fixture\nUNRELATED_SECRET=ignored\n`,
    { mode: 0o600 },
  );
  await fs.writeFile(
    path.join(root, ".env.stripe.local"),
    `STRIPE_SECRET_KEY=${key}\nSTRIPE_PRICE_ID=${TARGET.price}\nSTRIPE_LIVE_MODE_ENABLED=false\n`,
    { mode: 0o600 },
  );
  const calls = [];
  let user;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, "manual");
    if (url === "https://api.stripe.com/v1/account") return Response.json({ id: account });
    if (url === `https://api.stripe.com/v1/prices/${TARGET.price}`)
      return Response.json({
        id: TARGET.price,
        product: TARGET.product,
        livemode: false,
        active: true,
        currency: "usd",
        unit_amount: 599,
        recurring: { interval: "month", interval_count: 1 },
        ...price,
      });
    assert.equal(options.headers.apikey, "sb_secret_fixture");
    assert.equal(options.headers.Authorization, undefined);
    if (url.endsWith("/auth/v1/admin/users") && options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.email_confirm, true);
      assert.match(body.email, /@example\.test$/);
      assert.equal((await fs.stat(path.join(root, ARTIFACT))).mode & 0o777, 0o600);
      user = { ...body, id };
      if (outcome === "uncertain") throw new Error("PRIVATE provider data must never escape");
      return Response.json(user);
    }
    if (url.endsWith(`/auth/v1/admin/users/${id}`)) return Response.json(user);
    if (url.startsWith(`${TARGET.supabase}/rest/v1/profiles?`))
      return Response.json([
        { id, is_pro: false, stripe_customer_id: null, billing_revision: 0, ...profile },
      ]);
    assert.fail("Unexpected endpoint");
  };
  return {
    root,
    calls,
    run: (approved = true) => prepareSandbox({ root, approved, fetchImpl, checkIgnored: () => {} }),
  };
}
try {
  assertIgnored(path.resolve(import.meta.dirname, "../.."));
  assert.deepEqual(parseSelectedEnv("OTHER=secret\nX='value'", ["X"]), { X: "value" });
  assert.throws(() => parseSelectedEnv("X=a\nX=b", ["X"]), /DUPLICATE_CONFIG_KEY/);
  const gate = await fixture();
  await fs.unlink(path.join(gate.root, ".env.local"));
  await assert.rejects(gate.run(false), /EXPLICIT_SETUP_APPROVAL_REQUIRED/);
  assert.equal(gate.calls.length, 0);
  for (const options of [
    { account: "acct_wrong" },
    { key: "sk_" + "live_fixture" },
    { price: { livemode: true } },
    { price: { unit_amount: 600 } },
    { price: { product: "prod_other" } },
    { price: { recurring: { interval: "year", interval_count: 1 } } },
  ]) {
    const f = await fixture(options);
    await assert.rejects(f.run());
    assert.equal(f.calls.filter((x) => x.options.method === "POST").length, 0);
    await assert.rejects(fs.stat(path.join(f.root, ".stripe-sandbox.local")), { code: "ENOENT" });
  }
  const ok = await fixture();
  assert.deepEqual(await ok.run(), { ready: true, artifact: ARTIFACT });
  assert.equal((await fs.stat(path.join(ok.root, ".stripe-sandbox.local"))).mode & 0o777, 0o700);
  assert.deepEqual(await ok.run(), { ready: true, artifact: ARTIFACT });
  assert.equal(ok.calls.filter((x) => x.options.method === "POST").length, 1);
  const journal = JSON.parse(await fs.readFile(path.join(ok.root, ARTIFACT), "utf8"));
  assert.equal(journal.userId, id);
  assert.equal(journal.password.length, 43);
  const uncertain = await fixture({ outcome: "uncertain" });
  await assert.rejects(uncertain.run(), (error) => error.message === "REMOTE_REQUEST_FAILED");
  await assert.rejects(uncertain.run(), /PENDING_CREATE_REQUIRES_RECONCILIATION/);
  assert.equal(uncertain.calls.filter((x) => x.options.method === "POST").length, 1);
  const nonfree = await fixture({ profile: { is_pro: true } });
  await assert.rejects(nonfree.run(), /SYNTHETIC_PROFILE_NOT_PRISTINE_FREE/);
  assert.equal(
    nonfree.calls.filter((x) => ["PATCH", "PUT", "DELETE"].includes(x.options.method)).length,
    0,
  );
  const permissions = await fixture();
  await fs.chmod(path.join(permissions.root, ".env.local"), 0o644);
  await assert.rejects(permissions.run(), /PRIVATE_REGULAR_FILE_REQUIRED/);
  assert.equal(permissions.calls.length, 0);
  const symlink = await fixture();
  await fs.rename(path.join(symlink.root, ".env.local"), path.join(symlink.root, "secret"));
  await fs.symlink("secret", path.join(symlink.root, ".env.local"));
  await assert.rejects(symlink.run(), /PRIVATE_SETUP_FAILED/);
  assert.equal(symlink.calls.length, 0);
  await assert.rejects(
    privateJson(
      async () =>
        new Response("secret", { status: 302, headers: { location: "https://example.com" } }),
      "https://example.test",
      {},
    ),
    /REMOTE_REQUEST_REJECTED/,
  );
  await assert.rejects(
    privateJson(async () => new Response("x".repeat(65537)), "https://example.test", {}),
    /REMOTE_RESPONSE_TOO_LARGE/,
  );
  console.log(
    "PASS: sandbox preparation gates, exact targets, synthetic-only creation, private recovery journal, reuse, uncertain outcomes, no entitlement writes, private-file and redirect/body guards (offline).",
  );
} finally {
  for (const root of roots) await fs.rm(root, { recursive: true, force: true });
}
