// Operator-only, exact synthetic sandbox. No application/DB writes or arbitrary
// resource arguments. Every mutation is journaled; uncertainty is never retried.
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
const ACTIONS = [
  "status",
  "advance-to-renewal",
  "settle-renewal",
  "install-decline",
  "restore-payment",
  "pay-invoice",
];
const id = (value) => (typeof value === "string" ? value : value?.id);
const validId = (value, prefix) =>
  typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value);
const fail = (code) => {
  throw new SetupError(code);
};
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function sandboxRenewal({
  action,
  approved = false,
  root = ROOT,
  fetchImpl = fetch,
  verify = prepareSandbox,
} = {}) {
  if (!approved || !ACTIONS.includes(action)) fail("EXPLICIT_RENEWAL_APPROVAL_REQUIRED");
  let lock;
  let lockPath;
  try {
    const config = await verify({ approved: true, verificationOnly: true, root, fetchImpl });
    const directory = path.join(root, ".stripe-sandbox.local");
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.mode & 0o077 || stat.uid !== process.getuid())
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
    if (action !== "status") {
      lockPath = path.join(directory, "renewal-operation.lock");
      try {
        lock = await fs.open(lockPath, "wx", 0o600);
      } catch (error) {
        if (error.code === "EEXIST") fail("RENEWAL_OPERATION_LOCKED");
        throw error;
      }
    }
    const service = config.supa.SUPABASE_SERVICE_ROLE_KEY;
    const auth = service.startsWith("sb_secret_")
      ? { apikey: service }
      : { apikey: service, Authorization: `Bearer ${service}` };
    const user = await privateJson(
      fetchImpl,
      `${TARGET.supabase}/auth/v1/admin/users/${record.userId}`,
      { headers: auth },
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
        { headers: auth },
      );
    const profiles = await readProfile();
    if (
      !Array.isArray(profiles) ||
      profiles.length !== 1 ||
      profiles[0].id !== record.userId ||
      !validId(profiles[0].stripe_customer_id, "cus")
    )
      fail("SYNTHETIC_CUSTOMER_LINK_REQUIRED");
    const customerId = profiles[0].stripe_customer_id;
    const request = (endpoint, init = {}) =>
      privateJson(fetchImpl, `https://api.stripe.com/v1${endpoint}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
          "Stripe-Version": "2026-06-24.dahlia",
          ...init.headers,
        },
      });
    const customer = await request(`/customers/${customerId}`);
    if (
      customer.id !== customerId ||
      customer.deleted ||
      customer.livemode !== false ||
      customer.metadata?.user_id !== record.userId ||
      !validId(id(customer.test_clock), "clock")
    )
      fail("SYNTHETIC_CUSTOMER_CLOCK_REQUIRED");
    const clockId = id(customer.test_clock);
    const clock = await request(`/test_helpers/test_clocks/${clockId}`);
    if (
      clock.id !== clockId ||
      clock.livemode !== false ||
      !positive(clock.frozen_time) ||
      !["ready", "advancing", "internal_failure"].includes(clock.status)
    )
      fail("CLOCK_SCOPE_MISMATCH");
    const list = await request(
      `/subscriptions?${new URLSearchParams({ customer: customerId, status: "all", limit: "100" })}`,
    );
    if (
      !Array.isArray(list.data) ||
      list.has_more !== false ||
      new Set(list.data.map((s) => s.id)).size !== list.data.length
    )
      fail("INCOMPLETE_SUBSCRIPTION_LIST");
    const validateSub = (sub) => {
      if (
        !validId(sub.id, "sub") ||
        ![
          "active",
          "trialing",
          "past_due",
          "unpaid",
          "paused",
          "incomplete",
          "incomplete_expired",
          "canceled",
        ].includes(sub.status) ||
        sub.livemode !== false ||
        id(sub.customer) !== customerId ||
        sub.metadata?.user_id !== record.userId ||
        sub.items?.has_more !== false ||
        sub.items?.data?.length !== 1 ||
        id(sub.items.data[0].price) !== TARGET.price ||
        sub.items.data[0].quantity !== 1
      )
        fail("SUBSCRIPTION_SCOPE_MISMATCH");
    };
    list.data.forEach(validateSub);
    const current = list.data.filter((s) => !["canceled", "incomplete_expired"].includes(s.status));
    if (current.length > 1 || (action !== "status" && current.length !== 1))
      fail("SINGLE_CURRENT_SUBSCRIPTION_REQUIRED");
    const sub = current[0];
    const invoiceId = id(sub?.latest_invoice);
    let invoice = null;
    if (sub) {
      if (!validId(invoiceId, "in")) fail("LATEST_INVOICE_REQUIRED");
      invoice = await request(`/invoices/${invoiceId}`);
      if (
        invoice.id !== invoiceId ||
        !["draft", "open", "paid", "void", "uncollectible"].includes(invoice.status) ||
        invoice.livemode !== false ||
        id(invoice.customer) !== customerId ||
        invoice.parent?.type !== "subscription_details" ||
        id(invoice.parent.subscription_details?.subscription) !== sub.id
      )
        fail("INVOICE_SCOPE_MISMATCH");
    }
    const paymentPath = sub
      ? path.join(directory, `renewal-payment-${digest([record.userId, customerId, sub.id])}.json`)
      : null;
    let payment = null;
    if (paymentPath) {
      try {
        payment = JSON.parse(await readPrivate(paymentPath));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (
        payment &&
        (payment.version !== 1 ||
          payment.userId !== record.userId ||
          payment.customerId !== customerId ||
          payment.subscriptionId !== sub.id ||
          !validId(payment.originalEffective, "pm") ||
          (payment.originalDefault !== null && !validId(payment.originalDefault, "pm")))
      )
        fail("PAYMENT_JOURNAL_INVALID");
    }
    const effective =
      id(sub?.default_payment_method) ||
      id(customer.invoice_settings?.default_payment_method) ||
      null;
    const summary = () => ({
      action,
      testAccountVerified: true,
      clockStatus: clock.status,
      clockFrozenTime: clock.frozen_time,
      currentSubscriptions: current.length,
      terminalSubscriptions: list.data.length - current.length,
      subscriptionStatus: sub?.status || null,
      periodEnd: sub?.items.data[0].current_period_end || null,
      paymentMethod:
        payment && effective === payment.declineId
          ? "installed-decline"
          : payment && effective === payment.originalEffective
            ? "original"
            : effective
              ? "existing"
              : "absent",
      paymentJournalState: payment?.state || null,
      invoice: invoice
        ? {
            status: invoice.status,
            billingReason: [
              "subscription_create",
              "subscription_cycle",
              "subscription_update",
            ].includes(invoice.billing_reason)
              ? invoice.billing_reason
              : "other",
            amountDue: invoice.amount_due,
            amountRemaining: invoice.amount_remaining,
            amountPaid: invoice.amount_paid,
            currency: invoice.currency,
            attempted: invoice.attempted,
            attemptCount: invoice.attempt_count,
          }
        : null,
    });
    if (action === "status") return summary();
    // A prior unknown result blocks every subsequent mutation, even when the
    // remote state has moved into another billing period. Status stays usable.
    for (const name of await fs.readdir(directory)) {
      if (!/^renewal-[a-f0-9]{64}\.json$/.test(name)) continue;
      const previous = JSON.parse(await readPrivate(path.join(directory, name)));
      if (previous.state !== "accepted") fail("RENEWAL_UNCERTAIN_JOURNAL_USE_STATUS");
    }
    if (payment?.state === "pending") fail("RENEWAL_UNCERTAIN_JOURNAL_USE_STATUS");
    const end = sub.items.data[0].current_period_end;
    if (
      clock.status !== "ready" ||
      !["active", "past_due"].includes(sub.status) ||
      sub.collection_method !== "charge_automatically" ||
      sub.cancel_at_period_end !== false ||
      sub.cancel_at != null ||
      sub.pause_collection != null ||
      sub.schedule != null ||
      !positive(end)
    )
      fail("READY_UNSCHEDULED_SUBSCRIPTION_REQUIRED");
    const assertRecurringInvoice = (status) => {
      const lines = invoice.lines;
      const line = lines?.data?.[0];
      const price = line?.pricing?.price_details?.price ?? line?.price;
      if (
        invoice.status !== status ||
        invoice.billing_reason !== "subscription_cycle" ||
        invoice.collection_method !== "charge_automatically" ||
        invoice.currency !== "usd" ||
        !positive(invoice.amount_due) ||
        invoice.amount_due > 599 ||
        !positive(invoice.total) ||
        invoice.total > 599 ||
        lines?.has_more !== false ||
        lines.data?.length !== 1 ||
        id(price) !== TARGET.price ||
        line.quantity !== 1 ||
        !positive(invoice.created)
      )
        fail("BOUNDED_RECURRING_INVOICE_REQUIRED");
    };
    const checkPayment = async (paymentId) => {
      if (!validId(paymentId, "pm")) fail("EXISTING_PAYMENT_METHOD_REQUIRED");
      const method = await request(`/payment_methods/${paymentId}`);
      if (
        method.id !== paymentId ||
        method.livemode !== false ||
        id(method.customer) !== customerId ||
        method.type !== "card"
      )
        fail("PAYMENT_METHOD_SCOPE_MISMATCH");
      return method;
    };
    const savePayment = async () => {
      const temporary = `${paymentPath}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(payment), { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, paymentPath);
    };
    const mutate = async (step, scope, endpoint, body, validate) => {
      const journalPath = path.join(
        directory,
        `renewal-${digest([record.userId, customerId, sub.id, step, scope])}.json`,
      );
      const journal = {
        version: 1,
        step,
        userId: record.userId,
        customerId,
        subscriptionId: sub.id,
        scope,
        state: "pending",
        idempotency: `unimate-renewal-${randomUUID()}`,
      };
      try {
        await fs.writeFile(journalPath, JSON.stringify(journal), { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (error.code === "EEXIST") fail("RENEWAL_ACTION_ALREADY_JOURNALED_USE_STATUS");
        throw error;
      }
      const rows = await readProfile();
      if (
        !Array.isArray(rows) ||
        rows.length !== 1 ||
        rows[0].id !== record.userId ||
        rows[0].stripe_customer_id !== customerId
      )
        fail("CUSTOMER_LINK_CHANGED");
      const latest = await request(`/subscriptions/${sub.id}`);
      validateSub(latest);
      if (
        latest.status !== sub.status ||
        latest.collection_method !== "charge_automatically" ||
        id(latest.latest_invoice) !== invoiceId ||
        id(latest.default_payment_method) !== id(sub.default_payment_method) ||
        latest.cancel_at_period_end !== false ||
        latest.cancel_at != null ||
        latest.pause_collection != null ||
        latest.schedule != null ||
        latest.items.data[0].current_period_end !== end
      )
        fail("SUBSCRIPTION_CHANGED");
      const latestClock = await request(`/test_helpers/test_clocks/${clockId}`);
      if (
        latestClock.id !== clockId ||
        latestClock.livemode !== false ||
        latestClock.status !== "ready" ||
        latestClock.frozen_time !== clock.frozen_time
      )
        fail("CLOCK_CHANGED");
      if (step === "pay-invoice") {
        const latestInvoice = await request(`/invoices/${invoiceId}`);
        for (const field of [
          "id",
          "livemode",
          "status",
          "currency",
          "amount_due",
          "amount_remaining",
          "total",
          "billing_reason",
          "collection_method",
        ]) {
          if (latestInvoice[field] !== invoice[field]) fail("INVOICE_CHANGED");
        }
        if (
          id(latestInvoice.customer) !== customerId ||
          id(latestInvoice.parent?.subscription_details?.subscription) !== sub.id
        )
          fail("INVOICE_CHANGED");
      }
      const result = await request(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": journal.idempotency,
        },
        body: new URLSearchParams(body).toString(),
      });
      validate(result);
      const temporary = `${journalPath}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify({ ...journal, state: "accepted" }), {
        flag: "wx",
        mode: 0o600,
      });
      await fs.rename(temporary, journalPath);
      return result;
    };
    if (action === "advance-to-renewal" || action === "settle-renewal") {
      let target;
      if (action === "advance-to-renewal") {
        if (
          sub.status !== "active" ||
          invoice.status !== "paid" ||
          end <= clock.frozen_time ||
          end - clock.frozen_time > 32 * 86400
        )
          fail("NEXT_PAID_RENEWAL_REQUIRED");
        target = end;
      } else {
        assertRecurringInvoice("draft");
        if (
          invoice.auto_advance !== true ||
          invoice.created > clock.frozen_time ||
          clock.frozen_time - invoice.created > 3600
        )
          fail("FRESH_AUTOMATIC_DRAFT_REQUIRED");
        target = clock.frozen_time + 3601;
        if (target >= end) fail("SETTLEMENT_MUST_NOT_CROSS_PERIOD");
      }
      await mutate(
        action,
        [invoiceId, target],
        `/test_helpers/test_clocks/${clockId}/advance`,
        { frozen_time: String(target) },
        (result) => {
          if (
            result.id !== clockId ||
            result.livemode !== false ||
            !["ready", "advancing"].includes(result.status)
          )
            fail("CLOCK_RESULT_INVALID");
        },
      );
    } else if (action === "install-decline") {
      if (payment) fail("PAYMENT_EXPERIMENT_ALREADY_JOURNALED");
      if (sub.status !== "active" || invoice.status !== "paid") fail("PAID_SUBSCRIPTION_REQUIRED");
      await checkPayment(effective);
      payment = {
        version: 1,
        userId: record.userId,
        customerId,
        subscriptionId: sub.id,
        originalDefault: id(sub.default_payment_method) || null,
        originalEffective: effective,
        state: "pending",
      };
      await fs.writeFile(paymentPath, JSON.stringify(payment), { flag: "wx", mode: 0o600 });
      const attached = await mutate(
        "attach-decline",
        "once",
        "/payment_methods/pm_card_chargeCustomerFail/attach",
        { customer: customerId },
        (method) => {
          if (
            !validId(method.id, "pm") ||
            method.livemode !== false ||
            id(method.customer) !== customerId ||
            method.type !== "card" ||
            method.card?.last4 !== "0341"
          )
            fail("DECLINE_METHOD_RESULT_INVALID");
        },
      );
      payment.declineId = attached.id;
      await savePayment();
      await mutate(
        "set-decline",
        "once",
        `/subscriptions/${sub.id}`,
        { default_payment_method: attached.id },
        (result) => {
          validateSub(result);
          if (result.id !== sub.id || id(result.default_payment_method) !== attached.id)
            fail("PAYMENT_UPDATE_RESULT_INVALID");
        },
      );
      payment.state = "installed";
      await savePayment();
    } else if (action === "restore-payment") {
      if (payment?.state !== "installed" || effective !== payment.declineId)
        fail("INSTALLED_DECLINE_JOURNAL_REQUIRED");
      await checkPayment(payment.originalEffective);
      if (
        payment.originalDefault === null &&
        id(customer.invoice_settings?.default_payment_method) !== payment.originalEffective
      )
        fail("ORIGINAL_CUSTOMER_DEFAULT_CHANGED");
      await mutate(
        "restore-payment",
        "once",
        `/subscriptions/${sub.id}`,
        { default_payment_method: payment.originalDefault || "" },
        (result) => {
          validateSub(result);
          if (
            result.id !== sub.id ||
            (id(result.default_payment_method) || null) !== payment.originalDefault
          )
            fail("PAYMENT_UPDATE_RESULT_INVALID");
        },
      );
      payment.state = "restored";
      await savePayment();
    } else {
      assertRecurringInvoice("open");
      if (
        payment?.state !== "restored" ||
        effective !== payment.originalEffective ||
        !positive(invoice.amount_remaining) ||
        invoice.amount_remaining > 599
      )
        fail("RESTORED_BOUNDED_INVOICE_REQUIRED");
      await checkPayment(payment.originalEffective);
      await mutate(
        "pay-invoice",
        invoiceId,
        `/invoices/${invoiceId}/pay`,
        { payment_method: payment.originalEffective },
        (result) => {
          if (
            result.id !== invoiceId ||
            result.livemode !== false ||
            id(result.customer) !== customerId ||
            id(result.parent?.subscription_details?.subscription) !== sub.id ||
            result.status !== "paid" ||
            result.amount_remaining !== 0 ||
            result.amount_paid > 599
          )
            fail("INVOICE_PAYMENT_RESULT_INVALID");
        },
      );
    }
    // Do not present the pre-mutation snapshot as post-mutation evidence.
    return {
      action,
      accepted: true,
      testAccountVerified: true,
      next: "Read status; verify webhook and persisted entitlement separately.",
    };
  } catch (error) {
    throw error instanceof SetupError ? error : new SetupError("PRIVATE_RENEWAL_ACTION_FAILED");
  } finally {
    if (lock) {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  sandboxRenewal({
    action: process.argv.length === 3 ? process.argv[2] : undefined,
    approved: process.env.UNIMATE_STRIPE_TEST_RENEWAL === "approved",
  }).then(
    (result) => console.log(JSON.stringify(result, null, 2)),
    (error) => {
      console.error(
        `Renewal action stopped: ${error instanceof SetupError ? error.code : "PRIVATE_RENEWAL_ACTION_FAILED"}. No automatic retry; preserve private journals.`,
      );
      process.exitCode = 1;
    },
  );
}
