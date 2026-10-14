import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sandboxClock } from "../../scripts/stripe-sandbox-clock.mjs";
import { TARGET, ARTIFACT } from "../../scripts/prepare-stripe-sandbox.mjs";

async function fixture({
  action = "status",
  wrongMarker = false,
  wrongCustomer = false,
  wrongPrice = false,
  multiple = false,
  uncertain = false,
  changedLink = false,
  scheduled = true,
  attachmentStatus = "ready",
  clockStatus = "ready",
  cancelAt = null,
  periodEnd = 2000000100,
  frozenTime = 2000000000,
  invalidSchedule = false,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "unimate-clock-fixture-"));
  const writes = [];
  let profileReads = 0;
  let canceled = false;
  try {
    const userId = "10000000-0000-4000-8000-000000000001",
      nonce = "20000000-0000-4000-8000-000000000002",
      marker = "unimate-stripe-sandbox-synthetic-v1";
    const record = {
      version: 1,
      userId,
      nonce,
      marker,
      email: `unimate-billing-${nonce}@example.test`,
      account: TARGET.account,
      price: TARGET.price,
      supabase: TARGET.supabase,
    };
    await fs.mkdir(path.join(root, ".stripe-sandbox.local"), { mode: 0o700 });
    await fs.writeFile(path.join(root, ARTIFACT), JSON.stringify(record), { mode: 0o600 });
    const json = (data) => new Response(JSON.stringify(data));
    const fetchImpl = async (url, init) => {
      assert.equal(init.redirect, "manual");
      assert.ok(init.signal);
      const parsed = new URL(url);
      if (parsed.origin === TARGET.supabase) {
        assert.equal(init.method, undefined, "Never write to Supabase");
        if (parsed.pathname.includes("/admin/users/"))
          return json({
            id: userId,
            email: record.email,
            app_metadata: {
              unimate_test_marker: wrongMarker ? "bad" : marker,
              unimate_test_nonce: nonce,
            },
          });
        profileReads++;
        return json([
          {
            id: userId,
            stripe_customer_id: changedLink && profileReads > 1 ? "cus_changed" : "cus_fixture",
          },
        ]);
      }
      assert.equal(parsed.origin, "https://api.stripe.com");
      if (init.method === "POST" || init.method === "DELETE") {
        writes.push({ url, init });
        if (uncertain) throw new Error("Sensitive raw error must not escape");
        if (init.method === "DELETE") {
          assert.equal(parsed.search, "?invoice_now=false&prorate=false");
          canceled = true;
          return json({
            id: "sub_fixture",
            customer: "cus_fixture",
            livemode: false,
            status: "canceled",
          });
        }
        assert.match(init.headers["Idempotency-Key"], /^unimate-test-/);
        const body = new URLSearchParams(init.body);
        if (action === "attach-clock") assert.equal(body.get("customer"), "cus_fixture");
        else assert.equal(body.get("frozen_time"), String(periodEnd + 1));
        return json({
          id: "clock_fixture",
          livemode: false,
          status: action === "attach-clock" ? attachmentStatus : "advancing",
        });
      }
      if (parsed.pathname === "/v1/customers/cus_fixture")
        return json({
          id: "cus_fixture",
          livemode: false,
          metadata: { user_id: wrongCustomer ? "other" : userId },
          test_clock: action === "attach-clock" ? null : "clock_fixture",
        });
      if (parsed.pathname.includes("/test_helpers/test_clocks/"))
        return json({
          id: "clock_fixture",
          livemode: false,
          status: clockStatus,
          frozen_time: frozenTime,
        });
      if (parsed.pathname === "/v1/subscriptions") {
        assert.equal(parsed.searchParams.get("customer"), "cus_fixture");
        const sub = {
          id: "sub_fixture",
          livemode: false,
          customer: "cus_fixture",
          metadata: { user_id: userId },
          status: canceled ? "canceled" : "active",
          cancel_at_period_end: scheduled,
          cancel_at: cancelAt,
          items: {
            has_more: false,
            data: [
              {
                quantity: 1,
                price: { id: wrongPrice ? "price_other" : TARGET.price },
                current_period_end: periodEnd,
              },
            ],
          },
        };
        return json({
          data: multiple ? [sub, { ...sub, id: "sub_second" }] : [sub],
          has_more: false,
        });
      }
      throw new Error("Unexpected fixture read");
    };
    const run = () =>
      sandboxClock({
        action,
        approved: true,
        root,
        fetchImpl,
        verify: async (args) => {
          assert.equal(args.verificationOnly, true);
          return {
            supa: { SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture" },
            stripe: { STRIPE_SECRET_KEY: "sk_test_fixture" },
          };
        },
        now: () => 1999999900000,
      });
    if (
      wrongMarker ||
      wrongCustomer ||
      wrongPrice ||
      multiple ||
      uncertain ||
      changedLink ||
      (action === "advance-to-expiry" && !scheduled && cancelAt === null) ||
      invalidSchedule ||
      (action === "advance-to-expiry" && clockStatus !== "ready") ||
      (action === "attach-clock" && !["advancing", "ready"].includes(attachmentStatus))
    ) {
      await assert.rejects(run(), (error) => error.code && !error.message.includes("Sensitive"));
      const invalidAttachment =
        action === "attach-clock" && !["advancing", "ready"].includes(attachmentStatus);
      assert.equal(writes.length, uncertain || invalidAttachment ? 1 : 0);
      if (uncertain) {
        await assert.rejects(run(), /CLOCK_ACTION_ALREADY_JOURNALED_USE_STATUS/);
        assert.equal(writes.length, 1);
      }
      return;
    }
    const result = await run();
    assert.equal(JSON.stringify(result).includes("sk_test_"), false);
    assert.equal(writes.length, action === "status" ? 0 : 1);
    assert.equal(result.subscriptions[0].cancelAt, cancelAt);
    if (result.artifact) {
      assert.equal((await fs.stat(path.join(root, result.artifact))).mode & 0o777, 0o600);
      const journal = JSON.parse(await fs.readFile(path.join(root, result.artifact), "utf8"));
      assert.equal(journal.state, "accepted");
      if (action === "advance-to-expiry") assert.equal(journal.targetTime, periodEnd + 1);
      if (action === "attach-clock") {
        assert.equal(result.clockStatus, attachmentStatus);
        assert.equal(result.awaitClockReady, attachmentStatus === "advancing");
        assert.equal(journal.result.clockId, "clock_fixture");
      }
      await assert.rejects(
        run(),
        /CLOCK_ACTION_ALREADY_JOURNALED_USE_STATUS|SINGLE_ACTIVE_SUBSCRIPTION_REQUIRED/,
      );
      assert.equal(writes.length, 1);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
await assert.rejects(
  sandboxClock({ action: "cancel-immediately" }),
  /EXPLICIT_CLOCK_APPROVAL_REQUIRED/,
);
for (const action of ["status", "attach-clock", "advance-to-expiry", "cancel-immediately"])
  await fixture({ action });
await fixture({ action: "attach-clock", attachmentStatus: "advancing" });
for (const attachmentStatus of ["internal_failure", "initializing", "unknown"])
  await fixture({ action: "attach-clock", attachmentStatus });
await fixture({ action: "advance-to-expiry", clockStatus: "advancing" });
await fixture({
  action: "advance-to-expiry",
  scheduled: false,
  cancelAt: 1794624308,
  periodEnd: 1794624308,
  frozenTime: 1791945997,
});
await fixture({ action: "status", scheduled: false, cancelAt: 1794624308 });
for (const cancelAt of [-1, 0, 2000000100.5, "2000000100", 2000000099, 2000000101])
  await fixture({ action: "advance-to-expiry", scheduled: false, cancelAt, invalidSchedule: true });
await fixture({
  action: "advance-to-expiry",
  scheduled: false,
  cancelAt: 2000000100,
  frozenTime: 2000000100,
  invalidSchedule: true,
});
for (const bad of [
  "wrongMarker",
  "wrongCustomer",
  "wrongPrice",
  "multiple",
  "uncertain",
  "changedLink",
])
  await fixture({ action: "cancel-immediately", [bad]: true });
await fixture({ action: "advance-to-expiry", scheduled: false });
console.log(
  "PASS offline sandbox clock: synthetic identity/link/price, single-active scope, exact expiry, no DB writes, private journal and no uncertain retry",
);
