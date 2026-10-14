import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertContinuationAction,
  continuationRoutePolicy,
  continueProtectedSandboxCheckout,
  parseCheckoutContinuationCommand,
  verifyContinuationScope,
  performContinuationAction,
  assertSelectionRecovery,
  classifyContinuationFailure,
  inspectContinuationFields,
  assertReadySelectionRestart,
} from "../../scripts/continue-protected-sandbox-checkout.mjs";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";

const customer = "cus_VRAVJnKW1RGQzr";
const user = "10000000-0000-4000-8000-000000000001";
const nonce = "20000000-0000-4000-8000-000000000002";
function fixture() {
  const record = {
    version: 1,
    marker: "unimate-stripe-sandbox-synthetic-v1",
    nonce,
    userId: user,
    email: `unimate-billing-${nonce}@example.test`,
    password: "A".repeat(43),
    account: TARGET.account,
    price: TARGET.price,
    supabase: TARGET.supabase,
  };
  const baseline = ["sub_old1", "sub_old2", "sub_old3"].map((id) => [id, "canceled"]);
  const journal = {
    version: 1,
    account: TARGET.account,
    userId: user,
    customerId: customer,
    phase: "checkout-verified",
    paymentAttempted: true,
    sessionId: "cs_test_original",
    origin: "https://unimate-synthetic.vercel.app",
    baseline: JSON.stringify(baseline),
  };
  const state = {
    session: {
      id: journal.sessionId,
      livemode: false,
      customer,
      client_reference_id: user,
      metadata: { user_id: user },
      mode: "subscription",
      status: "open",
      payment_status: "unpaid",
      subscription: null,
      payment_intent: null,
      setup_intent: null,
      amount_total: 599,
      currency: "usd",
      url: `https://checkout.stripe.com/c/pay/${journal.sessionId}`,
    },
    items: {
      has_more: false,
      data: [{ price: TARGET.price, quantity: 1, amount_total: 599, currency: "usd" }],
    },
    scope: {
      account: TARGET.account,
      userId: user,
      customerId: customer,
      clockStatus: "ready",
      subscriptions: baseline.map(([id, status]) => ({ id, status })),
    },
    profiles: [{ id: user, is_pro: false, stripe_customer_id: customer, billing_revision: 43 }],
    open: {
      has_more: false,
      data: [{ id: journal.sessionId, customer, livemode: false, status: "open" }],
    },
  };
  return { record, journal, state };
}
const f = fixture();
{
  const originalStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "0" });
  const element = {
    tagName: "BUTTON",
    labels: [],
    getBoundingClientRect: () => ({ width: 100, height: 30 }),
    getAttribute: (name) => (name === "aria-label" ? "Pay with card" : null),
    matches: () => false,
  };
  const frame = {
    url: () => "https://checkout.stripe.com/",
    locator: () => ({ evaluateAll: (fn) => fn([element]) }),
  };
  try {
    const result = await inspectContinuationFields({ frames: () => [frame] });
    assert.equal(
      result.frames[0].fields[0].visible,
      true,
      "Opacity-zero click overlay is visible under Playwright semantics",
    );
  } finally {
    if (originalStyle === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = originalStyle;
  }
}
assert.equal(verifyContinuationScope(f.record, f.journal, f.state), f.state.session.url);
const previousSelection = {
  version: 1,
  account: TARGET.account,
  userId: user,
  customerId: customer,
  sessionId: f.journal.sessionId,
  createdAt: 1000,
  updatedAt: 2000,
  phase: "select_card-pending",
};
assert.doesNotThrow(() => assertSelectionRecovery(previousSelection, f.record, f.journal));
const readyRecovery = {
  ...previousSelection,
  createdAt: 3000,
  updatedAt: 3000,
  phase: "ready",
  selectionRecovery: true,
  priorAttempt: previousSelection,
  audit: [{ phase: "ready", at: 3000 }],
};
assert.doesNotThrow(() =>
  assertReadySelectionRestart(readyRecovery, previousSelection, f.record, f.journal),
);
for (const patch of [
  { phase: "select_card-pending" },
  { phase: "fill_card-pending" },
  { phase: "submit-pending" },
  { phase: "submitted" },
  { selectionRecoveryAttemptedAt: 3001 },
  { selectionRecoveryAttemptedAt: null },
  { restartAt: 3001 },
  { lastFailure: { classification: "unknown" } },
  { audit: [{ phase: "select_card-pending", at: 3000 }] },
  { audit: [{ phase: "ready", at: 3000, failure: "unknown" }] },
  { audit: [] },
  { userId: "other" },
  { sessionId: "cs_test_other" },
  { priorAttempt: { ...previousSelection, updatedAt: 2999 } },
  { paymentAttempted: true },
  { selectionRecovery: false },
])
  assert.throws(
    () =>
      assertReadySelectionRestart(
        { ...readyRecovery, ...patch },
        previousSelection,
        f.record,
        f.journal,
      ),
    /NOT_ELIGIBLE/,
  );
assert.equal(readyRecovery.phase, "ready");
assert.equal(
  previousSelection.phase,
  "select_card-pending",
  "validation never resets the prior attempt",
);
for (const patch of [
  { phase: "fill_card-pending" },
  { phase: "submit-pending" },
  { phase: "submitted" },
  { phase: "card-selected" },
  { phase: "ready" },
  { userId: "other" },
  { customerId: "cus_other" },
  { sessionId: "cs_test_other" },
  { account: "acct_other" },
  { selectionRecovery: true },
  { paymentAttempted: true },
  { createdAt: 0 },
  { updatedAt: 999 },
])
  assert.throws(
    () => assertSelectionRecovery({ ...previousSelection, ...patch }, f.record, f.journal),
    /NOT_ELIGIBLE/,
  );
for (const [message, expected] of [
  ["Timeout 15000ms exceeded", "timeout"],
  ["private sensitive text: div intercepts pointer events", "interception"],
  ["element is not visible; private sensitive text", "not_visible"],
  ["private sensitive text", "unknown"],
])
  assert.equal(classifyContinuationFailure(new Error(message)), expected);
for (const mutate of [
  (f) => {
    f.record.marker = "unmarked";
  },
  (f) => {
    f.journal.paymentAttempted = false;
  },
  (f) => {
    f.journal.account = "acct_other";
  },
  (f) => {
    f.journal.origin = "https://arbitrary.example";
  },
  (f) => {
    f.journal.baseline = "invalid";
  },
  (f) => {
    f.journal.baseline = JSON.stringify([
      ["sub_old1", "canceled"],
      ["sub_old1", "canceled"],
      ["sub_old3", "canceled"],
    ]);
  },
  (f) => {
    f.state.session.livemode = true;
  },
  (f) => {
    f.state.session.id = "cs_test_other";
  },
  (f) => {
    f.state.session.url = "https://attacker.example/c/pay/cs_test_original";
  },
  (f) => {
    f.state.session.customer = "cus_other";
  },
  (f) => {
    f.state.session.metadata.user_id = "other";
  },
  (f) => {
    f.state.session.amount_total = 600;
  },
  (f) => {
    f.state.session.payment_status = "paid";
  },
  (f) => {
    f.state.session.subscription = "sub_new";
  },
  (f) => {
    f.state.session.payment_intent = "pi_processing";
  },
  (f) => {
    f.state.session.setup_intent = "seti_unknown";
  },
  (f) => {
    f.state.items.data[0].price = "price_other";
  },
  (f) => {
    f.state.items.data[0].quantity = 2;
  },
  (f) => {
    f.state.items.has_more = true;
  },
  (f) => {
    f.state.scope.customerId = "cus_other";
  },
  (f) => {
    f.state.scope.clockStatus = "advancing";
  },
  (f) => {
    f.state.scope.subscriptions[0].status = "active";
  },
  (f) => {
    f.state.scope.subscriptions.push({ id: "sub_new", status: "incomplete" });
  },
  (f) => {
    f.state.profiles[0].is_pro = true;
  },
  (f) => {
    f.state.profiles[0].id = "other";
  },
  (f) => {
    f.state.profiles[0].billing_revision = "43";
  },
  (f) => {
    f.state.open.data.push({ ...f.state.open.data[0], id: "cs_test_extra" });
  },
  (f) => {
    f.state.open.has_more = true;
  },
]) {
  const value = fixture();
  mutate(value);
  assert.throws(() => verifyContinuationScope(value.record, value.journal, value.state));
}
for (const [command, phase] of [
  ["SELECT_CARD", "ready"],
  ["FILL_CARD", "card-selected"],
  ["SUBMIT", "card-filled"],
]) {
  assert.doesNotThrow(() => assertContinuationAction(command, phase));
  for (const wrong of [
    "select_card-pending",
    "fill_card-pending",
    "submit-pending",
    "submitted",
    "unknown",
  ])
    assert.throws(() => assertContinuationAction(command, wrong), /NO_RETRY/);
}
for (const command of ["STATUS", "INSPECT", "SELECT_CARD", "FILL_CARD", "SUBMIT", "STOP"])
  assert.equal(parseCheckoutContinuationCommand(` ${command} `), command);
for (const command of ["EVAL 1", "SUBMIT 599", "PAY", "RETRY", "https://example.com"])
  assert.equal(parseCheckoutContinuationCommand(command), null);

const policy = (url, mainNavigation = false) =>
  continuationRoutePolicy({
    url,
    mainNavigation,
    previewOrigin: f.journal.origin,
    sessionId: f.journal.sessionId,
  });
assert.equal(policy(f.state.session.url, true), "continue");
for (const url of [
  `${f.journal.origin}/upgrade?success=true`,
  "https://billing.stripe.com/other",
  "https://attacker.example",
  "http://localhost:8080",
])
  assert.equal(policy(url, true), "hold", "every top-level departure gets inert HTML");
assert.equal(policy(`${f.journal.origin}/api/billing-status`), "block");
for (const url of [
  "http://127.0.0.1",
  "https://192.168.1.1",
  "https://[::1]",
  "https://test.internal",
  "https://test.local",
  "https://user:password@js.stripe.com",
])
  assert.equal(policy(url), "block");
assert.equal(policy("https://js.stripe.com/v3/"), "continue");
const previous = globalThis.fetch;
globalThis.fetch = () => assert.fail("offline tests must never reach a provider");
try {
  await assert.rejects(
    continueProtectedSandboxCheckout(),
    /EXPLICIT_CHECKOUT_CONTINUATION_APPROVAL_REQUIRED/,
  );
} finally {
  globalThis.fetch = previous;
}

// Wiring safeguards supplement the executable scope/phase policies above.
const source = await readFile(
  new URL("../../scripts/continue-protected-sandbox-checkout.mjs", import.meta.url),
  "utf8",
);
assert(source.includes('"protected-checkout-card-continuation-v1.json"'));
assert(/"wx",\s*0o600/.test(source));
assert(source.includes("readPrivate(originalPath)"));
assert(
  source.indexOf('import("./protected-stripe-browser-card.mjs")') <
    source.indexOf("await performContinuationAction(command, attempt.phase"),
);
assert(
  source.indexOf("await save(`${command.toLowerCase()}-pending`)") <
    source.indexOf("await action()"),
);
assert(!source.includes("attachProtectedPreviewBrowser"));
assert(!source.includes("STRIPE_API_KEY:"));
assert(!source.includes('method: "POST"'));
assert(!source.includes("force: true"));
assert(source.includes('"protected-checkout-card-selection-recovery-v1.json"'));
assert(source.includes('page.locator(".card-accordion-item-cover")'));
assert(source.includes('card.locator("#payment-method-label-card").count()'));
assert(source.includes("FAILED_SELECTION_JOURNAL_CHANGED"));
{
  let phase = "card-filled",
    calls = 0;
  const save = async (next) => {
    phase = next;
  };
  await assert.rejects(
    performContinuationAction("SUBMIT", phase, {
      save,
      action: async () => {
        assert.equal(phase, "submit-pending");
        calls++;
        throw new Error("uncertain fixture");
      },
    }),
    /uncertain fixture/,
  );
  assert.equal(phase, "submit-pending");
  await assert.rejects(
    performContinuationAction("SUBMIT", phase, {
      save,
      action: async () => {
        calls++;
      },
    }),
    /NO_RETRY/,
  );
  assert.equal(calls, 1);
  phase = "card-filled";
  await performContinuationAction("SUBMIT", phase, {
    save,
    action: async () => {
      assert.equal(phase, "submit-pending");
    },
  });
  assert.equal(phase, "submitted");
}
console.log(
  "PASS Checkout continuation: exact synthetic scope, fixed commands, no uncertain retry, return isolation, approval and journal wiring (offline)",
);
