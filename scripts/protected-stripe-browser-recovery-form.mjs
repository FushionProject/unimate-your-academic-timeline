// Fixed, observed Portal steps. No arbitrary selectors, payment values, URLs,
// API writes, or retries. Continue is not a claim that payment has succeeded.
import {
  assertRecoveryPortalLocation,
  recoveryPortalInspectionStage,
} from "./protected-stripe-browser-recovery.mjs";
import { inspectStripeSurface } from "./protected-stripe-browser-actions.mjs";
import {
  fillRecoveryCard,
  submitRecoveryCardContinue,
} from "./protected-stripe-browser-recovery-card-controls.mjs";

const fail = () => {
  throw new Error("RECOVERY_OBSERVED_FORM_STEP_REQUIRED");
};

export function assertRecoverySubscriptionForm({ page, portal, subscriptionId, claimAction }) {
  assertRecoveryPortalLocation(page.url(), portal);
  if (
    page.isClosed() ||
    typeof claimAction !== "function" ||
    !/^sub_[A-Za-z0-9]+$/.test(subscriptionId || "")
  )
    fail();
  const url = new URL(page.url());
  if (
    !url.pathname.split("/").includes(subscriptionId) &&
    ![...url.searchParams.values()].includes(subscriptionId)
  )
    fail();
}

export async function navigateVerifiedRecoveryAdd(input) {
  const { page, portal, claimAction } = input;
  assertRecoverySubscriptionForm(input);
  if (
    recoveryPortalInspectionStage(await inspectStripeSurface(page)) !== "payment-method-selection"
  )
    fail();
  const add = page.getByRole("button", { name: "Add payment method", exact: true });
  const ready = async () => {
    assertRecoverySubscriptionForm(input);
    if ((await add.count()) !== 1 || !(await add.isVisible()) || !(await add.isEnabled())) fail();
  };
  await ready();
  await claimAction();
  await ready();
  await add.click();
  // This is navigation only. Wait for all observed card inputs rather than
  // mistaking Stripe's temporary skeleton for a ready form.
  for (let attempt = 0; attempt < 60; attempt++) {
    assertRecoveryPortalLocation(page.url(), portal);
    const frames = page.frames();
    if (frames.length > 32) fail();
    const candidates = [];
    for (const frame of frames) {
      let url;
      try {
        url = new URL(frame.url());
      } catch {
        continue;
      }
      if (url.origin !== "https://js.stripe.com" || url.username || url.password) continue;
      if ((await frame.locator("#payment-numberInput").count()) === 1) candidates.push(frame);
    }
    if (candidates.length > 1) fail();
    if (candidates.length === 1) {
      let readyFields = true;
      for (const id of [
        "payment-numberInput",
        "payment-expiryInput",
        "payment-cvcInput",
        "payment-countryInput",
        "payment-postalCodeInput",
      ]) {
        const field = candidates[0].locator(`#${id}`);
        readyFields &&=
          (await field.count()) === 1 && (await field.isVisible()) && (await field.isEnabled());
      }
      if (readyFields) return { navigated: true, submitted: false };
    }
    await page.waitForTimeout(250);
  }
  fail();
}

export async function fillVerifiedRecoveryCard(input) {
  assertRecoverySubscriptionForm(input);
  return fillRecoveryCard({ page: input.page, portal: input.portal, claimFill: input.claimAction });
}

export async function continueVerifiedRecoveryCard(input) {
  assertRecoverySubscriptionForm(input);
  const result = await submitRecoveryCardContinue({
    page: input.page,
    portal: input.portal,
    claimSubmit: input.claimAction,
  });
  if (result.clicked !== true) fail();
  return { continued: true, paymentOutcomeUnverified: true };
}

// No confirmation export is supplied until the actual next screen is inspected.
