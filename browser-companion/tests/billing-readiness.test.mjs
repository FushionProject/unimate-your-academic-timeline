import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../../src/server.ts", import.meta.url), "utf8");
const upgrade = await readFile(new URL("../../src/routes/upgrade.tsx", import.meta.url), "utf8");

const checkout = server.slice(
  server.indexOf("async function handleCreateCheckoutSession"),
  server.indexOf("async function verifyStripeSignature"),
);
const webhook = server.slice(
  server.indexOf("async function handleStripeWebhook"),
  server.indexOf("type ServerEntry"),
);

assert.match(checkout, /Authorization: `Bearer \$\{stripeSecretKey\}`/);
assert.match(checkout, /mode: "subscription"/);
assert.match(checkout, /"metadata\[user_id\]": userId/);
assert.match(checkout, /client_reference_id: userId/);
assert.doesNotMatch(
  checkout,
  /console\.error\([^\n]*errText/,
  "Stripe response bodies must not be copied into application logs",
);

assert.match(server, /STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300/);
assert.match(server, /parts\.signatures\.some/);
assert.match(server, /constantTimeEqual\(expectedSignature, signature\)/);
assert.match(webhook, /Entitlement storage unavailable", \{ status: 503 \}/);
assert.match(
  webhook,
  /body: JSON\.stringify\(\{ is_pro: true, stripe_customer_id: customerId \}\)/,
);

assert.match(upgrade, /https:\/\/checkout\.stripe\.com\//);
assert.match(upgrade, /Checkout complete — confirming your Pro access/);
assert.match(upgrade, /Checkout canceled\. You were not upgraded\./);
assert.doesNotMatch(upgrade, /Payment received/);

console.log("Billing readiness safeguards passed.");
