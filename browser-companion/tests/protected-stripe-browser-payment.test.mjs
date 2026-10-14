import assert from "node:assert/strict";
import { submitVerifiedTestPayment } from "../../scripts/protected-stripe-browser-payment.mjs";

const sessionId = "cs_" + "test_fixture";
function fixture(overrides = {}) {
  let clicks = 0;
  const state = {
    url: `https://checkout.stripe.com/c/pay/${sessionId}`,
    count: 1,
    visible: true,
    enabled: true,
    text: "$5.99 Subscribe",
    ...overrides,
  };
  const page = {
    url: () => state.url,
    getByRole: (role, options) => {
      assert.equal(role, "button");
      assert.ok(options.name.test("Subscribe"));
      return {
        count: async () => state.count,
        isVisible: async () => state.visible,
        isEnabled: async () => state.enabled,
        click: async () => {
          clicks++;
          if (state.clickFails) throw new Error("Synthetic browser interruption");
        },
      };
    },
    locator: (selector) => {
      assert.equal(selector, "body");
      return { innerText: async () => state.text };
    },
  };
  return { run: () => submitVerifiedTestPayment({ page, sessionId }), clicks: () => clicks };
}
const valid = fixture();
await valid.run();
assert.equal(valid.clicks(), 1);
const uncertain = fixture({ clickFails: true });
await assert.rejects(uncertain.run(), /Synthetic browser interruption/);
assert.equal(uncertain.clicks(), 1, "An uncertain submission must never be retried");
for (const bad of [
  { url: `https://example.test/c/pay/${sessionId}` },
  { url: "https://checkout.stripe.com/c/pay/cs_test_unrelated" },
  { url: `https://name@checkout.stripe.com/c/pay/${sessionId}` },
  { count: 0 },
  { count: 2 },
  { visible: false },
  { enabled: false },
  { text: "$9.99 Subscribe" },
]) {
  const item = fixture(bad);
  await assert.rejects(item.run(), /SANDBOX_CHECKOUT_SUBMIT_NOT_VERIFIED/);
  assert.equal(item.clicks(), 0);
}
console.log(
  "PASS fixed sandbox Checkout click: exact test session, price, one visible enabled button; no card entry or retry (offline)",
);
