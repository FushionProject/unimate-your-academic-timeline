import assert from "node:assert/strict";
import {
  CURRENT_SANDBOX_TARGET,
  currentSandboxPriceMatches,
  verifyCurrentSandboxPrice,
} from "../../scripts/verify-current-stripe-sandbox-price.mjs";
import { TARGET as HISTORICAL_TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";
import { RELEASE_PRO_CONTRACT } from "../../scripts/release-readiness.mjs";

// Offline fixtures only. No actual credentials, private env or provider calls.
const price = {
  id: CURRENT_SANDBOX_TARGET.price,
  product: CURRENT_SANDBOX_TARGET.product,
  active: true,
  livemode: false,
  type: "recurring",
  billing_scheme: "per_unit",
  transform_quantity: null,
  currency: "usd",
  unit_amount: 999,
  recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
};
const key = "rk_test_offlinefixture";
assert.notEqual(CURRENT_SANDBOX_TARGET.price, HISTORICAL_TARGET.price);
assert.equal(CURRENT_SANDBOX_TARGET.account, HISTORICAL_TARGET.account);
assert.equal(CURRENT_SANDBOX_TARGET.product, HISTORICAL_TARGET.product);
assert.equal(CURRENT_SANDBOX_TARGET.amountCents, RELEASE_PRO_CONTRACT.amountCents);
assert.equal(CURRENT_SANDBOX_TARGET.currency, RELEASE_PRO_CONTRACT.currency);
assert.equal(currentSandboxPriceMatches(price), true);

function fixture({ account = CURRENT_SANDBOX_TARGET.account, overrides = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    assert.equal(options.method, undefined, "verification never sends a mutation");
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    if (url === "https://api.stripe.com/v1/account") return Response.json({ id: account });
    assert.equal(url, `https://api.stripe.com/v1/prices/${CURRENT_SANDBOX_TARGET.price}`);
    return Response.json({ ...price, ...overrides });
  };
  return {
    calls,
    run: (options = {}) =>
      verifyCurrentSandboxPrice({ approved: true, secretKey: key, fetchImpl, ...options }),
  };
}
{
  const f = fixture();
  const result = await f.run();
  assert.equal(result.verified, true);
  assert.equal(result.scope, "price_configuration_only");
  assert.equal(result.paymentRequests, 0);
  assert.equal(result.historicalEvidenceReused, false);
  assert.equal(result.amountCents, 999);
  assert.equal(f.calls.length, 2);
  assert.ok(!JSON.stringify(result).includes(key));
}
for (const options of [
  { approved: false },
  { secretKey: undefined },
  { secretKey: "sk_live_offlinefixture" },
  { secretKey: "rk_live_offlinefixture" },
  { secretKey: `${key}\n` },
]) {
  const f = fixture();
  await assert.rejects(f.run(options));
  assert.equal(f.calls.length, 0);
}
{
  const f = fixture({ account: "acct_other" });
  await assert.rejects(f.run(), /STRIPE_ACCOUNT_MISMATCH/);
  assert.equal(f.calls.length, 1, "wrong account blocks even the price lookup");
}
for (const overrides of [
  { id: HISTORICAL_TARGET.price },
  { product: "prod_other" },
  { unit_amount: 599 },
  { unit_amount: "999" },
  { unit_amount: 1000 },
  { currency: "eur" },
  { active: false },
  { livemode: true },
  { livemode: undefined },
  { type: "one_time" },
  { billing_scheme: "tiered" },
  { transform_quantity: { divide_by: 2, round: "up" } },
  { recurring: null },
  { recurring: { interval: "year", interval_count: 1, usage_type: "licensed" } },
  { recurring: { interval: "month", interval_count: 3, usage_type: "licensed" } },
  { recurring: { interval: "month", interval_count: 1, usage_type: "metered" } },
]) {
  assert.equal(currentSandboxPriceMatches({ ...price, ...overrides }), false);
  const f = fixture({ overrides });
  await assert.rejects(f.run(), /CURRENT_STRIPE_PRICE_MISMATCH/);
  assert.equal(f.calls.length, 2);
}
console.log(
  "PASS current $9.99 sandbox price verifier: exact account/product/new Price, no mutations or historical evidence reuse (offline)",
);
