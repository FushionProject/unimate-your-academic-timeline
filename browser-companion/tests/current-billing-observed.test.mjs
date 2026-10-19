import assert from "node:assert/strict";
import vm from "node:vm";
import {
  CURRENT_BILLING_CONTINUATION,
  CURRENT_BILLING_SCOPE as C,
  assertCurrentBaseline,
} from "../../scripts/current-billing-policy.mjs";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";
import * as observed from "../../scripts/current-billing-observed.mjs";

let sequence = 0;
const sessionId = CURRENT_BILLING_CONTINUATION.sessionId;
async function fixture(overrides = {}) {
  // A new module instance isolates fixed-session one-shot state between fixtures.
  const { selectObservedCard, selectCurrentStandardCard } = await import(
    `../../scripts/current-billing-observed.mjs?fixture=${++sequence}`
  );
  const events = [];
  const state = {
    url: `https://checkout.stripe.com/c/pay/${sessionId}#synthetic`,
    closed: false,
    text: "Sandbox UniMate Pro $9.99 per month",
    cardCount: 1,
    cardVisible: true,
    cardEnabled: true,
    labelCount: 1,
    labelVisible: true,
    labelText: "Card",
    childCount: 1,
    numberCount: 0,
    numberVisible: false,
    active: true,
    ...overrides,
  };
  const card = {
    count: async () => state.cardCount,
    isVisible: async () => state.cardVisible,
    isEnabled: async () => state.cardEnabled,
    locator: (selector) => {
      assert.equal(selector, "#payment-method-label-card");
      return { count: async () => state.childCount };
    },
    click: async (...args) => {
      assert.deepEqual(args, [], "Normal observed Card click only, no force/options");
      assert.equal(events.at(-1), "active");
      assert.ok(events.includes("claim-complete"));
      events.push("click");
      if (state.clickFails) throw new Error("private browser URL must not escape");
    },
  };
  const page = {
    url: () => state.url,
    isClosed: () => state.closed,
    locator: (selector) => {
      if (selector === "body") return { innerText: async () => state.text };
      if (selector === ".card-accordion-item-cover") return card;
      if (selector === "#payment-method-label-card")
        return {
          count: async () => state.labelCount,
          isVisible: async () => state.labelVisible,
          innerText: async () => state.labelText,
        };
      assert.equal(selector, "#cardNumber");
      return {
        count: async () => state.numberCount,
        isVisible: async () => state.numberVisible,
      };
    },
  };
  const assertActive = () => {
    if (!state.active) throw new Error("private expiry detail must not escape");
    events.push("active");
  };
  const claim = async () => {
    assert.equal(events.at(-1), "active");
    events.push("claim");
    await Promise.resolve();
    if (state.claimFails) throw new Error("private journal detail must not escape");
    state.afterClaim?.();
    events.push("claim-complete");
  };
  return {
    state,
    events,
    run: (options = {}) => selectObservedCard({ page, sessionId, assertActive, claim, ...options }),
    runStandard: (options = {}) =>
      selectCurrentStandardCard({ page, sessionId, assertActive, claim, ...options }),
  };
}
const rejected = (promise) =>
  assert.rejects(promise, { message: "CURRENT_OBSERVED_CARD_CONTROL_REQUIRED" });

for (const numberCount of [0, 1]) {
  const sample = await fixture({ numberCount });
  assert.deepEqual(await sample.run(), { selected: true, submitted: false });
  assert.deepEqual(sample.events, [
    "active",
    "claim",
    "claim-complete",
    "active",
    "active",
    "click",
  ]);
  await rejected(sample.run());
  assert.equal(sample.events.filter((event) => event === "claim").length, 1);
  assert.equal(sample.events.filter((event) => event === "click").length, 1);
}
for (const patch of [
  { text: "Sandbox UniMate Pro $5.99 per month" },
  { text: "Sandbox UniMate Pro $9.99 per month, $5.99" },
  { text: "Sandbox UniMate Pro $99.99 per month" },
  { text: "Sandbox UniMate Pro $9.990 per month" },
  { text: "Sandbox UniMate Pro $9.99 per year" },
  { text: "UniMate Pro $9.99 per month" },
  { text: "Sandbox Other $9.99 per month" },
  { url: `https://evil.test/c/pay/${sessionId}` },
  { url: `https://checkout.stripe.com:444/c/pay/${sessionId}` },
  { url: `http://checkout.stripe.com/c/pay/${sessionId}` },
  { url: `https://user:private@checkout.stripe.com/c/pay/${sessionId}` },
  { url: "https://checkout.stripe.com/c/pay/cs_test_other" },
  { url: `https://checkout.stripe.com/other/${sessionId}` },
  { url: "invalid" },
  { closed: true },
  { cardCount: 0 },
  { cardCount: 2 },
  { cardVisible: false },
  { cardEnabled: false },
  { labelCount: 0 },
  { labelCount: 2 },
  { labelVisible: false },
  { labelText: "Pay with card" },
  { childCount: 0 },
  { childCount: 2 },
  { numberCount: 1, numberVisible: true },
  { numberCount: 2 },
  { active: false },
]) {
  const sample = await fixture(patch);
  await rejected(sample.run());
  assert.deepEqual(sample.events, [], "Invalid or stopped form must not claim or click");
}
for (const options of [{ sessionId: "cs_test_other" }, { assertActive: null }, { claim: null }]) {
  const sample = await fixture();
  await rejected(sample.run(options));
  assert.deepEqual(sample.events, []);
}
for (const patch of [
  { url: `https://checkout.stripe.com/c/pay/${sessionId}#changed` },
  { text: "Sandbox UniMate Pro $5.99 per month" },
  { cardCount: 2 },
  { cardVisible: false },
  { cardEnabled: false },
  { labelText: "Changed" },
  { labelVisible: false },
  { childCount: 0 },
  { numberCount: 1, numberVisible: true },
  { active: false },
]) {
  const sample = await fixture();
  sample.state.afterClaim = () => Object.assign(sample.state, patch);
  await rejected(sample.run());
  assert.equal(sample.events.includes("click"), false, "Full recheck after awaiting the claim");
  const before = [...sample.events];
  await rejected(sample.run());
  assert.deepEqual(sample.events, before, "Claimed action cannot be replayed after failed recheck");
}
for (const mode of ["claimFails", "clickFails"]) {
  const sample = await fixture({ [mode]: true });
  await rejected(sample.run());
  const before = [...sample.events];
  await rejected(sample.run());
  assert.deepEqual(sample.events, before, "Uncertain claims/clicks are not replayed");
  assert.equal(
    sample.events.filter((event) => event === "click").length,
    mode === "clickFails" ? 1 : 0,
  );
}
{
  const sample = await fixture();
  const results = await Promise.allSettled([sample.run(), sample.run()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(sample.events.filter((event) => event === "click").length, 1);
}

// Execute the actual fixed DOM read against guarded synthetic elements. These
// fixtures expose no browser, API, profile, or real payment information.
function challengeElement({
  tag = "button",
  text = "Complete",
  attrs = {},
  childField = false,
  visibility = "visible",
} = {}) {
  const result = {
    tagName: tag.toUpperCase(),
    textContent: text,
    visibility,
    getBoundingClientRect: () => ({ width: 100, height: 30 }),
    getAttribute: (name) => {
      assert.ok(["id", "aria-label", "aria-disabled"].includes(name));
      return attrs[name] ?? null;
    },
    querySelector: (selector) => {
      assert.equal(selector, "input,textarea,select");
      return childField ? {} : null;
    },
    matches: (selector) => {
      assert.equal(selector, ":disabled");
      return false;
    },
  };
  for (const property of ["value", "selectedOptions", "innerHTML", "href", "src", "action"])
    Object.defineProperty(result, property, {
      get: () => assert.fail(`Must not read ${property}`),
    });
  return result;
}
function challengeFrame(
  url,
  elements = [],
  {
    afterRead,
    error,
    parent = null,
    verificationVisible = false,
    verificationTitle = "hCaptcha",
  } = {},
) {
  const state = { url, reads: 0, parent, metadataReads: 0, disposals: 0 };
  return {
    state,
    url: () => state.url,
    parentFrame: () => state.parent,
    frameElement: async () => {
      assert.equal(new URL(state.url).origin, "https://newassets.hcaptcha.com");
      state.metadataReads++;
      return {
        isVisible: async () => verificationVisible,
        getAttribute: async (name) => {
          assert.equal(name, "title", "Only parent iframe title, never src or inner contents");
          return verificationTitle;
        },
        dispose: async () => {
          state.disposals++;
        },
      };
    },
    locator: (selector) => {
      if (selector === "input") return { evaluateAll: async () => [] };
      assert.equal(selector, "button,h1,h2");
      return {
        evaluateAll: async (fn) => {
          state.reads++;
          if (error) throw new Error("PRIVATE_RAW_BROWSER_ERROR https://secret.test/token");
          const context = vm.createContext({
            getComputedStyle: (el) => ({
              display: "block",
              visibility: el.visibility,
              opacity: "1",
            }),
          });
          const result = vm.runInContext(`(${fn.toString()})`, context)(elements);
          afterRead?.(state);
          return JSON.parse(JSON.stringify(result));
        },
      };
    },
  };
}
function challengePage(frames) {
  const state = { url: `https://checkout.stripe.com/c/pay/${sessionId}#private`, closed: false };
  return { state, url: () => state.url, isClosed: () => state.closed, frames: () => frames };
}
const inspect = (page, id = sessionId) =>
  observed.inspectObservedChallenge({ page, sessionId: id });
const inspectRejected = (promise) =>
  assert.rejects(promise, { message: "CURRENT_AUTH_INSPECTION_REQUIRED" });
{
  const secrets = [
    "private@example.test",
    "https://private.test/path?secret",
    "cs_test_private",
    "sk_test_private",
    "pi_private_secret_value",
    "4000 0000 0000 3220",
    "a".repeat(40),
  ];
  const frames = [
    "https://checkout.stripe.com",
    "https://js.stripe.com",
    "https://hooks.stripe.com",
  ].map((origin) =>
    challengeFrame(`${origin}/private-path?private-query#private-fragment`, [
      challengeElement({ tag: "h1", text: "Authentication test" }),
      ...secrets.map((text) => challengeElement({ text, attrs: { id: text, "aria-label": text } })),
      challengeElement({ text: "DO_NOT_READ_NESTED_FIELD", childField: true }),
      challengeElement({ text: "Hidden", visibility: "hidden" }),
      challengeElement({ text: "Collapsed", visibility: "collapse" }),
    ]),
  );
  const excluded = [
    "https://b.stripecdn.com/frame",
    "https://newassets.hcaptcha.com/frame",
    "https://m.stripe.network/frame",
    "https://js.stripe.com.evil.test/frame",
    "http://js.stripe.com/frame",
    "https://js.stripe.com:444/frame",
    "https://user:private@hooks.stripe.com/frame",
    "about:blank",
    "not-a-url",
  ].map((url) => challengeFrame(url));
  const result = await inspect(challengePage([...frames, ...excluded]));
  assert.equal(result.inspectionOnly, true);
  assert.equal(result.truncated, false);
  assert.deepEqual(
    result.frames.map((entry) => entry.origin),
    ["https://checkout.stripe.com", "https://js.stripe.com", "https://hooks.stripe.com"],
  );
  assert.equal(result.frames[0].controls[0].text, "Authentication test");
  assert.equal(result.frames[0].controls.at(-1).visible, false);
  assert.equal(result.frames[0].controls.at(-2).visible, false);
  for (const frame of excluded)
    assert.equal(frame.state.reads, 0, "No CDN/CAPTCHA/instrumentation/unapproved frame reads");
  const serialized = JSON.stringify(result);
  for (const secret of [
    ...secrets,
    "private-path",
    "private-query",
    "private-fragment",
    "DO_NOT_READ_NESTED_FIELD",
  ])
    assert.ok(
      !serialized.includes(secret),
      "No original sensitive metadata or field content escapes",
    );
  assert.equal(typeof observed.completeObservedChallenge, "function");
}
{
  const frames = Array.from({ length: 32 }, () =>
    challengeFrame(
      "https://hooks.stripe.com/frame",
      Array.from({ length: 41 }, () => challengeElement()),
    ),
  );
  const result = await inspect(challengePage(frames));
  assert.equal(result.frames.length, 32);
  assert.equal(result.truncated, true);
  assert.ok(result.frames.every((entry) => entry.controls.length === 40));
  const tooMany = Array.from({ length: 33 }, () =>
    challengeFrame("https://hooks.stripe.com/frame"),
  );
  await inspectRejected(inspect(challengePage(tooMany)));
  assert.ok(tooMany.every((frame) => frame.state.reads === 0));
}
for (const bad of ["closed", "wrong-origin", "wrong-session", "wrong-id"]) {
  const frame = challengeFrame("https://hooks.stripe.com/frame");
  const page = challengePage([frame]);
  if (bad === "closed") page.state.closed = true;
  if (bad === "wrong-origin") page.state.url = "https://evil.test/";
  if (bad === "wrong-session") page.state.url = "https://checkout.stripe.com/c/pay/cs_test_other";
  await inspectRejected(inspect(page, bad === "wrong-id" ? "cs_test_other" : sessionId));
  assert.equal(frame.state.reads, 0);
}
for (const mode of ["frame-navigation", "page-navigation", "raw-error"]) {
  let page;
  const frame = challengeFrame("https://hooks.stripe.com/frame", [], {
    error: mode === "raw-error",
    afterRead: (state) => {
      if (mode === "frame-navigation") state.url = "https://evil.test/";
      if (mode === "page-navigation") page.state.url += "changed";
    },
  });
  page = challengePage([frame]);
  await inspectRejected(inspect(page));
}

{
  const root = challengeFrame("https://hooks.stripe.com/authenticate?private");
  const blank = challengeFrame(
    "about:blank",
    [challengeElement({ text: "Complete test authentication" })],
    { parent: root },
  );
  const srcdoc = challengeFrame(
    "about:srcdoc",
    [challengeElement({ tag: "h2", text: "Test authentication" })],
    { parent: blank },
  );
  const empty = challengeFrame("", [], { parent: srcdoc });
  const result = await inspect(challengePage([root, blank, srcdoc, empty]));
  assert.deepEqual(
    result.frames.map(({ origin, inherited }) => ({ origin, inherited })),
    [
      { origin: "https://hooks.stripe.com", inherited: false },
      { origin: "https://hooks.stripe.com", inherited: true },
      { origin: "https://hooks.stripe.com", inherited: true },
      { origin: "https://hooks.stripe.com", inherited: true },
    ],
  );
  assert.equal(result.frames[1].controls[0].text, "Complete test authentication");
}
for (const origin of [
  "https://evil.test",
  "https://b.stripecdn.com",
  "https://newassets.hcaptcha.com",
  "https://m.stripe.network",
  "https://js.stripe.com:444",
  "https://user:private@hooks.stripe.com",
  "data:text/html,test",
  "about:blank#not-exact",
]) {
  const trusted = challengeFrame("https://checkout.stripe.com/root");
  const barrier = challengeFrame(`${origin}/frame`, [], { parent: trusted });
  const blank = challengeFrame("about:blank", [challengeElement()], { parent: barrier });
  const result = await inspect(challengePage([blank]));
  assert.deepEqual(result.frames, [], "Cannot inherit through a non-blank untrusted ancestor");
  assert.equal(blank.state.reads, 0);
  assert.equal(barrier.state.reads, 0);
}
for (const depth of [15, 16]) {
  let leaf = challengeFrame("https://hooks.stripe.com/root");
  for (let i = 0; i < depth; i++) leaf = challengeFrame("about:blank", [], { parent: leaf });
  const result = await inspect(challengePage([leaf]));
  assert.equal(
    result.frames.length,
    depth === 15 ? 1 : 0,
    "At most sixteen frames in a resolution chain",
  );
  assert.equal(leaf.state.reads, depth === 15 ? 1 : 0);
}
{
  const cycle = challengeFrame("about:blank");
  cycle.state.parent = cycle;
  assert.deepEqual((await inspect(challengePage([cycle]))).frames, []);
  assert.equal(cycle.state.reads, 0);
}
for (const change of ["ancestor-url", "ancestor-parent", "leaf-parent"]) {
  const ancestor = challengeFrame("https://hooks.stripe.com/root");
  const replacement = challengeFrame("https://js.stripe.com/replacement");
  const leaf = challengeFrame("about:srcdoc", [], {
    parent: ancestor,
    afterRead: (state) => {
      if (change === "ancestor-url") ancestor.state.url = "https://evil.test/";
      if (change === "ancestor-parent") ancestor.state.parent = replacement;
      if (change === "leaf-parent") state.parent = replacement;
    },
  });
  await inspectRejected(inspect(challengePage([leaf])));
}
{
  const frame = challengeFrame("https://newassets.hcaptcha.com/private?token", [], {
    verificationVisible: true,
    verificationTitle: "Verify private@example.test https://secret.test/token cs_test_private",
  });
  const child = challengeFrame(
    "about:blank",
    [challengeElement({ text: "MUST_NOT_READ_CAPTCHA" })],
    { parent: frame },
  );
  const result = await inspect(challengePage([frame, child]));
  assert.deepEqual(result.frames, []);
  assert.deepEqual(result.humanVerificationFrames, [
    { visible: true, title: "Verify [redacted-email] [redacted-url] [redacted-token]" },
  ]);
  assert.equal(frame.state.metadataReads, 1);
  assert.equal(frame.state.disposals, 1);
  assert.equal(frame.state.reads, 0);
  assert.equal(child.state.reads, 0);
  assert.ok(!JSON.stringify(result).includes("MUST_NOT_READ_CAPTCHA"));
}

for (const wrong of [null, "source", "intent", "status", "navigation"]) {
  const main = challengeFrame(`https://checkout.stripe.com/c/pay/${sessionId}#private`);
  const parent = challengeFrame(
    `https://js.stripe.com/frame#intentId=${wrong === "intent" ? "pi_wrong" : "pi_3USABnIxB8W4eFUh4dnmpJ7E"}`,
    [],
    { parent: main },
  );
  const acs = challengeFrame(
    `https://testmode-acs.stripe.com/3d_secure_2_test/${C.account}/src_fixture/challenge`,
    [challengeElement()],
    { parent },
  );
  const page = challengePage([main, parent, acs]);
  page.mainFrame = () => main;
  let reads = 0;
  const readStripe = async (endpoint) => {
    assert.equal(endpoint, "/payment_intents/pi_3USABnIxB8W4eFUh4dnmpJ7E");
    reads++;
    if (wrong === "navigation") parent.state.url += "changed";
    return {
      id: "pi_3USABnIxB8W4eFUh4dnmpJ7E",
      object: "payment_intent",
      livemode: false,
      status: wrong === "status" ? "succeeded" : "requires_action",
      amount: 999,
      amount_received: 0,
      currency: "usd",
      customer: C.customer,
      payment_method: "pm_1USABnIxB8W4eFUhrbPhU6sk",
      next_action: {
        type: "use_stripe_sdk",
        use_stripe_sdk: {
          type: "stripe_3ds2_fingerprint",
          three_d_secure_2_source: wrong === "source" ? "src_other" : "src_fixture",
          merchant: C.account,
        },
      },
      client_secret: "NEVER_RETURN_CLIENT_SECRET",
    };
  };
  const pending = observed.inspectObservedChallenge({ page, sessionId, readStripe });
  if (wrong === "navigation") await inspectRejected(pending);
  else {
    const result = await pending;
    assert.deepEqual(Object.fromEntries(Object.entries(result.challengeBinding).slice(0, 3)), {
      exactAcsPathMatches: wrong !== "source",
      exactAncestorIntentMatches: wrong !== "intent",
      requiresActionTest999: wrong !== "status",
    });
    assert.ok(!JSON.stringify(result).includes("NEVER_RETURN_CLIENT_SECRET"));
  }
  assert.equal(reads, 1);
}
{
  let reads = 0;
  await observed.inspectObservedChallenge({
    page: challengePage([challengeFrame("https://js.stripe.com/frame")]),
    sessionId,
    readStripe: async () => {
      reads++;
      throw new Error();
    },
  });
  assert.equal(reads, 0, "No fixed-PI read without an observed ACS frame");
}

async function actionFixture() {
  const module = await import(`../../scripts/current-billing-observed.mjs?action=${++sequence}`);
  const piId = "pi_3USABnIxB8W4eFUh4dnmpJ7E",
    pmId = "pm_1USABnIxB8W4eFUhrbPhU6sk";
  const userId = "11111111-2222-3333-4444-555555555555",
    nonce = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const list = (data) => ({ data, has_more: false });
  const state = {
    active: true,
    buttonCount: 1,
    buttonId: "test-source-authorize-3ds",
    buttonText: "Complete",
    buttonVisible: true,
    buttonEnabled: true,
    heading: "3D Secure 2Test Page",
    headingCount: 1,
    headingVisible: true,
    captchaVisible: false,
    pi: {
      id: piId,
      object: "payment_intent",
      livemode: false,
      status: "requires_action",
      amount: 999,
      amount_received: 0,
      currency: "usd",
      customer: C.customer,
      payment_method: pmId,
      next_action: {
        type: "use_stripe_sdk",
        use_stripe_sdk: {
          type: "stripe_3ds2_fingerprint",
          three_d_secure_2_source: "src_other",
          merchant: C.account,
        },
      },
    },
    pm: {
      id: pmId,
      object: "payment_method",
      livemode: false,
      customer: null,
      type: "card",
      card: { last4: "3220" },
    },
    provider: {
      record: {
        version: 1,
        marker: "unimate-stripe-sandbox-synthetic-v1",
        account: C.account,
        price: TARGET.price,
        supabase: TARGET.supabase,
        userId,
        nonce,
        email: `unimate-billing-${nonce}@example.test`,
      },
      customer: {
        id: C.customer,
        livemode: false,
        metadata: { user_id: userId },
        test_clock: "clock_fixture",
      },
      profile: { id: userId, stripe_customer_id: C.customer, is_pro: false, billing_revision: 80 },
      subscriptions: list(
        Array.from({ length: 7 }, (_, i) => ({
          id: `sub_old${i}`,
          object: "subscription",
          livemode: false,
          customer: C.customer,
          metadata: { user_id: userId },
          status: "canceled",
          items: list([{ price: { id: TARGET.price }, quantity: 1 }]),
        })),
      ),
      open: list([]),
    },
    session: {
      id: sessionId,
      object: "checkout.session",
      livemode: false,
      customer: C.customer,
      client_reference_id: userId,
      metadata: { user_id: userId },
      mode: "subscription",
      status: "open",
      payment_status: "unpaid",
      subscription: null,
      payment_intent: null,
      invoice: null,
      currency: "usd",
      amount_subtotal: 999,
      amount_total: 999,
      total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 },
      automatic_tax: { enabled: false },
      success_url: `${C.origin}/upgrade?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${C.origin}/upgrade?canceled=true`,
      url: `https://checkout.stripe.com/c/pay/${sessionId}#private`,
    },
    lines: list([
      {
        price: { id: C.price },
        quantity: 1,
        amount_subtotal: 999,
        amount_total: 999,
        currency: "usd",
      },
    ]),
  };
  const baseline = assertCurrentBaseline(state.provider);
  state.provider.open = list([structuredClone(state.session)]);
  const events = [];
  const main = challengeFrame(state.session.url);
  const parent = challengeFrame(`https://js.stripe.com/auth#intentId=${piId}`, [], {
    parent: main,
  });
  const acs = challengeFrame(
    `https://testmode-acs.stripe.com/3d_secure_2_test/${C.account}/src_fixture/challenge`,
    [],
    { parent },
  );
  acs.locator = (selector) => {
    if (selector === "h1")
      return {
        count: async () => state.headingCount,
        isVisible: async () => state.headingVisible,
        innerText: async () => state.heading,
      };
    assert.equal(selector, "#test-source-authorize-3ds");
    return { count: async () => state.buttonCount };
  };
  acs.getByRole = (role, options) => {
    assert.equal(role, "button");
    assert.deepEqual(options, { name: "Complete", exact: true });
    return {
      count: async () => state.buttonCount,
      isVisible: async () => state.buttonVisible,
      isEnabled: async () => state.buttonEnabled,
      innerText: async () => state.buttonText,
      getAttribute: async (name) => {
        assert.equal(name, "id");
        return state.buttonId;
      },
      click: async (options) => {
        assert.deepEqual(options, { noWaitAfter: true });
        assert.equal(events.at(-1), "active");
        assert.ok(events.includes("claim-complete"));
        events.push("click");
        if (state.clickFails) throw new Error("private URL error");
      },
    };
  };
  const captcha = challengeFrame("https://newassets.hcaptcha.com/frame");
  captcha.frameElement = async () => ({
    isVisible: async () => state.captchaVisible,
    dispose: async () => events.push("dispose"),
  });
  const page = challengePage([main, parent, acs, captcha]);
  page.mainFrame = () => main;
  const reads = [];
  const endpoints = [
    `/payment_intents/${piId}`,
    `/payment_methods/${pmId}`,
    `/checkout/sessions/${sessionId}`,
    `/checkout/sessions/${sessionId}/line_items?limit=100`,
  ];
  const readStripe = async (endpoint) => {
    assert.ok(endpoints.includes(endpoint), "Only four fixed GET endpoints are available");
    reads.push(endpoint);
    const value = [state.pi, state.pm, state.session, state.lines][endpoints.indexOf(endpoint)];
    state.afterRead?.();
    return structuredClone(value);
  };
  const inspect = async () => {
    events.push("inspect");
    return structuredClone(state.provider);
  };
  const assertActive = () => {
    if (!state.active) throw new Error("Stopped");
    events.push("active");
  };
  const claim = async (proof) => {
    assert.deepEqual(proof, { paymentIntentId: piId, sessionId, isPro: false });
    assert.equal(events.at(-1), "active");
    events.push("claim");
    await Promise.resolve();
    if (state.claimFails) throw new Error("private journal error");
    state.afterClaim?.();
    events.push("claim-complete");
  };
  return {
    state,
    events,
    reads,
    parent,
    main,
    acs,
    page,
    baseline,
    run: () =>
      module.completeObservedChallenge({
        page,
        sessionId,
        baseline,
        readStripe,
        inspect,
        assertActive,
        claim,
      }),
  };
}
const actionRejected = (promise) =>
  assert.rejects(promise, { message: "CURRENT_OBSERVED_CHALLENGE_REQUIRED" });
{
  const sample = await actionFixture();
  assert.deepEqual(await sample.run(), {
    submitted: true,
    paymentIntentId: "pi_3USABnIxB8W4eFUh4dnmpJ7E",
    paymentSuccessClaimed: false,
    bindingKind: "trusted_frame_ancestor_exact_intent",
  });
  assert.equal(sample.reads.length, 8);
  assert.equal(sample.events.filter((event) => event === "inspect").length, 2);
  assert.equal(sample.events.filter((event) => event === "click").length, 1);
  await actionRejected(sample.run());
  assert.equal(sample.events.filter((event) => event === "click").length, 1);
}
const actionMutations = [
  (x) => (x.state.pi.id = "pi_wrong"),
  (x) => (x.state.pi.livemode = true),
  (x) => (x.state.pi.amount = 599),
  (x) => (x.state.pi.currency = "eur"),
  (x) => (x.state.pi.customer = "cus_wrong"),
  (x) => (x.state.pi.status = "succeeded"),
  (x) => (x.state.pi.payment_method = "pm_wrong"),
  (x) => (x.state.pi.next_action.use_stripe_sdk.merchant = "acct_wrong"),
  (x) => (x.state.pi.amount_received = 999),
  (x) => delete x.state.pi.amount_received,
  (x) => (x.state.pi.next_action.use_stripe_sdk.type = "unexpected"),
  (x) => (x.state.pm.livemode = true),
  (x) => (x.state.pm.customer = "cus_wrong"),
  (x) => (x.state.pm.card.last4 = "4242"),
  (x) => (x.state.session.amount_total = 599),
  (x) => (x.state.session.payment_status = "paid"),
  (x) => (x.state.lines.data[0].price.id = TARGET.price),
  (x) => (x.state.provider.profile.is_pro = true),
  (x) => (x.state.provider.profile.billing_revision = 81),
  (x) => (x.state.provider.subscriptions.data[0].status = "active"),
  (x) => x.state.provider.open.data.push(structuredClone(x.state.session)),
  (x) => (x.parent.state.url = "https://js.stripe.com/auth#intentId=pi_wrong"),
  (x) => (x.parent.state.url += "&intentId=pi_3USABnIxB8W4eFUh4dnmpJ7E"),
  (x) => (x.parent.state.url = "https://evil.test/"),
  (x) => (x.acs.state.url = "https://evil.test/"),
  (x) =>
    (x.acs.state.url = `https://testmode-acs.stripe.com/3d_secure_2_test/acct_wrong/src_fixture/challenge`),
  (x) =>
    (x.acs.state.url = `https://testmode-acs.stripe.com/3d_secure_2_test/${C.account}/encoded%2Fsource/challenge`),
  (x) =>
    (x.acs.state.url = `https://testmode-acs.stripe.com/3d_secure_2_test/${C.account}/${"a".repeat(161)}/challenge`),
  (x) => {
    const frames = x.page.frames();
    x.page.frames = () => [...frames, x.acs];
  },
  (x) => {
    x.parent.state.parent = challengeFrame("https://js.stripe.com/extra", [], { parent: x.main });
  },
  (x) => (x.state.buttonCount = 2),
  (x) => (x.state.buttonText = "Fail"),
  (x) => (x.state.buttonId = "other"),
  (x) => (x.state.buttonEnabled = false),
  (x) => (x.state.buttonVisible = false),
  (x) => (x.state.heading = "Another challenge"),
  (x) => (x.state.captchaVisible = true),
  (x) => (x.state.active = false),
];
for (const mutate of actionMutations) {
  const sample = await actionFixture();
  mutate(sample);
  await actionRejected(sample.run());
  assert.equal(sample.events.includes("claim"), false);
  assert.equal(sample.events.includes("click"), false);
}
for (const mutate of actionMutations) {
  const sample = await actionFixture();
  sample.state.afterClaim = () => mutate(sample);
  await actionRejected(sample.run());
  assert.equal(sample.events.filter((event) => event === "claim").length, 1);
  assert.equal(sample.events.includes("click"), false);
  await actionRejected(sample.run());
  assert.equal(sample.events.filter((event) => event === "claim").length, 1);
}
for (const mode of ["claimFails", "clickFails"]) {
  const sample = await actionFixture();
  sample.state[mode] = true;
  await actionRejected(sample.run());
  const before = [...sample.events];
  await actionRejected(sample.run());
  assert.deepEqual(sample.events, before);
}
{
  const sample = await actionFixture();
  sample.state.afterRead = () => {
    sample.parent.state.url += "changed";
  };
  await actionRejected(sample.run());
  assert.equal(sample.reads.length, 1);
  assert.equal(sample.events.includes("claim"), false);
}
{
  const sample = await actionFixture();
  const results = await Promise.allSettled([sample.run(), sample.run()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(sample.events.filter((event) => event === "click").length, 1);
}

const standardSession = "cs_test_newStandardFixture";
const standardUrl = `https://checkout.stripe.com/c/pay/${standardSession}#synthetic`;
{
  const sample = await fixture({ url: standardUrl });
  await rejected(sample.run({ sessionId: standardSession }));
  assert.deepEqual(sample.events, [], "Historical public selector remains fixed to old Checkout");
  assert.deepEqual(await sample.runStandard({ sessionId: standardSession }), {
    selected: true,
    submitted: false,
  });
  await rejected(sample.runStandard({ sessionId: standardSession }));
  assert.equal(sample.events.filter((event) => event === "claim").length, 1);
  assert.equal(sample.events.filter((event) => event === "click").length, 1);
}
for (const value of [
  sessionId,
  "cs_live_other",
  "",
  null,
  "cs_test_bad/slash",
  "pi_testOther",
  "cs_test_",
]) {
  const sample = await fixture({ url: `https://checkout.stripe.com/c/pay/${value}` });
  await rejected(sample.runStandard({ sessionId: value }));
  assert.deepEqual(sample.events, []);
}
for (const patch of [
  { url: `https://checkout.stripe.com/c/pay/cs_test_other` },
  { url: `http://checkout.stripe.com/c/pay/${standardSession}` },
  { url: `https://user:private@checkout.stripe.com/c/pay/${standardSession}` },
  { url: `https://checkout.stripe.com:444/c/pay/${standardSession}` },
  { url: `https://checkout.stripe.com/wrong/${standardSession}` },
  { text: "Sandbox UniMate Pro $5.99 per month" },
  { text: "UniMate Pro $9.99 per month" },
  { text: "Sandbox UniMate Pro $9.99 per year" },
  { cardCount: 2 },
  { cardVisible: false },
  { cardEnabled: false },
  { labelCount: 2 },
  { labelVisible: false },
  { labelText: "Pay" },
  { childCount: 0 },
  { numberCount: 1, numberVisible: true },
  { active: false },
]) {
  const sample = await fixture({ url: standardUrl, ...patch });
  await rejected(sample.runStandard({ sessionId: standardSession }));
  assert.deepEqual(sample.events, []);
}
for (const patch of [
  { url: standardUrl + "changed" },
  { text: "Sandbox UniMate Pro $5.99 per month" },
  { cardCount: 2 },
  { labelText: "Changed" },
  { active: false },
]) {
  const sample = await fixture({ url: standardUrl });
  sample.state.afterClaim = () => Object.assign(sample.state, patch);
  await rejected(sample.runStandard({ sessionId: standardSession }));
  assert.equal(sample.events.includes("click"), false);
  const before = [...sample.events];
  await rejected(sample.runStandard({ sessionId: standardSession }));
  assert.deepEqual(sample.events, before);
}
for (const mode of ["claimFails", "clickFails"]) {
  const sample = await fixture({ url: standardUrl, [mode]: true });
  await rejected(sample.runStandard({ sessionId: standardSession }));
  const before = [...sample.events];
  await rejected(sample.runStandard({ sessionId: standardSession }));
  assert.deepEqual(sample.events, before);
}
{
  const sample = await fixture({ url: standardUrl });
  const results = await Promise.allSettled([
    sample.runStandard({ sessionId: standardSession }),
    sample.runStandard({ sessionId: standardSession }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(sample.events.filter((event) => event === "click").length, 1);
}

console.log(
  "PASS observed current Checkout controls: isolated Card selectors, bounded read-only 3DS inspection, and one-shot test authentication guards (offline)",
);
