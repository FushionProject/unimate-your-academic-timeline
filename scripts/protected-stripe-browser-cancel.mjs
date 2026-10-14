// Called only by the runner after exact synthetic customer/subscription proof
// and a persisted one-attempt cancellation journal. No API mutation or retry.
const fail = () => {
  throw new Error("VERIFIED_SANDBOX_PORTAL_CANCELLATION_REQUIRED");
};

export async function openVerifiedCancellation({ page }) {
  const original = new URL(page.url());
  if (original.origin !== "https://billing.stripe.com" || original.username || original.password)
    fail();
  const link = page.getByRole("link", { name: "Cancel subscription", exact: true });
  // Portal navigation can finish before Stripe hydrates the product and link.
  // Wait for the exact observed control before reading identity text or clicking.
  await link.waitFor({ state: "visible", timeout: 15000 });
  const current = new URL(page.url());
  if (current.origin !== original.origin || current.username || current.password) fail();
  const text = await page.locator("body").innerText();
  if (!text.includes("Sandbox") || !text.includes("UniMate Pro") || !text.includes("$5.99")) fail();
  if ((await link.count()) !== 1 || !(await link.isVisible())) fail();
  const target = new URL(await link.getAttribute("href"), original);
  if (target.origin !== original.origin || target.username || target.password) fail();
  await link.click();
}

async function assertConfirmationPage(page) {
  const current = new URL(page.url());
  const text = await page.locator("body").innerText();
  if (
    current.origin !== "https://billing.stripe.com" ||
    current.username ||
    current.password ||
    !text.includes("Sandbox") ||
    !text.includes("UniMate Pro") ||
    !text.includes("Cancel subscription")
  )
    fail();
}

export async function chooseVerifiedCancellationReason({ page }) {
  await assertConfirmationPage(page);
  const choice = page.getByRole("button", { name: "Choose an option", exact: true });
  await choice.waitFor({ state: "visible", timeout: 15000 });
  if ((await choice.count()) !== 1 || !(await choice.isEnabled())) fail();
  await choice.click();
  const other = page.getByText("Other", { exact: true });
  await other.waitFor({ state: "visible", timeout: 15000 });
  if ((await other.count()) !== 1 || !(await other.isVisible())) fail();
  await other.click();
  const comment = page.locator("textarea:visible");
  const comments = await comment.count();
  if (comments > 1) fail();
  if (comments === 1) {
    if (!(await comment.isEnabled())) fail();
    await comment.fill("Sandbox subscription lifecycle verification");
  }
  const next = page.getByRole("button", { name: "Continue to cancellation", exact: true });
  await next.waitFor({ state: "visible", timeout: 15000 });
  if ((await next.count()) !== 1 || !(await next.isVisible()) || !(await next.isEnabled())) fail();
  await next.click();
}

export async function confirmVerifiedCancellation({ page }) {
  await assertConfirmationPage(page);
  // Stripe includes its hidden busy label in this button's accessible name.
  const button = page.getByRole("button", { name: /^Cancel subscription/ });
  await button.waitFor({ state: "visible", timeout: 15000 });
  if ((await button.count()) !== 1) fail();
  const next = page.getByRole("button", { name: "Continue to cancellation", exact: true });
  if ((await next.count()) && (await next.isVisible())) fail();
  if (!(await button.isEnabled())) fail();
  await button.click();
}

export async function cancelVerifiedTestSubscription({ page }) {
  await openVerifiedCancellation({ page });
  await chooseVerifiedCancellationReason({ page });
  await confirmVerifiedCancellation({ page });
}
