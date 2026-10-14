// Exact synthetic sandbox only. Installing a fixture does not charge it: the
// operator separately advances ONE approved renewal. Closing accepts a TEST
// dispute as lost and is irreversible. No arbitrary resource IDs or retries.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { prepareSandbox, privateJson, TARGET, SetupError } from "./prepare-stripe-sandbox.mjs";
import { sandboxClock } from "./stripe-sandbox-clock.mjs";
import { readPrivate } from "./verify-stripe-sandbox-lifecycle.mjs";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ACTIONS = ["status", "install-dispute", "restore-payment", "close-dispute"];
const id = (value) => (typeof value === "string" ? value : value?.id);
const validId = (value, prefix) =>
  typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value);
const fail = (code) => {
  throw new SetupError(code);
};
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function sandboxDispute({
  action,
  approved = false,
  root = ROOT,
  fetchImpl = fetch,
  verify = prepareSandbox,
  inspect = sandboxClock,
} = {}) {
  if (!approved || !ACTIONS.includes(action)) fail("EXPLICIT_DISPUTE_APPROVAL_REQUIRED");
  let lock;
  let lockPath;
  try {
    const config = await verify({ approved: true, verificationOnly: true, root, fetchImpl });
    if (
      !/^[sr]k_test_[A-Za-z0-9]+$/.test(config.stripe.STRIPE_SECRET_KEY || "") ||
      config.stripe.STRIPE_LIVE_MODE_ENABLED !== "false" ||
      config.stripe.STRIPE_PRICE_ID !== TARGET.price
    )
      fail("EXACT_TEST_BILLING_CONFIG_REQUIRED");
    const scope = () =>
      inspect({ action: "status", approved: true, root, fetchImpl, verify: async () => config });
    const identity = await scope();
    if (
      identity.account !== TARGET.account ||
      !validId(identity.customerId, "cus") ||
      !validId(identity.clockId, "clock") ||
      identity.clockStatus !== "ready"
    )
      fail("READY_SYNTHETIC_SCOPE_REQUIRED");
    const active = identity.subscriptions.filter(
      (s) => !["canceled", "incomplete_expired"].includes(s.status),
    );
    if (active.length !== 1 || active[0].status !== "active")
      fail("SINGLE_ACTIVE_SUBSCRIPTION_REQUIRED");
    const customerId = identity.customerId,
      subId = active[0].id;
    const request = (endpoint, init = {}) =>
      privateJson(fetchImpl, `https://api.stripe.com/v1${endpoint}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
          "Stripe-Version": "2026-06-24.dahlia",
          ...init.headers,
        },
      });
    const validateSub = (sub) => {
      if (
        sub.id !== subId ||
        sub.livemode !== false ||
        id(sub.customer) !== customerId ||
        sub.metadata?.user_id !== identity.userId ||
        sub.items?.has_more !== false ||
        sub.items.data?.length !== 1 ||
        id(sub.items.data[0].price) !== TARGET.price ||
        sub.items.data[0].quantity !== 1 ||
        sub.status !== "active" ||
        sub.collection_method !== "charge_automatically" ||
        sub.cancel_at_period_end !== false ||
        sub.cancel_at != null ||
        sub.pause_collection != null ||
        sub.schedule != null
      )
        fail("SUBSCRIPTION_SCOPE_MISMATCH");
    };
    const sub = await request(`/subscriptions/${subId}`);
    validateSub(sub);
    const customer = await request(`/customers/${customerId}`);
    if (
      customer.id !== customerId ||
      customer.deleted ||
      customer.livemode !== false ||
      customer.metadata?.user_id !== identity.userId ||
      id(customer.test_clock) !== identity.clockId
    )
      fail("CUSTOMER_SCOPE_MISMATCH");
    const directory = path.join(root, ".stripe-sandbox.local");
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.mode & 0o077 || stat.uid !== process.getuid())
      fail("PRIVATE_DIRECTORY_REQUIRED");
    if (action !== "status") {
      // Share the renewal helper lock, so PM changes and clock advancement
      // cannot run concurrently through these two operator helpers.
      lockPath = path.join(directory, "renewal-operation.lock");
      try {
        lock = await fs.open(lockPath, "wx", 0o600);
      } catch (error) {
        if (error.code === "EEXIST") fail("RENEWAL_OPERATION_LOCKED");
        throw error;
      }
      for (const name of await fs.readdir(directory)) {
        const stepJournal = /^(?:dispute|renewal)-[a-f0-9]{64}\.json$/.test(name);
        const paymentJournal = /^(?:dispute|renewal)-payment-[a-f0-9]{64}\.json$/.test(name);
        if (!stepJournal && !paymentJournal) continue;
        const previous = JSON.parse(await readPrivate(path.join(directory, name)));
        if (
          stepJournal
            ? previous.state !== "accepted"
            : !["installed", "restored"].includes(previous.state)
        )
          fail("UNCERTAIN_MUTATION_JOURNAL_USE_STATUS");
      }
    }
    const paymentPath = path.join(
      directory,
      `dispute-payment-${digest([identity.userId, customerId, subId])}.json`,
    );
    let payment = null;
    try {
      payment = JSON.parse(await readPrivate(paymentPath));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (
      payment &&
      (payment.version !== 1 ||
        payment.userId !== identity.userId ||
        payment.customerId !== customerId ||
        payment.subscriptionId !== subId ||
        !["pending", "installed", "restored"].includes(payment.state) ||
        !validId(payment.originalEffective, "pm") ||
        (payment.originalDefault !== null && !validId(payment.originalDefault, "pm")) ||
        !validId(payment.baselineInvoice, "in") ||
        (payment.state !== "pending" && !validId(payment.fixtureId, "pm")))
    )
      fail("DISPUTE_PAYMENT_JOURNAL_INVALID");
    if (action !== "status" && payment?.state === "pending")
      fail("UNCERTAIN_MUTATION_JOURNAL_USE_STATUS");
    const effective =
      id(sub.default_payment_method) ||
      id(customer.invoice_settings?.default_payment_method) ||
      null;
    const checkMethod = async (methodId) => {
      if (!validId(methodId, "pm")) fail("EXISTING_PAYMENT_METHOD_REQUIRED");
      const method = await request(`/payment_methods/${methodId}`);
      if (
        method.id !== methodId ||
        method.livemode !== false ||
        id(method.customer) !== customerId ||
        method.type !== "card"
      )
        fail("PAYMENT_METHOD_SCOPE_MISMATCH");
      return method;
    };
    const invoiceId = id(sub.latest_invoice);
    if (!validId(invoiceId, "in")) fail("LATEST_INVOICE_REQUIRED");
    const invoice = await request(`/invoices/${invoiceId}`);
    if (
      invoice.id !== invoiceId ||
      invoice.livemode !== false ||
      id(invoice.customer) !== customerId ||
      invoice.parent?.type !== "subscription_details" ||
      id(invoice.parent.subscription_details?.subscription) !== subId ||
      !["draft", "open", "paid", "void", "uncollectible"].includes(invoice.status)
    )
      fail("INVOICE_SCOPE_MISMATCH");
    const resolveDispute = async () => {
      if (!payment || invoiceId === payment.baselineInvoice)
        return { phase: "awaiting-new-renewal", dispute: null };
      if (invoice.status !== "paid") return { phase: "awaiting-paid-renewal", dispute: null };
      const line = invoice.lines?.data?.[0];
      if (
        invoice.billing_reason !== "subscription_cycle" ||
        invoice.currency !== "usd" ||
        invoice.total !== 599 ||
        invoice.amount_paid !== 599 ||
        invoice.amount_remaining !== 0 ||
        invoice.lines?.has_more !== false ||
        invoice.lines.data.length !== 1 ||
        id(line?.pricing?.price_details?.price ?? line?.price) !== TARGET.price ||
        line.quantity !== 1
      )
        fail("EXACT_RENEWAL_INVOICE_REQUIRED");
      const payments = await request(
        `/invoice_payments?${new URLSearchParams({ invoice: invoiceId, status: "paid", limit: "100" })}`,
      );
      if (
        !Array.isArray(payments.data) ||
        payments.has_more !== false ||
        payments.data.length !== 1
      )
        fail("SINGLE_COMPLETE_INVOICE_PAYMENT_REQUIRED");
      const paid = payments.data[0],
        piId = id(paid.payment?.payment_intent);
      if (
        !validId(paid.id, "inpay") ||
        paid.livemode !== false ||
        id(paid.invoice) !== invoiceId ||
        paid.status !== "paid" ||
        paid.amount_paid !== 599 ||
        paid.currency !== "usd" ||
        paid.payment?.type !== "payment_intent" ||
        !validId(piId, "pi")
      )
        fail("INVOICE_PAYMENT_SCOPE_MISMATCH");
      const intent = await request(`/payment_intents/${piId}`);
      const chargeId = id(intent.latest_charge);
      if (
        intent.id !== piId ||
        intent.livemode !== false ||
        id(intent.customer) !== customerId ||
        intent.status !== "succeeded" ||
        intent.currency !== "usd" ||
        intent.amount_received !== 599 ||
        id(intent.payment_method) !== payment.fixtureId ||
        !validId(chargeId, "ch")
      )
        fail("PAYMENT_INTENT_SCOPE_MISMATCH");
      const charge = await request(`/charges/${chargeId}`);
      if (
        charge.id !== chargeId ||
        charge.livemode !== false ||
        id(charge.customer) !== customerId ||
        id(charge.payment_intent) !== piId ||
        charge.paid !== true ||
        charge.captured !== true ||
        charge.amount !== 599 ||
        charge.currency !== "usd" ||
        charge.amount_refunded !== 0 ||
        charge.payment_method !== payment.fixtureId
      )
        fail("CHARGE_SCOPE_MISMATCH");
      const disputes = await request(
        `/disputes?${new URLSearchParams({ charge: chargeId, limit: "100" })}`,
      );
      if (!Array.isArray(disputes.data) || disputes.has_more !== false || disputes.data.length > 1)
        fail("SINGLE_COMPLETE_DISPUTE_REQUIRED");
      if (!disputes.data.length) return { phase: "awaiting-dispute", dispute: null };
      const dispute = disputes.data[0];
      if (
        !validId(dispute.id, "du") ||
        dispute.livemode !== false ||
        id(dispute.charge) !== chargeId ||
        (dispute.payment_intent != null && id(dispute.payment_intent) !== piId) ||
        dispute.currency !== "usd" ||
        dispute.amount !== 599 ||
        dispute.reason !== "fraudulent" ||
        !["needs_response", "under_review", "won", "lost"].includes(dispute.status)
      )
        fail("DISPUTE_SCOPE_MISMATCH");
      return { phase: dispute.status, dispute, chargeId, piId };
    };
    if (action === "status") {
      const resolved = await resolveDispute();
      return {
        action,
        testAccountVerified: true,
        subscriptionStatus: "active",
        invoiceStatus: invoice.status,
        paymentMethod:
          payment && effective === payment.fixtureId
            ? "installed-dispute"
            : payment && effective === payment.originalEffective
              ? "original"
              : "existing",
        paymentJournalState: payment?.state || null,
        disputeState: resolved.phase,
        testDisputeAmount: resolved.dispute ? 599 : null,
      };
    }
    const savePayment = async () => {
      const temporary = `${paymentPath}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(payment), { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, paymentPath);
    };
    const mutate = async (step, targetId, endpoint, body, validate) => {
      const journalPath = path.join(
        directory,
        `dispute-${digest([identity.userId, customerId, subId, step, targetId])}.json`,
      );
      const journal = {
        version: 1,
        step,
        userId: identity.userId,
        customerId,
        subscriptionId: subId,
        targetId,
        state: "pending",
        idempotency: `unimate-dispute-${randomUUID()}`,
      };
      try {
        await fs.writeFile(journalPath, JSON.stringify(journal), { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (error.code === "EEXIST") fail("DISPUTE_ACTION_ALREADY_JOURNALED_USE_STATUS");
        throw error;
      }
      const current = await scope();
      if (
        current.userId !== identity.userId ||
        current.customerId !== customerId ||
        current.clockId !== identity.clockId ||
        current.clockStatus !== "ready" ||
        current.subscriptions.filter((s) => !["canceled", "incomplete_expired"].includes(s.status))
          .length !== 1 ||
        !current.subscriptions.some((s) => s.id === subId && s.status === "active")
      )
        fail("SYNTHETIC_SCOPE_CHANGED");
      const latest = await request(`/subscriptions/${subId}`);
      validateSub(latest);
      if (
        id(latest.default_payment_method) !== id(sub.default_payment_method) ||
        id(latest.latest_invoice) !== invoiceId
      )
        fail("SUBSCRIPTION_CHANGED");
      if (step === "restore" && payment.originalDefault === null) {
        const freshCustomer = await request(`/customers/${customerId}`);
        if (
          freshCustomer.id !== customerId ||
          freshCustomer.livemode !== false ||
          freshCustomer.metadata?.user_id !== identity.userId ||
          id(freshCustomer.invoice_settings?.default_payment_method) !== payment.originalEffective
        )
          fail("ORIGINAL_CUSTOMER_DEFAULT_CHANGED");
      }
      if (step === "close-dispute") {
        const fresh = await resolveDispute();
        if (fresh.dispute?.id !== targetId || fresh.dispute.status !== "needs_response")
          fail("DISPUTE_CHANGED");
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
    if (action === "install-dispute") {
      if (payment) fail("DISPUTE_EXPERIMENT_ALREADY_JOURNALED");
      if (invoice.status !== "paid") fail("PAID_SUBSCRIPTION_REQUIRED");
      const original = await checkMethod(effective);
      if (original.card?.last4 !== "4242") fail("KNOWN_SUCCESS_TEST_CARD_REQUIRED");
      payment = {
        version: 1,
        userId: identity.userId,
        customerId,
        subscriptionId: subId,
        originalDefault: id(sub.default_payment_method) || null,
        originalEffective: effective,
        baselineInvoice: invoiceId,
        state: "pending",
      };
      await fs.writeFile(paymentPath, JSON.stringify(payment), { flag: "wx", mode: 0o600 });
      const attached = await mutate(
        "attach",
        subId,
        "/payment_methods/pm_card_createDispute/attach",
        { customer: customerId },
        (method) => {
          if (
            !validId(method.id, "pm") ||
            method.livemode !== false ||
            id(method.customer) !== customerId ||
            method.type !== "card" ||
            method.card?.last4 !== "0259"
          )
            fail("DISPUTE_METHOD_RESULT_INVALID");
        },
      );
      payment.fixtureId = attached.id;
      await savePayment();
      await mutate(
        "install",
        subId,
        `/subscriptions/${subId}`,
        { default_payment_method: attached.id },
        (result) => {
          validateSub(result);
          if (id(result.default_payment_method) !== attached.id)
            fail("PAYMENT_UPDATE_RESULT_INVALID");
        },
      );
      payment.state = "installed";
      await savePayment();
    } else if (action === "restore-payment") {
      if (payment?.state !== "installed" || effective !== payment.fixtureId)
        fail("INSTALLED_DISPUTE_JOURNAL_REQUIRED");
      await checkMethod(payment.originalEffective);
      if (
        payment.originalDefault === null &&
        id(customer.invoice_settings?.default_payment_method) !== payment.originalEffective
      )
        fail("ORIGINAL_CUSTOMER_DEFAULT_CHANGED");
      await mutate(
        "restore",
        subId,
        `/subscriptions/${subId}`,
        { default_payment_method: payment.originalDefault || "" },
        (result) => {
          validateSub(result);
          if ((id(result.default_payment_method) || null) !== payment.originalDefault)
            fail("PAYMENT_UPDATE_RESULT_INVALID");
        },
      );
      payment.state = "restored";
      await savePayment();
    } else {
      if (payment?.state !== "restored" || effective !== payment.originalEffective)
        fail("RESTORE_ORIGINAL_BEFORE_DISPUTE_CLOSE");
      const resolved = await resolveDispute();
      const dispute = resolved.dispute;
      if (!dispute || dispute.status !== "needs_response") fail("OPEN_SYNTHETIC_DISPUTE_REQUIRED");
      await mutate("close-dispute", dispute.id, `/disputes/${dispute.id}/close`, {}, (result) => {
        if (
          result.id !== dispute.id ||
          result.livemode !== false ||
          id(result.charge) !== resolved.chargeId ||
          result.amount !== 599 ||
          result.currency !== "usd" ||
          result.status !== "lost"
        )
          fail("DISPUTE_CLOSE_RESULT_INVALID");
      });
    }
    return {
      action,
      accepted: true,
      testAccountVerified: true,
      next: "Read status and verify actual webhook delivery and persisted entitlement separately.",
    };
  } catch (error) {
    throw error instanceof SetupError ? error : new SetupError("PRIVATE_DISPUTE_ACTION_FAILED");
  } finally {
    if (lock) {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  sandboxDispute({
    action: process.argv.length === 3 ? process.argv[2] : undefined,
    approved: process.env.UNIMATE_STRIPE_TEST_DISPUTE === "approved",
  }).then(
    (result) => console.log(JSON.stringify(result, null, 2)),
    (error) => {
      console.error(
        `Dispute action stopped: ${error instanceof SetupError ? error.code : "PRIVATE_DISPUTE_ACTION_FAILED"}. No automatic retry; preserve private journals.`,
      );
      process.exitCode = 1;
    },
  );
}
