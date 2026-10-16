import assert from "node:assert/strict";
import {
  fillVerifiedTestCard,
  submitVerifiedCardCheckout,
} from "../../scripts/protected-stripe-browser-card.mjs";

const sessionId = "cs_" + "test_fixture";
function fixture() {
  const values = new Map();
  let checked = true;
  let clicks = 0;
  const page = {
    url: () => `https://checkout.stripe.com/c/pay/${sessionId}`,
    locator: (selector) => {
      if (selector === "body") return { innerText: async () => "UniMate Sandbox $5.99 Subscribe" };
      assert.match(
        selector,
        /^#(?:cardNumber|cardExpiry|cardCvc|billingName|billingPostalCode|billingCountry|enableStripePass)$/,
      );
      return {
        count: async () => 1,
        isVisible: async () => true,
        isEnabled: async () => true,
        isChecked: async () => checked,
        uncheck: async () => {
          checked = false;
        },
        selectOption: async (value) => {
          assert.equal(value, "US");
          values.set(selector, value);
        },
        fill: async (value) => {
          values.set(selector, value);
        },
        inputValue: async () => values.get(selector),
      };
    },
    getByRole: (role, options) => {
      assert.equal(role, "button");
      assert(options.name.test("Subscribe"));
      return {
        count: async () => 1,
        isVisible: async () => true,
        isEnabled: async () => true,
        click: async () => {
          clicks++;
        },
      };
    },
  };
  return {
    page,
    values,
    clicks: () => clicks,
    setLink: () => {
      checked = true;
    },
  };
}
const sample = fixture();
await fillVerifiedTestCard({ page: sample.page, sessionId });
assert.equal(sample.clicks(), 0);
sample.values.set("#cardNumber", "4242 4242 4242 4242");
sample.values.set("#cardExpiry", "12 / 34");
let claims = 0;
await submitVerifiedCardCheckout({
  page: sample.page,
  sessionId,
  claimPayment: async () => {
    claims++;
  },
});
assert.equal(sample.clicks(), 1);
assert.equal(claims, 1);
sample.setLink();
await assert.rejects(
  submitVerifiedCardCheckout({ page: sample.page, sessionId }),
  /VERIFIED_SANDBOX_CARD_FORM_REQUIRED/,
);
assert.equal(sample.clicks(), 1);
const wrong = fixture();
wrong.page.url = () => "https://checkout.stripe.com/c/pay/cs_live_unrelated";
await assert.rejects(
  fillVerifiedTestCard({ page: wrong.page, sessionId }),
  /VERIFIED_SANDBOX_CARD_FORM_REQUIRED/,
);
assert.equal(wrong.values.size, 0);
const changed = fixture();
await fillVerifiedTestCard({ page: changed.page, sessionId });
changed.values.set("#cardCvc", "999");
await assert.rejects(
  submitVerifiedCardCheckout({ page: changed.page, sessionId }),
  /VERIFIED_SANDBOX_CARD_FORM_REQUIRED/,
);
assert.equal(changed.clicks(), 0);
console.log(
  "PASS browser-only exact sandbox card form, Link opt-out, verified fields and one submit (offline)",
);
