import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../../src/server.ts", import.meta.url), "utf8");
const upgrade = await readFile(new URL("../../src/routes/upgrade.tsx", import.meta.url), "utf8");
const profile = await readFile(new URL("../../src/lib/profile.ts", import.meta.url), "utf8");
const companion = await readFile(new URL("../background.js", import.meta.url), "utf8");
const envExample = await readFile(new URL("../../.env.example", import.meta.url), "utf8");

const checkout = server.slice(
  server.indexOf("async function handleCreateCheckoutSession"),
  server.indexOf("async function verifyStripeSignature"),
);
const webhook = server.slice(
  server.indexOf("async function handleStripeWebhook"),
  server.indexOf("type ServerEntry"),
);

assert.match(server, /secretKey\.startsWith\("sk_live_"\)/);
assert.match(server, /STRIPE_LIVE_MODE_ENABLED !== "true"/);
assert.match(envExample, /STRIPE_LIVE_MODE_ENABLED=false/);
assert.match(envExample, /ALLOW_DEV_PRO_OVERRIDES=false/);
assert.match(server, /function developmentProOverride/);
assert.match(server, /DEV_PRO_USER_IDS/);
assert.match(server, /STRIPE_LIVE_MODE_ENABLED === "true"\) return false/);

assert.match(checkout, /mode: "subscription"/);
assert.match(checkout, /"metadata\[user_id\]": authResult\.id/);
assert.match(checkout, /"subscription_data\[metadata\]\[user_id\]": authResult\.id/);
assert.match(checkout, /client_reference_id: authResult\.id/);
assert.match(server, /"Idempotency-Key": idempotencyKey/);
assert.match(
  checkout,
  /`checkout-\$\{authResult\.id\}-\$\{config\.priceId\}-\$\{idempotencyWindow\}`/,
);
assert.match(checkout, /profile\.stripe_customer_id/);
assert.match(checkout, /listCustomerSubscriptions/);
assert.match(checkout, /price\.type !== "recurring"/);
assert.match(checkout, /checkoutUrl\.hostname !== "checkout\.stripe\.com"/);
assert.doesNotMatch(
  checkout,
  /console\.error\([^\n]*await stripeRes\.text/,
  "Stripe response bodies must not be copied into application logs",
);

assert.match(server, /STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300/);
assert.match(server, /parts\.signatures\.some/);
assert.match(server, /constantTimeEqual\(expectedSignature, signature\)/);
assert.match(webhook, /customer\.subscription\.updated/);
assert.match(webhook, /customer\.subscription\.deleted/);
assert.match(webhook, /invoice\.payment_failed/);
assert.match(webhook, /invoice\.paid/);
assert.match(webhook, /checkout\.session\.async_payment_succeeded/);
assert.match(webhook, /checkout\.session\.async_payment_failed/);
assert.match(server, /subscriptionEntitled\(subscription\.status\)/);
assert.match(server, /status === "past_due"/);
assert.match(server, /status === "active" \|\| status === "trialing"/);

assert.match(server, /async function handleBillingStatus/);
assert.match(server, /async function handleCreatePortalSession/);
assert.match(server, /url\.hostname === "billing\.stripe\.com"/);
assert.match(server, /url\.pathname === "\/api\/billing-status"/);
assert.match(server, /url\.pathname === "\/api\/create-portal-session"/);
assert.match(profile, /fetch\("\/api\/billing-status"/);
assert.match(companion, /\/api\/billing-status/);
assert.doesNotMatch(companion, /profiles\?id=.*select=is_pro/);

assert.match(upgrade, /Manage billing/);
assert.match(upgrade, /latest payment failed/);
assert.match(upgrade, /set to end/);
assert.match(upgrade, /Confirmation is taking longer than expected/);
assert.match(upgrade, /never\s+receives\s+your card details/);
assert.doesNotMatch(upgrade, /Payment received/);

console.log("PASS complete test-mode subscription, lifecycle, portal, and override safeguards");
