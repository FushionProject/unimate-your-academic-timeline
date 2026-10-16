import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TARGET } from "../../scripts/prepare-stripe-sandbox.mjs";
import { PROTECTED_BILLING_V2 } from "../../scripts/protected-billing-run-v2.mjs";
import {
  verifyPortalCompletionScope,
  performPortalCompletion,
  parsePortalCompletionCommand,
  completeProtectedSandboxPortal,
  assertPortalOpenRecovery,
  assertPortalFeedbackRecovery,
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
function fixtureV2() {
  const value = fixture();
  const baseline = PROTECTED_BILLING_V2.baseline.map((id) => [id, "canceled"]);
  Object.assign(value.journal, {
    version: 2,
    origin: PROTECTED_BILLING_V2.origin,
    baseline: JSON.stringify(baseline),
  });
  value.state.scope.subscriptions = [
    ...baseline.map(([id, status]) => ({ id, status })),
    value.state.scope.subscriptions.at(-1),
  ];
  value.state.events[0].data.object.return_url = `${PROTECTED_BILLING_V2.origin}/upgrade`;
  return value;
}
{
  const v2 = fixtureV2();
  assert.equal(
    verifyPortalCompletionScope(v2.record, v2.journal, v2.state, now, 2),
    v2.state.events[0].data.object.url,
  );
  assert.throws(() => verifyPortalCompletionScope(v2.record, v2.journal, v2.state, now));
  assert.throws(() => verifyPortalCompletionScope(f.record, f.journal, f.state, now, 2));
  assert.throws(() => verifyPortalCompletionScope(v2.record, v2.journal, v2.state, now, 3));
  for (const mutate of [
    (value) => {
      value.journal.version = 1;
    },
    (value) => {
      value.journal.origin = PROTECTED_BILLING_V2.previousOrigin;
    },
    (value) => {
      value.journal.cancelAttempted = false;
    },
    (value) => {
      value.journal.portalVerified = false;
    },
    (value) => {
      value.journal.portalAttempted = false;
    },
    (value) => {
      value.journal.subscriptionId = PROTECTED_BILLING_V2.previousSubscription;
    },
    (value) => {
      value.journal.baseline = JSON.stringify(
        PROTECTED_BILLING_V2.baseline.slice(0, 3).map((id) => [id, "canceled"]),
      );
    },
    (value) => {
      const baseline = JSON.parse(value.journal.baseline);
      baseline[3][0] = "sub_foreign";
      value.journal.baseline = JSON.stringify(baseline);
      value.state.scope.subscriptions[3].id = "sub_foreign";
    },
    (value) => {
      value.state.scope.subscriptions[3].status = "active";
    },
    (value) => {
      value.state.scope.subscriptions.at(-1).cancelAtPeriodEnd = true;
    },
    (value) => {
      value.state.scope.subscriptions.at(-1).cancelAt = 1804995910;
    },
    (value) => {
      value.state.scope.subscriptions.at(-1).status = "canceled";
    },
    (value) => {
      value.state.scope.subscriptions.push({ id: "sub_extra", status: "active" });
    },
    (value) => {
      value.state.scope.subscriptions.pop();
    },
    (value) => {
      value.state.scope.customerId = "cus_other";
    },
    (value) => {
      value.state.scope.clockStatus = "advancing";
    },
    (value) => {
      value.state.profiles[0].is_pro = false;
    },
    (value) => {
      value.state.profiles[0].billing_revision = 45;
    },
    (value) => {
      value.state.events[0].livemode = true;
    },
    (value) => {
      value.state.events[0].data.object.livemode = true;
    },
    (value) => {
      value.state.events[0].data.object.customer = "cus_other";
    },
    (value) => {
      value.state.events[0].data.object.return_url = `${PROTECTED_BILLING_V2.previousOrigin}/upgrade`;
    },
    (value) => {
      value.state.events[0].created = now / 1000 - 20;
    },
    (value) => {
      value.state.events.push(structuredClone(value.state.events[0]));
    },
  ]) {
    const input = fixtureV2();
    mutate(input);
    assert.throws(() =>
      verifyPortalCompletionScope(input.record, input.journal, input.state, now, 2),
    );
  }
}
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
const priorFeedback = {
  ...priorOpen,
  createdAt: 3000,
  updatedAt: 6000,
  phase: "reason-pending",
  navigationRecovery: true,
  priorAttempt: structuredClone(priorOpen),
  audit: ["ready", "open-pending", "opened", "reason-pending"].map((phase, index) => ({
    phase,
    at: 3000 + index * 1000,
  })),
};
assert.doesNotThrow(() =>
  assertPortalFeedbackRecovery(priorFeedback, priorOpen, f.record, f.journal),
);
for (const patch of [
  { phase: "confirm-pending" },
  { phase: "submitted" },
  { phase: "reason-selected" },
  { navigationRecovery: false },
  { feedbackRecovery: true },
  { confirmAttempted: false },
  { subscriptionId: "sub_other" },
  { userId: "other" },
  { customerId: "cus_other" },
  { priorAttempt: { ...priorOpen, updatedAt: 1999 } },
  { audit: [...priorFeedback.audit, { phase: "confirm-pending", at: 6000 }] },
  { audit: priorFeedback.audit.slice(0, 3) },
  {
    audit: priorFeedback.audit.map((entry, index) =>
      index === 2 ? { ...entry, phase: "confirm-pending" } : entry,
    ),
  },
])
  assert.throws(
    () =>
      assertPortalFeedbackRecovery({ ...priorFeedback, ...patch }, priorOpen, f.record, f.journal),
    /NOT_ELIGIBLE/,
  );
assert.equal(
  priorFeedback.phase,
  "reason-pending",
  "feedback recovery validation preserves failed prior record",
);
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
const originalNodeOptions = process.env.NODE_OPTIONS;
globalThis.fetch = () => assert.fail("no provider calls in offline suite");
try {
  await assert.rejects(
    completeProtectedSandboxPortal(),
    /EXPLICIT_PORTAL_COMPLETION_APPROVAL_REQUIRED/,
  );
  delete process.env.NODE_OPTIONS;
  for (const options of [
    { runVersion: 2, resumeOpen: true },
    { runVersion: 2, resumeFeedback: true },
    { runVersion: 3 },
  ])
    await assert.rejects(
      completeProtectedSandboxPortal({ approved: true, ...options }),
      /V2_PORTAL_COMPLETION_DOES_NOT_ALLOW_RECOVERY/,
    );
} finally {
  globalThis.fetch = originalFetch;
  if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS;
  else process.env.NODE_OPTIONS = originalNodeOptions;
}
const source = await readFile(
  new URL("../../scripts/complete-protected-sandbox-portal.mjs", import.meta.url),
  "utf8",
);
assert(source.includes('"protected-portal-cancellation-completion-v1.json"'));
assert(source.includes('"protected-portal-cancellation-completion-v2.json"'));
assert(/"wx",\s*0o600/.test(source));
assert(source.includes("ORIGINAL_PORTAL_JOURNAL_CHANGED"));
assert(source.includes("ORIGINAL_PORTAL_COMPLETION_CHANGED"));
assert(source.includes("ORIGINAL_PORTAL_OPEN_RECOVERY_CHANGED"));
assert(source.includes('"protected-portal-feedback-recovery-v1.json"'));
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
