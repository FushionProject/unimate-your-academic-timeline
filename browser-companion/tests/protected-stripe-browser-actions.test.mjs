import assert from "node:assert/strict";
import vm from "node:vm";
import { inspectStripeSurface } from "../../scripts/protected-stripe-browser-actions.mjs";

function element({
  tag = "input",
  attrs = {},
  labels = [],
  text = "",
  hidden = false,
  disabled = false,
  childField = false,
} = {}) {
  const result = {
    tagName: tag.toUpperCase(),
    labels: labels.map((textContent) =>
      typeof textContent === "string" ? { textContent } : textContent,
    ),
    textContent: text,
    hidden,
    getAttribute: (name) => {
      assert.ok(["id", "name", "type", "role", "aria-label", "aria-disabled"].includes(name));
      return attrs[name] ?? null;
    },
    getBoundingClientRect: () => ({ width: hidden ? 0 : 200, height: hidden ? 0 : 30 }),
    matches: (selector) => {
      assert.equal(selector, ":disabled");
      return disabled;
    },
    querySelector: (selector) => {
      assert.equal(selector, "input,textarea,select");
      return childField ? {} : null;
    },
  };
  for (const property of ["value", "selectedOptions", "innerHTML", "href", "src", "action"])
    Object.defineProperty(result, property, {
      get: () => assert.fail(`Must not read ${property}`),
    });
  return result;
}
function frame(url, inputs = [], controls = []) {
  let current = url;
  const calls = [];
  return {
    url: () => current,
    navigate: (next) => {
      current = next;
    },
    calls,
    locator: (selector) => ({
      evaluateAll: async (fn) => {
        calls.push(selector);
        assert.ok(
          ["input,select,textarea", 'button,a,[role="button"],[role="link"]'].includes(selector),
        );
        const context = vm.createContext({
          getComputedStyle: (el) => ({
            display: "block",
            visibility: el.hidden ? "hidden" : "visible",
            opacity: "1",
          }),
        });
        const result = vm.runInContext(
          `(${fn.toString()})`,
          context,
        )(selector.startsWith("input") ? inputs : controls);
        return JSON.parse(JSON.stringify(result));
      },
    }),
  };
}
const page = (url, frames) => ({ url: () => url, frames: () => frames });

const secrets = [
  "unimate-billing-fixture@example.test",
  "https://checkout.stripe.com/c/pay/cs_test_SensitiveSession",
  "cs_test_SecretSession",
  "sk_test_SecretKey",
  "rk_test_RestrictedKey",
  "whsec_SigningSecret",
  "pi_private_secret_secretvalue",
  "sb_secret_DatabaseSecret",
  "bps_portalsession",
  "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE4MDAwMDAwMDB9.signature",
  "a".repeat(40),
  "4242 4242 4242 4242",
];
{
  const root = frame(
    "https://checkout.stripe.com/c/pay/cs_test_Private#private",
    [
      element({
        attrs: { id: "cardNumber", name: "cardNumber", type: "text", "aria-label": "Card number" },
        labels: ["Card details"],
      }),
      element({
        tag: "textarea",
        attrs: { id: "private" },
        text: "MUST_NOT_READ_TEXTAREA_CONTENT",
        hidden: true,
      }),
    ],
    [
      element({
        tag: "button",
        attrs: { id: "subscribe", "aria-label": "Subscribe" },
        text: "Subscribe",
        disabled: true,
      }),
      element({
        tag: "button",
        text: secrets.join(" | "),
        attrs: { id: secrets[2], name: secrets[3] },
      }),
      element({ tag: "button", text: "MUST_NOT_READ_FIELD_ANCESTOR_CONTENT", childField: true }),
    ],
  );
  const child = frame("https://js.stripe.com/v3/elements-inner-card?private-token", [
    element({ attrs: { name: "cardCvc", type: "text" } }),
  ]);
  const unrelated = frame("https://example.test/other", [element()]);
  const result = await inspectStripeSurface(page(root.url(), [root, child, unrelated]));
  assert.equal(result.surface, "stripe-checkout");
  assert.equal(result.framesInspected, 2);
  assert.equal(result.inputs.length, 3);
  assert.equal(result.inputs[0].id, "cardNumber");
  assert.equal(result.inputs[0].visible, true);
  assert.equal(result.inputs[1].visible, false);
  assert.equal(result.controls[0].text, "Subscribe");
  assert.equal(result.controls[0].disabled, true);
  assert.equal(result.inspectionOnly, true);
  assert.equal(result.paymentSubmissionEnabled, false);
  assert.equal(result.cancellationEnabled, false);
  assert.equal(unrelated.calls.length, 0);
  const serialized = JSON.stringify(result);
  for (const secret of [
    ...secrets,
    "MUST_NOT_READ_TEXTAREA_CONTENT",
    "MUST_NOT_READ_FIELD_ANCESTOR_CONTENT",
    "private-token",
  ])
    assert.ok(!serialized.includes(secret), "No original private text is returned");
  assert.ok(!serialized.includes("https://"));
  assert.equal(result.controls[1].id, "[redacted-token]");
  assert.ok(result.controls[1].text.length <= 120);
}
{
  const url = "https://checkout.stripe.com/";
  const input = element({
    labels: [{ textContent: "DO_NOT_READ_NESTED_TEXTAREA", querySelector: () => ({}) }],
  });
  const result = await inspectStripeSurface(page(url, [frame(url, [input])]));
  assert.deepEqual(result.inputs[0].labels, [""]);
  assert.ok(!JSON.stringify(result).includes("DO_NOT_READ_NESTED_TEXTAREA"));
}
for (const origin of [
  "https://evil.test/",
  "https://checkout.stripe.com.evil.test/",
  "http://checkout.stripe.com/",
  "https://user:pass@billing.stripe.com/",
  "http://127.0.0.1/",
])
  await assert.rejects(
    inspectStripeSurface(page(origin, [])),
    /STRIPE_SURFACE_INSPECTION_REJECTED/,
  );
{
  const url = "https://billing.stripe.com/p/session/private";
  const frames = Array.from({ length: 10 }, () =>
    frame(
      url,
      Array.from({ length: 100 }, () => element()),
      [element({ tag: "button", text: "Cancel subscription" })],
    ),
  );
  const result = await inspectStripeSurface(page(url, frames));
  assert.equal(result.surface, "stripe-portal");
  assert.equal(result.truncated, true);
  assert.equal(result.framesInspected, 8);
  assert.equal(result.inputs.length, 80);
  assert.equal(frames[8].calls.length, 0);
}
{
  const url = "https://billing.stripe.com/p/session/private";
  const broken = {
    url: () => url,
    locator: () => ({
      evaluateAll: async () => {
        throw new Error("SECRET_RAW_BROWSER_LOG https://secret.test/token");
      },
    }),
  };
  await assert.rejects(
    inspectStripeSurface(page(url, [broken])),
    (error) => error.message === "STRIPE_SURFACE_INSPECTION_REJECTED",
  );
  let reads = 0;
  const moving = page(url, [frame(url)]);
  moving.url = () => (++reads > 1 ? "https://other.test/" : url);
  await assert.rejects(inspectStripeSurface(moving), /STRIPE_SURFACE_INSPECTION_REJECTED/);
}
console.log(
  "PASS Stripe surface inspection: exact origins, bounded static metadata, no values/URLs/actions, redaction and navigation guards (offline)",
);
