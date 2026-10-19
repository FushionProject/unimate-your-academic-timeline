// Retire only the known failed-authentication, unpaid test Checkout. No retry,
// payment confirmation, subscription change, or historical evidence overwrite.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  prepareSandbox,
  privateJson,
  ARTIFACT,
  TARGET,
  assertIgnored,
} from "./prepare-stripe-sandbox.mjs";
import { readPrivate } from "./verify-stripe-sandbox-lifecycle.mjs";
import {
  CURRENT_BILLING_SCOPE as C,
  CURRENT_BILLING_CONTINUATION as K,
  assertCurrentBaseline,
  assertCurrentOpenCheckout,
  assertCurrentExpiredCheckout,
} from "./current-billing-policy.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sha = (text) => createHash("sha256").update(text).digest("hex");
const claimName = `payment-submit-${sha(K.sessionId)}.json`;
export const RETIREMENT_SCOPE = Object.freeze({
  journal: "current-billing-999-retirement-v1.jsonl",
  intentId: "pi_3USABnIxB8W4eFUh4dnmpJ7E",
  sourceNames: Object.freeze([C.journal, K.journal, K.resumeJournal, claimName]),
});
const R = RETIREMENT_SCOPE;
const fail = () => {
  throw new Error("CURRENT_FAILED_AUTH_RETIREMENT_REQUIRED");
};
export function assertFailedCurrentIntent(intent) {
  if (
    intent?.id !== R.intentId ||
    intent.object !== "payment_intent" ||
    intent.livemode !== false ||
    intent.customer !== C.customer ||
    intent.amount !== 999 ||
    intent.amount_received !== 0 ||
    intent.currency !== "usd" ||
    intent.status !== "requires_payment_method" ||
    intent.payment_method !== null ||
    intent.next_action !== null ||
    intent.last_payment_error?.code !== "payment_intent_authentication_failure"
  )
    fail();
  return true;
}
export function assertRetiredCurrentIntent(intent) {
  // Expiring Checkout can cancel its PaymentIntent. That terminal zero-paid
  // state is valid cleanup, but never valid input to the expiration action.
  if (intent?.status !== "canceled") return assertFailedCurrentIntent(intent);
  if (
    intent.id !== R.intentId ||
    intent.object !== "payment_intent" ||
    intent.livemode !== false ||
    intent.customer !== C.customer ||
    intent.amount !== 999 ||
    intent.amount_received !== 0 ||
    intent.currency !== "usd" ||
    intent.payment_method !== null ||
    intent.next_action !== null
  )
    fail();
  return true;
}
const phases = [
  ["baseline", "create-pending", "stopped"],
  ["baseline", "checkout-verified", "card-selection-pending", "card-selected"],
  [
    "baseline",
    "checkout-verified",
    "card-selection-pending",
    "card-selected",
    "fill-pending",
    "filled",
    "payment-pending",
  ],
];
function rows(text) {
  if (typeof text !== "string" || !text.endsWith("\n") || text.length > 150000) fail();
  try {
    return text.trim().split("\n").map(JSON.parse);
  } catch {
    fail();
  }
}
export function assertFailedSourceHistory({ texts, baseline }) {
  if (baseline?.billingRevision !== 80 || baseline.phase !== "baseline") fail();
  const history = {};
  for (const [i, name] of R.sourceNames.entries()) {
    const text = texts?.[name];
    if (typeof text !== "string") fail();
    history[name] = sha(text);
    if (i === 3) {
      let claim;
      try {
        claim = JSON.parse(text);
      } catch {
        fail();
      }
      if (
        claim.version !== 1 ||
        claim.sessionSha256 !== sha(K.sessionId) ||
        claim.phase !== "claimed" ||
        !Number.isSafeInteger(claim.claimedAt)
      )
        fail();
      continue;
    }
    const parsed = rows(text);
    if (
      JSON.stringify(parsed.map((r) => r.phase)) !== JSON.stringify(phases[i]) ||
      JSON.stringify(parsed[0].baseline) !== JSON.stringify(baseline) ||
      parsed.some(
        (r, n) =>
          r.version !== 1 ||
          r.sequence !== n + 1 ||
          r.account !== C.account ||
          r.price !== C.price ||
          r.origin !== C.origin ||
          r.source !== C.source ||
          !Number.isSafeInteger(r.at) ||
          (r.sessionId !== undefined && r.sessionId !== K.sessionId),
      )
    )
      fail();
  }
  return history;
}
export function assertRetiredCurrentAttempt({
  journalText,
  baseline,
  session,
  lines,
  intent,
  history,
}) {
  assertRetiredCurrentIntent(intent);
  if (session?.id !== K.sessionId) fail();
  assertCurrentExpiredCheckout({ session, lines, userId: baseline?.userId });
  const parsed = rows(journalText);
  if (
    JSON.stringify(parsed.map((r) => r.phase)) !==
      JSON.stringify(["validated", "expire-pending", "final"]) ||
    parsed.some(
      (r, i) =>
        r.version !== 1 ||
        r.sequence !== i + 1 ||
        r.account !== C.account ||
        r.sessionId !== K.sessionId ||
        r.intentId !== R.intentId ||
        !Number.isSafeInteger(r.at),
    ) ||
    JSON.stringify(parsed[0].baseline) !== JSON.stringify(baseline) ||
    JSON.stringify(parsed[2].baseline) !== JSON.stringify(baseline) ||
    parsed[2].unpaid !== true ||
    parsed[2].expired !== true ||
    parsed[2].openCheckouts !== 0 ||
    R.sourceNames.some(
      (name) =>
        !/^[a-f0-9]{64}$/.test(history?.[name] || "") ||
        parsed[0].history?.[name] !== history[name] ||
        parsed[2].history?.[name] !== history[name],
    )
  )
    fail();
  return Object.freeze({
    retirementSha256: sha(journalText),
    sourceHistory: Object.freeze({ ...history }),
    baselineSha256: baseline.evidenceSha256,
    retiredSessionId: K.sessionId,
    scope: "failed_authentication_retired_without_payment",
  });
}

export async function retireFailedCurrentAttempt({ approved = false } = {}) {
  if (approved !== true || process.env.DEBUG || process.env.NODE_OPTIONS || process.env.PWDEBUG)
    fail();
  const dir = path.join(ROOT, ".stripe-sandbox.local");
  let lock,
    journal,
    sequence = 0;
  const append = async (phase, data = {}) => {
    await journal.writeFile(
      JSON.stringify({
        version: 1,
        sequence: ++sequence,
        at: Date.now(),
        account: C.account,
        sessionId: K.sessionId,
        intentId: R.intentId,
        phase,
        ...data,
      }) + "\n",
    );
    await journal.sync();
  };
  try {
    assertIgnored(ROOT);
    const stat = await fs.lstat(dir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid() ||
      stat.mode & 0o077
    )
      fail();
    lock = await fs.open(path.join(dir, "protected-billing-run.lock"), "wx", 0o600);
    // Claim this exact cleanup once before any provider mutation; an uncertain
    // outcome keeps the journal and blocks repeat execution.
    journal = await fs.open(path.join(dir, R.journal), "wx", 0o600);
    const config = await prepareSandbox({ approved: true, verificationOnly: true });
    const record = JSON.parse(await readPrivate(path.join(ROOT, ARTIFACT)));
    const get = (endpoint) =>
      privateJson(fetch, `https://api.stripe.com/v1${endpoint}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
          "Stripe-Version": "2026-06-24.dahlia",
        },
      });
    const sourceTexts = async () =>
      Object.fromEntries(
        await Promise.all(
          R.sourceNames.map(async (name) => [name, await readPrivate(path.join(dir, name))]),
        ),
      );
    const state = async () => {
      const customer = await get(`/customers/${C.customer}`);
      const clock = await get(`/test_helpers/test_clocks/${customer.test_clock}`);
      if (clock.status !== "ready" || clock.livemode !== false || clock.id !== customer.test_clock)
        fail();
      const subscriptions = await get(`/subscriptions?customer=${C.customer}&status=all&limit=100`);
      const open = await get(`/checkout/sessions?customer=${C.customer}&status=open&limit=100`);
      const key = config.supa.SUPABASE_SERVICE_ROLE_KEY;
      const profiles = await privateJson(
        fetch,
        `${TARGET.supabase}/rest/v1/profiles?${new URLSearchParams({ id: `eq.${record.userId}`, select: "id,is_pro,stripe_customer_id,billing_revision" })}`,
        {
          method: "GET",
          headers: key.startsWith("sb_secret_")
            ? { apikey: key }
            : { apikey: key, Authorization: `Bearer ${key}` },
        },
      );
      if (!Array.isArray(profiles) || profiles.length !== 1) fail();
      return { record, customer, subscriptions, open, profile: profiles[0] };
    };
    const initial = await state();
    if (
      initial.open.has_more !== false ||
      initial.open.data?.length !== 1 ||
      initial.open.data[0].id !== K.sessionId
    )
      fail();
    const baseline = assertCurrentBaseline({ ...initial, open: { data: [], has_more: false } });
    const history = assertFailedSourceHistory({ texts: await sourceTexts(), baseline });
    const preflight = async () => {
      const fresh = await state();
      if (
        fresh.open.has_more !== false ||
        fresh.open.data?.length !== 1 ||
        fresh.open.data[0].id !== K.sessionId ||
        JSON.stringify(assertCurrentBaseline({ ...fresh, open: { data: [], has_more: false } })) !==
          JSON.stringify(baseline) ||
        JSON.stringify(assertFailedSourceHistory({ texts: await sourceTexts(), baseline })) !==
          JSON.stringify(history)
      )
        fail();
      assertFailedCurrentIntent(await get(`/payment_intents/${R.intentId}`));
      const session = await get(`/checkout/sessions/${K.sessionId}`);
      if (session.id !== K.sessionId) fail();
      assertCurrentOpenCheckout({
        session,
        lines: await get(`/checkout/sessions/${K.sessionId}/line_items?limit=100`),
        userId: record.userId,
      });
    };
    await preflight();
    await append("validated", { baseline, history });
    await append("expire-pending");
    await preflight();
    const expired = await privateJson(
      fetch,
      `https://api.stripe.com/v1/checkout/sessions/${K.sessionId}/expire`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.stripe.STRIPE_SECRET_KEY}`,
          "Stripe-Version": "2026-06-24.dahlia",
        },
      },
    );
    if (expired.id !== K.sessionId || expired.status !== "expired" || expired.livemode !== false)
      fail();
    const finalState = await state();
    const finalBaseline = assertCurrentBaseline(finalState);
    if (JSON.stringify(finalBaseline) !== JSON.stringify(baseline)) fail();
    const finalHistory = assertFailedSourceHistory({ texts: await sourceTexts(), baseline });
    if (JSON.stringify(finalHistory) !== JSON.stringify(history)) fail();
    const session = await get(`/checkout/sessions/${K.sessionId}`);
    const lines = await get(`/checkout/sessions/${K.sessionId}/line_items?limit=100`);
    const intent = await get(`/payment_intents/${R.intentId}`);
    assertRetiredCurrentIntent(intent);
    assertCurrentExpiredCheckout({ session, lines, userId: record.userId });
    await append("final", { baseline, history, expired: true, unpaid: true, openCheckouts: 0 });
    const proof = assertRetiredCurrentAttempt({
      journalText: await readPrivate(path.join(dir, R.journal)),
      baseline,
      session,
      lines,
      intent,
      history,
    });
    console.log(JSON.stringify({ kind: "failed-auth-retired", ...proof, liveCharges: 0 }));
  } catch {
    console.error("CURRENT_FAILED_AUTH_RETIREMENT_STOPPED_NO_RETRY");
    process.exitCode = 1;
  } finally {
    await journal?.close();
    if (lock) {
      await lock.close();
      await fs.unlink(path.join(dir, "protected-billing-run.lock"));
    }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== "--approved") {
    console.error("CURRENT_RETIREMENT_APPROVAL_REQUIRED");
    process.exitCode = 1;
  } else await retireFailedCurrentAttempt({ approved: true });
}
