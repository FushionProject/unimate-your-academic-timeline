import assert from "node:assert/strict";
import { selectPreferredSubscription, stripeStateEntitled } from "../../src/lib/billing-policy.ts";

for (const status of ["active", "trialing"]) assert.equal(stripeStateEntitled(status), true);
assert.equal(stripeStateEntitled("past_due", true), true);
assert.equal(stripeStateEntitled("past_due", false), false);
for (const status of ["canceled", "unpaid", "paused", "incomplete", "incomplete_expired"]) {
  assert.equal(stripeStateEntitled(status), false);
}

const active = { id: "sub_active", status: "active" };
const canceled = { id: "sub_old", status: "canceled" };
const pastDue = { id: "sub_past_due", status: "past_due" };
assert.equal(selectPreferredSubscription([canceled, pastDue, active])?.id, "sub_active");
assert.equal(selectPreferredSubscription([canceled, pastDue])?.id, "sub_past_due");
assert.equal(selectPreferredSubscription([]), null);

console.log("PASS executable Stripe entitlement policy tests");
