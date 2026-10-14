// Synthetic sandbox customer ONLY. No application/DB writes, payments,
// customer deletion, retries, or general-purpose URL/ID arguments.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  prepareSandbox,
  privateJson,
  TARGET,
  ARTIFACT,
  SetupError,
} from "./prepare-stripe-sandbox.mjs";
import { readPrivate } from "./verify-stripe-sandbox-lifecycle.mjs";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MARKER = "unimate-stripe-sandbox-synthetic-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (code) => {
  throw new SetupError(code);
};
const objectId = (value) => (typeof value === "string" ? value : value?.id);

export async function sandboxClock({
  action,
  approved = false,
  root = ROOT,
  fetchImpl = fetch,
  verify = prepareSandbox,
  now = Date.now,
} = {}) {
  if (
    !approved ||
    !["status", "attach-clock", "advance-to-expiry", "cancel-immediately"].includes(action)
  )
    fail("EXPLICIT_CLOCK_APPROVAL_REQUIRED");
  try {
    const config = await verify({ approved: true, verificationOnly: true, root, fetchImpl });
    const directory = path.join(root, ".stripe-sandbox.local");
    const directoryStat = await fs.lstat(directory);
    if (
      !directoryStat.isDirectory() ||
      directoryStat.mode & 0o077 ||
      directoryStat.uid !== process.getuid()
    )
      fail("PRIVATE_DIRECTORY_REQUIRED");
    const record = JSON.parse(await readPrivate(path.join(root, ARTIFACT)));
    if (
      record.version !== 1 ||
      record.marker !== MARKER ||
      record.account !== TARGET.account ||
      record.price !== TARGET.price ||
      record.supabase !== TARGET.supabase ||
      !UUID.test(record.userId) ||
      !UUID.test(record.nonce) ||
      record.email !== `unimate-billing-${record.nonce}@example.test`
    )
      fail("SYNTHETIC_RECORD_INVALID");
    const service = config.supa.SUPABASE_SERVICE_ROLE_KEY;
    const headers = service.startsWith("sb_secret_")
      ? { apikey: service }
      : { apikey: service, Authorization: `Bearer ${service}` };
    const user = await privateJson(
      fetchImpl,
      `${TARGET.supabase}/auth/v1/admin/users/${record.userId}`,
      { headers },
    );
    if (
      user.id !== record.userId ||
      user.email !== record.email ||
      user.app_metadata?.unimate_test_marker !== MARKER ||
      user.app_metadata?.unimate_test_nonce !== record.nonce
    )
      fail("SYNTHETIC_USER_IDENTITY_MISMATCH");
    const readProfile = () =>
      privateJson(
        fetchImpl,
        `${TARGET.supabase}/rest/v1/profiles?${new URLSearchParams({ id: `eq.${record.userId}`, select: "id,stripe_customer_id" })}`,
        { headers },
      );
    const profiles = await readProfile();
    if (
      !Array.isArray(profiles) ||
      profiles.length !== 1 ||
      profiles[0].id !== record.userId ||
      !/^cus_[A-Za-z0-9]+$/.test(profiles[0].stripe_customer_id)
    )
      fail("SYNTHETIC_CUSTOMER_LINK_REQUIRED");
    const customerId = profiles[0].stripe_customer_id;
    const stripeHeaders = {
      Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
      "Stripe-Version": "2026-06-24.dahlia",
    };
    const request = (endpoint, init = {}) =>
      privateJson(fetchImpl, `https://api.stripe.com/v1${endpoint}`, {
        ...init,
        headers: { ...stripeHeaders, ...init.headers },
      });
    const customer = await request(`/customers/${customerId}`);
    if (
      customer.id !== customerId ||
      customer.deleted ||
      customer.livemode !== false ||
      customer.metadata?.user_id !== record.userId
    )
      fail("SYNTHETIC_CUSTOMER_MISMATCH");
    const list = await request(
      `/subscriptions?${new URLSearchParams({ customer: customerId, status: "all", limit: "100" })}`,
    );
    if (!Array.isArray(list.data) || list.has_more !== false) fail("INCOMPLETE_SUBSCRIPTION_LIST");
    const subscriptions = list.data;
    for (const sub of subscriptions) {
      if (
        !/^sub_[A-Za-z0-9]+$/.test(sub.id) ||
        sub.livemode !== false ||
        objectId(sub.customer) !== customerId ||
        sub.metadata?.user_id !== record.userId ||
        sub.items?.has_more !== false ||
        sub.items?.data?.length !== 1 ||
        objectId(sub.items.data[0].price) !== TARGET.price ||
        sub.items.data[0].quantity !== 1
      )
        fail("SUBSCRIPTION_SCOPE_MISMATCH");
    }
    const active = subscriptions.filter(
      (sub) => !["canceled", "incomplete_expired"].includes(sub.status),
    );
    let clockId = objectId(customer.test_clock) || null;
    if (clockId && !/^clock_[A-Za-z0-9]+$/.test(clockId)) fail("CLOCK_ID_INVALID");
    let clock = clockId ? await request(`/test_helpers/test_clocks/${clockId}`) : null;
    if (clock && (clock.id !== clockId || clock.livemode !== false)) fail("CLOCK_SCOPE_MISMATCH");
    const summary = () => ({
      action,
      account: TARGET.account,
      userId: record.userId,
      customerId,
      clockId,
      clockStatus: clock?.status || null,
      subscriptions: subscriptions.map((sub) => ({
        id: sub.id,
        status: sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        cancelAt: sub.cancel_at ?? null,
        periodEnd: sub.items.data[0].current_period_end || sub.current_period_end || null,
      })),
    });
    if (action === "status") return summary();
    if (action === "attach-clock" && clock) return { ...summary(), alreadyAttached: true };
    if (active.length !== 1 || active[0].status !== "active")
      fail("SINGLE_ACTIVE_SUBSCRIPTION_REQUIRED");
    const subscription = active[0];
    let targetTime = null;
    if (action === "advance-to-expiry") {
      const periodEnd =
        subscription.items.data[0].current_period_end || subscription.current_period_end;
      // Flexible billing can schedule cancellation with cancel_at while the
      // older flag stays false. This expiry test permits only the actual end
      // of this approved subscription's current period, never arbitrary dates.
      const cancelAt = subscription.cancel_at;
      const cancellationTime =
        cancelAt == null
          ? subscription.cancel_at_period_end === true
            ? periodEnd
            : null
          : cancelAt;
      if (
        !clock ||
        clock.status !== "ready" ||
        !Number.isSafeInteger(clock.frozen_time) ||
        clock.frozen_time < 0 ||
        !Number.isSafeInteger(periodEnd) ||
        !Number.isSafeInteger(cancellationTime) ||
        cancellationTime <= 0 ||
        cancellationTime !== periodEnd ||
        cancellationTime <= clock.frozen_time ||
        !Number.isSafeInteger(cancellationTime + 1)
      )
        fail("SCHEDULED_EXPIRY_AND_READY_CLOCK_REQUIRED");
      targetTime = cancellationTime + 1;
    }
    // Fixed operation key gives each subscription/expiry one attempt journal.
    // Pending means outcome unknown: reconcile read-only rather than retry.
    const digest = createHash("sha256")
      .update(
        JSON.stringify([
          record.userId,
          customerId,
          action,
          action === "attach-clock" ? null : subscription.id,
          targetTime,
        ]),
      )
      .digest("hex");
    const artifact = `.stripe-sandbox.local/clock-${digest}.json`;
    const journalPath = path.join(root, artifact);
    const journal = {
      version: 1,
      action,
      userId: record.userId,
      customerId,
      subscriptionId: subscription.id,
      clockId,
      targetTime,
      state: "pending",
      idempotency: `unimate-test-${randomUUID()}`,
    };
    try {
      await fs.writeFile(journalPath, JSON.stringify(journal), { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code === "EEXIST") fail("CLOCK_ACTION_ALREADY_JOURNALED_USE_STATUS");
      throw error;
    }
    // Recheck the DB link immediately before sending the only mutation.
    const current = await readProfile();
    if (
      current.length !== 1 ||
      current[0].id !== record.userId ||
      current[0].stripe_customer_id !== customerId
    )
      fail("CUSTOMER_LINK_CHANGED");
    let result;
    if (action === "attach-clock") {
      result = await request("/test_helpers/test_clocks", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": journal.idempotency,
        },
        body: new URLSearchParams({
          customer: customerId,
          frozen_time: String(Math.floor(now() / 1000) + 60),
          name: "UniMate synthetic subscription expiry",
        }).toString(),
      });
      if (
        !/^clock_[A-Za-z0-9]+$/.test(result.id) ||
        result.livemode !== false ||
        // Attachment can begin advancing asynchronously. Accepted is not ready:
        // a separate status read must prove readiness before advancing again.
        !["advancing", "ready"].includes(result.status)
      )
        fail("CLOCK_RESULT_INVALID");
      clockId = result.id;
      clock = result;
    } else if (action === "advance-to-expiry") {
      result = await request(`/test_helpers/test_clocks/${clockId}/advance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": journal.idempotency,
        },
        body: new URLSearchParams({ frozen_time: String(targetTime) }).toString(),
      });
      if (
        result.id !== clockId ||
        result.livemode !== false ||
        !["advancing", "ready"].includes(result.status)
      )
        fail("CLOCK_RESULT_INVALID");
      clock = result;
    } else {
      // Stripe DELETE is not protected by POST idempotency; the private
      // create-exclusive journal prevents a second attempt after uncertainty.
      result = await request(`/subscriptions/${subscription.id}?invoice_now=false&prorate=false`, {
        method: "DELETE",
      });
      if (
        result.id !== subscription.id ||
        objectId(result.customer) !== customerId ||
        result.livemode !== false ||
        result.status !== "canceled"
      )
        fail("CANCELLATION_RESULT_INVALID");
      subscription.status = result.status;
    }
    const output = {
      ...summary(),
      artifact,
      accepted: true,
      awaitClockReady: clock?.status === "advancing",
      awaitWebhook: true,
    };
    const completed = path.join(directory, `clock-${digest}-${randomUUID()}.tmp`);
    await fs.writeFile(
      completed,
      JSON.stringify({ ...journal, state: "accepted", result: output }),
      { flag: "wx", mode: 0o600 },
    );
    await fs.rename(completed, journalPath);
    return output;
  } catch (error) {
    throw error instanceof SetupError ? error : new SetupError("PRIVATE_CLOCK_ACTION_FAILED");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  sandboxClock({
    action: process.argv.length === 3 ? process.argv[2] : undefined,
    approved: process.env.UNIMATE_STRIPE_TEST_CLOCK === "approved",
  }).then(
    (result) => console.log(JSON.stringify(result, null, 2)),
    (error) => {
      console.error(
        `Clock action stopped: ${error instanceof SetupError ? error.code : "PRIVATE_CLOCK_ACTION_FAILED"}. No automatic retry; use status and preserve private journal.`,
      );
      process.exitCode = 1;
    },
  );
}
