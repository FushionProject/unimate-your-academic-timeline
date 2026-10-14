import assert from "node:assert/strict";
import {
  openVerifiedCancellation,
  chooseVerifiedCancellationReason,
  confirmVerifiedCancellation,
  cancelVerifiedTestSubscription,
} from "../../scripts/protected-stripe-browser-cancel.mjs";

const refused = /VERIFIED_SANDBOX_PORTAL_CANCELLATION_REQUIRED/;
function fixture({
  origin = "https://billing.stripe.com",
  sandbox = true,
  product = "UniMate Pro",
  price = "$5.99",
  phase = "portal",
  comments = 1,
  modalStillPresent = false,
  delayedHydration = false,
  overrides = {},
} = {}) {
  const actions = [];
  const waiters = [];
  let hydrated = !delayedHydration;
  const control = (key) => {
    const values = overrides[key] || {};
    return {
      count: async () => values.count ?? (key === "comment" ? comments : 1),
      isVisible: async () =>
        values.visible ?? (key !== "next" || phase !== "confirm" || modalStillPresent),
      isEnabled: async () => values.enabled ?? true,
      getAttribute: async (name) => {
        assert.equal(key, "link");
        assert.equal(name, "href");
        return values.href ?? "/p/session/fixture/cancel";
      },
      waitFor: async (options) => {
        assert.deepEqual(options, { state: "visible", timeout: 15000 });
        waiters.push(key);
        if (key === "link") hydrated = true;
      },
      click: async () => {
        actions.push(key);
        const expected = {
          link: ["portal", "reason"],
          choice: ["reason", "opened"],
          other: ["opened", "selected"],
          next: ["selected", "confirm"],
          confirm: ["confirm", "finished"],
        }[key];
        assert.ok(expected, "Only observed controls may be clicked");
        assert.equal(phase, expected[0]);
        phase = expected[1];
      },
      fill: async (value) => {
        assert.equal(key, "comment");
        assert.equal(phase, "selected");
        assert.equal(value, "Sandbox subscription lifecycle verification");
        actions.push("comment");
      },
    };
  };
  const page = {
    url: () => `${origin}/p/session/fixture`,
    locator: (selector) => {
      if (selector === "body")
        return {
          innerText: async () => {
            if (!hydrated) return "";
            return `${sandbox ? "Sandbox" : ""} ${product} ${price} Cancel subscription`;
          },
        };
      assert.equal(selector, "textarea:visible");
      return control("comment");
    },
    getByRole: (role, { name, exact }) => {
      if (role === "link") {
        assert.equal(name, "Cancel subscription");
        assert.equal(exact, true);
        return control("link");
      }
      assert.equal(role, "button");
      if (name instanceof RegExp) {
        assert.equal(name.source, "^Cancel subscription");
        assert.equal(name.test("Cancel subscription Canceling..."), true);
        assert.equal(exact, undefined);
        return control("confirm");
      }
      assert.equal(exact, true);
      assert.ok(["Choose an option", "Continue to cancellation"].includes(name));
      return control(name === "Choose an option" ? "choice" : "next");
    },
    getByText: (text, options) => {
      assert.equal(text, "Other");
      assert.deepEqual(options, { exact: true });
      return control("other");
    },
  };
  return { page, actions, waiters, phase: () => phase };
}

// The staged exports and combined wrapper must perform one confirmation only,
// after the observed dropdown/modal progression, with or without a comment.
for (const comments of [0, 1]) {
  for (const staged of [false, true]) {
    const x = fixture({ comments });
    if (staged) {
      await openVerifiedCancellation({ page: x.page });
      assert.deepEqual(x.actions, ["link"]);
      await chooseVerifiedCancellationReason({ page: x.page });
      assert.equal(x.phase(), "confirm");
      assert.equal(x.actions.includes("confirm"), false);
      await confirmVerifiedCancellation({ page: x.page });
    } else await cancelVerifiedTestSubscription({ page: x.page });
    assert.deepEqual(x.actions, [
      "link",
      "choice",
      "other",
      ...(comments ? ["comment"] : []),
      "next",
      "confirm",
    ]);
    assert.deepEqual(x.waiters, ["link", "choice", "other", "next", "confirm"]);
    assert.equal(x.actions.filter((action) => action === "confirm").length, 1);
    assert.equal(x.phase(), "finished");
  }
}

{
  const x = fixture({ delayedHydration: true });
  await openVerifiedCancellation({ page: x.page });
  assert.deepEqual(x.waiters, ["link"]);
  assert.deepEqual(x.actions, ["link"], "identity is checked only after the exact link hydrates");
}

for (const [action, phase] of [
  [openVerifiedCancellation, "portal"],
  [chooseVerifiedCancellationReason, "reason"],
  [confirmVerifiedCancellation, "confirm"],
  [cancelVerifiedTestSubscription, "portal"],
]) {
  for (const options of [
    { origin: "https://example.test" },
    { origin: "https://billing.stripe.com.example.test" },
    { origin: "https://user:password@billing.stripe.com" },
    { sandbox: false },
    { product: "Another product" },
  ]) {
    const x = fixture({ ...options, phase });
    await assert.rejects(action({ page: x.page }), refused);
    assert.deepEqual(x.actions, [], "Unverified pages must cause no click or fill");
  }
}

for (const options of [
  { price: "$6.99" },
  { overrides: { link: { count: 0 } } },
  { overrides: { link: { count: 2 } } },
  { overrides: { link: { visible: false } } },
  { overrides: { link: { href: "https://other.test/cancel" } } },
  { overrides: { link: { href: "https://user:password@billing.stripe.com/cancel" } } },
]) {
  const x = fixture(options);
  await assert.rejects(openVerifiedCancellation({ page: x.page }), refused);
  assert.deepEqual(x.actions, []);
}

for (const [overrides, expected] of [
  [{ choice: { count: 0 } }, []],
  [{ choice: { count: 2 } }, []],
  [{ choice: { enabled: false } }, []],
  [{ other: { count: 2 } }, ["choice"]],
  [{ other: { visible: false } }, ["choice"]],
  [{ comment: { count: 2 } }, ["choice", "other"]],
  [{ comment: { enabled: false } }, ["choice", "other"]],
  [{ next: { count: 2 } }, ["choice", "other", "comment"]],
  [{ next: { visible: false } }, ["choice", "other", "comment"]],
  [{ next: { enabled: false } }, ["choice", "other", "comment"]],
]) {
  const x = fixture({ phase: "reason", overrides });
  await assert.rejects(chooseVerifiedCancellationReason({ page: x.page }), refused);
  assert.deepEqual(x.actions, expected);
  assert.equal(x.actions.includes("confirm"), false);
}

for (const options of [
  { overrides: { confirm: { count: 0 } } },
  { overrides: { confirm: { count: 2 } } },
  { overrides: { confirm: { enabled: false } } },
  { modalStillPresent: true },
]) {
  const x = fixture({ ...options, phase: "confirm" });
  await assert.rejects(confirmVerifiedCancellation({ page: x.page }), refused);
  assert.deepEqual(x.actions, []);
}

console.log(
  "PASS offline sandbox cancellation: staged dropdown/modal flow, optional comment, one confirmation, origin/sandbox/control guards",
);
