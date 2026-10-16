// One reviewed click on the already verified synthetic sandbox Checkout.
// The runner revalidates exact customer/price/mode and journals before calling.
// No card entry, saved-method change, Link enrollment, or payment retry.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const PRIVATE = fileURLToPath(new URL("../.stripe-sandbox.local", import.meta.url));

// Both the main runner and the Card continuation pass through this helper.
// An immutable per-Checkout claim fences concurrent processes and survives
// uncertain browser outcomes. The injected directory is only for offline tests.
export async function claimSandboxBrowserPayment(sessionId, directory = PRIVATE) {
  const fail = () => {
    throw new Error("SANDBOX_PAYMENT_ALREADY_CLAIMED_OR_UNSAFE");
  };
  if (!/^cs_test_[A-Za-z0-9]+$/.test(sessionId || "")) fail();
  let handle;
  try {
    const stat = await fs.lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid() ||
      stat.mode & 0o077
    )
      fail();
    const hash = createHash("sha256").update(sessionId).digest("hex");
    handle = await fs.open(path.join(directory, `payment-submit-${hash}.json`), "wx", 0o600);
    await handle.writeFile(
      JSON.stringify({ version: 1, sessionSha256: hash, phase: "claimed", claimedAt: Date.now() }),
    );
    await handle.sync();
  } catch {
    fail();
  } finally {
    await handle?.close();
  }
}

export async function submitVerifiedTestPayment({
  page,
  sessionId,
  claimPayment = claimSandboxBrowserPayment,
}) {
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
  await claimPayment(sessionId);
  await button.click();
  // Submission is deliberately single-shot. An unchanged Checkout is inspected
  // separately; it never triggers a second click or automatic alternative.
}
