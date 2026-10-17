import assert from "node:assert/strict";
import * as form from "../../scripts/protected-stripe-browser-recovery-form.mjs";
import { PROTECTED_BILLING_RECOVERY_V2 as C } from "../../scripts/protected-billing-recovery-policy.mjs";

assert.deepEqual(Object.keys(form).sort(), [
  "assertRecoverySubscriptionForm",
  "continueVerifiedRecoveryCard",
  "fillVerifiedRecoveryCard",
  "navigateVerifiedRecoveryAdd",
]);

let sequence = 0;
function fixture(options = {}) {
  const portal = {
    id: `bps_wrapper${++sequence}`,
    livemode: false,
    customer: C.customer,
    return_url: `${C.origin}/upgrade`,
    url: "https://billing.stripe.com/p/session/syntheticBearer",
  };
  const trace = [];
  const state = {
    url: `${portal.url}/subscriptions/sub_fixture/payment-method`,
    added: false,
    ...options,
  };
  const element = (value) => ({
    id: "",
    name: "",
    type: "",
    visible: true,
    disabled: false,
    labels: [],
    label: "",
    text: "",
    ...value,
  });
  const mainFrame = {
    url: () => state.url,
    locator: (selector) => ({
      evaluateAll: async () => ({
        truncated: false,
        elements:
          selector === "input,select,textarea"
            ? [element({ tag: "input", type: "radio", visible: false })]
            : [
                element({ tag: "button", text: "Add payment method" }),
                element({ tag: "button", text: "Go back" }),
                element({ tag: "button", text: "Continue", disabled: true }),
              ],
      }),
    }),
  };
  const cardFrame = {
    url: () => "https://js.stripe.com/v3/syntheticCardFrame",
    locator: (selector) => {
      assert.match(selector, /^#payment-(number|expiry|cvc|country|postalCode)Input$/);
      return {
        count: async () => (state.missingCardField === selector ? 0 : 1),
        isVisible: async () => true,
        isEnabled: async () => true,
      };
    },
  };
  const add = {
    count: async () => (state.duplicateAdd ? 2 : 1),
    isVisible: async () => !state.hiddenAdd,
    isEnabled: async () => !state.disabledAdd,
    click: async (...args) => {
      assert.deepEqual(args, []);
      assert.equal(trace.at(-1), "claim");
      trace.push("add-click");
      state.added = true;
    },
  };
  const page = {
    url: () => state.url,
    isClosed: () => Boolean(state.closed),
    frames: () => (state.added ? [mainFrame, cardFrame] : [mainFrame]),
    getByRole: (role, options) => {
      assert.equal(role, "button");
      assert.deepEqual(options, { name: "Add payment method", exact: true });
      return add;
    },
    waitForTimeout: async (delay) => {
      assert.equal(delay, 250);
      trace.push("wait");
    },
  };
  const claimAction = async () => {
    trace.push("claim");
    if (state.claimThrows) throw new Error("synthetic claim failure");
    if (state.navigateAfterClaim) state.url = "https://other.test/";
  };
  return { page, portal, subscriptionId: "sub_fixture", claimAction, state, trace };
}

{
  const good = fixture();
  assert.deepEqual(await form.navigateVerifiedRecoveryAdd(good), {
    navigated: true,
    submitted: false,
  });
  assert.deepEqual(good.trace, ["claim", "add-click"]);
}

for (const options of [
  { url: "https://other.test/sub_fixture" },
  { url: "https://billing.stripe.com/p/session/other/sub_fixture" },
  { url: "https://billing.stripe.com/p/session/syntheticBearer/sub_wrong" },
  { url: "https://billing.stripe.com/p/session/syntheticBearer/sub_fixture_extra" },
  { closed: true },
]) {
  for (const method of [
    form.navigateVerifiedRecoveryAdd,
    form.fillVerifiedRecoveryCard,
    form.continueVerifiedRecoveryCard,
  ]) {
    const bad = fixture(options);
    await assert.rejects(method(bad));
    assert.deepEqual(bad.trace, []);
  }
}
for (const options of [{ duplicateAdd: true }, { hiddenAdd: true }, { disabledAdd: true }]) {
  const bad = fixture(options);
  await assert.rejects(form.navigateVerifiedRecoveryAdd(bad));
  assert.deepEqual(bad.trace, []);
}
for (const options of [{ claimThrows: true }, { navigateAfterClaim: true }]) {
  const bad = fixture(options);
  await assert.rejects(form.navigateVerifiedRecoveryAdd(bad));
  assert.deepEqual(bad.trace, ["claim"]);
}
{
  const bad = fixture({ missingCardField: "#payment-expiryInput" });
  await assert.rejects(form.navigateVerifiedRecoveryAdd(bad));
  assert.equal(bad.trace.filter((item) => item === "claim").length, 1);
  assert.equal(bad.trace.filter((item) => item === "add-click").length, 1);
  assert.equal(bad.trace.filter((item) => item === "wait").length, 60);
}
for (const method of [
  form.navigateVerifiedRecoveryAdd,
  form.fillVerifiedRecoveryCard,
  form.continueVerifiedRecoveryCard,
]) {
  const bad = fixture();
  await assert.rejects(method({ ...bad, claimAction: undefined }));
  assert.deepEqual(bad.trace, []);
}
for (const method of [form.fillVerifiedRecoveryCard, form.continueVerifiedRecoveryCard]) {
  const noCardFrame = fixture();
  await assert.rejects(method(noCardFrame));
  assert.deepEqual(noCardFrame.trace, [], "Card helper preflight must precede wrapper claim");
}
console.log(
  "PASS fixed Portal wrapper: exact session/subscription, claim-before-navigation, card preflight delegation, no confirmation export (offline)",
);
