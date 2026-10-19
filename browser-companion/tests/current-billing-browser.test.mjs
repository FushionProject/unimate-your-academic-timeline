import assert from "node:assert/strict";
import {
  fillCurrentTestCard,
  submitCurrentTestCheckout,
  fillCurrentStandardTestCard,
  submitCurrentStandardTestCheckout,
} from "../../scripts/current-billing-browser.mjs";
import { CURRENT_BILLING_CONTINUATION } from "../../scripts/current-billing-policy.mjs";

let sequence = 0;
const expected = {
  cardNumber: "4000000000003220",
  cardExpiry: "1234",
  cardCvc: "123",
  billingName: "UniMate Sandbox Test",
  billingPostalCode: "94107",
  billingCountry: "US",
};
function fixture(overrides = {}, profile = "three-d-secure") {
  const sessionId = `cs_test_fixture${++sequence}`;
  const events = [];
  const state = {
    url: `https://checkout.stripe.com/c/pay/${sessionId}`,
    text: "Sandbox UniMate Pro $9.99 per month Subscribe",
    closed: false,
    checked: true,
    checkboxType: "checkbox",
    linkLabelCount: 1,
    linkLabelVisible: true,
    linkLabelEnabled: true,
    linkLabelText: "Save my information with Link for faster checkout",
    linkAssociation: "for",
    fieldCount: 1,
    fieldVisible: true,
    fieldEnabled: true,
    buttonCount: 1,
    buttonVisible: true,
    buttonEnabled: true,
    badField: "cardCvc",
    values: new Map(),
    ...overrides,
  };
  const page = {
    url: () => state.url,
    isClosed: () => state.closed,
    locator: (selector) => {
      if (selector === "body") return { innerText: async () => state.text };
      if (selector === "label")
        return {
          filter: ({ hasText }) => {
            assert.equal(hasText.source, "^Save my information with Link for faster checkout$");
            return {
              count: async () => state.linkLabelCount,
              isVisible: async () => state.linkLabelVisible,
              isEnabled: async () => state.linkLabelEnabled,
              innerText: async () => state.linkLabelText,
              evaluate: async (fn) => {
                const input = {
                  id: state.linkAssociation === "wrong-id" ? "other" : "enableStripePass",
                  tagName: "INPUT",
                  type: state.checkboxType,
                };
                input.ownerDocument = {
                  getElementById: () => (state.linkAssociation === "wrong-element" ? {} : input),
                };
                return fn({
                  control: state.linkAssociation === "no-control" ? null : input,
                  htmlFor: state.linkAssociation === "for" ? input.id : "",
                  contains: (element) => state.linkAssociation === "nested" && element === input,
                });
              },
              click: async (...args) => {
                assert.deepEqual(args, [], "Normal label click only, no force");
                assert.ok(events.includes("claim-fill"));
                if (state.requireActive) assert.equal(events.at(-1), "active");
                events.push("link-label");
                if (state.writeFails) throw new Error("Synthetic private error");
                if (!state.linkStaysChecked) state.checked = !state.checked;
                state.afterWrite?.("link-label");
              },
            };
          },
        };
      assert.match(
        selector,
        /^#(?:cardNumber|cardExpiry|cardCvc|billingName|billingPostalCode|billingCountry|enableStripePass)$/,
      );
      const id = selector.slice(1);
      const checkedWrite = (kind, value) => {
        assert.ok(events.includes("claim-fill"), "Every form write follows a fill claim");
        if (state.requireActive)
          assert.equal(events.at(-1), "active", "Check immediately before UI write");
        events.push(kind);
        if (state.writeFails) throw new Error("Synthetic private value must not escape");
        state.values.set(id, value);
        state.afterWrite?.(kind);
      };
      return {
        count: async () => (id === state.badField ? state.fieldCount : 1),
        isVisible: async () => (id === state.badField ? state.fieldVisible : true),
        isEnabled: async () => (id === state.badField ? state.fieldEnabled : true),
        isChecked: async () => state.checked,
        getAttribute: async (name) => {
          assert.equal(id, "enableStripePass");
          assert.equal(name, "type");
          return state.checkboxType;
        },
        inputValue: async () => state.values.get(id) || "",
        uncheck: async () => {
          checkedWrite("uncheck", false);
          if (!state.linkStaysChecked) state.checked = false;
        },
        selectOption: async (value) => checkedWrite("country", value),
        fill: async (value) => checkedWrite("fill", value),
      };
    },
    getByRole: (role, options) => {
      assert.equal(role, "button");
      assert.ok(options.name.test("Subscribe"));
      return {
        count: async () => state.buttonCount,
        isVisible: async () => state.buttonVisible,
        isEnabled: async () => state.buttonEnabled,
        click: async () => {
          assert.ok(events.includes("claim-payment"), "Submit follows its durable payment claim");
          if (state.requireActive)
            assert.equal(events.at(-1), "active", "Check immediately before click");
          events.push("click");
          if (state.clickFails) throw new Error("Synthetic private URL must not escape");
        },
      };
    },
  };
  const claimFill = async (id) => {
    assert.equal(id, sessionId);
    if (state.requireActive) assert.equal(events.at(-1), "active", "Check before fill claim");
    events.push("claim-fill");
    if (state.fillClaimFails) throw new Error("Synthetic private claim error");
    state.afterFillClaim?.();
  };
  const claimPayment = async (id) => {
    assert.equal(id, sessionId);
    if (state.requireActive) assert.equal(events.at(-1), "active", "Check before payment claim");
    events.push("claim-payment");
    if (state.paymentClaimFails) throw new Error("Synthetic private claim error");
    state.afterPaymentClaim?.();
  };
  return {
    state,
    events,
    page,
    sessionId,
    claimFill,
    claimPayment,
    fill: (assertActive) =>
      (profile === "standard" ? fillCurrentStandardTestCard : fillCurrentTestCard)({
        page,
        sessionId,
        claimFill,
        assertActive,
      }),
    submit: (assertActive) =>
      (profile === "standard" ? submitCurrentStandardTestCheckout : submitCurrentTestCheckout)({
        page,
        sessionId,
        claimPayment,
        assertActive,
      }),
  };
}
const rejected = (promise) =>
  assert.rejects(promise, { message: "CURRENT_SANDBOX_CARD_FORM_REQUIRED" });

for (const checked of [true, false]) {
  const sample = fixture({ checked, buttonEnabled: false });
  assert.deepEqual(await sample.fill(), { filled: true, submitted: false });
  assert.equal(sample.events[0], "claim-fill");
  assert.equal(sample.events.filter((event) => event === "uncheck").length, checked ? 1 : 0);
  assert.equal(sample.events.includes("click"), false);
  assert.equal(sample.state.checked, false);
  assert.deepEqual(
    Object.fromEntries([...sample.state.values].filter(([key]) => key !== "enableStripePass")),
    expected,
  );
  const before = sample.events.length;
  await rejected(sample.fill());
  assert.equal(sample.events.length, before, "No second fill claim or UI write");
  sample.state.buttonEnabled = true;
  sample.state.values.set("cardNumber", "4000 0000 0000 3220");
  sample.state.values.set("cardExpiry", "12 / 34");
  assert.deepEqual(await sample.submit(), { clicked: true, challengeHandled: false });
  assert.deepEqual(sample.events.slice(-2), ["claim-payment", "click"]);
  await rejected(sample.submit());
  assert.equal(sample.events.filter((event) => event === "click").length, 1);
}

for (const bad of [
  { text: "Sandbox UniMate Pro $5.99 per month" },
  { text: "Sandbox UniMate Pro $9.99 per month, previously $5.99" },
  { text: "Sandbox UniMate Pro $99.99 per month" },
  { text: "Sandbox UniMate Pro $9.990 per month" },
  { text: "Sandbox UniMate Pro $9.99 per year" },
  { text: "UniMate Pro $9.99 per month" },
  { text: "Sandbox Unrelated $9.99 per month" },
  { closed: true },
  { fieldCount: 0 },
  { fieldCount: 2 },
  { fieldVisible: false },
  { fieldEnabled: false },
  { badField: "enableStripePass", fieldVisible: false, linkLabelVisible: false },
  { buttonCount: 0 },
  { buttonCount: 2 },
  { buttonVisible: false },
]) {
  const sample = fixture(bad);
  await rejected(sample.fill());
  await rejected(sample.submit());
  assert.deepEqual(sample.events, [], "Failed preflight makes no claim or UI change");
}
for (const transform of [
  (id) => `https://example.test/c/pay/${id}`,
  (id) => `https://checkout.stripe.com:444/c/pay/${id}`,
  (id) => `http://checkout.stripe.com/c/pay/${id}`,
  (id) => `https://user:secret@checkout.stripe.com/c/pay/${id}`,
  () => "https://checkout.stripe.com/c/pay/cs_test_other",
  () => "https://checkout.stripe.com/c/pay/cs_live_other",
  () => "not-a-url",
]) {
  const sample = fixture();
  sample.state.url = transform(sample.sessionId);
  await rejected(sample.fill());
  await rejected(sample.submit());
  assert.deepEqual(sample.events, []);
}

const missingClaim = fixture();
await rejected(fillCurrentTestCard({ page: missingClaim.page, sessionId: missingClaim.sessionId }));
assert.deepEqual(missingClaim.events, []);
for (const mode of ["fillClaimFails", "writeFails", "linkStaysChecked"]) {
  const sample = fixture({ [mode]: true });
  await rejected(sample.fill());
  const events = [...sample.events];
  await rejected(sample.fill());
  assert.deepEqual(sample.events, events, "Uncertain fill is not replayed");
  if (mode === "fillClaimFails") assert.deepEqual(events, ["claim-fill"]);
  assert.equal(events.includes("click"), false);
}
for (const mutate of [
  (s) => {
    s.checked = true;
  },
  (s) => {
    s.values.set("cardNumber", "4242424242424242");
  },
  (s) => {
    s.values.set("cardNumber", "4000000000003220x");
  },
  (s) => {
    s.values.set("cardExpiry", "1235");
  },
  (s) => {
    s.values.set("cardCvc", "999");
  },
  (s) => {
    s.values.set("billingName", "Another name");
  },
  (s) => {
    s.values.set("billingPostalCode", "00000");
  },
  (s) => {
    s.values.set("billingCountry", "CA");
  },
  (s) => {
    s.buttonEnabled = false;
  },
  (s) => {
    s.buttonCount = 2;
  },
]) {
  const sample = fixture();
  await sample.fill();
  mutate(sample.state);
  const events = [...sample.events];
  await rejected(sample.submit());
  assert.deepEqual(sample.events, events, "Changed values/controls cannot claim or submit");
}
for (const mode of ["paymentClaimFails", "clickFails"]) {
  const sample = fixture();
  await sample.fill();
  sample.state[mode] = true;
  await rejected(sample.submit());
  const events = [...sample.events];
  await rejected(sample.submit());
  assert.deepEqual(sample.events, events, "Uncertain payment is not replayed");
  assert.equal(events.filter((event) => event === "click").length, mode === "clickFails" ? 1 : 0);
}
for (const stage of ["fill", "payment"]) {
  for (const mutate of [
    (s) => {
      s.url = "https://checkout.stripe.com/c/pay/cs_test_changed";
    },
    (s) => {
      s.text = "Sandbox UniMate Pro $5.99 per month";
    },
  ]) {
    const sample = fixture();
    if (stage === "payment") await sample.fill();
    sample.state[stage === "fill" ? "afterFillClaim" : "afterPaymentClaim"] = () =>
      mutate(sample.state);
    const before = sample.events.length;
    await rejected(stage === "fill" ? sample.fill() : sample.submit());
    assert.deepEqual(
      sample.events.slice(before),
      [`claim-${stage}`],
      "Claim-time drift stops all subsequent UI writes",
    );
  }
}
for (const stage of ["fill", "submit"]) {
  const sample = fixture();
  if (stage === "submit") await sample.fill();
  const outcomes = await Promise.allSettled([sample[stage](), sample[stage]()]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(
    sample.events.filter((event) => event === (stage === "fill" ? "claim-fill" : "click")).length,
    1,
  );
}

for (const mutate of [
  (s) => {
    s.checked = true;
  },
  (s) => {
    s.values.set("cardNumber", "4242424242424242");
  },
  (s) => {
    s.buttonCount = 2;
  },
  (s) => {
    s.buttonEnabled = false;
  },
]) {
  const sample = fixture();
  await sample.fill();
  sample.state.afterPaymentClaim = () => mutate(sample.state);
  const before = sample.events.length;
  await rejected(sample.submit());
  assert.deepEqual(
    sample.events.slice(before),
    ["claim-payment"],
    "Recheck values and controls after the durable claim",
  );
}

for (const checked of [true, false]) {
  const sample = fixture({ checked, requireActive: true });
  const assertActive = () => sample.events.push("active");
  await sample.fill(assertActive);
  await sample.submit(assertActive);
  assert.equal(sample.events.filter((event) => event === "click").length, 1);
  assert.equal(sample.events.filter((event) => event === "fill").length, 5);
  assert.equal(sample.events.filter((event) => event === "uncheck").length, checked ? 1 : 0);
}

for (const stage of ["fill", "submit"]) {
  for (const stopAfterClaim of [false, true]) {
    const sample = fixture();
    if (stage === "submit") await sample.fill();
    let active = stopAfterClaim;
    const assertActive = () => {
      if (!active) throw new Error("Synthetic run expired or stopped");
    };
    sample.state[stage === "fill" ? "afterFillClaim" : "afterPaymentClaim"] = () => {
      active = false;
    };
    const before = sample.events.length;
    await rejected(sample[stage](assertActive));
    assert.deepEqual(
      sample.events.slice(before),
      stopAfterClaim ? [stage === "fill" ? "claim-fill" : "claim-payment"] : [],
      "A stopped/expired run cannot write, including after awaiting its claim with unchanged UI",
    );
  }
}

for (const stopAfterWrite of ["uncheck", "country", "fill"]) {
  const sample = fixture();
  let active = true;
  sample.state.afterWrite = (kind) => {
    if (kind === stopAfterWrite) active = false;
  };
  await rejected(
    sample.fill(() => {
      if (!active) throw new Error("Synthetic run stopped between UI writes");
    }),
  );
  assert.equal(sample.events.at(-1), stopAfterWrite, "No next UI write after stop");
  assert.equal(sample.events.includes("click"), false);
}

for (const checked of [true, false]) {
  for (const linkAssociation of ["for", "nested"]) {
    const sample = fixture({
      checked,
      linkAssociation,
      badField: "enableStripePass",
      fieldVisible: false,
      requireActive: true,
    });
    const active = () => sample.events.push("active");
    await sample.fill(active);
    assert.equal(sample.state.checked, false);
    assert.equal(sample.events.filter((event) => event === "link-label").length, checked ? 1 : 0);
    assert.equal(sample.events.includes("uncheck"), false);
    await sample.submit(active);
    assert.equal(sample.events.filter((event) => event === "click").length, 1);
  }
}
for (const patch of [
  { checkboxType: "text" },
  { linkLabelCount: 0 },
  { linkLabelCount: 2 },
  { linkLabelVisible: false },
  { linkLabelEnabled: false },
  { linkLabelText: "Save different information" },
  { linkAssociation: "no-control" },
  { linkAssociation: "wrong-id" },
  { linkAssociation: "wrong-element" },
  { linkAssociation: "unassociated" },
]) {
  const sample = fixture({ badField: "enableStripePass", fieldVisible: false, ...patch });
  await rejected(sample.fill());
  assert.deepEqual(
    sample.events,
    [],
    "Hidden checkbox requires a unique ready associated label before claim",
  );
}
for (const patch of [
  { linkLabelVisible: false },
  { linkAssociation: "wrong-element" },
  { checkboxType: "text" },
]) {
  const sample = fixture({ badField: "enableStripePass", fieldVisible: false });
  sample.state.afterFillClaim = () => Object.assign(sample.state, patch);
  await rejected(sample.fill());
  assert.deepEqual(
    sample.events,
    ["claim-fill"],
    "Revalidate hidden-checkbox label after awaited claim",
  );
}
{
  const sample = fixture({
    badField: "enableStripePass",
    fieldVisible: false,
    linkStaysChecked: true,
  });
  await rejected(sample.fill());
  assert.deepEqual(
    sample.events,
    ["claim-fill", "link-label"],
    "A failed opt-out prevents all card filling",
  );
  await rejected(sample.fill());
  assert.equal(sample.events.filter((event) => event === "link-label").length, 1);
}
{
  const sample = fixture({ badField: "enableStripePass", fieldVisible: false });
  let active = true;
  sample.state.afterWrite = () => {
    active = false;
  };
  await rejected(
    sample.fill(() => {
      if (!active) throw new Error("Stopped");
    }),
  );
  assert.deepEqual(
    sample.events,
    ["claim-fill", "link-label"],
    "Stop after label click prevents the next form write",
  );
}

// Standard-card mode uses a new session after retirement, not a second attempt
// on the old authentication Checkout. Shared controls/claims stay fail-closed.
for (const checked of [true, false]) {
  const sample = fixture(
    { checked, badField: "enableStripePass", fieldVisible: false, requireActive: true },
    "standard",
  );
  const active = () => sample.events.push("active");
  assert.deepEqual(await sample.fill(active), { filled: true, submitted: false });
  assert.equal(sample.state.values.get("cardNumber"), "4242424242424242");
  assert.equal(sample.state.checked, false);
  assert.equal(sample.events.filter((event) => event === "link-label").length, checked ? 1 : 0);
  assert.deepEqual(Object.fromEntries(sample.state.values), {
    ...expected,
    cardNumber: "4242424242424242",
  });
  assert.deepEqual(await sample.submit(active), { clicked: true, challengeHandled: false });
  assert.equal(sample.events.filter((event) => event === "click").length, 1);
  const before = [...sample.events];
  await rejected(sample.fill(active));
  await rejected(sample.submit(active));
  assert.deepEqual(sample.events, before);
}
for (const profile of ["standard", "three-d-secure"]) {
  const sample = fixture({}, profile);
  await sample.fill();
  const other =
    profile === "standard" ? submitCurrentTestCheckout : submitCurrentStandardTestCheckout;
  const before = [...sample.events];
  await rejected(
    other({ page: sample.page, sessionId: sample.sessionId, claimPayment: sample.claimPayment }),
  );
  assert.deepEqual(sample.events, before, "A completed fill cannot switch payment-card profile");
  await sample.submit();
  assert.equal(sample.events.filter((event) => event === "click").length, 1);
}
{
  const sample = fixture({}, "standard");
  await rejected(sample.submit());
  assert.deepEqual(
    sample.events,
    [],
    "Standard payment requires this process's completed matching fill",
  );
  await sample.fill();
  sample.state.values.set("cardNumber", "4000000000003220");
  await rejected(sample.submit());
  assert.equal(
    sample.events.includes("claim-payment"),
    false,
    "Reject post-fill card substitution before payment claim",
  );
}
{
  const sample = fixture({ writeFails: true }, "standard");
  await rejected(sample.fill());
  sample.state.checked = false;
  sample.state.values = new Map(Object.entries({ ...expected, cardNumber: "4242424242424242" }));
  await rejected(sample.submit());
  assert.equal(
    sample.events.includes("claim-payment"),
    false,
    "A failed fill cannot be promoted to payment by prepopulated values",
  );
  const before = [...sample.events];
  await rejected(sample.fill());
  assert.deepEqual(sample.events, before);
}
{
  const sample = fixture({}, "standard");
  const sessionId = CURRENT_BILLING_CONTINUATION.sessionId;
  sample.state.url = `https://checkout.stripe.com/c/pay/${sessionId}`;
  for (const helper of [fillCurrentStandardTestCard, submitCurrentStandardTestCheckout])
    await rejected(
      helper({
        page: sample.page,
        sessionId,
        claimFill: sample.claimFill,
        claimPayment: sample.claimPayment,
      }),
    );
  assert.deepEqual(
    sample.events,
    [],
    "The original failed-authentication Checkout cannot use standard mode",
  );
}
for (const mode of ["claim", "click"]) {
  const sample = fixture({}, "standard");
  await sample.fill();
  sample.state[mode === "claim" ? "paymentClaimFails" : "clickFails"] = true;
  await rejected(sample.submit());
  const before = [...sample.events];
  await rejected(sample.submit());
  assert.deepEqual(sample.events, before, "Uncertain standard payment remains one-shot");
}
{
  const sample = fixture({}, "standard");
  await sample.fill();
  const outcomes = await Promise.allSettled([sample.submit(), sample.submit()]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(sample.events.filter((event) => event === "click").length, 1);
}
console.log(
  "PASS fixed $9.99 sandbox card controls: 3DS/standard fill binding, Link opt-out, claims before writes, one submit, no challenge/retry (offline)",
);
