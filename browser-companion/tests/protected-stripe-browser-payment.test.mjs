import assert from "node:assert/strict";
import {
  submitVerifiedTestPayment,
  claimSandboxBrowserPayment,
} from "../../scripts/protected-stripe-browser-payment.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const sessionId = "cs_" + "test_fixture";
function fixture(overrides = {}) {
  let clicks = 0;
  let claims = 0;
  const state = {
    url: `https://checkout.stripe.com/c/pay/${sessionId}`,
    count: 1,
    visible: true,
    enabled: true,
    text: "$5.99 Subscribe",
    ...overrides,
  };
  const page = {
    url: () => state.url,
    getByRole: (role, options) => {
      assert.equal(role, "button");
      assert.ok(options.name.test("Subscribe"));
      return {
        count: async () => state.count,
        isVisible: async () => state.visible,
        isEnabled: async () => state.enabled,
        click: async () => {
          clicks++;
          if (state.clickFails) throw new Error("Synthetic browser interruption");
        },
      };
    },
    locator: (selector) => {
      assert.equal(selector, "body");
      return { innerText: async () => state.text };
    },
  };
  return {
    run: () =>
      submitVerifiedTestPayment({
        page,
        sessionId,
        claimPayment: async () => {
          claims++;
          if (state.claimFails) throw new Error("claimed");
        },
      }),
    clicks: () => clicks,
    claims: () => claims,
  };
}
const valid = fixture();
await valid.run();
assert.equal(valid.clicks(), 1);
assert.equal(valid.claims(), 1);
const lostClaim = fixture({ claimFails: true });
await assert.rejects(lostClaim.run(), /claimed/);
assert.equal(lostClaim.clicks(), 0);
const uncertain = fixture({ clickFails: true });
await assert.rejects(uncertain.run(), /Synthetic browser interruption/);
assert.equal(uncertain.clicks(), 1, "An uncertain submission must never be retried");
for (const bad of [
  { url: `https://example.test/c/pay/${sessionId}` },
  { url: "https://checkout.stripe.com/c/pay/cs_test_unrelated" },
  { url: `https://name@checkout.stripe.com/c/pay/${sessionId}` },
  { count: 0 },
  { count: 2 },
  { visible: false },
  { enabled: false },
  { text: "$9.99 Subscribe" },
]) {
  const item = fixture(bad);
  await assert.rejects(item.run(), /SANDBOX_CHECKOUT_SUBMIT_NOT_VERIFIED/);
  assert.equal(item.clicks(), 0);
  assert.equal(item.claims(), 0);
}
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-payment-claim-test-"));
try {
  const outcomes = await Promise.allSettled(
    Array.from({ length: 10 }, () => claimSandboxBrowserPayment(sessionId, directory)),
  );
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((r) => r.status === "rejected").length, 9);
  const files = await fs.readdir(directory);
  assert.equal(files.length, 1);
  const filename = path.join(directory, files[0]);
  assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await fs.readFile(filename, "utf8")).phase, "claimed");
  await assert.rejects(
    claimSandboxBrowserPayment(sessionId, directory),
    /ALREADY_CLAIMED_OR_UNSAFE/,
  );
  await assert.rejects(
    claimSandboxBrowserPayment("cs_live_notAllowed", directory),
    /ALREADY_CLAIMED_OR_UNSAFE/,
  );
  await fs.chmod(directory, 0o755);
  await assert.rejects(
    claimSandboxBrowserPayment("cs_test_other", directory),
    /ALREADY_CLAIMED_OR_UNSAFE/,
  );
} finally {
  await fs.rm(directory, { recursive: true });
}
console.log(
  "PASS fixed sandbox Checkout click: exact test session, price, one visible enabled button; no card entry or retry (offline)",
);
