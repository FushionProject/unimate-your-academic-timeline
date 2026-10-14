// Operator-only fixed sandbox refund tests. Never imported into the app. No
// arbitrary resource/amount arguments, database writes, or automatic retries.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { prepareSandbox, privateJson, TARGET, SetupError } from "./prepare-stripe-sandbox.mjs";
import { sandboxClock } from "./stripe-sandbox-clock.mjs";
import { readPrivate } from "./verify-stripe-sandbox-lifecycle.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const id = (value) => (typeof value === "string" ? value : value?.id);
const validId = (value, prefix) =>
  typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value);
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (code) => {
  throw new SetupError(code);
};

export async function sandboxRefund({
  action,
  approved = false,
  root = ROOT,
  fetchImpl = fetch,
  verify = prepareSandbox,
} = {}) {
  if (!approved || !["status", "refund-partial", "refund-remaining"].includes(action))
    fail("EXPLICIT_REFUND_APPROVAL_REQUIRED");
  let lock, lockPath;
  try {
    const config = await verify({ approved: true, verificationOnly: true, root, fetchImpl });
    const request = (endpoint, init = {}) =>
      privateJson(fetchImpl, `https://api.stripe.com/v1${endpoint}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
          "Stripe-Version": "2026-06-24.dahlia",
          ...init.headers,
        },
      });
    // Reuse the exact account, private-file, app_metadata, DB binding, customer,
    // complete subscription-list, single-price and test-clock safety checks.
    const readScope = () =>
      sandboxClock({
        action: "status",
        approved: true,
        root,
        fetchImpl,
        verify: async () => config,
      });
    const resolve = async () => {
      const scope = await readScope();
      const current = scope.subscriptions.filter(
        (sub) => !["canceled", "incomplete_expired"].includes(sub.status),
      );
      if (scope.clockStatus !== "ready" || current.length !== 1 || current[0].status !== "active")
        fail("ONE_ACTIVE_SUBSCRIPTION_AND_READY_CLOCK_REQUIRED");
      const sub = await request(`/subscriptions/${current[0].id}`);
      if (
        sub.id !== current[0].id ||
        sub.livemode !== false ||
        sub.status !== "active" ||
        sub.collection_method !== "charge_automatically" ||
        id(sub.customer) !== scope.customerId ||
        sub.metadata?.user_id !== scope.userId ||
        sub.items?.has_more !== false ||
        sub.items?.data?.length !== 1 ||
        id(sub.items.data[0].price) !== TARGET.price ||
        sub.items.data[0].quantity !== 1 ||
        !validId(id(sub.latest_invoice), "in")
      )
        fail("CURRENT_SUBSCRIPTION_CHANGED");
      const invoice = await request(`/invoices/${id(sub.latest_invoice)}`);
      if (
        invoice.id !== id(sub.latest_invoice) ||
        invoice.livemode !== false ||
        id(invoice.customer) !== scope.customerId ||
        invoice.parent?.type !== "subscription_details" ||
        id(invoice.parent.subscription_details?.subscription) !== sub.id ||
        invoice.status !== "paid" ||
        invoice.billing_reason !== "subscription_cycle" ||
        invoice.collection_method !== "charge_automatically" ||
        invoice.currency !== "usd" ||
        invoice.total !== 599 ||
        invoice.amount_due !== 599 ||
        invoice.amount_paid !== 599 ||
        invoice.amount_remaining !== 0 ||
        invoice.lines?.has_more !== false ||
        invoice.lines?.data?.length !== 1 ||
        invoice.lines.data[0].quantity !== 1 ||
        id(invoice.lines.data[0].pricing?.price_details?.price) !== TARGET.price
      )
        fail("EXACT_PAID_RENEWAL_REQUIRED");

      // Pinned modern API: InvoicePayment, not legacy invoice.payment_intent.
      // https://docs.stripe.com/api/invoice-payment/object
      const payments = await request(
        `/invoice_payments?${new URLSearchParams({ invoice: invoice.id, status: "paid", limit: "100" })}`,
      );
      if (payments.has_more !== false || payments.data?.length !== 1)
        fail("ONE_COMPLETE_INVOICE_PAYMENT_REQUIRED");
      const payment = payments.data[0];
      if (
        !validId(payment.id, "inpay") ||
        payment.livemode !== false ||
        id(payment.invoice) !== invoice.id ||
        payment.status !== "paid" ||
        payment.currency !== "usd" ||
        payment.amount_paid !== 599 ||
        payment.amount_requested !== 599 ||
        payment.payment?.type !== "payment_intent" ||
        !validId(id(payment.payment.payment_intent), "pi")
      )
        fail("INVOICE_PAYMENT_SCOPE_MISMATCH");
      const intent = await request(`/payment_intents/${id(payment.payment.payment_intent)}`);
      if (
        intent.id !== id(payment.payment.payment_intent) ||
        intent.livemode !== false ||
        id(intent.customer) !== scope.customerId ||
        intent.status !== "succeeded" ||
        intent.currency !== "usd" ||
        intent.amount !== 599 ||
        intent.amount_received !== 599 ||
        !validId(id(intent.latest_charge), "ch")
      )
        fail("PAYMENT_INTENT_SCOPE_MISMATCH");
      // This is a read of an existing PaymentIntent's charge, never a legacy
      // charge creation. Refund objects themselves have no livemode property.
      const charge = await request(`/charges/${id(intent.latest_charge)}`);
      if (
        charge.id !== id(intent.latest_charge) ||
        charge.livemode !== false ||
        id(charge.customer) !== scope.customerId ||
        id(charge.payment_intent) !== intent.id ||
        charge.status !== "succeeded" ||
        charge.paid !== true ||
        charge.captured !== true ||
        charge.disputed !== false ||
        charge.currency !== "usd" ||
        charge.amount !== 599 ||
        charge.amount_captured !== 599 ||
        !Number.isSafeInteger(charge.amount_refunded) ||
        charge.amount_refunded < 0 ||
        charge.amount_refunded > 599 ||
        charge.refunded !== (charge.amount_refunded === 599)
      )
        fail("CAPTURED_UNDISPUTED_TEST_CHARGE_REQUIRED");
      const refunds = await request(
        `/refunds?${new URLSearchParams({ charge: charge.id, limit: "100" })}`,
      );
      if (
        !Array.isArray(refunds.data) ||
        refunds.has_more !== false ||
        new Set(refunds.data.map((refund) => refund.id)).size !== refunds.data.length ||
        refunds.data.some(
          (refund) =>
            !validId(refund.id, "re") ||
            id(refund.charge) !== charge.id ||
            id(refund.payment_intent) !== intent.id ||
            refund.currency !== "usd" ||
            !Number.isSafeInteger(refund.amount) ||
            refund.amount <= 0 ||
            refund.amount > 599 ||
            !["succeeded", "pending", "requires_action", "failed", "canceled"].includes(
              refund.status,
            ),
        )
      )
        fail("COMPLETE_SCOPED_REFUND_LIST_REQUIRED");
      return { scope, sub, invoice, intent, charge, refunds: refunds.data };
    };
    const initial = await resolve();
    const { scope, sub, invoice, intent, charge, refunds } = initial;
    const directory = path.join(root, ".stripe-sandbox.local");
    if (action !== "status") {
      lockPath = path.join(directory, "refund-operation.lock");
      try {
        lock = await fs.open(lockPath, "wx", 0o600);
      } catch (error) {
        if (error.code === "EEXIST") fail("REFUND_OPERATION_LOCKED");
        throw error;
      }
    }
    // Uncertainty belongs to this synthetic test workflow, not just the latest
    // charge. A later invoice must not permit another refund while an earlier
    // attempt still needs operator reconciliation. Status remains read-only.
    let pendingRefundJournals = 0;
    for (const file of await fs.readdir(directory)) {
      if (!/^refund-[a-f0-9]{64}\.json$/.test(file)) continue;
      const prior = JSON.parse(await readPrivate(path.join(directory, file)));
      if (
        prior.version !== 1 ||
        !["refund-partial", "refund-remaining"].includes(prior.action) ||
        !Array.isArray(prior.identity) ||
        prior.identity.length !== 6 ||
        !["pending", "accepted"].includes(prior.state) ||
        prior.amount !== (prior.action === "refund-partial" ? 100 : 499)
      )
        fail("REFUND_JOURNAL_INVALID");
      if (prior.state === "pending") pendingRefundJournals++;
    }
    if (action !== "status" && pendingRefundJournals > 0) fail("REFUND_PENDING_OUTCOME_USE_STATUS");
    const identity = [scope.userId, scope.customerId, sub.id, invoice.id, intent.id, charge.id];
    const journalFor = (operation) =>
      `.stripe-sandbox.local/refund-${digest([...identity, operation])}.json`;
    const readJournal = async (operation) => {
      let journal;
      try {
        journal = JSON.parse(await readPrivate(path.join(root, journalFor(operation))));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
      if (
        journal.version !== 1 ||
        journal.action !== operation ||
        JSON.stringify(journal.identity) !== JSON.stringify(identity) ||
        !["pending", "accepted"].includes(journal.state) ||
        journal.amount !== (operation === "refund-partial" ? 100 : 499) ||
        (journal.state === "accepted" && !validId(journal.refundId, "re"))
      )
        fail("REFUND_JOURNAL_INVALID");
      return journal;
    };
    const partial = await readJournal("refund-partial");
    const remaining = await readJournal("refund-remaining");
    const summary = {
      action,
      testAccountVerified: true,
      subscriptionStatus: sub.status,
      invoiceStatus: invoice.status,
      invoiceBillingReason: invoice.billing_reason,
      currency: "usd",
      amountPaid: 599,
      amountRefunded: charge.amount_refunded,
      fullyRefunded: charge.refunded,
      refundCount: refunds.length,
      refundStatuses: refunds.map((refund) => refund.status),
      partialJournalState: partial?.state || null,
      remainingJournalState: remaining?.state || null,
      pendingRefundJournals,
    };
    if (action === "status") return summary;
    if ((action === "refund-partial" && partial) || (action === "refund-remaining" && remaining))
      fail("REFUND_ALREADY_JOURNALED_USE_STATUS");
    if (action === "refund-partial" && (charge.amount_refunded !== 0 || refunds.length !== 0))
      fail("UNREFUNDED_CHARGE_REQUIRED");
    if (
      action === "refund-remaining" &&
      (charge.amount_refunded !== 100 ||
        partial?.state !== "accepted" ||
        refunds.length !== 1 ||
        refunds[0].id !== partial.refundId ||
        refunds[0].amount !== 100 ||
        refunds[0].status !== "succeeded")
    )
      fail("VERIFIED_PARTIAL_REFUND_REQUIRED");
    const amount = action === "refund-partial" ? 100 : 499;
    const artifact = journalFor(action);
    const journal = {
      version: 1,
      action,
      identity,
      amount,
      state: "pending",
      idempotency: `unimate-refund-${randomUUID()}`,
    };
    try {
      await fs.writeFile(path.join(root, artifact), JSON.stringify(journal), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (error.code === "EEXIST") fail("REFUND_ALREADY_JOURNALED_USE_STATUS");
      throw error;
    }
    // Re-resolve every ownership/payment link immediately before the sole POST.
    const latest = await resolve();
    const fingerprint = (value) =>
      JSON.stringify([
        value.scope.userId,
        value.scope.customerId,
        value.sub.id,
        value.invoice.id,
        value.intent.id,
        value.charge.id,
        value.charge.amount_refunded,
        value.refunds.map((refund) => [refund.id, refund.amount, refund.status]).sort(),
      ]);
    if (fingerprint(latest) !== fingerprint(initial)) fail("REFUND_SCOPE_CHANGED_USE_STATUS");
    const result = await request("/refunds", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": journal.idempotency,
      },
      // No reason=fraudulent (Radar side effects), reversals, fees or email.
      body: new URLSearchParams({ charge: charge.id, amount: String(amount) }).toString(),
    });
    if (
      !validId(result.id, "re") ||
      id(result.charge) !== charge.id ||
      id(result.payment_intent) !== intent.id ||
      result.currency !== "usd" ||
      result.amount !== amount ||
      result.status !== "succeeded"
    )
      fail("REFUND_NOT_CONFIRMED_USE_STATUS");
    const temporary = path.join(directory, `refund-${randomUUID()}.tmp`);
    await fs.writeFile(
      temporary,
      JSON.stringify({ ...journal, state: "accepted", refundId: result.id }),
      { flag: "wx", mode: 0o600 },
    );
    await fs.rename(temporary, path.join(root, artifact));
    return {
      action,
      testAccountVerified: true,
      accepted: true,
      refundAmount: amount,
      artifact,
      awaitWebhook: true,
    };
  } catch (error) {
    throw error instanceof SetupError ? error : new SetupError("PRIVATE_REFUND_ACTION_FAILED");
  } finally {
    if (lock) {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  sandboxRefund({
    action: process.argv.length === 3 ? process.argv[2] : undefined,
    approved: process.env.UNIMATE_STRIPE_TEST_REFUND === "approved",
  }).then(
    (result) => console.log(JSON.stringify(result, null, 2)),
    (error) => {
      console.error(
        `Refund action stopped: ${error instanceof SetupError ? error.code : "PRIVATE_REFUND_ACTION_FAILED"}. No automatic retry; use status and preserve private journals.`,
      );
      process.exitCode = 1;
    },
  );
}
