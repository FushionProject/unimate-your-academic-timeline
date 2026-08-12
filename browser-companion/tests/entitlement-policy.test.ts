import assert from "node:assert/strict";
import { AI_ENTITLEMENTS, entitlementFor, planFromProfile } from "../../src/lib/ai-entitlements.ts";

assert.deepEqual(entitlementFor("free", "syllabus"), {
  allowed: true,
  limit: 2,
  period: "lifetime",
});
for (const feature of ["text", "screenshot"] as const) {
  assert.deepEqual(entitlementFor("free", feature), {
    allowed: false,
    limit: 0,
    period: "month",
    code: "PRO_REQUIRED",
  });
}
assert.deepEqual(entitlementFor("pro", "syllabus"), { allowed: true, limit: 30, period: "month" });
assert.deepEqual(entitlementFor("pro", "text"), { allowed: true, limit: 750, period: "month" });
assert.deepEqual(entitlementFor("pro", "screenshot"), {
  allowed: true,
  limit: 300,
  period: "month",
});
assert.equal(planFromProfile(undefined), "free", "missing profiles must fail closed to Free");
assert.equal(planFromProfile({ is_pro: false }), "free");
assert.equal(planFromProfile({ is_pro: true }), "pro");
assert.equal(AI_ENTITLEMENTS.free.syllabusLifetime, 2);
assert.equal(AI_ENTITLEMENTS.pro.screenshotDaily, 25);
console.log("AI entitlement policy assertions passed.");
