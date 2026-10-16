// Browser-only published Stripe test values. Never sends raw card data through
// our server/API client, saves it, enrolls in Link, or retries a payment.
import { submitVerifiedTestPayment } from "./protected-stripe-browser-payment.mjs";

const VALUES = Object.freeze({
  cardNumber: "4242424242424242",
  cardExpiry: "1234",
  cardCvc: "123",
  billingName: "UniMate Sandbox Test",
  billingPostalCode: "94107",
});
const fail = () => {
  throw new Error("VERIFIED_SANDBOX_CARD_FORM_REQUIRED");
};

async function fieldsFor(page, sessionId) {
  const url = new URL(page.url());
  if (
    url.origin !== "https://checkout.stripe.com" ||
    url.username ||
    url.password ||
    !/^cs_test_[A-Za-z0-9]+$/.test(sessionId || "") ||
    !url.pathname.split("/").includes(sessionId)
  )
    fail();
  const text = await page.locator("body").innerText();
  if (!text.includes("$5.99") || !text.includes("Sandbox")) fail();
  const fields = {};
  for (const id of [...Object.keys(VALUES), "billingCountry", "enableStripePass"]) {
    const field = page.locator(`#${id}`);
    if ((await field.count()) !== 1 || !(await field.isVisible()) || !(await field.isEnabled()))
      fail();
    fields[id] = field;
  }
  return fields;
}

export async function fillVerifiedTestCard({ page, sessionId }) {
  const fields = await fieldsFor(page, sessionId);
  // Stripe defaults this optional checkbox on. Do not create a Link account.
  if (await fields.enableStripePass.isChecked()) await fields.enableStripePass.uncheck();
  if (await fields.enableStripePass.isChecked()) fail();
  await fields.billingCountry.selectOption("US");
  for (const [id, value] of Object.entries(VALUES)) await fields[id].fill(value);
}

export async function submitVerifiedCardCheckout({ page, sessionId, claimPayment }) {
  const fields = await fieldsFor(page, sessionId);
  if (
    (await fields.enableStripePass.isChecked()) ||
    (await fields.billingCountry.inputValue()) !== "US"
  )
    fail();
  for (const [id, value] of Object.entries(VALUES)) {
    const actual = await fields[id].inputValue();
    const normalized = ["cardNumber", "cardExpiry"].includes(id)
      ? actual.replace(/\D/g, "")
      : actual;
    if (normalized !== value) fail();
  }
  // The surrounding continuation has freshly reconciled API/DB scope and
  // persisted its one-shot pending journal before entering this helper.
  await submitVerifiedTestPayment({ page, sessionId, claimPayment });
}
