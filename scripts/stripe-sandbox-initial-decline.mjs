// One synthetic initial Checkout. The operator uses Stripe's decline test card
// in the browser; this helper never pays. Verify supervisor ownership first.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareSandbox, privateJson, TARGET, SetupError } from "./prepare-stripe-sandbox.mjs";
import { sandboxClock } from "./stripe-sandbox-clock.mjs";
import { verifyLifecycle, readPrivate } from "./verify-stripe-sandbox-lifecycle.mjs";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const fail = (code) => {
  throw new SetupError(code);
};
const id = (value) => (typeof value === "string" ? value : value?.id);
const JOURNAL = ".stripe-sandbox.local/initial-decline-v1.json";

export async function initialDecline({
  action,
  approved = false,
  root = ROOT,
  fetchImpl = fetch,
  verify = prepareSandbox,
  inspect = sandboxClock,
  lifecycle = verifyLifecycle,
} = {}) {
  if (!approved || !["create", "status", "cleanup"].includes(action))
    fail("EXPLICIT_INITIAL_DECLINE_APPROVAL_REQUIRED");
  let lock;
  const lockPath = path.join(root, ".stripe-sandbox.local/initial-decline-operation.lock");
  try {
    const config = await verify({ approved: true, verificationOnly: true, root, fetchImpl });
    if (
      !/^[sr]k_test_[A-Za-z0-9]+$/.test(config.stripe.STRIPE_SECRET_KEY || "") ||
      config.stripe.STRIPE_LIVE_MODE_ENABLED !== "false" ||
      config.stripe.STRIPE_PRICE_ID !== TARGET.price
    )
      fail("EXACT_TEST_BILLING_CONFIG_REQUIRED");
    const directory = await fs.lstat(path.join(root, ".stripe-sandbox.local"));
    if (!directory.isDirectory() || directory.mode & 0o077 || directory.uid !== process.getuid())
      fail("PRIVATE_DIRECTORY_REQUIRED");
    const scope = await inspect({
      action: "status",
      approved: true,
      root,
      fetchImpl,
      verify: async () => config,
    });
    if (
      scope.account !== TARGET.account ||
      scope.clockStatus !== "ready" ||
      !/^cus_[A-Za-z0-9]+$/.test(scope.customerId) ||
      scope.subscriptions.some((sub) => !["canceled", "incomplete_expired"].includes(sub.status))
    )
      fail("SYNTHETIC_FREE_SCOPE_REQUIRED");
    const baseline = JSON.stringify(scope.subscriptions.map((sub) => [sub.id, sub.status]).sort());
    const request = (endpoint, init = {}) =>
      privateJson(fetchImpl, `https://api.stripe.com/v1${endpoint}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
          "Stripe-Version": "2026-06-24.dahlia",
          ...init.headers,
        },
      });
    const list = await request(
      `/checkout/sessions?${new URLSearchParams({ customer: scope.customerId, status: "open", limit: "100" })}`,
    );
    if (
      !Array.isArray(list.data) ||
      list.has_more !== false ||
      list.data.some(
        (session) =>
          session.livemode !== false ||
          id(session.customer) !== scope.customerId ||
          session.status !== "open",
      )
    )
      fail("COMPLETE_SCOPED_CHECKOUT_LIST_REQUIRED");
    let journal;
    try {
      journal = JSON.parse(await readPrivate(path.join(root, JOURNAL)));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (
      journal &&
      (journal.version !== 1 ||
        journal.account !== TARGET.account ||
        journal.userId !== scope.userId ||
        journal.customerId !== scope.customerId ||
        journal.baseline !== baseline ||
        !["pending", "created", "expiry-pending", "cleaned"].includes(journal.state))
    )
      fail("INITIAL_DECLINE_JOURNAL_MISMATCH");
    const state = await lifecycle({ action: "status", approved: true, root, fetchImpl });
    if (
      state.userId !== scope.userId ||
      state.profile.isPro !== false ||
      state.gate.status !== 403 ||
      state.gate.code !== "PRO_REQUIRED"
    )
      fail("PERSISTED_FREE_GATE_REQUIRED");
    const writeNew = async (name, data) => {
      const handle = await fs.open(name, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(data));
        await handle.sync();
      } finally {
        await handle.close();
      }
    };
    const save = async (value) => {
      const temporary = path.join(root, `${JOURNAL}.${process.pid}.tmp`);
      await writeNew(temporary, value);
      await fs.rename(temporary, path.join(root, JOURNAL));
      journal = value;
    };
    if (action !== "status") lock = await fs.open(lockPath, "wx", 0o600);
    if (action === "create") {
      if (journal || list.data.length) fail("INITIAL_DECLINE_ALREADY_STARTED_OR_OPEN_CHECKOUT");
      journal = {
        version: 1,
        account: TARGET.account,
        userId: scope.userId,
        customerId: scope.customerId,
        baseline,
        state: "pending",
      };
      await writeNew(path.join(root, JOURNAL), journal);
      const result = await lifecycle({ action: "checkout", approved: true, root, fetchImpl });
      const url = new URL(result.url);
      const sessionId = url.pathname.split("/").find((part) => /^cs_test_[A-Za-z0-9]+$/.test(part));
      if (
        url.origin !== "https://checkout.stripe.com" ||
        url.username ||
        url.password ||
        !sessionId
      )
        fail("EXACT_TEST_CHECKOUT_URL_REQUIRED");
      await save({ ...journal, state: "created", sessionId, url: result.url });
      // Persist the resolved ID before readback so a failed validation never
      // loses provenance or permits another create. Status does not acquire
      // this operation lock or perform a Checkout mutation.
      const checked = await initialDecline({
        action: "status",
        approved: true,
        root,
        fetchImpl,
        verify,
        inspect,
        lifecycle,
      });
      if (checked.checkoutStatus !== "open") fail("NEW_CHECKOUT_NOT_OPEN");
      return { action, created: true, privateArtifact: JOURNAL, isPro: false };
    }
    if (!journal || !/^cs_test_[A-Za-z0-9]+$/.test(journal.sessionId || ""))
      fail("RESOLVED_INITIAL_DECLINE_JOURNAL_REQUIRED");
    const session = await request(`/checkout/sessions/${journal.sessionId}`);
    if (
      session.id !== journal.sessionId ||
      session.livemode !== false ||
      id(session.customer) !== scope.customerId ||
      session.client_reference_id !== scope.userId ||
      session.metadata?.user_id !== scope.userId ||
      session.mode !== "subscription" ||
      session.subscription != null ||
      session.payment_status !== "unpaid" ||
      session.amount_total !== 599 ||
      session.currency !== "usd" ||
      !["open", "expired"].includes(session.status)
    )
      fail("EXACT_UNPAID_CHECKOUT_REQUIRED");
    const lines = await request(`/checkout/sessions/${journal.sessionId}/line_items?limit=100`);
    if (
      lines.has_more !== false ||
      lines.data?.length !== 1 ||
      id(lines.data[0].price) !== TARGET.price ||
      lines.data[0].quantity !== 1 ||
      lines.data[0].amount_total !== 599 ||
      lines.data[0].currency !== "usd"
    )
      fail("EXACT_CHECKOUT_PRICE_REQUIRED");
    if (
      list.data.some((open) => open.id !== journal.sessionId) ||
      list.data.length !== (session.status === "open" ? 1 : 0)
    )
      fail("UNRELATED_OPEN_CHECKOUT_PRESENT");
    if (action === "cleanup") {
      if (session.status === "expired") {
        await save({ ...journal, state: "cleaned" });
      } else {
        if (journal.state !== "created") fail("EXPIRY_OUTCOME_UNCERTAIN_NO_RETRY");
        await save({ ...journal, state: "expiry-pending" });
        const expired = await request(`/checkout/sessions/${journal.sessionId}/expire`, {
          method: "POST",
        });
        if (
          expired.id !== journal.sessionId ||
          expired.livemode !== false ||
          expired.status !== "expired" ||
          id(expired.customer) !== scope.customerId ||
          expired.subscription != null ||
          expired.payment_status !== "unpaid"
        )
          fail("EXPIRY_NOT_CONFIRMED");
        await save({ ...journal, state: "cleaned" });
      }
      // Do not report the pre-expiry Free/subscription snapshot as post-expiry
      // evidence. Re-read the exact session, complete list and persisted gate.
      const checked = await initialDecline({
        action: "status",
        approved: true,
        root,
        fetchImpl,
        verify,
        inspect,
        lifecycle,
      });
      if (checked.checkoutStatus !== "expired") fail("EXPIRY_NOT_CONFIRMED");
      return { ...checked, action: "cleanup" };
    }
    return {
      action,
      journalState: journal.state,
      checkoutStatus: action === "cleanup" ? "expired" : session.status,
      isPro: false,
      companionStatus: 403,
      subscriptionsUnchanged: true,
      privateArtifact: JOURNAL,
    };
  } catch (error) {
    throw error instanceof SetupError
      ? error
      : new SetupError(
          error.code === "EEXIST" ? "PRIVATE_JOURNAL_EXISTS_NO_RETRY" : "INITIAL_DECLINE_FAILED",
        );
  } finally {
    if (lock) {
      await lock.close();
      await fs.unlink(lockPath);
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  initialDecline({
    action: process.argv.length === 3 ? process.argv[2] : undefined,
    approved: process.env.UNIMATE_STRIPE_TEST_INITIAL_DECLINE === "approved",
  })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(
        JSON.stringify({
          error: error instanceof SetupError ? error.code : "INITIAL_DECLINE_FAILED",
        }),
      );
      process.exitCode = 1;
    });
}
