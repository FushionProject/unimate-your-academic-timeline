// One reviewed click on the already verified synthetic sandbox Checkout.
// The runner revalidates exact customer/price/mode and journals before calling.
// No card entry, saved-method change, Link enrollment, or payment retry.
export async function submitVerifiedTestPayment({ page, sessionId }) {
  const fail = () => {
    throw new Error("SANDBOX_CHECKOUT_SUBMIT_NOT_VERIFIED");
  };
  const url = new URL(page.url());
  if (
    url.origin !== "https://checkout.stripe.com" ||
    url.username ||
    url.password ||
    !/^cs_test_[A-Za-z0-9]+$/.test(sessionId || "") ||
    !url.pathname.split("/").includes(sessionId)
  )
    fail();
  const button = page.getByRole("button", { name: /^Subscribe/ });
  if ((await button.count()) !== 1 || !(await button.isVisible()) || !(await button.isEnabled()))
    fail();
  const text = await page.locator("body").innerText();
  if (!text.includes("$5.99")) fail();
  await button.click();
  // Submission is deliberately single-shot. An unchanged Checkout is inspected
  // separately; it never triggers a second click or automatic alternative.
}
