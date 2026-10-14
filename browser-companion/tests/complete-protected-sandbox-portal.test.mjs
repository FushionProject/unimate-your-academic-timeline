import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";
import {
  verifyPortalCompletionScope,
  performPortalCompletion,
  parsePortalCompletionCommand,
  completeProtectedSandboxPortal,
  assertPortalOpenRecovery,
} from "../../scripts/complete-protected-sandbox-portal.mjs";

const now = 1800000000000,
  customer = "cus_VRAVJnKW1RGQzr",
  user = "10000000-0000-4000-8000-000000000001";
function fixture() {
  const nonce = "20000000-0000-4000-8000-000000000002";
  const record = {
    version: 1,
    marker: "unimate-stripe-sandbox-synthetic-v1",
    nonce,
    userId: user,
    email: `unimate-billing-${nonce}@example.test`,
    password: "A".repeat(43),
    account: TARGET.account,
    price: TARGET.price,
    supabase: TARGET.supabase,
  };
  const baseline = ["sub_old1", "sub_old2", "sub_old3"].map((id) => [id, "canceled"]);
  const journal = {
    version: 1,
    account: TARGET.account,
    userId: user,
    customerId: customer,
    origin: "https://unimate-synthetic.vercel.app",
    portalVerified: true,
    portalAttempted: true,
    cancelAttempted: true,
    portalAttemptedAt: now - 10000,
    purchaseVerifiedRevision: 46,
    subscriptionId: "sub_current",
    baseline: JSON.stringify(baseline),
  };
  const state = {
    scope: {
      account: TARGET.account,
      userId: user,
      customerId: customer,
      clockStatus: "ready",
      subscriptions: [
        ...baseline.map(([id, status]) => ({ id, status })),
        {
          id: "sub_current",
          status: "active",
          cancelAtPeriodEnd: false,
          cancelAt: null,
          periodEnd: 1804995910,
        },
      ],
    },
    profiles: [{ id: user, stripe_customer_id: customer, is_pro: true, billing_revision: 48 }],
    events: [
      {
        id: "evt_current",
        type: "billing_portal.session.created",
        livemode: false,
        created: now / 1000 - 9,
        data: {
          object: {
            livemode: false,
            customer,
            return_url: `${journal.origin}/upgrade`,
            url: "https://billing.stripe.com/p/session/test_synthetic",
          },
        },
      },
    ],
  };
  return { record, journal, state };
}
const f = fixture();
const priorOpen = {
  version: 1,
  account: TARGET.account,
  userId: user,
  customerId: customer,
  subscriptionId: "sub_current",
  createdAt: 1000,
  updatedAt: 2000,
  phase: "open-pending",
  audit: [
    { phase: "ready", at: 1000 },
    { phase: "open-pending", at: 2000 },
  ],
};
assert.doesNotThrow(() => assertPortalOpenRecovery(priorOpen, f.record, f.journal));
for (const patch of [
  { phase: "reason-pending" },
  { phase: "confirm-pending" },
  { phase: "submitted" },
  { phase: "opened" },
  { subscriptionId: "sub_other" },
  { userId: "other" },
  { customerId: "cus_other" },
  { navigationRecovery: true },
  { confirmAttempted: true },
  {
    audit: [
      { phase: "ready", at: 1000 },
      { phase: "reason-pending", at: 2000 },
    ],
  },
  { audit: [...priorOpen.audit, { phase: "confirm-pending", at: 2000 }] },
  {
    audit: [
      { phase: "open-pending", at: 2000 },
      { phase: "ready", at: 1000 },
    ],
  },
  {
    audit: [
      { phase: "ready", at: 1000 },
      { phase: "open-pending", at: 2000, reasonAttempted: true },
    ],
  },
])
  assert.throws(
    () => assertPortalOpenRecovery({ ...priorOpen, ...patch }, f.record, f.journal),
    /NOT_ELIGIBLE/,
  );
assert.equal(
  priorOpen.phase,
  "open-pending",
  "recovery validation never resets the original journal",
);
{
  const queryForm = fixture();
  queryForm.state.events[0].data.object.url =
    "https://billing.stripe.com/p/session?session=synthetic-opaque-fixture";
  assert.equal(
    verifyPortalCompletionScope(queryForm.record, queryForm.journal, queryForm.state, now),
    queryForm.state.events[0].data.object.url,
  );
  for (const url of [
    "https://billing.stripe.com/p/session",
    "https://billing.stripe.com/p/session?",
    "https://billing.stripe.com/p/other?session=synthetic",
    "https://attacker.example/p/session?session=synthetic",
    "https://user:password@billing.stripe.com/p/session?session=synthetic",
  ]) {
    queryForm.state.events[0].data.object.url = url;
    assert.throws(
      () => verifyPortalCompletionScope(queryForm.record, queryForm.journal, queryForm.state, now),
      /EXACT_STRIPE_PORTAL_URL_REQUIRED/,
    );
  }
}
assert.equal(
  verifyPortalCompletionScope(f.record, f.journal, f.state, now),
  f.state.events[0].data.object.url,
);
for (const mutate of [
  (f) => {
    f.journal.portalVerified = false;
  },
  (f) => {
    f.journal.cancelAttempted = false;
  },
  (f) => {
    f.journal.origin = "https://attacker.example";
  },
  (f) => {
    f.journal.subscriptionId = "sub_other";
  },
  (f) => {
    f.journal.baseline = JSON.stringify([
      ["sub_old1", "canceled"],
      ["sub_old1", "canceled"],
      ["sub_old3", "canceled"],
    ]);
  },
  (f) => {
    f.state.scope.clockStatus = "advancing";
  },
  (f) => {
    f.state.scope.customerId = "cus_other";
  },
  (f) => {
    f.state.scope.subscriptions[0].status = "active";
  },
  (f) => {
    f.state.scope.subscriptions.at(-1).status = "canceled";
  },
  (f) => {
    f.state.scope.subscriptions.at(-1).cancelAtPeriodEnd = true;
  },
  (f) => {
    f.state.scope.subscriptions.at(-1).cancelAt = 1804995910;
  },
  (f) => {
    f.state.scope.subscriptions.push({ id: "sub_extra", status: "active" });
  },
  (f) => {
    f.state.profiles[0].is_pro = false;
  },
  (f) => {
    f.state.profiles[0].billing_revision = 45;
  },
  (f) => {
    f.state.events[0].livemode = true;
  },
  (f) => {
    f.state.events[0].data.object.livemode = true;
  },
  (f) => {
    f.state.events[0].data.object.customer = "cus_other";
  },
  (f) => {
    f.state.events[0].data.object.return_url = "https://attacker.example/upgrade";
  },
  (f) => {
    f.state.events[0].data.object.url = "https://attacker.example/p/session/test_synthetic";
  },
  (f) => {
    f.state.events[0].created = now / 1000 - 20;
  },
  (f) => {
    f.state.events.push(structuredClone(f.state.events[0]));
  },
]) {
  const value = fixture();
  mutate(value);
  assert.throws(() => verifyPortalCompletionScope(value.record, value.journal, value.state, now));
}
for (const command of ["STATUS", "INSPECT", "REASON", "CONFIRM", "STOP"])
  assert.equal(parsePortalCompletionCommand(` ${command} `), command);
for (const command of ["RETRY", "OPEN", "EVAL 1", "CONFIRM twice"])
  assert.equal(parsePortalCompletionCommand(command), null);
{
  let phase = "ready",
    actions = 0;
  const save = async (next) => {
    phase = next;
  };
  await performPortalCompletion("OPEN", phase, {
    save,
    action: async () => {
      assert.equal(phase, "open-pending");
    },
  });
  assert.equal(phase, "opened");
  await assert.rejects(
    performPortalCompletion("CONFIRM", phase, { save, action: async () => actions++ }),
    /NO_RETRY/,
  );
  await performPortalCompletion("REASON", phase, {
    save,
    action: async () => {
      assert.equal(phase, "reason-pending");
    },
  });
  await assert.rejects(
    performPortalCompletion("CONFIRM", phase, {
      save,
      action: async () => {
        actions++;
        assert.equal(phase, "confirm-pending");
        throw new Error("unknown outcome");
      },
    }),
    /unknown outcome/,
  );
  assert.equal(phase, "confirm-pending");
  await assert.rejects(
    performPortalCompletion("CONFIRM", phase, { save, action: async () => actions++ }),
    /NO_RETRY/,
  );
  assert.equal(actions, 1);
}
const originalFetch = globalThis.fetch;
globalThis.fetch = () => assert.fail("no provider calls in offline suite");
try {
  await assert.rejects(
    completeProtectedSandboxPortal(),
    /EXPLICIT_PORTAL_COMPLETION_APPROVAL_REQUIRED/,
  );
} finally {
  globalThis.fetch = originalFetch;
}
const source = await readFile(
  new URL("../../scripts/complete-protected-sandbox-portal.mjs", import.meta.url),
  "utf8",
);
assert(source.includes('"protected-portal-cancellation-completion-v1.json"'));
assert(/"wx",\s*0o600/.test(source));
assert(source.includes("ORIGINAL_PORTAL_JOURNAL_CHANGED"));
assert(source.includes("ORIGINAL_PORTAL_COMPLETION_CHANGED"));
assert(source.includes('"protected-portal-open-recovery-v1.json"'));
assert(source.includes("continuationRoutePolicy({"));
assert(source.includes("if (main && url.origin !== PORTAL)"));
assert(
  source.includes("?phase=open") &&
    source.includes("?phase=reason") &&
    source.includes("?phase=confirm"),
);
assert(
  !source.includes('method: "POST"') &&
    !source.includes("force: true") &&
    !source.includes("attachProtectedPreviewBrowser"),
);
console.log(
  "PASS Portal completion: exact scoped active subscription/event, fresh-state guards, separate staged one-shot journal and approval (offline)",
);
