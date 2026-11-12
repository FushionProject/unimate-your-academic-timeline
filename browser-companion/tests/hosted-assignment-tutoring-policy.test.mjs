import assert from "node:assert/strict";
import { createHostedWorkspacePolicy } from "../../scripts/hosted-workspace-test-policy.mjs";
import {
  TUTORING_CASES,
  tutoringPlan,
  createHostedTutoringPolicy,
} from "../../scripts/hosted-assignment-tutoring-policy.mjs";
const record = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "synthetic@example.test",
  password: "synthetic-only",
  marker: "test-marker",
  nonce: "test-nonce",
};
const app = "https://unimate-fixture.vercel.app",
  supabase = "https://gtqfaxsokdlrdxipcyqo.supabase.co",
  fixtureOrigin = "http://127.0.0.1:45678",
  prefix = "[Workspace test 00000000-0000-4000-8000-000000000001]";
const conversationId = "22222222-2222-4222-8222-222222222222",
  workspaceId = "33333333-3333-4333-8333-333333333333";
const item = {
  id: workspaceId,
  userId: record.userId,
  kind: "assignment",
  title: `${prefix} Fictional reflection`,
  conversationId,
  courseId: null,
  sourceUrl: null,
  content: "Fictional assignment",
};
const image = "data:image/jpeg;base64," + "A".repeat(2000);
const auth = {
  user: {
    id: record.userId,
    email: record.email,
    app_metadata: { unimate_test_marker: record.marker, unimate_test_nonce: record.nonce },
  },
  access_token: "synthetic-access",
  refresh_token: "synthetic-refresh",
};
const request = (url, method = "GET", body) => ({
  url,
  method,
  body,
  authorization: "Bearer synthetic-access",
});
const make = (lane = "companion", plan = tutoringPlan()) => {
  const policy = createHostedTutoringPolicy({
    base: createHostedWorkspacePolicy({ record, app, prefix, supabase }),
    record,
    app,
    prefix,
    fixtureOrigin,
    lane,
    cases: plan.cases,
    plan: plan.name,
  });
  policy.observe("auth", auth);
  policy.observe("saved", { item });
  return policy;
};
function armed() {
  const p = make();
  p.arm({ id: "understand", workspaceId, conversationId });
  p.captureAllowed(`${fixtureOrigin}/`);
  p.recordCapture(image);
  return p;
}
function ai(index = 0, chatHistory = []) {
  const c = TUTORING_CASES[index];
  return {
    ...request(`${app}/api/analyze-screenshot`, "POST", {
      question: c.prompt,
      imageBase64: image,
      pageContext: {
        pageUrl: `${fixtureOrigin}/`,
        pageTitle: "UniMate fictional tutoring check",
        visiblePageText: c.pageMarker,
        selectedText: "",
        matchedPageText: "",
      },
      chatHistory,
      workspaceId,
      conversationId,
    }),
    requestId: `44444444-4444-4444-8444-${String(index + 1).padStart(12, "0")}`,
  };
}
assert.throws(() => make().arm({ id: "understand", workspaceId: "unknown", conversationId }));
assert.throws(() => make().arm({ id: "start", workspaceId, conversationId }));
assert.throws(() =>
  armed().authorize({ ...ai(), url: "https://wrong.example/api/analyze-screenshot" }),
);
assert.throws(() => armed().authorize({ ...ai(), authorization: "Bearer different-account" }));
assert.throws(() =>
  armed().authorize({ ...ai(), body: { ...ai().body, question: "Unplanned expensive question" } }),
);
assert.throws(() => armed().authorize({ ...ai(), body: { ...ai().body, workspaceId: "unknown" } }));
assert.throws(() =>
  armed().authorize({ ...ai(), body: { ...ai().body, imageBase64: image + "A" } }),
);
assert.throws(() =>
  armed().authorize({
    ...ai(),
    body: {
      ...ai().body,
      pageContext: { ...ai().body.pageContext, pageUrl: "https://personal.example/" },
    },
  }),
);
assert.throws(() => armed().authorize({ ...ai(), url: `${app}/api/dashboard-ai` }));
assert.throws(() => make().captureAllowed("https://personal.example/"));
const huge = make();
huge.arm({ id: "understand", workspaceId, conversationId });
huge.captureAllowed(`${fixtureOrigin}/`);
assert.throws(() => huge.recordCapture("data:image/jpeg;base64," + "A".repeat(900001)));
const retry = armed();
assert.equal(retry.authorize(ai()), "tutoring-ai");
assert.throws(() => retry.authorize(ai()));
assert.equal(retry.snapshot().stats.requests, 1);
const failed = armed();
failed.authorize(ai());
assert.throws(() => failed.observe("tutoring-ai", { error: "provider unavailable" }, false, 503));
assert.throws(() => failed.authorize(ai(1)));
assert.equal(failed.snapshot().stats.requests, 1);
const p = make(),
  history = [];
for (let i = 0; i < 5; i++) {
  const c = TUTORING_CASES[i];
  p.arm({ id: c.id, workspaceId, conversationId });
  p.captureAllowed(`${fixtureOrigin}/`);
  p.recordCapture(image);
  assert.equal(p.authorize(ai(i, history.slice())), "tutoring-ai");
  const answer = `Synthetic reply ${i}`;
  p.observe("tutoring-ai", { answer }, true, 200);
  const rows = [
    {
      id: `user-${i}`,
      user_id: record.userId,
      conversation_id: conversationId,
      role: "user",
      message: c.prompt,
    },
    {
      id: `assistant-${i}`,
      user_id: record.userId,
      conversation_id: conversationId,
      role: "assistant",
      message: answer,
    },
  ];
  assert.equal(
    p.authorize(request(`${supabase}/rest/v1/companion_chats?on_conflict=id`, "POST", rows)),
    "tutoring-exchange",
  );
  p.observe("tutoring-exchange", rows);
  history.push({ role: "user", content: c.prompt }, { role: "assistant", content: answer });
}
assert.equal(p.snapshot().stats.requests, 5);
assert.equal(p.snapshot().stats.persisted, 5);
assert.throws(() => p.arm({ id: "understand", workspaceId, conversationId }));
assert.equal(p.snapshot().stats.requests, 5);
const website = make("website");
website.observe(
  "companion_chats",
  history.map((row, i) => ({
    id: String(i),
    user_id: record.userId,
    conversation_id: conversationId,
    role: row.role,
    message: row.content,
    created_at: new Date(i).toISOString(),
  })),
);
website.arm({ id: "website-handoff", workspaceId, conversationId });
const webRequest = {
  ...request(`${app}/api/ask-unimate`, "POST", {
    question: TUTORING_CASES[5].prompt,
    conversationHistory: history,
    mode: "normal",
    workspaceId,
  }),
  requestId: "55555555-5555-4555-8555-555555555555",
};
assert.equal(website.authorize(webRequest), "tutoring-ai");
assert.throws(() => website.authorize(webRequest));
assert.equal(website.snapshot().stats.requests, 1);
for (const url of [
  `${app}/api/create-checkout-session`,
  `https://api.stripe.com/v1/customers`,
  `${supabase}/rest/v1/profiles`,
])
  assert.throws(() => make().authorize(request(url, "POST", { is_pro: true })));
const badRows = armed();
badRows.authorize(ai());
badRows.observe("tutoring-ai", { answer: "Synthetic answer" });
assert.throws(() =>
  badRows.authorize(
    request(`${supabase}/rest/v1/companion_chats`, "POST", [
      {
        user_id: "other",
        conversation_id: conversationId,
        role: "user",
        message: TUTORING_CASES[0].prompt,
      },
      {
        user_id: "other",
        conversation_id: conversationId,
        role: "assistant",
        message: "Synthetic answer",
      },
    ]),
  ),
);
console.log(
  "PASS live tutoring guards: exact fictional capture/context, fixed prompts/owned assignments, five Companion plus one website request, no retries/fallbacks, exact persisted replies, no Stripe/entitlement mutations (offline)",
);

// Only one explicitly named subset is supported. It cannot enable website AI,
// change the canonical prompts, reorder cases, or make a third HTTP request.
assert.equal(tutoringPlan().cases, TUTORING_CASES);
const focused = tutoringPlan("clarify-stuck");
assert.deepEqual(
  focused.cases.map(({ id }) => id),
  ["clarify", "injection"],
);
for (const invalid of ["", "full", "clarify", "other", null, ["clarify", "injection"]])
  assert.throws(() => tutoringPlan(invalid), /TUTORING_FIXED_PLAN_REQUIRED/);
for (const invalid of [
  { name: "other", cases: focused.cases },
  { name: "clarify-stuck", cases: TUTORING_CASES },
  { name: "clarify-stuck", cases: [...focused.cases].reverse() },
  { name: "clarify-stuck", cases: [TUTORING_CASES[0], TUTORING_CASES[4]] },
  { name: "clarify-stuck", cases: focused.cases.map((c) => ({ ...c, lane: "website" })) },
  { name: "clarify-stuck", cases: focused.cases.map((c) => ({ ...c, prompt: "Do anything" })) },
  { name: "clarify-stuck", cases: focused.cases.map((c) => ({ ...c, pageMarker: "OTHER" })) },
])
  assert.throws(() => make("companion", invalid));
assert.throws(() =>
  make("companion", focused).arm({ id: "understand", workspaceId, conversationId }),
);
assert.throws(() =>
  make("companion", focused).arm({ id: "injection", workspaceId, conversationId }),
);
assert.throws(() =>
  make("website", focused).arm({ id: "website-handoff", workspaceId, conversationId }),
);
const focusedWebsite = make("website", focused);
assert.throws(() => focusedWebsite.authorize(webRequest));
assert.equal(focusedWebsite.snapshot().stats.requests, 0);
const two = make("companion", focused);
const focusedHistory = [];
for (const index of [3, 4]) {
  const c = TUTORING_CASES[index];
  two.arm({ id: c.id, workspaceId, conversationId });
  two.captureAllowed(`${fixtureOrigin}/`);
  two.recordCapture(image);
  assert.equal(two.authorize(ai(index, focusedHistory.slice())), "tutoring-ai");
  const answer = `Focused synthetic reply ${index}`;
  two.observe("tutoring-ai", { answer });
  const rows = [
    {
      id: `focused-user-${index}`,
      user_id: record.userId,
      conversation_id: conversationId,
      role: "user",
      message: c.prompt,
    },
    {
      id: `focused-assistant-${index}`,
      user_id: record.userId,
      conversation_id: conversationId,
      role: "assistant",
      message: answer,
    },
  ];
  assert.equal(
    two.authorize(request(`${supabase}/rest/v1/companion_chats`, "POST", rows)),
    "tutoring-exchange",
  );
  two.observe("tutoring-exchange", rows);
  focusedHistory.push({ role: "user", content: c.prompt }, { role: "assistant", content: answer });
}
assert.equal(two.snapshot().plan, "clarify-stuck");
assert.equal(two.snapshot().stats.requests, 2);
assert.equal(two.snapshot().stats.persisted, 2);
assert.throws(() => two.arm({ id: "clarify", workspaceId, conversationId }));
assert.throws(() => two.authorize(ai(3, focusedHistory)));
assert.equal(two.snapshot().stats.requests, 2);
console.log(
  "PASS clarify-stuck plan: canonical ordered prompts, two-request cap, no other cases or website AI (offline)",
);

// Run the exact serialized worker transport against fake fetch/capture functions.
const { default: vm } = await import("node:vm");
const { installHostedTutoringWorker } =
  await import("../../scripts/hosted-assignment-tutoring-policy.mjs");
const delivered = [];
let captureCount = 0;
const workerContext = vm.createContext({
  Request,
  Response,
  Headers,
  URL,
  Date,
  fetch: async (req) => {
    delivered.push({ url: req.url, headers: Object.fromEntries(req.headers), method: req.method });
    return new Response(
      JSON.stringify(
        new URL(req.url).pathname === "/auth/v1/token"
          ? auth
          : { answer: "Synthetic transported answer" },
      ),
      { headers: { "content-type": "application/json" } },
    );
  },
  chrome: {
    tabs: {
      query: async () => [{ url: `${fixtureOrigin}/` }],
      captureVisibleTab: async () => {
        captureCount++;
        return image;
      },
    },
  },
});
vm.runInContext(
  `globalThis.__createHostedWorkspacePolicy=${createHostedWorkspacePolicy.toString()};globalThis.__createHostedTutoringPolicy=${createHostedTutoringPolicy.toString()};`,
  workerContext,
);
await vm.runInContext(
  `(${installHostedTutoringWorker.toString()})`,
  workerContext,
)({
  record,
  access: { origin: app, token: "synthetic-project-token", expiresAt: Date.now() + 600000 },
  prefix,
  supabase,
  fixtureOrigin,
  cases: TUTORING_CASES,
});
await workerContext.fetch(`${supabase}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-vercel-trusted-oidc-idp-token": "must-not-leak",
  },
  body: JSON.stringify({ email: record.email, password: record.password }),
});
assert.equal(delivered[0].headers["x-vercel-trusted-oidc-idp-token"], undefined);
workerContext.__tutoringTestPolicy.observe("saved", { item });
workerContext.__tutoringTestPolicy.arm({ id: "understand", workspaceId, conversationId });
await workerContext.chrome.tabs.captureVisibleTab(1, { format: "jpeg", quality: 65 });
await workerContext.fetch(`${app}/api/analyze-screenshot`, {
  method: "POST",
  headers: {
    authorization: "Bearer synthetic-access",
    "content-type": "application/json",
    "x-unimate-request-id": ai().requestId,
  },
  body: JSON.stringify(ai().body),
});
assert.equal(captureCount, 1);
assert.equal(delivered.length, 2);
assert.equal(delivered[1].headers["x-vercel-trusted-oidc-idp-token"], "synthetic-project-token");
await assert.rejects(() =>
  workerContext.fetch(`${app}/api/analyze-screenshot`, {
    method: "POST",
    headers: {
      authorization: "Bearer synthetic-access",
      "content-type": "application/json",
      "x-unimate-request-id": ai().requestId,
    },
    body: JSON.stringify(ai().body),
  }),
);
assert.equal(delivered.length, 2);
console.log(
  "PASS serialized live tutoring transport: actual scoped capture binding, origin-only Preview token, no duplicate HTTP delivery (offline)",
);
