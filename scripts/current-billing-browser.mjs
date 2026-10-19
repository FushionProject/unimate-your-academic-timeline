// New $9.99 Checkout only. Historical $5.99 helpers and evidence stay unchanged.
// Fixed published Stripe test cards, fictional billing details, browser fields only.
// The caller must independently verify exact sandbox account/customer/Price,
// preserve a one-shot journal, and hold the Preview return for webhook proof.
import { claimSandboxBrowserPayment } from "./protected-stripe-browser-payment.mjs";
import { CURRENT_BILLING_CONTINUATION } from "./current-billing-policy.mjs";

const VALUES = Object.freeze({
  cardNumber: "4000000000003220",
  cardExpiry: "1234",
  cardCvc: "123",
  billingName: "UniMate Sandbox Test",
  billingPostalCode: "94107",
});
const STANDARD_VALUES = Object.freeze({ ...VALUES, cardNumber: "4242424242424242" });
const fillClaims = new Set();
const paymentClaims = new Set();
const filledProfiles = new Map();
const fail = () => {
  throw new Error("CURRENT_SANDBOX_CARD_FORM_REQUIRED");
};
function profileValues(profile, sessionId) {
  if (profile === "three-d-secure") return VALUES;
  if (profile === "standard" && sessionId !== CURRENT_BILLING_CONTINUATION.sessionId)
    return STANDARD_VALUES;
  fail();
}

function assertLocation(page, sessionId, expectedUrl) {
  if (page.isClosed() || !/^cs_test_[A-Za-z0-9]+$/.test(sessionId || "")) fail();
  const current = page.url();
  const url = new URL(current);
  if (
    url.origin !== "https://checkout.stripe.com" ||
    url.username ||
    url.password ||
    !url.pathname.split("/").includes(sessionId) ||
    (expectedUrl !== undefined && current !== expectedUrl)
  )
    fail();
  return current;
}

async function controls(page, sessionId, expectedUrl) {
  const location = assertLocation(page, sessionId, expectedUrl);
  const unchanged = () => assertLocation(page, sessionId, location);
  const text = await page.locator("body").innerText();
  if (
    !/\bSandbox\b/.test(text) ||
    !/\bUniMate Pro\b/.test(text) ||
    !/\$9\.99(?![\d.,])/.test(text) ||
    /\$5\.99(?!\d)/.test(text) ||
    !/(?:\bper\s+month\b|\/\s*month\b|\bmonthly\b)/i.test(text)
  )
    fail();
  const fields = {};
  let linkLabel;
  for (const id of [...Object.keys(VALUES), "billingCountry", "enableStripePass"]) {
    const field = page.locator(`#${id}`);
    if ((await field.count()) !== 1 || !(await field.isEnabled())) fail();
    const visible = await field.isVisible();
    if (id === "enableStripePass") {
      if ((await field.getAttribute("type")) !== "checkbox") fail();
      if (!visible) {
        linkLabel = page.locator("label").filter({
          hasText: /^Save my information with Link for faster checkout$/,
        });
        if (
          (await linkLabel.count()) !== 1 ||
          !(await linkLabel.isVisible()) ||
          !(await linkLabel.isEnabled()) ||
          (await linkLabel.innerText()).trim() !==
            "Save my information with Link for faster checkout" ||
          !(await linkLabel.evaluate((label) => {
            const input = label.control;
            return Boolean(
              input &&
              input.id === "enableStripePass" &&
              input.tagName === "INPUT" &&
              input.type === "checkbox" &&
              input.ownerDocument.getElementById("enableStripePass") === input &&
              (label.htmlFor === input.id || label.contains(input)),
            );
          }))
        )
          fail();
      }
    } else if (!visible) fail();
    fields[id] = field;
    unchanged();
  }
  const button = page.getByRole("button", { name: /^Subscribe/ });
  // An empty form may disable Subscribe; filling never clicks it.
  if ((await button.count()) !== 1 || !(await button.isVisible())) fail();
  unchanged();
  return { fields, button, linkLabel, location, unchanged };
}

async function verifyValues(fields, values) {
  if (
    (await fields.enableStripePass.isChecked()) ||
    (await fields.billingCountry.inputValue()) !== "US"
  )
    fail();
  for (const [id, expected] of Object.entries(values)) {
    const value = await fields[id].inputValue();
    const actual = ["cardNumber", "cardExpiry"].includes(id) ? value.replace(/[\s/]/g, "") : value;
    if (actual !== expected) fail();
  }
}

async function fillFixedTestCard({ page, sessionId, claimFill, assertActive = () => {}, profile }) {
  try {
    const values = profileValues(profile, sessionId);
    if (
      typeof claimFill !== "function" ||
      typeof assertActive !== "function" ||
      fillClaims.has(sessionId) ||
      paymentClaims.has(sessionId)
    )
      fail();
    const preflight = await controls(page, sessionId);
    // No callback or UI write occurs until every field and Subscribe is checked.
    // Claim before the first opt-out/fill; a failure remains non-retryable.
    if (fillClaims.has(sessionId) || paymentClaims.has(sessionId)) fail();
    assertActive();
    fillClaims.add(sessionId);
    await claimFill(sessionId);
    assertActive();
    const { fields, linkLabel, unchanged } = await controls(page, sessionId, preflight.location);
    if (await fields.enableStripePass.isChecked()) {
      unchanged();
      assertActive();
      // Stripe's observed hidden checkbox is operated only through its real,
      // visible associated label. No forced clicks or DOM/style changes.
      if (linkLabel) await linkLabel.click();
      else await fields.enableStripePass.uncheck();
    }
    if (await fields.enableStripePass.isChecked()) fail();
    unchanged();
    assertActive();
    await fields.billingCountry.selectOption("US");
    for (const [id, value] of Object.entries(values)) {
      unchanged();
      if (await fields.enableStripePass.isChecked()) fail();
      assertActive();
      await fields[id].fill(value);
    }
    await verifyValues(fields, values);
    unchanged();
    filledProfiles.set(sessionId, profile);
    return { filled: true, submitted: false };
  } catch {
    // Browser errors may contain field values or credential-bearing URLs.
    fail();
  }
}

async function submitFixedTestCheckout({
  page,
  sessionId,
  claimPayment = claimSandboxBrowserPayment,
  assertActive = () => {},
  profile,
}) {
  try {
    const values = profileValues(profile, sessionId);
    if (
      typeof claimPayment !== "function" ||
      typeof assertActive !== "function" ||
      paymentClaims.has(sessionId) ||
      filledProfiles.get(sessionId) !== profile
    )
      fail();
    const preflight = await controls(page, sessionId);
    await verifyValues(preflight.fields, values);
    if (!(await preflight.button.isEnabled())) fail();
    preflight.unchanged();
    if (paymentClaims.has(sessionId)) fail();
    assertActive();
    paymentClaims.add(sessionId);
    await claimPayment(sessionId);
    assertActive();
    const current = await controls(page, sessionId, preflight.location);
    await verifyValues(current.fields, values);
    if (!(await current.button.isEnabled())) fail();
    current.unchanged();
    assertActive();
    await current.button.click();
    // Not payment-success proof. No challenge click or automatic retry exists.
    return { clicked: true, challengeHandled: false };
  } catch {
    fail();
  }
}

// The original 3DS exports retain their fixed card. The separate standard
// exports cannot select arbitrary cards, resume the failed Checkout, or submit
// a different profile from the successfully completed fill in this process.
export const fillCurrentTestCard = (input) =>
  fillFixedTestCard({ ...input, profile: "three-d-secure" });
export const submitCurrentTestCheckout = (input) =>
  submitFixedTestCheckout({ ...input, profile: "three-d-secure" });
export const fillCurrentStandardTestCard = (input) =>
  fillFixedTestCard({ ...input, profile: "standard" });
export const submitCurrentStandardTestCheckout = (input) =>
  submitFixedTestCheckout({ ...input, profile: "standard" });
