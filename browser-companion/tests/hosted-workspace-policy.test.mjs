import assert from "node:assert/strict";
import {
  assertHostedWorkspacePublicKey,
  createHostedWorkspacePolicy,
} from "../../scripts/hosted-workspace-test-policy.mjs";
const record = {
  userId: "user-a",
  email: "test@example.test",
  password: "not-real-password",
  marker: "marked",
  nonce: "nonce-a",
};
const app = "https://unimate-fixture.vercel.app";
const supabase = "https://gtqfaxsokdlrdxipcyqo.supabase.co";
const prefix = "[Workspace test 00000000-0000-4000-8000-000000000001]";
const user = {
  id: record.userId,
  email: record.email,
  app_metadata: { unimate_test_marker: record.marker, unimate_test_nonce: record.nonce },
};
const make = () => createHostedWorkspacePolicy({ record, app, supabase, prefix });
const policy = make();
const request = (url, method = "GET", body) => ({
  url,
  method,
  body,
  authorization: "Bearer synthetic-access",
});
assert.throws(() => policy.authorize(request(`${app}/api/study-workspace`)));
assert.throws(() =>
  policy.authorize(
    request(`${supabase}/auth/v1/token?grant_type=password`, "POST", {
      ...record,
      email: "personal@example.com",
    }),
  ),
);
assert.equal(
  policy.authorize(
    request(`${supabase}/auth/v1/token?grant_type=password`, "POST", {
      email: record.email,
      password: record.password,
    }),
  ),
  "auth",
);
policy.observe("auth", {
  user,
  access_token: "synthetic-access",
  refresh_token: "synthetic-refresh",
});
assert.equal(policy.authorize(request(`${app}/api/billing-status?reconcile=false`)), "billing");
assert.throws(() => policy.authorize(request(`${app}/api/billing-status`)));
for (const url of [
  `${app}/api/dashboard-ai`,
  `${app}/api/analyze-screenshot`,
  `${app}/api/create-checkout-session`,
  "https://api.stripe.com/v1/customers",
])
  assert.throws(() => policy.authorize(request(url, "POST", {})));
for (const url of [
  "https://example.com/",
  "http://localhost:3000/",
  `${supabase}/rest/v1/profiles`,
])
  assert.throws(() => policy.authorize(request(url, "PATCH", { is_pro: true })));
assert.throws(() =>
  policy.authorize(
    request(`${supabase}/rest/v1/companion_conversations`, "POST", {
      user_id: "someone-else",
      title: "Assignment help",
    }),
  ),
);
assert.equal(
  policy.authorize(
    request(`${supabase}/rest/v1/companion_conversations`, "POST", {
      user_id: record.userId,
      title: "Assignment help",
    }),
  ),
  "new-chat",
);
policy.observe("new-chat", { id: "new-chat", user_id: record.userId });
const item = {
  id: "new-item",
  title: `${prefix} assignment`,
  kind: "assignment",
  conversationId: "new-chat",
  courseId: null,
};
assert.equal(policy.authorize(request(`${app}/api/study-workspace`, "POST", { item })), "saved");
assert.throws(() =>
  policy.authorize(
    request(`${app}/api/study-workspace`, "POST", {
      item: { ...item, title: "Unmarked personal item" },
    }),
  ),
);
assert.throws(() =>
  policy.authorize(
    request(`${app}/api/study-workspace`, "POST", {
      item: { ...item, courseId: "personal-class" },
    }),
  ),
);
assert.throws(() =>
  policy.authorize(
    request(`${app}/api/study-workspace`, "PATCH", {
      id: item.id,
      expectedVersion: 1,
      patch: item,
    }),
  ),
);
policy.observe("saved", { item: { ...item, userId: record.userId } });
assert.equal(
  policy.authorize(
    request(`${app}/api/study-workspace`, "PATCH", {
      id: item.id,
      expectedVersion: 1,
      patch: item,
    }),
  ),
  "saved",
);
assert.throws(() =>
  policy.authorize(
    request(`${app}/api/study-workspace`, "DELETE", { id: item.id, expectedVersion: 2 }),
  ),
);
assert.throws(() => policy.observe("items", { items: [{ ...item, userId: "other-user" }] }));
assert.throws(() => policy.observe("user", { ...user, app_metadata: {} }));
assert.throws(() =>
  policy.authorize({
    ...request(`${app}/api/study-workspace`),
    authorization: "Bearer another-account",
  }),
);
assert.throws(() =>
  make().observe("auth", { user: { ...user, id: "personal" }, access_token: "synthetic-access" }),
);

assert.equal(
  policy.authorize(
    request(`${supabase}/rest/v1/companion_conversations?on_conflict=id`, "POST", {
      id: "minimal-chat",
      user_id: record.userId,
      title: "New assignment",
    }),
  ),
  "new-chat",
);
assert.throws(() =>
  policy.authorize(
    request(`${supabase}/rest/v1/companion_preferences`, "POST", {
      user_id: record.userId,
      active_conversation_id: "minimal-chat",
    }),
  ),
);
policy.observe("companion_conversations", [{ id: "minimal-chat" }]);
assert.equal(
  policy.authorize(
    request(`${supabase}/rest/v1/companion_preferences`, "POST", {
      user_id: record.userId,
      active_conversation_id: "minimal-chat",
    }),
  ),
  "preference",
);

const bootstrapPolicy = make();
bootstrapPolicy.observe("auth", {
  user,
  access_token: "synthetic-access",
  refresh_token: "synthetic-refresh",
});
const bootstrapRequest = request(`${supabase}/rest/v1/companion_conversations`, "POST", {
  user_id: record.userId,
  title: "My first chat",
});
assert.throws(() => bootstrapPolicy.authorize(bootstrapRequest));
bootstrapPolicy.observe("companion_conversations", []);
assert.equal(bootstrapPolicy.authorize(bootstrapRequest), "new-chat");
assert.throws(() => bootstrapPolicy.authorize(bootstrapRequest));

assert.doesNotThrow(() => assertHostedWorkspacePublicKey("sb_publishable_synthetic_key"));
assert.throws(() => assertHostedWorkspacePublicKey("sb_secret_synthetic_key"));
assert.throws(() =>
  assertHostedWorkspacePublicKey(
    "x." +
      Buffer.from(JSON.stringify({ role: "service_role", ref: "gtqfaxsokdlrdxipcyqo" })).toString(
        "base64url",
      ) +
      ".y",
  ),
);

console.log(
  "Hosted workspace policy passed: marked identity, isolated destinations, no AI/Stripe/reconciliation, only this run’s fake saves, and no deletions.",
);
