import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../content.js", import.meta.url), "utf8");
const section = source.slice(
  source.indexOf("  function chooseStudyPrompt("),
  source.indexOf("  async function retrySaving("),
);
const plain = (value) => JSON.parse(JSON.stringify(value));
const assignment = {
  userId: "10000000-0000-4000-8000-000000000001",
  id: "30000000-0000-4000-8000-000000000001",
  kind: "assignment",
  title: "Biology report",
  content: "Explain photosynthesis using one source.",
  sourceUrl: "https://course.test/report",
  sourceTitle: "Biology",
  nextStep: "Find one source",
  progress: "Read the rubric",
  status: "active",
  courseId: null,
  conversationId: "20000000-0000-4000-8000-000000000001",
  version: 1,
};
function contentHarness() {
  const events = [];
  const handlers = new Map();
  const nodes = new Map();
  const body = {
    innerHTML: "",
    querySelector(selector) {
      if (!nodes.has(selector))
        nodes.set(selector, {
          focus() {
            events.push(["focus", selector]);
          },
          addEventListener(type, fn) {
            handlers.set(`${selector}:${type}`, fn);
          },
        });
      return nodes.get(selector);
    },
    querySelectorAll() {
      return [];
    },
  };
  const state = {
    busy: false,
    workspaceBusy: false,
    workspaceDraft: null,
    workspaceItem: null,
    workspaceItems: [],
    workspaceCourses: [],
    workspaceNextOffset: null,
    workspaceLoadVersion: 0,
    sessionVersion: 1,
    draft: "",
    messages: [{ role: "assistant", message: "Here is a suggested first step." }],
    activeConversationId: assignment.conversationId,
  };
  const context = vm.createContext({
    state,
    body,
    crypto,
    URL,
    Object,
    document: { title: "Biology report" },
    location: { href: "https://course.test/report?lesson=1&access_token=do-not-save#private" },
    escapeHtml: (s) =>
      String(s)
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;"),
    renderChat: (message, error) => events.push(["chat", message, error]),
    handleAccessRequired: () => false,
    extractContext: () => ({
      highlightedText: "Explain photosynthesis using one source.",
      visiblePageText: "Longer page sample",
      pageTitle: "Biology assignment",
    }),
    send: async (request) => {
      events.push(["request", plain(request)]);
      if (request.type === "LOAD_STUDY_WORKSPACE") return { items: [], courses: [] };
      if (request.type === "PRIVACY_CONSENT_STATE") return { accepted: true };
      if (request.type === "SAVE_STUDY_ITEM") return { item: { ...request.item, version: 1 } };
      if (request.type === "SELECT_STUDY_CONVERSATION")
        return {
          conversationId: assignment.conversationId,
          conversationTitle: assignment.title,
          messages: [{ role: "assistant", message: "Earlier work" }],
          workspaceItem: assignment,
        };
      return {};
    },
  });
  vm.runInContext(
    `${section}\nglobalThis.api = { chooseStudyPrompt, studyPageUrl, openStudyWorkspace, saveStudyDraft, selectStudyChat, renderStudyEditor, useStudyPageText, loadMoreStudyWork };`,
    context,
  );
  return { state, context, events, handlers, body, api: context.api };
}

{
  const h = contentHarness();
  h.api.chooseStudyPrompt("understand");
  assert.match(h.state.draft, /what I need to hand in/);
  assert.equal(
    h.events.filter(([type]) => type === "request").length,
    0,
    "Starter clicks never capture or call AI",
  );
  const draft = h.state.draft;
  h.api.chooseStudyPrompt("start");
  assert.equal(h.state.draft, draft, "Existing composer work is preserved");
  h.state.draft = "";
  h.api.chooseStudyPrompt("start");
  assert.match(h.state.draft, /15 minutes/);
  assert.equal(
    h.api.studyPageUrl(),
    "https://course.test/report?lesson=1",
    "Source links omit credential parameters and fragments",
  );
}

{
  const h = contentHarness();
  h.state.draft = "My unsent question";
  await h.api.openStudyWorkspace("note");
  assert.equal(h.state.workspaceDraft.content, "Here is a suggested first step.");
  assert.equal(h.state.workspaceDraft.courseId, null, "Saving does not require a class");
  assert.equal(
    h.state.workspaceDraft.sourceUrl,
    "",
    "An earlier answer is never attributed to the currently open tab",
  );
  assert.equal(
    h.events.filter(([, r]) => r?.type === "SAVE_STUDY_ITEM").length,
    0,
    "The suggested note requires review and explicit Save",
  );
  h.handlers.get(".um-study-form:input")({
    target: { name: "content", value: "My reviewed note" },
  });
  const id = h.state.workspaceDraft.id;
  h.handlers.get(".um-work-back:click")();
  await h.api.openStudyWorkspace("link");
  assert.equal(
    h.state.workspaceDraft.id,
    id,
    "Opening another save action cannot discard unfinished edits",
  );
  await h.api.saveStudyDraft({ preventDefault() {} });
  const request = h.events.find(([, r]) => r?.type === "SAVE_STUDY_ITEM")[1];
  assert.equal(request.item.content, "My reviewed note");
  assert.equal(h.state.draft, "My unsent question");
  assert.equal(h.state.workspaceDraft, null);
  assert.match(h.events.at(-1)[1], /Saved to Notes/);
}

{
  const h = contentHarness();
  h.state.workspaceDraft = { ...assignment };
  h.context.send = async (request) => {
    h.events.push(["request", plain(request)]);
    throw Object.assign(new Error("Newer version exists"), { code: "WORKSPACE_CONFLICT" });
  };
  await h.api.saveStudyDraft({ preventDefault() {} });
  assert.equal(h.state.workspaceDraft.nextStep, "Find one source");
  assert.equal(h.state.workspaceBusy, false);
  assert.match(h.body.innerHTML, /changed elsewhere/);
  assert.equal(h.events[0][1].expectedVersion, 1);
  assert.equal(
    h.events.some(([name, text]) => name === "chat" && /Saved\./.test(text)),
    false,
  );
}

{
  const h = contentHarness();
  let resolve;
  h.context.send = () =>
    new Promise((r) => {
      resolve = r;
    });
  h.state.workspaceDraft = { ...assignment };
  const save = h.api.saveStudyDraft({ preventDefault() {} });
  h.state.sessionVersion += 1;
  h.state.workspaceDraft = null;
  resolve({ item: assignment });
  await save;
  assert.equal(h.state.workspaceItem, null, "A late save cannot populate a different account");
  assert.equal(
    h.events.some(([name]) => name === "chat"),
    false,
  );
}

{
  const h = contentHarness();
  h.state.draft = "Keep this question";
  await h.api.selectStudyChat(assignment.conversationId);
  assert.equal(h.events.length, 0, "Switching assignments is blocked while a draft is unfinished");
  h.state.draft = "";
  await h.api.selectStudyChat(assignment.conversationId);
  assert.equal(h.state.workspaceItem.nextStep, "Find one source");
  assert.equal(h.state.messages[0].message, "Earlier work");
  h.api.chooseStudyPrompt("continue");
  assert.match(h.state.draft, /saved progress and next step/);
}

// Execute the real worker protocol with synthetic storage and HTTP transport.
{
  const h = contentHarness();
  await h.api.openStudyWorkspace("assignment");
  await h.api.useStudyPageText();
  assert.equal(h.state.workspaceDraft.content, "Explain photosynthesis using one source.");
  assert.match(h.state.workspaceDraft.pageTextNotice, /highlighted text/);
  assert.equal(
    h.events.some(([, r]) => r?.type === "SAVE_STUDY_ITEM" || r?.type === "SEND_CHAT"),
    false,
    "Page text is only put into the review form",
  );
  h.state.workspaceDraft.content = "My own instructions";
  await h.api.useStudyPageText();
  assert.equal(h.state.workspaceDraft.content, "My own instructions");
  h.state.workspaceDraft.content = "";
  h.context.send = async () => ({ accepted: false });
  let extracted = false;
  h.context.extractContext = () => {
    extracted = true;
    return {};
  };
  await h.api.useStudyPageText();
  assert.equal(extracted, false, "Consent revocation prevents page extraction");
  assert.match(h.body.innerHTML, /Page sharing is off/);
}
{
  const h = contentHarness();
  h.state.messages[0].message = "A".repeat(12001);
  await h.api.openStudyWorkspace("note");
  assert.equal(
    h.state.workspaceDraft.content.length,
    12001,
    "Long answers are kept for review, never silently truncated",
  );
  await h.api.saveStudyDraft({ preventDefault() {} });
  assert.equal(
    h.events.some(([, r]) => r?.type === "SAVE_STUDY_ITEM"),
    false,
  );
  assert.match(h.body.innerHTML, /Shorten it to 12,000/);
}
{
  const h = contentHarness();
  h.state.workspaceItems = [assignment];
  h.state.workspaceNextOffset = 200;
  h.context.send = async (request) => {
    assert.equal(request.filters.offset, 200);
    return {
      items: [
        { ...assignment, nextStep: "Updated next step" },
        { ...assignment, id: "30000000-0000-4000-8000-000000000002" },
      ],
      nextOffset: null,
    };
  };
  await h.api.loadMoreStudyWork();
  assert.equal(h.state.workspaceItems.length, 2);
  assert.equal(h.state.workspaceItems[0].nextStep, "Updated next step");
  assert.equal(h.state.workspaceNextOffset, null);
}

{
  const h = contentHarness();
  const orphan = { ...assignment, conversationId: null, version: 4 };
  let createdId;
  let conflict = true;
  h.context.send = async (request) => {
    h.events.push(["request", plain(request)]);
    if (request.type === "SELECT_STUDY_CONVERSATION") {
      createdId ||= request.conversationId;
      assert.equal(request.conversationId, createdId, "Retry reuses the newly created chat");
      assert.equal(request.create, true);
      return { conversationId: createdId, conversationTitle: "New assignment", messages: [] };
    }
    assert.equal(request.type, "SAVE_STUDY_ITEM");
    assert.equal(request.expectedVersion, 4);
    assert.deepEqual(plain(request.item), { id: orphan.id, conversationId: createdId });
    if (conflict)
      throw Object.assign(new Error("Changed elsewhere"), { code: "WORKSPACE_CONFLICT" });
    return { item: { ...orphan, conversationId: createdId, version: 5 } };
  };
  await h.api.selectStudyChat(null, false, orphan);
  assert.equal(h.state.workspaceItem, null);
  assert.match(h.body.innerHTML, /new chat was created/);
  assert.equal(orphan.nextStep, "Find one source", "Failed attachment never alters saved progress");
  conflict = false;
  await h.api.selectStudyChat(null, false, orphan);
  assert.equal(h.state.workspaceItem.conversationId, createdId);
  assert.equal(h.state.workspaceItem.nextStep, orphan.nextStep);
  assert.equal(h.state.workspaceResume, null);
  assert.equal(
    h.events.some(([, r]) => r?.type === "SEND_CHAT"),
    false,
    "Resuming never calls AI automatically",
  );
}

const background = fs.readFileSync(new URL("../background.js", import.meta.url), "utf8");
function workerHarness() {
  let listener;
  const requests = [];
  const session = {
    access_token: "synthetic-access",
    refresh_token: "synthetic-refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "10000000-0000-4000-8000-000000000001" },
  };
  const state = {
    pro: true,
    consent: true,
    owned: true,
    workspaceStatus: 200,
    workspaceBody: null,
    pauseWorkspace: null,
  };
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    });
  const context = vm.createContext({
    URL,
    Response,
    AbortController,
    crypto,
    setTimeout,
    clearTimeout,
    importScripts() {},
    console,
    self: {
      UNIMATE_COMPANION_CONFIG: {
        SUPABASE_URL: "https://supabase.test",
        SUPABASE_ANON_KEY: "synthetic-public",
        UNIMATE_API_URL: "https://unimate.test",
      },
    },
    fetch: async (url, options = {}) => {
      const href = String(url);
      requests.push({ href, options });
      if (href.endsWith("/auth/v1/user")) return json(session.user);
      if (href.includes("/api/billing-status")) return json({ isPro: state.pro });
      if (href.includes("/api/study-workspace")) {
        if (state.pauseWorkspace) await state.pauseWorkspace;
        const body = options.body ? JSON.parse(options.body) : {};
        return json(
          state.workspaceBody ||
            (options.method === "GET"
              ? { items: [assignment], courses: [] }
              : { item: { ...assignment, ...(body.item || body.patch) } }),
          state.workspaceStatus,
        );
      }
      if (href.includes("/companion_conversations"))
        return json(
          options.method === "POST"
            ? {}
            : state.owned
              ? [{ id: assignment.conversationId, title: assignment.title }]
              : [],
        );
      if (href.includes("/companion_preferences"))
        return json(
          options.method === "POST" ? {} : [{ active_conversation_id: assignment.conversationId }],
        );
      if (href.includes("/companion_chats"))
        return json([{ role: "assistant", message: "Earlier work" }]);
      throw new Error(`Unexpected request ${href}`);
    },
    chrome: {
      storage: {
        local: {
          async get(key) {
            return key === "unimateCompanionPrivacyConsent"
              ? { unimateCompanionPrivacyConsent: { accepted: state.consent, version: 1 } }
              : { unimateCompanionSession: session };
          },
          async set() {},
          async remove() {},
        },
      },
      runtime: {
        onMessage: {
          addListener(fn) {
            listener = fn;
          },
        },
      },
      action: { onClicked: { addListener() {} } },
      tabs: {
        async query() {
          return [];
        },
        async create() {},
      },
    },
  });
  vm.runInContext(`${background}\nglobalThis.bumpEpoch = () => { sessionEpoch += 1; };`, context);
  const call = (request) =>
    new Promise((resolve) =>
      listener({ expectedUserId: assignment.userId, ...request }, {}, resolve),
    );
  return { call, state, context, requests, session };
}

{
  const h = workerHarness();
  const loaded = await h.call({ type: "LOAD_STUDY_WORKSPACE" });
  assert.equal(loaded.ok, true);
  const request = h.requests.find(({ href }) => href.includes("study-workspace"));
  assert.equal(request.options.headers.Authorization, "Bearer synthetic-access");
  assert.equal(request.options.headers["X-UniMate-Client"], "companion");
  const saved = await h.call({ type: "SAVE_STUDY_ITEM", item: assignment, expectedVersion: 1 });
  assert.equal(saved.ok, true);
  const patch = JSON.parse(h.requests.at(-1).options.body);
  assert.equal(h.requests.at(-1).options.method, "PATCH");
  assert.equal(patch.expectedVersion, 1);
  assert.equal(patch.patch.id, undefined);
  assert.equal(patch.patch.kind, undefined);
}
for (const boundary of ["pro", "consent"]) {
  const h = workerHarness();
  h.state[boundary] = false;
  const result = await h.call({ type: "SAVE_STUDY_ITEM", item: assignment });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, boundary === "pro" ? "PRO_REQUIRED" : "PRIVACY_CONSENT_REQUIRED");
  assert.equal(
    h.requests.some(({ href }) => href.includes("study-workspace")),
    false,
  );
}
for (const request of [
  { type: "LOAD_STUDY_WORKSPACE" },
  { type: "SAVE_STUDY_ITEM", item: assignment },
  { type: "SELECT_STUDY_CONVERSATION", conversationId: assignment.conversationId, create: true },
]) {
  const h = workerHarness();
  h.session.user.id = "10000000-0000-4000-8000-000000000099";
  const result = await h.call(request);
  assert.equal(
    result.errorCode,
    "AUTH_REQUIRED",
    "A stale panel cannot operate using another signed-in account",
  );
  assert.equal(
    h.requests.some(({ href }) => href.includes("study-workspace") || href.includes("/rest/v1/")),
    false,
    "Account mismatch stops before reads, writes or chat creation",
  );
}
for (const badItem of [
  { ...assignment, userId: "another-student" },
  { ...assignment, sourceUrl: "javascript:alert(1)" },
  { ...assignment, version: 0 },
]) {
  const h = workerHarness();
  h.state.workspaceBody = { items: [badItem], courses: [] };
  const result = await h.call({ type: "LOAD_STUDY_WORKSPACE" });
  assert.equal(result.ok, false, "Worker rejects unowned or malformed workspace rows");
}
{
  const h = workerHarness();
  h.state.workspaceStatus = 503;
  h.state.workspaceBody = { error: "Unavailable", code: "WORKSPACE_UNAVAILABLE" };
  const result = await h.call({ type: "LOAD_CHAT_STATE" });
  assert.equal(result.ok, true, "Chat remains usable during a separate workspace outage");
  assert.equal(result.data.workspaceItem, null);
  assert.equal(
    result.data.workspaceUnavailable,
    true,
    "Missing assignment context is disclosed to the student",
  );
}
{
  const h = workerHarness();
  h.state.workspaceStatus = 409;
  h.state.workspaceBody = { error: "Updated elsewhere", code: "WORKSPACE_CONFLICT" };
  const result = await h.call({ type: "SAVE_STUDY_ITEM", item: assignment, expectedVersion: 1 });
  assert.equal(result.errorCode, "WORKSPACE_CONFLICT");
}
{
  const h = workerHarness();
  h.state.owned = false;
  const result = await h.call({
    type: "SELECT_STUDY_CONVERSATION",
    conversationId: assignment.conversationId,
  });
  assert.equal(result.ok, false);
  assert.equal(
    h.requests.some(
      ({ href, options }) => href.includes("companion_preferences") && options.method === "POST",
    ),
    false,
    "Ownership must be verified before switching chats",
  );
}
{
  const h = workerHarness();
  let resume;
  h.state.pauseWorkspace = new Promise((resolve) => {
    resume = resolve;
  });
  const loading = h.call({ type: "LOAD_STUDY_WORKSPACE" });
  await new Promise((resolve) => setImmediate(resolve));
  h.context.bumpEpoch();
  resume();
  const result = await loading;
  assert.equal(result.ok, false, "Account change rejects a late workspace response");
}
console.log(
  "PASS Companion assignment starters, reviewed saves, standalone use, resumed progress, conflict preservation and authenticated workspace boundaries",
);
