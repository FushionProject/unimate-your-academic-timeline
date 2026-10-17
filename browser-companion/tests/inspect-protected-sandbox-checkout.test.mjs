import assert from "node:assert/strict";
import vm from "node:vm";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";
import {
  verifyDiagnosticCheckout,
  redactDiagnosticText,
  diagnosticFrameScope,
  readDiagnosticStripeFrame,
  readVisibleCardAncestors,
  inspectCheckoutCardStructure,
  inspectCheckoutCardHitTarget,
} from "../../scripts/inspect-protected-sandbox-checkout.mjs";

const record = {
  version: 1,
  marker: "unimate-stripe-sandbox-synthetic-v1",
  account: TARGET.account,
  price: TARGET.price,
  supabase: TARGET.supabase,
  nonce: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000002",
  password: "x".repeat(43),
};
record.email = `unimate-billing-${record.nonce}@example.test`;
const journal = {
  version: 1,
  account: TARGET.account,
  userId: record.userId,
  customerId: "cus_VRAVJnKW1RGQzr",
  phase: "checkout-verified",
  paymentAttempted: true,
  sessionId: "cs_test_fixture",
};
const session = {
  id: journal.sessionId,
  livemode: false,
  customer: journal.customerId,
  client_reference_id: record.userId,
  metadata: { user_id: record.userId },
  mode: "subscription",
  status: "open",
  payment_status: "unpaid",
  subscription: null,
  amount_total: 599,
  currency: "usd",
  url: "https://checkout.stripe.com/c/pay/cs_test_fixture#private",
};
const items = {
  has_more: false,
  data: [{ price: TARGET.price, quantity: 1, amount_total: 599, currency: "usd" }],
};
assert.equal(verifyDiagnosticCheckout(record, journal, session, items), session.url);
for (const patch of [
  { livemode: true },
  { amount_total: 600 },
  { payment_status: "paid" },
  { subscription: "sub_other" },
  { customer: "cus_other" },
  { url: "https://other.test/" },
])
  assert.throws(() => verifyDiagnosticCheckout(record, journal, { ...session, ...patch }, items));
const parent = { url: () => "https://payments.stripe.com/private", parentFrame: () => null };
assert.deepEqual(
  diagnosticFrameScope({
    url: () => "about:srcdoc",
    parentFrame: () => ({ url: () => "about:blank", parentFrame: () => parent }),
  }),
  { host: "payments.stripe.com", inherited: true, stripe: true },
);
const redacted = redactDiagnosticText(
  "4242 4242 4242 4242 example@example.test https://checkout.stripe.com/c/pay/cs_test_abc sk_test_secretvalue",
);
assert.ok(
  !redacted.includes("4242") &&
    !redacted.includes("@") &&
    !redacted.includes("https://") &&
    !redacted.includes("sk_test_"),
);

const element = (tag, attrs = {}) => {
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id: attrs.id || "",
    parentElement: null,
    labels: [],
    getAttribute: (name) => attrs[name] || null,
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
    closest: () => null,
    getRootNode: () => ({}),
    onclick: null,
  };
  for (const key of ["value", "innerHTML", "href", "src"])
    Object.defineProperty(el, key, { get: () => assert.fail(`Forbidden read ${key}`) });
  return el;
};
const style = () => ({ display: "block", visibility: "visible", opacity: "1" });
const card = element("span", { class: "Text css-random" });
const row = element("div", {
  class: "PaymentMethod-accordionItem css-random payment_cs_test_private",
  "data-testid": "payment-method-card",
  "aria-expanded": "false",
});
row.onclick = () => assert.fail("No clicks allowed");
card.parentElement = row;
const nodes = [
  { nodeType: 3, textContent: "Card", parentElement: card },
  { nodeType: 3, textContent: "Card number", parentElement: card },
];
const document = {
  body: {},
  createTreeWalker: () => {
    let i = 0;
    return { nextNode: () => nodes[i++] || null };
  },
};
const world = vm.createContext({
  document,
  Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
  NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
  getComputedStyle: style,
});
const result = vm.runInContext(`(${readVisibleCardAncestors.toString()})`, world)();
assert.equal(result.matches.length, 1);
assert.equal(result.matches[0].ancestors[1].tag, "div");
assert.equal(result.matches[0].ancestors[1].hasClickHandler, true);
assert.equal(result.matches[0].ancestors[1].testId, "payment-method-card");
assert.deepEqual([...result.matches[0].ancestors[1].classes], ["PaymentMethod-accordionItem"]);
{
  // Real inspected Stripe markup places the fixed cover at ancestor eleven.
  // The bounded reader must include it without reading values or clicking.
  let previous = row;
  for (let depth = 2; depth < 25; depth++) {
    const next = element("div", {
      class: depth === 11 ? "card-accordion-item-cover" : `payment-container-${depth}`,
    });
    previous.parentElement = next;
    previous = next;
  }
  const deep = vm.runInContext(`(${readVisibleCardAncestors.toString()})`, world)();
  assert.equal(deep.matches[0].ancestors.length, 20);
  assert.deepEqual([...deep.matches[0].ancestors[11].classes], ["card-accordion-item-cover"]);
  assert.ok(!JSON.stringify(deep).includes("payment-container-20"));
  row.parentElement = null;
}
const page = {
  url: () => session.url,
  mainFrame: () => ({ evaluate: async (fn) => vm.runInContext(`(${fn.toString()})`, world)() }),
};
assert.equal((await inspectCheckoutCardStructure(page)).matches.length, 1);
await assert.rejects(
  inspectCheckoutCardStructure({ ...page, url: () => "https://other.test/" }),
  /PRIVATE_CARD_STRUCTURE_INSPECTION_FAILED/,
);

const native = element("input", { type: "radio", id: "card-native" });
native.checked = false;
const radio = element("div", { role: "radio", "aria-label": "Card" });
const label = element("label", { for: "card-native" });
label.control = native;
const radioWorld = vm.createContext({
  NodeFilter: { SHOW_TEXT: 4 },
  getComputedStyle: style,
  document: {
    readyState: "complete",
    body: null,
    getElementById: () => null,
    querySelectorAll: (selector) =>
      selector.startsWith("input,select") ? [native] : [radio, native, label],
    createTreeWalker: () => ({ nextNode: () => null }),
  },
});
const radioResult = vm.runInContext(
  `(${readDiagnosticStripeFrame.toString()})`,
  radioWorld,
)({ readText: false });
assert.equal(radioResult.radiosAndLabels[0].role, "radio");
assert.equal(radioResult.radiosAndLabels[2].controlId, "card-native");
const cardLabel = element("div", { id: "payment-method-label-card" });
cardLabel.getBoundingClientRect = () => ({ x: 10, y: 20, width: 100, height: 20 });
cardLabel.contains = () => false;
const overlay = element("div", { class: "Overlay session_private", id: "overlay" });
const payButton = element("button", {
  "aria-label": "Pay with card",
  "aria-hidden": "true",
  tabindex: "-1",
});
const hitWorld = vm.createContext({
  getComputedStyle: () => ({
    ...style(),
    clipPath: "url(https://secret.test/token)",
    pointerEvents: "auto",
  }),
  document: {
    querySelectorAll: (selector) =>
      selector === "#payment-method-label-card" ? [cardLabel] : [payButton],
    elementFromPoint: (x, y) => {
      assert.equal(x, 60);
      assert.equal(y, 30);
      return overlay;
    },
  },
});
const hitPage = {
  ...page,
  mainFrame: () => ({ evaluate: async (fn) => vm.runInContext(`(${fn.toString()})`, hitWorld)() }),
};
const hit = await inspectCheckoutCardHitTarget(hitPage);
assert.equal(hit.labelCount, 1);
assert.equal(hit.centerHitsLabel, false);
assert.equal(hit.hitAncestors[0].id, "overlay");
assert.deepEqual([...hit.hitAncestors[0].classes], ["Overlay"]);
assert.equal(hit.payWithCardButtonCount, 1);
assert.equal(hit.payWithCardButtons[0].ariaHidden, "true");
assert.equal(hit.payWithCardButtons[0].tabIndex, -1);
assert.equal(hit.payWithCardButtons[0].style.clipPath, "[redacted]");
await assert.rejects(
  inspectCheckoutCardHitTarget({ ...hitPage, url: () => "https://other.test/" }),
  /PRIVATE_CARD_HIT_TEST_FAILED/,
);
console.log(
  "PASS offline Checkout diagnostic: exact unpaid scope, inherited frames, redaction, bounded Card ancestry/radios/hit-test, no values or actions",
);
