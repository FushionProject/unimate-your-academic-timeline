import assert from "node:assert/strict";
import {
  fillRecoveryCard,
  submitRecoveryCardContinue,
} from "../../scripts/protected-stripe-browser-recovery-card-controls.mjs";
import { PROTECTED_BILLING_RECOVERY_V2 as C } from "../../scripts/protected-billing-recovery-policy.mjs";

let sequence = 0;
function fixture(options = {}) {
  const portal = {
    id: `bps_fixture${++sequence}`,
    livemode: false,
    customer: C.customer,
    return_url: `${C.origin}/upgrade`,
    url: "https://billing.stripe.com/p/session/syntheticBearer",
  };
  const values = new Map();
  const trace = [];
  const state = {
    link: false,
    url: portal.url + "/payment-method",
    frameUrl: "https://js.stripe.com/v3/fixture",
    ...options,
  };
  const fields = new Map();
  for (const id of [
    "payment-numberInput",
    "payment-expiryInput",
    "payment-cvcInput",
    "payment-countryInput",
    "payment-postalCodeInput",
    "payment-linkOptInInput",
  ]) {
    fields.set(`#${id}`, {
      count: async () => (state.missing === id ? 0 : state.duplicateField === id ? 2 : 1),
      isVisible: async () => id !== "payment-linkOptInInput" && state.hidden !== id,
      isEnabled: async () => state.disabled !== id,
      getAttribute: async (name) => {
        assert.equal(name, "type");
        return state.wrongLinkType ? "text" : "checkbox";
      },
      isChecked: async () => state.link,
      selectOption: async (value) => {
        assert.equal(id, "payment-countryInput");
        assert.equal(value, "US");
        trace.push("country");
        values.set(id, value);
      },
      fill: async (value) => {
        trace.push(id);
        values.set(id, value);
        if (state.navigateOnFill) state.url = "https://other.test/";
      },
      inputValue: async () => values.get(id) || "",
    });
  }
  const label = {
    count: async () => (state.duplicateLabel ? 2 : state.missingLabel ? 0 : 1),
    isVisible: async () => !state.hiddenLabel,
    isEnabled: async () => !state.disabledLabel,
    innerText: async () => state.labelText || "Save my information for faster checkout",
    evaluate: async (fn, id) => {
      assert.equal(id, "payment-linkOptInInput");
      const control = { id: state.wrongLabelAssociation ? "other" : id, type: "checkbox" };
      return fn(
        {
          control,
          htmlFor: state.wrappedLabel ? "" : id,
          contains: (element) => state.wrappedLabel && element === control,
        },
        id,
      );
    },
    click: async (...args) => {
      assert.deepEqual(args, [], "Link opt-out must never force-click");
      trace.push("link-opt-out");
      if (!state.optOutFails) state.link = false;
    },
  };
  const frame = {
    url: () => state.frameUrl,
    locator: (selector) => {
      if (selector === "label")
        return {
          filter: ({ hasText }) => {
            assert.equal(hasText.test("Save my information for faster checkout"), true);
            assert.equal(hasText.test("Save my information for another purpose"), false);
            return label;
          },
        };
      assert.ok(fields.has(selector), "Only observed fixed controls may be queried");
      return fields.get(selector);
    },
  };
  const button = {
    count: async () => (state.duplicateButton ? 2 : 1),
    isVisible: async () => !state.hiddenButton,
    isEnabled: async () => !state.disabledButton,
    innerText: async () => state.buttonText || "ContinueContinuing…",
    click: async () => {
      trace.push("click");
      if (state.clickThrows) throw new Error("uncertain private call details");
    },
  };
  const page = {
    url: () => state.url,
    isClosed: () => Boolean(state.closed),
    frames: () =>
      state.duplicateFrame
        ? [frame, frame]
        : [
            frame,
            ...Array.from({ length: (state.frameCount || 1) - 1 }, () => ({
              url: () => "about:blank",
              locator: () => assert.fail("Auxiliary frame controls must not be inspected"),
            })),
          ],
    getByRole: (role, spec) => {
      assert.equal(role, "button");
      assert.equal(spec.name.test("ContinueContinuing…"), true);
      assert.equal(spec.name.test("Continue to another purchase"), false);
      return button;
    },
  };
  const claimSubmit = async () => {
    trace.push("claim");
    if (state.claimThrows) throw new Error("private claim details");
    if (state.changeAfterClaim) state.link = true;
  };
  return { page, portal, state, values, trace, claimSubmit };
}

const f = fixture();
assert.deepEqual(await fillRecoveryCard(f), { filled: true, submitted: false });
assert.deepEqual(Object.fromEntries(f.values), {
  "payment-countryInput": "US",
  "payment-numberInput": "4242424242424242",
  "payment-expiryInput": "1234",
  "payment-cvcInput": "123",
  "payment-postalCodeInput": "94107",
});
assert.equal(f.trace.includes("click"), false);
assert.equal(f.state.link, false);
f.values.set("payment-numberInput", "4242 4242 4242 4242");
f.values.set("payment-expiryInput", "12 / 34");
assert.deepEqual(await submitRecoveryCardContinue(f), { clicked: true });
assert.deepEqual(f.trace.slice(-2), ["claim", "click"]);
await assert.rejects(submitRecoveryCardContinue(f));
await assert.rejects(fillRecoveryCard(f));
assert.equal(f.trace.filter((item) => item === "click").length, 1);

for (const options of [
  { url: "https://other.test/" },
  { url: "https://billing.stripe.com/p/session/other" },
  { frameUrl: "https://untrusted.test/frame" },
  { frameUrl: "https://x@js.stripe.com/v3/frame" },
  { duplicateFrame: true },
  { frameCount: 33 },
  { missing: "payment-expiryInput" },
  { duplicateField: "payment-cvcInput" },
  { hidden: "payment-numberInput" },
  { disabled: "payment-postalCodeInput" },
  { wrongLinkType: true },
  { closed: true },
]) {
  const bad = fixture(options);
  await assert.rejects(fillRecoveryCard(bad), /VERIFIED_RECOVERY_CARD_CONTROLS_REQUIRED/);
  assert.deepEqual(bad.trace, []);
}
{
  const fullPortal = fixture({ frameCount: 16 });
  assert.deepEqual(await fillRecoveryCard(fullPortal), { filled: true, submitted: false });
  assert.deepEqual(await submitRecoveryCardContinue(fullPortal), { clicked: true });
  assert.equal(fullPortal.trace.filter((item) => item === "claim").length, 1);
  assert.equal(fullPortal.trace.filter((item) => item === "click").length, 1);
}
for (const wrappedLabel of [false, true]) {
  const checked = fixture({ link: true, wrappedLabel });
  assert.deepEqual(await fillRecoveryCard(checked), { filled: true, submitted: false });
  assert.equal(checked.state.link, false);
  assert.equal(checked.trace[0], "link-opt-out");
  assert.equal(checked.trace.filter((item) => item === "link-opt-out").length, 1);
  assert.equal(checked.trace.includes("claim"), false);
}
for (const options of [
  { duplicateLabel: true },
  { missingLabel: true },
  { hiddenLabel: true },
  { disabledLabel: true },
  { labelText: "Save everything" },
  { wrongLabelAssociation: true },
  { optOutFails: true },
]) {
  const bad = fixture({ link: true, ...options });
  await assert.rejects(fillRecoveryCard(bad), /VERIFIED_RECOVERY_CARD_CONTROLS_REQUIRED/);
  assert.deepEqual(bad.trace, options.optOutFails ? ["link-opt-out"] : []);
  assert.equal(bad.values.size, 0);
}
{
  const changed = fixture({ navigateOnFill: true });
  await assert.rejects(fillRecoveryCard(changed));
  assert.deepEqual(changed.trace, ["country", "payment-numberInput"]);
}
for (const options of [
  { duplicateButton: true },
  { hiddenButton: true },
  { disabledButton: true },
  { buttonText: "Continue to purchase" },
  { claimThrows: true },
  { changeAfterClaim: true },
  { clickThrows: true },
]) {
  const bad = fixture(options);
  await fillRecoveryCard(bad);
  await assert.rejects(submitRecoveryCardContinue(bad), /VERIFIED_RECOVERY_CARD_CONTROLS_REQUIRED/);
  if (!options.clickThrows) assert.equal(bad.trace.includes("click"), false);
  if (options.claimThrows || options.changeAfterClaim || options.clickThrows) {
    await assert.rejects(submitRecoveryCardContinue(bad));
    assert.equal(bad.trace.filter((item) => item === "claim").length, 1);
  } else assert.equal(bad.trace.includes("claim"), false);
}
for (const [id, value] of [
  ["payment-numberInput", "4000000000000002"],
  ["payment-expiryInput", "12 / 35"],
  ["payment-cvcInput", "999"],
  ["payment-countryInput", "CA"],
  ["payment-postalCodeInput", "00000"],
]) {
  const bad = fixture();
  await fillRecoveryCard(bad);
  bad.values.set(id, value);
  await assert.rejects(submitRecoveryCardContinue(bad));
  assert.equal(bad.trace.includes("claim"), false);
}
{
  const bad = fixture();
  await fillRecoveryCard(bad);
  bad.state.link = true;
  await assert.rejects(submitRecoveryCardContinue(bad));
  assert.equal(bad.trace.includes("claim"), false);
}
{
  const bad = fixture();
  await fillRecoveryCard(bad);
  await assert.rejects(submitRecoveryCardContinue({ ...bad, claimSubmit: undefined }));
  assert.equal(bad.trace.includes("click"), false);
}
{
  const concurrent = fixture();
  await fillRecoveryCard(concurrent);
  const results = await Promise.allSettled([
    submitRecoveryCardContinue(concurrent),
    submitRecoveryCardContinue(concurrent),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.trace.filter((item) => item === "claim").length, 1);
  assert.equal(concurrent.trace.filter((item) => item === "click").length, 1);
}
console.log(
  "PASS fixed Portal card controls: exact sandbox/session/frame, published test fields, Link off, separate fill/one-shot Continue, no payment claim (offline)",
);
