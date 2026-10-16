import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseProtectedBillingCommand,
  runProtectedBillingPreview,
  protectedBillingReturnProof,
  assertProtectedBillingReturn,
  recentProtectedPortalEvents,
  readyProtectedBillingButton,
  validatedProtectedVercelCli,
  assertProtectedPaymentAttempt,
  assertProtectedCancelAttempt,
  protectedBillingStartupError,
} from "../../scripts/run-protected-billing-preview.mjs";
import { SetupError } from "../../scripts/prepare-stripe-sandbox.mjs";
import { PROTECTED_BILLING_V2 } from "../../scripts/protected-billing-run-v2.mjs";

for (const stage of [
  "CONFIG",
  "DEPLOYMENT",
  "OIDC",
  "LISTENER",
  "BROWSER_LAUNCH",
  "WEBSITE_SIGNIN",
  "COMPANION_FREE",
]) {
  const error = protectedBillingStartupError(stage, new Error("private provider diagnostics"));
  assert.equal(error.code, `PRIVATE_PREVIEW_${stage}_FAILED`);
  assert(!JSON.stringify(error).includes("private provider diagnostics"));
  assert(!error.message.includes("private provider diagnostics"));
}
assert.equal(
  protectedBillingStartupError("untrusted provider text", new Error("secret")).code,
  "PRIVATE_PREVIEW_RUN_FAILED",
);
const classified = new SetupError("SYNTHETIC_PROFILE_MISMATCH");
assert.equal(protectedBillingStartupError("BASELINE", classified), classified);

for (const command of [
  "STATUS",
  "PAGE",
  "CHECKOUT",
  "PAY",
  "INSPECT_STRIPE",
  "PAY_SUBMIT",
  "PORTAL",
  "PORTAL_CANCEL",
  "RETURN",
  "EXPECT_FREE",
  "EXPECT_PRO",
  "EXPECT_REVOKED",
  "STOP",
])
  assert.equal(parseProtectedBillingCommand(` ${command} `), command);
for (const command of [
  "EVAL 1",
  "PAY 599",
  "https://example.com",
  "checkout",
  "STOP; PAY",
  "",
  "CANCEL",
])
  assert.equal(parseProtectedBillingCommand(command), null);
const originalFetch = globalThis.fetch;
globalThis.fetch = () => assert.fail("offline runner tests must never reach a provider");
try {
  await assert.rejects(
    runProtectedBillingPreview({ origin: "https://example.com" }),
    /EXPLICIT_PRIVATE_RUN_APPROVAL_REQUIRED/,
  );
} finally {
  globalThis.fetch = originalFetch;
}

const customer = "cus_VRAVJnKW1RGQzr",
  user = "10000000-0000-4000-8000-000000000001";
function proofFixture() {
  return {
    journal: {
      customerId: customer,
      userId: user,
      sessionId: "cs_test_new",
      baselineRevision: 42,
      baseline: JSON.stringify([
        ["sub_old1", "canceled"],
        ["sub_old2", "canceled"],
        ["sub_old3", "canceled"],
      ]),
    },
    profile: { id: user, stripe_customer_id: customer, is_pro: true, billing_revision: 45 },
    subscriptions: [
      { id: "sub_old1", status: "canceled" },
      { id: "sub_old2", status: "canceled" },
      { id: "sub_old3", status: "canceled" },
      { id: "sub_new", status: "active" },
    ],
    openCheckouts: [],
    session: {
      id: "cs_test_new",
      livemode: false,
      customer,
      client_reference_id: user,
      metadata: { user_id: user },
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      amount_total: 599,
      currency: "usd",
      subscription: "sub_new",
    },
    events: [
      {
        id: "evt_new",
        livemode: false,
        type: "invoice.paid",
        data: {
          object: {
            object: "invoice",
            livemode: false,
            customer,
            status: "paid",
            parent: { subscription_details: { subscription: "sub_new" } },
          },
        },
      },
    ],
    purchaseRevision: null,
  };
}
const valid = protectedBillingReturnProof(proofFixture());
assert.deepEqual(valid, {
  verified: true,
  subscriptionId: "sub_new",
  billingRevision: 45,
  phase: "purchased",
});
assert.doesNotThrow(() => assertProtectedBillingReturn(true, valid));
assert.throws(() => assertProtectedBillingReturn(false, valid), /PROOF_REQUIRED/);
assert.throws(() => assertProtectedBillingReturn(true, { verified: false }), /PROOF_REQUIRED/);

for (const mutate of [
  (f) => (f.events = []), // Pro alone does not certify a hosted webhook.
  (f) => (f.profile.is_pro = false), // A delivered event without persisted Pro is insufficient.
  (f) => (f.profile.billing_revision = 42),
  (f) => (f.events[0].livemode = true),
  (f) => (f.events[0].account = "acct_other"),
  (f) => (f.events[0].data.object.customer = "cus_other"),
  (f) => (f.events[0].data.object.livemode = true),
  (f) => (f.events[0].data.object.parent.subscription_details.subscription = "sub_old1"),
  (f) => (f.events[0].data.object.status = "open"),
  (f) => (f.session.subscription = "sub_old1"),
  (f) => (f.session.payment_status = "unpaid"),
  (f) => (f.session.status = "open"),
  (f) => (f.session.customer = "cus_other"),
  (f) => (f.session.amount_total = 600),
  (f) => (f.session.metadata.user_id = "other"),
  (f) => (f.journal.subscriptionId = "sub_other"),
  (f) => f.subscriptions.push({ id: "sub_extra", status: "active" }),
  (f) => (f.subscriptions[0].status = "active"),
  (f) => (f.subscriptions[3].status = "canceled"),
  (f) => f.openCheckouts.push({ id: "cs_test_open" }),
  (f) => (f.journal.baseline = "not-json"),
]) {
  const input = proofFixture();
  mutate(input);
  assert.deepEqual(protectedBillingReturnProof(input), { verified: false });
}
for (const type of [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
]) {
  const input = proofFixture();
  input.events = [
    {
      id: "evt_new",
      livemode: false,
      type,
      data: {
        object: type.startsWith("checkout")
          ? input.session
          : { id: "sub_new", object: "subscription", livemode: false, customer },
      },
    },
  ];
  input.session.object = "checkout.session";
  assert.equal(protectedBillingReturnProof(input).verified, true);
  input.events[0].data.object.id = type.startsWith("checkout") ? "cs_test_other" : "sub_old1";
  assert.equal(protectedBillingReturnProof(input).verified, false);
}
function revokedFixture() {
  const input = proofFixture();
  input.journal.portalAttempted = true;
  input.journal.subscriptionId = "sub_new";
  input.purchaseRevision = 45;
  input.profile.is_pro = false;
  input.profile.billing_revision = 48;
  input.subscriptions[3].status = "canceled";
  input.events = [
    {
      id: "evt_deleted",
      livemode: false,
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_new", object: "subscription", livemode: false, customer } },
    },
  ];
  return input;
}
assert.deepEqual(protectedBillingReturnProof(revokedFixture()), {
  verified: true,
  subscriptionId: "sub_new",
  billingRevision: 48,
  phase: "revoked",
});
for (const mutate of [
  (f) => (f.events = []),
  (f) => (f.events[0].data.object.id = "sub_old1"),
  (f) => (f.profile.is_pro = true),
  (f) => (f.profile.billing_revision = 45),
  (f) => (f.purchaseRevision = null),
  (f) => delete f.journal.subscriptionId,
  (f) => (f.subscriptions[3].status = "active"),
]) {
  const input = revokedFixture();
  mutate(input);
  assert.equal(protectedBillingReturnProof(input).verified, false);
}
// v2 is a separate fixed four-subscription baseline, never a relaxation of v1.
function v2ProofFixture(revoked = false) {
  const input = revoked ? revokedFixture() : proofFixture();
  input.runVersion = 2;
  input.journal.version = 2;
  input.journal.origin = PROTECTED_BILLING_V2.origin;
  input.journal.baseline = JSON.stringify(
    PROTECTED_BILLING_V2.baseline.map((id) => [id, "canceled"]),
  );
  input.subscriptions = [
    ...PROTECTED_BILLING_V2.baseline.map((id) => ({ id, status: "canceled" })),
    { id: "sub_new", status: revoked ? "canceled" : "active" },
  ];
  return input;
}
for (const revoked of [false, true]) {
  assert.equal(protectedBillingReturnProof(v2ProofFixture(revoked)).verified, true);
  for (const mutate of [
    (f) => (f.runVersion = 1),
    (f) => (f.runVersion = 3),
    (f) => (f.journal.version = 1),
    (f) => (f.journal.origin = "https://wrong.vercel.app"),
    (f) => {
      const rows = JSON.parse(f.journal.baseline);
      rows[0][0] = "sub_other";
      f.journal.baseline = JSON.stringify(rows);
      f.subscriptions[0].id = "sub_other";
    },
    (f) => f.subscriptions.push({ id: "sub_extra", status: "canceled" }),
  ]) {
    const input = v2ProofFixture(revoked);
    mutate(input);
    assert.equal(protectedBillingReturnProof(input).verified, false);
  }
}
// RETURN re-evaluates current evidence; a previous purchased proof cannot make a
// subsequently canceled/no-deletion-event snapshot pass its gate.
const changed = proofFixture();
changed.profile.is_pro = false;
assert.throws(
  () => assertProtectedBillingReturn(true, protectedBillingReturnProof(changed)),
  /PROOF_REQUIRED/,
);

const attemptedAt = 1_800_000_000_000;
const event = (id) => ({ id, type: "billing_portal.session.created", livemode: false });
const paths = [];
const recent = await recentProtectedPortalEvents(async (path) => {
  paths.push(path);
  return paths.length === 1
    ? { data: [event("evt_first")], has_more: true }
    : { data: [event("evt_last")], has_more: false };
}, attemptedAt);
assert.equal(recent.length, 2);
assert.equal(
  new URL(paths[0], "https://fixture.example").searchParams.get("created[gte]"),
  String(attemptedAt / 1000 - 120),
);
assert.equal(
  new URL(paths[1], "https://fixture.example").searchParams.get("starting_after"),
  "evt_first",
);
await assert.rejects(
  recentProtectedPortalEvents(async () => ({ data: [], has_more: true }), attemptedAt),
  /LIST_REQUIRED/,
);
await assert.rejects(
  recentProtectedPortalEvents(
    async () => ({ data: [event("evt_same")], has_more: true }),
    attemptedAt,
  ),
  /LIST_REQUIRED/,
);
let pages = 0;
await assert.rejects(
  recentProtectedPortalEvents(
    async () => ({ data: [event(`evt_page${++pages}`)], has_more: true }),
    attemptedAt,
  ),
  /LIST_REQUIRED/,
);
assert.equal(pages, 3, "pagination is bounded; no endless provider discovery");

// Actual readiness helper must complete both checks before the caller can
// journal/hold/click. A merely visible disabled button does not qualify.
const seen = [];
const button = {
  waitFor: async (opts) => {
    seen.push(["visible", opts.state]);
  },
  isEnabled: async () => {
    seen.push(["enabled"]);
    return true;
  },
};
const page = {
  getByRole: (role, opts) => {
    assert.equal(role, "button");
    assert.equal(opts.name, "Manage billing");
    assert.equal(opts.exact, true);
    return button;
  },
};
assert.equal(await readyProtectedBillingButton(page, "Manage billing"), button);
assert.deepEqual(seen, [["visible", "visible"], ["enabled"]]);
button.isEnabled = async () => false;
await assert.rejects(readyProtectedBillingButton(page, "Manage billing"), /BUTTON_NOT_READY/);
// Supplemental wiring assertions: production commands call these executable
// helpers in the necessary order, rather than tests certifying unused helpers.
const source = await readFile(
  new URL("../../scripts/run-protected-billing-preview.mjs", import.meta.url),
  "utf8",
);
const portal = source.slice(source.indexOf('} else if (command === "PORTAL")'));
assert(
  portal.indexOf('readyProtectedBillingButton(page, "Manage billing")') <
    portal.indexOf("portalAttempted: true"),
);
assert(portal.indexOf("portalAttempted: true") < portal.indexOf("holdUpgrade = true"));
assert(portal.indexOf("holdUpgrade = true") < portal.indexOf("portalButton.click()"));
const returning = source.slice(
  source.indexOf('} else if (command === "RETURN")'),
  source.indexOf('} else if (command === "PAGE"'),
);
assert(returning.indexOf("readReturnProof()") < returning.indexOf("assertProtectedBillingReturn"));
assert(
  returning.indexOf("assertProtectedBillingReturn") < returning.indexOf("holdUpgrade = false"),
);
function paymentFixture() {
  const input = proofFixture();
  input.journal.phase = "checkout-verified";
  input.profile.is_pro = false;
  input.session.status = "open";
  input.session.payment_status = "unpaid";
  input.session.subscription = null;
  input.subscriptions.pop();
  return {
    journal: input.journal,
    session: input.session,
    items: {
      has_more: false,
      data: [
        {
          price: "price_1UQHp4IxB8W4eFUhP9PCN5MG",
          quantity: 1,
          amount_total: 599,
          currency: "usd",
        },
      ],
    },
    state: {
      profile: input.profile,
      scope: { subscriptions: input.subscriptions },
      open: [{ id: input.session.id }],
    },
    baseline: input.journal.baseline,
  };
}
const paymentCheck = (input) =>
  assertProtectedPaymentAttempt(
    input.journal,
    input.session,
    input.items,
    input.state,
    input.baseline,
  );
assert.doesNotThrow(() => paymentCheck(paymentFixture()));
for (const mutate of [
  (f) => (f.journal.paymentAttempted = true),
  (f) => (f.journal.phase = "checkout-pending"),
  (f) => (f.session.livemode = true),
  (f) => (f.session.customer = "cus_other"),
  (f) => (f.session.amount_total = 600),
  (f) => (f.session.payment_status = "paid"),
  (f) => (f.items.data[0].price = "price_other"),
  (f) => (f.state.profile.is_pro = true),
  (f) => f.state.open.push({ id: "cs_test_other" }),
  (f) => f.state.scope.subscriptions.push({ id: "sub_new", status: "active" }),
]) {
  const input = paymentFixture();
  mutate(input);
  assert.throws(() => paymentCheck(input), /REJECTED|SCOPE_REQUIRED/);
}
function cancellationFixture() {
  const input = proofFixture();
  input.journal.portalVerified = true;
  input.journal.subscriptionId = "sub_new";
  return {
    journal: input.journal,
    state: { profile: input.profile, scope: { subscriptions: input.subscriptions } },
  };
}
const cancellationCheck = (input) => assertProtectedCancelAttempt(input.journal, input.state);
assert.doesNotThrow(() => cancellationCheck(cancellationFixture()));
for (const mutate of [
  (f) => (f.journal.cancelAttempted = true),
  (f) => (f.journal.portalVerified = false),
  (f) => (f.journal.subscriptionId = "sub_old1"),
  (f) => (f.state.profile.is_pro = false),
  (f) => (f.state.scope.subscriptions[3].cancelAtPeriodEnd = true),
  (f) => (f.state.scope.subscriptions[3].cancelAt = 1800000000),
  (f) => f.state.scope.subscriptions.push({ id: "sub_extra", status: "active" }),
]) {
  const input = cancellationFixture();
  mutate(input);
  assert.throws(() => cancellationCheck(input), /SCOPE_REQUIRED/);
}
const cliFixture = await mkdtemp(path.join(os.tmpdir(), "unimate-pinned-cli-fixture-"));
try {
  await mkdir(path.join(cliFixture, "dist"));
  const cli = path.join(cliFixture, "dist", "vc.js"),
    pkg = path.join(cliFixture, "package.json");
  await writeFile(cli, "// synthetic no-op fixture", { mode: 0o600 });
  await writeFile(
    pkg,
    JSON.stringify({ name: "vercel", version: "63.1.2", bin: { vercel: "./dist/vc.js" } }),
    { mode: 0o600 },
  );
  assert.equal(await validatedProtectedVercelCli(cli), cli);
  await assert.rejects(validatedProtectedVercelCli("relative/dist/vc.js"), /CLI_REQUIRED/);
  await writeFile(
    pkg,
    JSON.stringify({ name: "vercel", version: "99.0.0", bin: { vercel: "./dist/vc.js" } }),
  );
  await assert.rejects(validatedProtectedVercelCli(cli), /CLI_REQUIRED/);
} finally {
  await rm(cliFixture, { recursive: true, force: true });
}
const paying = source.slice(
  source.indexOf('} else if (command === "PAY_SUBMIT")'),
  source.indexOf('} else if (command === "PORTAL_CANCEL")'),
);
assert(paying.indexOf("assertProtectedPaymentAttempt") < paying.indexOf("paymentAttempted: true"));
assert(
  paying.indexOf('import("./protected-stripe-browser-payment.mjs")') <
    paying.indexOf("paymentAttempted: true"),
);
assert(
  paying.indexOf("paymentAttempted: true") < paying.indexOf("await submitVerifiedTestPayment"),
);
console.log(
  "Protected billing runner offline command, readiness, new-subscription proof and return-gate tests passed.",
);
