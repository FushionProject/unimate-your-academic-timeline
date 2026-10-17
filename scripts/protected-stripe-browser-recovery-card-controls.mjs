// Fixed observed Portal controls; published sandbox values only. No API calls,
// Link enrollment, automatic retries, or assertion that Continue settles payment.
import { assertRecoveryPortalLocation } from "./protected-stripe-browser-recovery.mjs";

const VALUES = Object.freeze({
  "payment-numberInput": "4242424242424242",
  "payment-expiryInput": "1234",
  "payment-cvcInput": "123",
  "payment-postalCodeInput": "94107",
});
const COUNTRY = "payment-countryInput";
const LINK = "payment-linkOptInInput";
const LINK_LABEL = /^Save my information for faster checkout$/;
const CONTINUE = /^Continue(?:\s*Continuing(?:…|\.\.\.))?$/;
const claimedPortals = new Set();
const fail = () => {
  throw new Error("VERIFIED_RECOVERY_CARD_CONTROLS_REQUIRED");
};

async function controls(page, portal, { allowLinkOptOut = false } = {}) {
  assertRecoveryPortalLocation(page.url(), portal);
  if (page.isClosed() || claimedPortals.has(portal.id)) fail();
  const location = page.url();
  const frames = page.frames();
  // The fully loaded observed Portal has 16 frames. Bound total frames without
  // confusing auxiliary Stripe frames with the one exact card-control frame.
  if (frames.length > 32) fail();
  const candidates = [];
  for (const frame of frames) {
    let url;
    try {
      url = new URL(frame.url());
    } catch {
      continue;
    }
    if (url.origin !== "https://js.stripe.com" || url.username || url.password || url.port)
      continue;
    if ((await frame.locator("#payment-numberInput").count()) > 0) candidates.push(frame);
  }
  if (candidates.length !== 1) fail();
  const frame = candidates[0];
  const frameUrl = frame.url();
  const fields = {};
  const unchanged = () => {
    assertRecoveryPortalLocation(page.url(), portal);
    if (page.isClosed() || page.url() !== location || frame.url() !== frameUrl) fail();
  };
  for (const id of [...Object.keys(VALUES), COUNTRY, LINK]) {
    const field = frame.locator(`#${id}`);
    if ((await field.count()) !== 1) fail();
    if (id !== LINK && (!(await field.isVisible()) || !(await field.isEnabled()))) fail();
    fields[id] = field;
  }
  // The observed input is hidden; only its visible, associated label can be
  // clicked to opt out. Submission never toggles this setting implicitly.
  if ((await fields[LINK].getAttribute("type")) !== "checkbox") fail();
  if (await fields[LINK].isChecked()) {
    if (!allowLinkOptOut) fail();
    const label = frame.locator("label").filter({ hasText: LINK_LABEL });
    if (
      (await label.count()) !== 1 ||
      !(await label.isVisible()) ||
      !(await label.isEnabled()) ||
      !LINK_LABEL.test((await label.innerText()).trim()) ||
      !(await label.evaluate((element, id) => {
        const input = element.control;
        return (
          input?.id === id &&
          input.type === "checkbox" &&
          (element.htmlFor === id || element.contains(input))
        );
      }, LINK))
    )
      fail();
    unchanged();
    // Recheck immediately before the single normal label click so an already
    // unchecked control is never toggled on by this helper.
    if (await fields[LINK].isChecked()) await label.click();
    unchanged();
    if (await fields[LINK].isChecked()) fail();
  }
  unchanged();
  return { fields, unchanged };
}

async function verifyValues(fields) {
  if ((await fields[LINK].isChecked()) || (await fields[COUNTRY].inputValue()) !== "US") fail();
  for (const [id, expected] of Object.entries(VALUES)) {
    const value = await fields[id].inputValue();
    const actual = ["payment-numberInput", "payment-expiryInput"].includes(id)
      ? value.replace(/[\s/]/g, "")
      : value;
    if (actual !== expected) fail();
  }
}

export async function fillRecoveryCard({ page, portal }) {
  try {
    const { fields, unchanged } = await controls(page, portal, { allowLinkOptOut: true });
    unchanged();
    await fields[COUNTRY].selectOption("US");
    for (const [id, value] of Object.entries(VALUES)) {
      unchanged();
      if (await fields[LINK].isChecked()) fail();
      await fields[id].fill(value);
    }
    unchanged();
    await verifyValues(fields);
    return { filled: true, submitted: false };
  } catch {
    fail();
  }
}

export async function submitRecoveryCardContinue({ page, portal, claimSubmit }) {
  try {
    if (typeof claimSubmit !== "function") fail();
    const { fields, unchanged } = await controls(page, portal);
    const button = page.getByRole("button", { name: CONTINUE });
    const ready = async () => {
      unchanged();
      await verifyValues(fields);
      if (
        (await button.count()) !== 1 ||
        !(await button.isVisible()) ||
        !(await button.isEnabled()) ||
        !CONTINUE.test((await button.innerText()).trim())
      )
        fail();
      unchanged();
    };
    await ready();
    if (claimedPortals.has(portal.id)) fail();
    claimedPortals.add(portal.id);
    // Caller must durably claim the exact Portal action. Any claim/click failure
    // remains consumed here too; never automatically try again.
    await claimSubmit();
    await ready();
    await button.click();
    return { clicked: true };
  } catch {
    fail();
  }
}
