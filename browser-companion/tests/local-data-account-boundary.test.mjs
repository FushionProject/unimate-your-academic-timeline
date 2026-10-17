import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import { z } from "zod";
import * as jsx from "react/jsx-runtime";

const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const source = (file) =>
  ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = (code) =>
  ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const execute = (code, context) => vm.runInContext(compile(code), context);
const functionNode = (ast, name) =>
  ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
const declarations = (node, ast, names) =>
  node.body.statements
    .filter(
      (statement) =>
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some((item) =>
          names.includes(item.name.getText(ast)),
        ),
    )
    .map((node) => node.getText(ast))
    .join("\n");
const effects = (node, ast) =>
  node.body.statements.filter(
    (node) =>
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(ast) === "useEffect",
  );
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const storageModule = vm.createContext({ exports: {}, crypto });
execute(read("src/lib/syllabus-results.ts"), storageModule);
const { syllabusResultStorageKey: key } = storageModule.exports;
assert.notEqual(key("student-A", "draft"), key("student-B", "draft"));
assert.notEqual(key("a:b", "c"), key("a", "b:c"));
assert.equal(key(undefined, "draft"), null);
assert.equal(key("student-A", undefined), null);
assert.notEqual(key("student-A", "draft"), "unimateSyllabusResult:draft");

// Execute the actual wrappers: account changes remount private editors, while
// same-account token refresh retains the same component key and unsaved work.
for (const [file, name, childName] of [
  ["src/routes/notes.tsx", "NotesRoute", "Notes"],
  ["src/routes/planner.tsx", "PlannerRoute", "Planner"],
  ["src/routes/results.tsx", "ResultsRoute", "Results"],
]) {
  const ast = source(file);
  const ProtectedRoute = () => null;
  let user = { id: "student-A" };
  const context = vm.createContext({
    require: () => jsx,
    exports: {},
    useAuth: () => ({ user }),
    Route: { useSearch: () => ({ resultId: "draft" }) },
    ProtectedRoute,
    [childName]: () => null,
  });
  execute(`${functionNode(ast, name).getText(ast)}\nglobalThis.route = ${name};`, context);
  const first = context.route();
  assert.equal(first.type, ProtectedRoute, `${name} must be behind authentication`);
  const firstKey = first.props.children.key;
  user = { id: "student-A", accessToken: "refreshed" };
  assert.equal(context.route().props.children.key, firstKey);
  user = { id: "student-B" };
  assert.notEqual(context.route().props.children.key, firstKey);
  user = null;
  assert.notEqual(context.route().props.children.key, firstKey);
}
{
  const ast = source("src/components/protected-route.tsx");
  const privateChild = { marker: "private draft" };
  let auth;
  const context = vm.createContext({
    require: () => jsx,
    exports: {},
    useAuth: () => auth,
    useEffect: () => {},
    useNavigate: () => () => {},
    Loader2: () => null,
  });
  execute(
    `${functionNode(ast, "ProtectedRoute").getText(ast)}\nglobalThis.route = ProtectedRoute;`,
    context,
  );
  for (const state of [
    { loading: true, user: null },
    { loading: true, user: { id: "A" } },
    { loading: false, user: null },
  ]) {
    auth = state;
    assert.notEqual(context.route({ children: privateChild }).props.children, privateChild);
  }
  auth = { loading: false, user: { id: "A" } };
  assert.equal(context.route({ children: privateChild }).props.children, privateChild);
}

// Run production Notes hooks with React-style queued setters: the load effect
// cannot change the later save effect's closed-over values within the same render.
{
  const ast = source("src/routes/notes.tsx"),
    notes = functionNode(ast, "Notes");
  const stateNames = notes.body.statements.flatMap((statement) =>
    ts.isVariableStatement(statement)
      ? [...statement.declarationList.declarations]
          .filter(
            (decl) =>
              decl.initializer &&
              ts.isCallExpression(decl.initializer) &&
              decl.initializer.expression.getText(ast) === "useState",
          )
          .map((decl) => decl.name.elements[0].getText(ast))
      : [],
  );
  const stored = new Map(),
    writes = [],
    slots = [],
    pending = new Map(),
    previousDeps = [];
  let user = { id: "student-A" },
    index,
    effectIndex,
    work,
    getFails = false,
    setFails = false;
  const localStorage = {
    getItem: (key) => {
      if (getFails) throw new Error("storage blocked");
      return stored.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (setFails) throw new Error("quota");
      writes.push([key, value]);
      stored.set(key, value);
    },
  };
  const hooks = {
    useState: (initial) => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
      return [
        slots[slot],
        (value) =>
          pending.set(
            slot,
            typeof value === "function"
              ? value(pending.has(slot) ? pending.get(slot) : slots[slot])
              : value,
          ),
      ];
    },
    useEffect: (callback, deps) => {
      const slot = effectIndex++;
      if (!previousDeps[slot] || deps.some((v, i) => v !== previousDeps[slot][i]))
        work.push(callback);
      previousDeps[slot] = deps;
    },
  };
  const context = vm.createContext({
    exports: {},
    localStorage,
    window: { confirm: () => true },
    require: (name) =>
      name === "react"
        ? hooks
        : name === "react/jsx-runtime"
          ? jsx
          : name === "@tanstack/react-router"
            ? { createFileRoute: () => (options) => options }
            : name.endsWith("auth-context")
              ? { useAuth: () => ({ user }) }
              : name.endsWith("courses")
                ? { useCourses: () => ({ data: [] }) }
                : new Proxy({}, { get: () => () => null }),
  });
  execute(`${read("src/routes/notes.tsx")}\nglobalThis.notes = Notes;`, context);
  const render = () => {
    index = 0;
    effectIndex = 0;
    work = [];
    const view = context.notes();
    for (const effect of work) effect();
    return view;
  };
  const flush = () => {
    for (const [slot, value] of pending) slots[slot] = value;
    pending.clear();
  };
  const state = (name) => slots[stateNames.indexOf(name)];
  const privateNote = {
    id: "note-A",
    title: "Private A",
    body: "Private coursework A",
    tags: [],
    pinned: false,
    updatedAt: "2026-10-16",
  };
  stored.set("unimateNotes:student-A", JSON.stringify([privateNote]));
  stored.set("unimateNotes:student-B", "[]");
  render();
  flush();
  render();
  flush();
  assert.equal(state("body"), privateNote.body);
  slots[stateNames.indexOf("title")] = "Unsent title edit";
  user = { id: "student-A", accessToken: "refreshed" };
  render();
  flush();
  assert.equal(
    state("title"),
    "Unsent title edit",
    "Same-account refresh preserves unsaved editor text",
  );
  const before = writes.length;
  user = { id: "student-B" };
  render();
  assert.equal(writes.length, before, "Do not write A's closed-over notes under B's key");
  flush();
  render();
  flush();
  assert.equal(state("body"), "");
  assert.equal(state("title"), "");
  assert.equal(state("selectedNoteId"), null);
  assert.equal(stored.get("unimateNotes:student-B"), "[]");
  assert.ok(
    writes
      .filter(([key]) => key === "unimateNotes:student-B")
      .every(([, value]) => !value.includes("Private A")),
  );
  user = { id: "student-C" };
  stored.set("unimateNotes:student-C", "{broken");
  render();
  flush();
  render();
  flush();
  assert.equal(
    stored.get("unimateNotes:student-C"),
    "{broken",
    "Unreadable notes must not be overwritten with []",
  );
  assert.match(state("storageError"), /have not been replaced/);
  for (const [userId, value] of [
    ["student-object", '{"private":"keep me"}'],
    ["student-null", "null"],
  ]) {
    user = { id: userId };
    stored.set(`unimateNotes:${userId}`, value);
    render();
    flush();
    render();
    flush();
    assert.equal(stored.get(`unimateNotes:${userId}`), value);
    assert.match(state("storageError"), /have not been replaced/);
  }
  getFails = true;
  user = { id: "student-D" };
  render();
  flush();
  render();
  flush();
  assert.equal(stored.has("unimateNotes:student-D"), false);
  getFails = false;
  user = { id: "student-A" };
  render();
  flush();
  setFails = true;
  render();
  flush();
  assert.match(state("storageError"), /only in this tab/);
  setFails = false;
  const find = (value, predicate) =>
    !value || typeof value !== "object"
      ? null
      : Array.isArray(value)
        ? value.map((item) => find(item, predicate)).find(Boolean)
        : predicate(value)
          ? value
          : find(value.props?.children, predicate);
  const saveButton = find(
    render(),
    (node) =>
      node.type === "button" &&
      node.props.children?.some?.((child) => typeof child === "string" && child.trim() === "Save"),
  );
  assert.ok(saveButton);
  saveButton.props.onClick();
  flush();
  render();
  flush();
  assert.equal(state("storageError"), "");
  assert.equal(state("saveStatus"), "Saved");
  assert.equal(JSON.parse(stored.get("unimateNotes:student-A"))[0].body, privateNote.body);
}

// Execute Results' actual load/save effects against separate account keys.
{
  const ast = source("src/routes/results.tsx"),
    component = functionNode(ast, "Results");
  const load = effects(component, ast).find((node) =>
    node.getText(ast).includes("storedResultSchema.parse"),
  );
  const save = effects(component, ast).find((node) =>
    node.getText(ast).includes("const stored = writeBrowserStorage"),
  );
  const top = ast.statements.filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((decl) =>
        ["itemSchema", "storedResultSchema"].includes(decl.name.getText(ast)),
      ),
  );
  const stored = new Map(),
    writes = [],
    view = {};
  const context = vm.createContext({
    exports: {},
    z,
    crypto,
    useEffect: (callback) => callback(),
    sessionStorage: { getItem: (key) => stored.get(key) ?? null },
    writeBrowserStorage: (_get, key, value) => {
      writes.push(key);
      stored.set(key, value);
      return true;
    },
    ...Object.fromEntries(
      [
        "Items",
        "CourseName",
        "CourseCode",
        "SyllabusText",
        "DraftAvailable",
        "DraftWarning",
        "ReviewLoaded",
      ].map((name) => [
        `set${name}`,
        (value) => {
          view[name] = value;
        },
      ]),
    ),
  });
  execute(top.map((node) => node.getText(ast)).join("\n"), context);
  const draft = {
    userId: "student-A",
    items: [{ title: "Private assignment", type: "exam", due_date: "2026-11-01" }],
    syllabusText: "Private syllabus A",
  };
  stored.set(key("student-A", "draft"), JSON.stringify(draft));
  stored.set("unimateSyllabusResult:draft", JSON.stringify({ ...draft, userId: undefined }));
  for (const userId of ["student-A", "student-B"]) {
    for (const field of Object.keys(view)) delete view[field];
    context.user = { id: userId };
    context.storageKey = key(userId, "draft");
    execute(load.getText(ast), context);
    assert.equal(view.DraftAvailable, userId === "student-A" ? true : undefined);
    if (userId === "student-A") assert.equal(view.SyllabusText, draft.syllabusText);
    else assert.equal(view.SyllabusText, undefined);
  }
  stored.set(key("student-B", "draft"), JSON.stringify(draft));
  execute(load.getText(ast), context);
  assert.match(view.DraftWarning, /couldn’t open/);
  assert.equal(view.SyllabusText, undefined, "Mismatched owner fields must fail closed");
  Object.assign(context, {
    user: { id: "student-A" },
    storageKey: key("student-A", "draft"),
    draftAvailable: true,
    saved: false,
    items: draft.items,
    syllabusText: draft.syllabusText,
    courseName: "A course",
    courseCode: "A101",
  });
  execute(save.getText(ast), context);
  assert.equal(JSON.parse(stored.get(key("student-A", "draft"))).userId, "student-A");
  assert.deepEqual(writes, [key("student-A", "draft")]);
  assert.ok(
    stored.has("unimateSyllabusResult:draft"),
    "Never remove or adopt the legacy ownerless draft",
  );
}

// Exercise the real review-save handler at every await boundary. A successful
// write already sent for A may finish, but no later row/UI/draft cleanup follows
// after that editor unmounts (including switching A→B→A).
{
  const ast = source("src/routes/results.tsx"),
    component = functionNode(ast, "Results");
  const cleanup = effects(component, ast).find((node) =>
    node.getText(ast).includes("mounted.current = false"),
  );
  const pure = vm.createContext({ exports: {} });
  execute(read("src/lib/syllabus-review.ts"), pure);
  for (const boundary of ["refetch", "course", "assignment"]) {
    const pending = deferred(),
      reached = deferred(),
      writes = [],
      stateChanges = [],
      removed = [];
    const pause = (name, result) => {
      if (boundary !== name) return Promise.resolve(result);
      reached.resolve();
      return pending.promise;
    };
    const context = vm.createContext({
      exports: {},
      ...pure.exports,
      user: { id: "student-A" },
      courseName: "Private A course",
      courseCode: "A101",
      items: [
        { title: "Private A assignment", due_date: "2026-11-01" },
        { title: "Second A assignment", due_date: "2026-11-02" },
      ],
      hasIncompleteItems: false,
      saveInFlight: { current: false },
      mounted: { current: true },
      accountScope: { current: { userId: "student-A" } },
      checkpoint: { current: { userId: "student-A", confirmed: new Set() } },
      storageKey: key("student-A", "draft"),
      sessionStorage: {},
      useEffect: (callback) => {
        context.cleanup = callback();
      },
      coursesQuery: { refetch: () => pause("refetch", { data: [] }) },
      assignmentsQuery: { refetch: async () => ({ data: [] }) },
      addCourse: {
        mutateAsync: (input) => {
          writes.push(["course", input]);
          return pause("course", { id: "course-A" });
        },
      },
      addAssignment: {
        mutateAsync: (input) => {
          writes.push(["assignment", input]);
          return pause("assignment", {});
        },
      },
      removeBrowserStorage: (_get, key) => removed.push(key),
      ...Object.fromEntries(
        ["Saving", "SaveMessage", "SavedCourseId", "Saved"].map((name) => [
          `set${name}`,
          (value) => stateChanges.push([name, value]),
        ]),
      ),
    });
    execute(
      `${cleanup.getText(ast)}\n${declarations(component, ast, ["saveSemester"])}\nglobalThis.save = saveSemester;`,
      context,
    );
    const request = context.save();
    await reached.promise;
    context.cleanup();
    stateChanges.length = 0;
    const sentBeforeUnmount = writes.length;
    pending.resolve(boundary === "refetch" ? { data: [] } : { id: "course-A" });
    await request;
    assert.equal(writes.length, sentBeforeUnmount);
    assert.equal(stateChanges.length, 0);
    assert.equal(
      removed.length,
      0,
      "Preserve A's account-owned draft for a later legitimate retry",
    );
  }
}

// A deferred auth lock cannot send A's syllabus using B's token. Same-account
// token refresh works; canceled requests never reach fetch.
{
  let session,
    requests = [],
    auth;
  const context = vm.createContext({
    exports: {},
    z,
    crypto,
    Response,
    AbortController,
    require: (name) =>
      name === "zod"
        ? { z }
        : name === "./supabase"
          ? { supabase: { auth: { getSession: () => session } } }
          : auth,
    fetch: async (...args) => {
      requests.push(args);
      return new Response(JSON.stringify({ items: [] }));
    },
  });
  execute(read("src/lib/auth-fetch.ts"), context);
  auth = context.exports;
  context.exports = {};
  execute(read("src/functions/parse-syllabus.ts"), context);
  const parse = context.exports.parseSyllabus;
  for (const nextUser of ["student-B", null]) {
    const pending = deferred();
    session = pending.promise;
    const request = parse({ syllabusText: "Private A" }, { expectedUserId: "student-A" });
    pending.resolve({
      data: { session: nextUser ? { user: { id: nextUser }, access_token: "token" } : null },
      error: null,
    });
    await assert.rejects(request, /signed-in account changed/);
    assert.equal(requests.length, 0);
  }
  for (const access of [undefined, {}, { expectedUserId: "" }])
    await assert.rejects(parse({ syllabusText: "Private A" }, access));
  session = Promise.resolve({
    data: { session: { user: { id: "student-A" }, access_token: "refreshed" } },
    error: null,
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    parse(
      { syllabusText: "Private A" },
      { expectedUserId: "student-A", signal: controller.signal },
    ),
  );
  assert.equal(requests.length, 0);
  await parse({ syllabusText: "Private A" }, { expectedUserId: "student-A" });
  assert.equal(requests[0][1].headers.Authorization, "Bearer refreshed");
}

// Execute Planner's real async handler and cleanup: late parsing/PDF reads may
// not save drafts, navigate, or update a different account after unmount.
{
  const ast = source("src/routes/planner.tsx"),
    component = functionNode(ast, "Planner");
  const cleanup = effects(component, ast).find((node) =>
    node.getText(ast).includes("activeRequest.current?.abort()"),
  );
  for (const stop of [false, true]) {
    const pending = deferred(),
      stored = new Map(),
      navigations = [],
      changes = [];
    let parsingAccess;
    const context = vm.createContext({
      exports: {},
      AbortController,
      user: { id: "student-A" },
      tab: "text",
      pdfText: "",
      pastedText: "Private syllabus A",
      parseInFlight: { current: false },
      extractingPdf: false,
      mounted: { current: true },
      activeRequest: { current: null },
      latestPdfRead: { current: 0 },
      createSyllabusResultId: () => "draft",
      syllabusResultStorageKey: key,
      sessionStorage: {},
      useEffect: (callback) => {
        context.cleanup = callback();
      },
      writeBrowserStorage: (_get, key, value) => {
        stored.set(key, value);
        return true;
      },
      removeBrowserStorage: (_get, key) => stored.delete(key),
      parseSyllabus: (_input, access) => {
        parsingAccess = access;
        return pending.promise;
      },
      navigate: (value) => navigations.push(value),
      SyllabusParseError: class extends Error {},
      setLoading: (value) => changes.push(["loading", value]),
      setProcessingError: (value) => changes.push(["error", value]),
    });
    execute(
      `${cleanup.getText(ast)}\n${declarations(component, ast, ["handleMapSemester"])}\nglobalThis.map = handleMapSemester;`,
      context,
    );
    const request = context.map();
    assert.equal(parsingAccess.expectedUserId, "student-A");
    if (stop) {
      context.cleanup();
      changes.length = 0;
    }
    pending.resolve({ items: [] });
    await request;
    if (stop) {
      assert.equal(parsingAccess.signal.aborted, true);
      assert.equal(stored.size, 0);
      assert.equal(navigations.length, 0);
      assert.equal(changes.length, 0);
    } else {
      assert.equal(JSON.parse(stored.get(key("student-A", "draft"))).userId, "student-A");
      assert.equal(navigations.length, 1);
    }
  }
  for (const resolution of ["text", "error"]) {
    const pending = deferred(),
      changes = [];
    const context = vm.createContext({
      exports: {},
      parseInFlight: { current: false },
      latestPdfRead: { current: 0 },
      activeRequest: { current: null },
      mounted: { current: true },
      MAX_PDF_BYTES: 10 * 1024 * 1024,
      extractPdfText: () => pending.promise,
      useEffect: (callback) => {
        context.cleanup = callback();
      },
      ...Object.fromEntries(
        ["PdfText", "Filename", "ExtractingPdf", "ProcessingError", "PdfError"].map((name) => [
          `set${name}`,
          (value) => changes.push([name, value]),
        ]),
      ),
      console: {
        error: () => assert.fail("An abandoned PDF error must not log/update the next account"),
      },
    });
    execute(
      `${cleanup.getText(ast)}\n${declarations(component, ast, ["handlePdfFile"])}\nglobalThis.readPdf = handlePdfFile;`,
      context,
    );
    const result = context.readPdf({ name: "private-A.pdf", type: "application/pdf", size: 123 });
    context.cleanup();
    changes.length = 0;
    // A later remount (including A→B→A) has a separate identity/ref generation.
    // Resolving the old promise must not update either newer editor.
    if (resolution === "text") pending.resolve("Private PDF A");
    else pending.reject(new Error("Private PDF failure"));
    await result;
    assert.equal(changes.length, 0);
  }
}
console.log(
  "PASS local Notes and syllabus account boundaries: keyed routes, owned drafts, same-account retention, queued-effect isolation, aborted parse and late-response suppression (offline)",
);
