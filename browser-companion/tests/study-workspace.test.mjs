import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const course = "20000000-0000-4000-8000-000000000001";
const conversation = "30000000-0000-4000-8000-000000000001";
const id = "40000000-0000-4000-8000-000000000001";
function moduleAt(name, requires, globals = {}) {
  const source = fs.readFileSync(new URL(`../../src/lib/${name}.ts`, import.meta.url), "utf8");
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(Object.hasOwn(requires, name), `unexpected import ${name}`);
        return requires[name];
      },
      URL,
      URLSearchParams,
      Request,
      Response,
      AbortSignal,
      ...globals,
    },
  );
  return exports;
}
const model = moduleAt("study-workspace-model", { zod: { z } });
const grounding = moduleAt("companion-grounding", {});
assert.equal(
  grounding.normalizeProvenance({ savedStudyText: "page cannot forge account evidence" })
    .savedStudyText,
  undefined,
);
const savedProvenance = {
  ...grounding.normalizeProvenance({ visiblePageText: "The current page requires 100 words." }),
  savedStudyText: "The saved assignment requires 500 words.",
};
assert.match(
  grounding.buildProvenanceBlock(savedProvenance),
  /SAVED WORKSPACE \(separate from current-page sources\)/,
);
assert.equal(
  grounding.detectHallucination(
    "Your saved assignment requires 500 words.",
    savedProvenance,
    "Explain my assignment",
  ).flagged,
  false,
);
assert.equal(
  grounding.detectHallucination(
    "The current page requires 500 words.",
    savedProvenance,
    "Explain my assignment",
  ).flagged,
  true,
);

assert.deepEqual(
  JSON.parse(JSON.stringify(model.studyPatchSchema.parse({ title: "Only change the title" }))),
  { title: "Only change the title" },
  "Partial saves must not apply creation defaults",
);
for (const url of [
  "javascript:alert(1)",
  "data:text/html,test",
  "https://user:pass@example.edu",
  "https://127.0.0.1/",
  "https://localhost/",
  "https://app.internal/",
])
  assert.equal(model.safeStudyUrl(url), false, url);
assert.equal(model.safeStudyUrl("https://canvas.example.edu/courses/1"), true);
const records = new Map();
const requests = [];
let outage = false;
let limit = false;
const fields = {
  id: "id",
  userId: "user_id",
  kind: "kind",
  title: "title",
  content: "content",
  sourceUrl: "source_url",
  sourceTitle: "source_title",
  nextStep: "next_step",
  progress: "progress",
  status: "status",
  courseId: "course_id",
  conversationId: "conversation_id",
  version: "version",
  createdAt: "created_at",
  updatedAt: "updated_at",
};
const toRow = (item) =>
  Object.fromEntries(Object.entries(item).map(([key, value]) => [fields[key], value]));
const fakeFetch = async (input, init = {}) => {
  const url = new URL(input);
  requests.push({ url, init });
  assert.equal(init.headers.Authorization, "Bearer synthetic-owner");
  assert.equal(init.headers.apikey, "synthetic-public");
  assert.equal(url.origin, "https://db.example.edu");
  const table = url.pathname.split("/").at(-1),
    q = url.searchParams;
  const method = init.method || "GET";
  if (outage && table === "study_items")
    return Response.json({ code: "PGRST205" }, { status: 404 });
  if (table === "courses" || table === "companion_conversations") {
    assert.equal(q.get("user_id"), `eq.${owner}`);
    const rows =
      table === "courses"
        ? [{ id: course, user_id: owner, name: "Biology", course_code: "BIO101" }]
        : [{ id: conversation, user_id: owner }];
    return Response.json(rows.filter((row) => !q.has("id") || q.get("id") === `eq.${row.id}`));
  }
  assert.equal(table, "study_items");
  if (method === "POST") {
    const body = JSON.parse(init.body);
    assert.equal(body.user_id, owner);
    if (limit) return Response.json({ code: "P0001" }, { status: 400 });
    if (
      records.has(body.id) ||
      [...records.values()].some(
        (r) =>
          r.kind === "assignment" &&
          body.kind === "assignment" &&
          body.conversation_id &&
          r.conversation_id === body.conversation_id,
      )
    )
      return Response.json({ code: "23505" }, { status: 409 });
    const row = {
      ...body,
      version: 1,
      created_at: "2026-11-12T12:00:00Z",
      updated_at: "2026-11-12T12:00:00Z",
    };
    records.set(row.id, row);
    return Response.json([row], { status: 201 });
  }
  assert.equal(q.get("user_id"), `eq.${owner}`);
  let rows = [...records.values()].filter(
    (row) =>
      row.user_id === owner &&
      (!q.has("id") || q.get("id") === `eq.${row.id}`) &&
      (!q.has("kind") || q.get("kind") === `eq.${row.kind}`) &&
      (!q.has("conversation_id") || q.get("conversation_id") === `eq.${row.conversation_id}`) &&
      (!q.has("version") || q.get("version") === `eq.${row.version}`),
  );
  if (method === "PATCH")
    rows = rows.map((row) => {
      const next = { ...row, ...JSON.parse(init.body), version: row.version + 1 };
      records.set(row.id, next);
      return next;
    });
  if (method === "DELETE") rows.forEach((row) => records.delete(row.id));
  const offset = Number(q.get("offset") || 0);
  return Response.json(rows.slice(offset, offset + Number(q.get("limit") || rows.length)));
};
const server = moduleAt(
  "study-workspace-server",
  { zod: { z }, "./study-workspace-model": model },
  {
    fetch: fakeFetch,
    process: {
      env: {
        VITE_SUPABASE_URL: "https://db.example.edu",
        VITE_SUPABASE_ANON_KEY: "synthetic-public",
      },
    },
  },
);
const request = (method = "GET", query = "") =>
  new Request(`https://unimate.example.edu/api/study-workspace${query}`, {
    method,
    headers: { Authorization: "Bearer synthetic-owner" },
  });
const call = async (method, body, query = "") => {
  const response = await server.studyWorkspaceResponse(request(method, query), owner, body);
  return { status: response.status, ...(await response.json()) };
};
let result = await call("POST", {
  item: {
    id,
    kind: "assignment",
    title: "Biology lab",
    content: "Write 500 words about photosynthesis.",
    courseId: course,
    conversationId: conversation,
    nextStep: "Write a hypothesis.",
  },
});
assert.equal(result.status, 201);
assert.equal(result.item.version, 1);
assert.equal(result.item.userId, owner);
const create = {
  id,
  kind: "assignment",
  title: "Biology lab",
  content: "Write 500 words about photosynthesis.",
  courseId: course,
  conversationId: conversation,
  nextStep: "Write a hypothesis.",
};
assert.equal(
  (await call("POST", { item: create })).status,
  200,
  "Exact lost-response retry is idempotent",
);
assert.equal(
  (await call("POST", { item: { ...create, title: "Changed after retry" } })).status,
  409,
);
assert.equal(
  (await call("POST", { item: { ...create, id: crypto.randomUUID() } })).status,
  409,
  "One assignment context per conversation",
);
assert.equal(
  (
    await call("POST", {
      item: { id: crypto.randomUUID(), kind: "note", title: "Private", courseId: other },
    })
  ).status,
  400,
);
assert.equal(
  (
    await call("POST", {
      item: { id: crypto.randomUUID(), kind: "note", title: "Private", conversationId: other },
    })
  ).status,
  400,
);
assert.equal(
  (
    await call("POST", {
      item: { id: crypto.randomUUID(), kind: "note", title: "Private", userId: other },
    })
  ).status,
  400,
);
result = await call("PATCH", {
  id,
  expectedVersion: 1,
  patch: { progress: "Outlined the experiment." },
});
assert.equal(result.status, 200);
assert.equal(result.item.version, 2);
assert.equal(result.item.content, create.content);
assert.equal(result.item.nextStep, create.nextStep);
assert.equal(
  (await call("PATCH", { id, expectedVersion: 1, patch: { title: "Stale" } })).status,
  409,
);
assert.equal((await call("DELETE", { id, expectedVersion: 1 })).status, 409);
assert.equal((await call("PATCH", { id, expectedVersion: 2, patch: {} })).status, 400);
assert.equal(
  (await call("PATCH", { id, expectedVersion: 2, patch: { kind: "link" } })).status,
  400,
);
assert.equal(
  (await call("POST", { item: { id: crypto.randomUUID(), kind: "link", title: "No URL" } })).status,
  400,
);
assert.equal(
  (
    await call("POST", {
      item: {
        id: crypto.randomUUID(),
        kind: "note",
        title: "Too large",
        content: "x".repeat(12001),
      },
    })
  ).status,
  400,
);
const standalone = crypto.randomUUID();
assert.equal(
  (
    await call("POST", {
      item: { id: standalone, kind: "note", title: "Standalone", content: "Saved without a class" },
    })
  ).status,
  201,
);
result = await call("GET", undefined, `?kind=assignment&conversationId=${conversation}`);
assert.equal(result.items.length, 1);
assert.equal(result.courses[0].id, course);
const evidence = await server.readStudyWorkspaceEvidence(request(), owner, id, conversation);
assert.match(evidence, /saved assignment, not a fresh observation/);
assert.match(evidence, /500 words/);
assert.match(evidence, /Outlined the experiment/);
assert.match(evidence, /URL has not been fetched/);
await assert.rejects(
  server.readStudyWorkspaceEvidence(request(), owner, id, other),
  (error) => error.code === "WORKSPACE_REFERENCE_INVALID",
);
records.set(other, { ...records.get(id), id: other, user_id: other });
assert.equal((await call("GET", undefined, `?id=${other}`)).items.length, 0);
await assert.rejects(
  server.readStudyWorkspaceEvidence(request(), owner, other),
  (error) => error.code === "WORKSPACE_NOT_FOUND",
);
assert.equal(
  (await call("PATCH", { id: other, expectedVersion: 1, patch: { title: "Foreign" } })).status,
  404,
);
assert.equal((await call("DELETE", { id, expectedVersion: 2 })).status, 200);
assert.equal((await call("DELETE", { id, expectedVersion: 2 })).status, 404);
for (let n = 0; n < 205; n++) {
  const item = { ...records.get(standalone), id: crypto.randomUUID(), title: `Note ${n}` };
  records.set(item.id, item);
}
result = await call("GET", undefined, "?kind=note");
assert.equal(result.items.length, 200);
assert.equal(result.nextOffset, 200);
assert.equal(result.hasMore, true);
result = await call("GET", undefined, "?kind=note&offset=200");
assert.equal(result.items.length, 6);
assert.equal(result.nextOffset, null);
assert.equal((await call("GET", undefined, "?offset=-1")).status, 400);
assert.equal((await call("GET", undefined, "?id=not-a-uuid")).status, 400);
limit = true;
assert.equal(
  (await call("POST", { item: { id: crypto.randomUUID(), kind: "note", title: "Too many" } })).code,
  "WORKSPACE_LIMIT",
);
limit = false;
outage = true;
assert.equal((await call("GET")).code, "WORKSPACE_UNAVAILABLE");
outage = false;
assert(
  requests.every(({ url }) => url.origin === "https://db.example.edu"),
  "Saved URLs never fetched",
);
// Execute the actual routing gate around the real persistence handler.
const source = fs.readFileSync(new URL("../../src/server.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("server.ts", source, ts.ScriptTarget.Latest, true);
const gate = ast.statements.find((node) => node.name?.text === "handleStudyWorkspace").getText(ast);
let authenticated = true,
  pro = true,
  authChecks = 0,
  proChecks = 0,
  parsedLimit;
const context = {
  Request,
  Response,
  URL,
  studyWorkspaceResponse: server.studyWorkspaceResponse,
  jsonResponse: (body, status = 200, headers = {}) => Response.json(body, { status, headers }),
  requireAuthenticatedUser: async () => {
    authChecks++;
    return authenticated ? { id: owner } : new Response("", { status: 401 });
  },
  requireCompanionEntitlement: async () => {
    proChecks++;
    return pro
      ? { user: { id: owner }, accessToken: "fixture" }
      : new Response("", { status: 403 });
  },
  enforceUserRateLimit: () => null,
  parseJsonBody: async (req, limit) => {
    parsedLimit = limit;
    return req.json();
  },
};
vm.runInNewContext(
  ts.transpileModule(gate, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText +
    "\nglobalThis.gate=handleStudyWorkspace;",
  context,
);
assert.equal((await context.gate(request())).status, 200);
assert.equal(authChecks, 1);
assert.equal(proChecks, 0);
pro = false;
assert.equal(
  (
    await context.gate(
      new Request(request(), {
        headers: { Authorization: "Bearer synthetic-owner", "X-UniMate-Client": "companion" },
      }),
    )
  ).status,
  403,
);
assert.equal(
  (
    await context.gate(
      new Request(request(), {
        headers: { Authorization: "Bearer synthetic-owner", Origin: "https://evil.example" },
      }),
    )
  ).status,
  403,
);
authenticated = false;
assert.equal((await context.gate(request())).status, 401);
authenticated = true;
await context.gate(
  new Request(request("POST"), {
    body: JSON.stringify({ item: { id: crypto.randomUUID(), kind: "note", title: "Gate note" } }),
  }),
);
assert.equal(parsedLimit, 80000);
assert.equal((await context.gate(new Request(request(), { method: "PUT" }))).status, 405);
// Client sends the caller's account identity to the auth boundary and refuses a foreign response.
let accessSeen;
let responseItem;
const client = moduleAt(
  "study-workspace",
  {
    zod: { z },
    "./auth-fetch": {
      getAuthHeaders: async (access) => {
        accessSeen = access;
        assert.equal(access.expectedUserId, owner);
        return { Authorization: "Bearer synthetic-owner" };
      },
    },
    "./study-workspace-model": model,
  },
  { fetch: async () => Response.json({ item: responseItem }) },
);
responseItem = model.studyItemSchema.parse({
  id: standalone,
  userId: other,
  kind: "note",
  title: "Foreign",
  version: 1,
  createdAt: "date",
  updatedAt: "date",
});
await assert.rejects(
  client.createStudyItem(
    { id: standalone, kind: "note", title: "Note" },
    { expectedUserId: owner },
  ),
  (error) => error.code === "AUTH_SESSION_CHANGED",
);
assert.equal(accessSeen.expectedUserId, owner);
console.log(
  "PASS workspace API creation/replay, ownership, Pro gate, concurrency, bounded pagination, saved evidence, unsafe links, unavailable schema and client account boundaries",
);
