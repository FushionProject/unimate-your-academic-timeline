// Operator-only, read-only verification for NEW $9.99 runs. The historical
// prepare-stripe-sandbox TARGET and its $5.99 journals intentionally stay fixed.
// Importing this module reads no env, private evidence or network resources.
import { privateJson, SetupError } from "./prepare-stripe-sandbox.mjs";

export const CURRENT_SANDBOX_TARGET = Object.freeze({
  account: "acct_1UQHj2IxB8W4eFUh",
  product: "prod_VRA7ssPuHQrbbc",
  price: "price_1US7nEIxB8W4eFUhI9C4RuJa",
  amountCents: 999,
  currency: "usd",
  interval: "month",
  intervalCount: 1,
});

export function currentSandboxPriceMatches(price) {
  return (
    price?.id === CURRENT_SANDBOX_TARGET.price &&
    price.product === CURRENT_SANDBOX_TARGET.product &&
    price.active === true &&
    price.livemode === false &&
    price.type === "recurring" &&
    price.billing_scheme === "per_unit" &&
    price.transform_quantity == null &&
    price.currency === CURRENT_SANDBOX_TARGET.currency &&
    price.unit_amount === CURRENT_SANDBOX_TARGET.amountCents &&
    price.recurring?.interval === CURRENT_SANDBOX_TARGET.interval &&
    price.recurring.interval_count === CURRENT_SANDBOX_TARGET.intervalCount &&
    price.recurring.usage_type === "licensed"
  );
}

// The caller supplies the already-approved private test key in memory. No
// env-file rewrite is needed: the old runner's Price must remain historical.
// This performs only two fixed-target GETs; it creates no customer, checkout,
// invoice, subscription, payment, local journal, or account/session identity.
export async function verifyCurrentSandboxPrice({
  approved = false,
  secretKey,
  fetchImpl = fetch,
} = {}) {
  if (!approved) throw new SetupError("EXPLICIT_CURRENT_PRICE_VERIFICATION_APPROVAL_REQUIRED");
  if (typeof secretKey !== "string" || !/^[sr]k_test_[A-Za-z0-9]+$/.test(secretKey))
    throw new SetupError("TEST_BILLING_KEY_REQUIRED");
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    "Stripe-Version": "2026-06-24.dahlia",
  };
  const account = await privateJson(fetchImpl, "https://api.stripe.com/v1/account", { headers });
  if (account?.id !== CURRENT_SANDBOX_TARGET.account)
    throw new SetupError("STRIPE_ACCOUNT_MISMATCH");
  const price = await privateJson(
    fetchImpl,
    `https://api.stripe.com/v1/prices/${CURRENT_SANDBOX_TARGET.price}`,
    { headers },
  );
  if (!currentSandboxPriceMatches(price)) throw new SetupError("CURRENT_STRIPE_PRICE_MISMATCH");
  return Object.freeze({
    verified: true,
    scope: "price_configuration_only",
    testMode: true,
    ...CURRENT_SANDBOX_TARGET,
    paymentRequests: 0,
    historicalEvidenceReused: false,
  });
}
