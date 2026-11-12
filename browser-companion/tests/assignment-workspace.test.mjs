import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = fs.readFileSync(
  new URL("../../src/components/assignment-workspace.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const owner = "11111111-1111-4111-8111-111111111111";
const conversation = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const saved = (patch = {}) => ({
  id: itemId,
  userId: owner,
  kind: "assignment",
  title: "Biology lab",
  content: "Explain the result using two sources.",
  sourceUrl: null,
  sourceTitle: "Biology lab",
  courseId: null,
  conversationId: conversation,
  progress: "Selected two sources",
  nextStep: "Outline the evidence",
  status: "active",
  version: 3,
  createdAt: "2026-11-12T00:00:00Z",
  updatedAt: "2026-11-12T00:00:00Z",
  ...patch,
});
const walk = (node, predicate, found = []) => {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, predicate, found));
    return found;
  }
  if (predicate(node)) found.push(node);
  walk(node.props?.children, predicate, found);
  return found;
};
const textOf = (node) =>
  Array.isArray(node)
    ? node.map(textOf).join("")
    : typeof node === "string" || typeof node === "number"
      ? String(node)
      : textOf(node?.props?.children || "");

function fixture(initial = null) {
  const state = {
    saved: initial,
    writes: [],
    asks: [],
    contexts: [],
    invalidations: [],
    fail: null,
    response: null,
    blocker: null,
    acceptLeave: false,
  };
  const slots = [],
    cleanups = new Map();
  let index = 0,
    changed = false,
    effects = [],
    tree;
  const changedDeps = (before, after) =>
    !before || !after || before.some((value, i) => value !== after[i]);
  const hooks = {
    useState(initialValue) {
      const slot = index++;
      if (!(slot in slots))
        slots[slot] = typeof initialValue === "function" ? initialValue() : initialValue;
      return [
        slots[slot],
        (value) => {
          const next = typeof value === "function" ? value(slots[slot]) : value;
          if (next !== slots[slot]) {
            slots[slot] = next;
            changed = true;
          }
        },
      ];
    },
    useRef(value) {
      const slot = index++;
      return (slots[slot] ||= { current: value });
    },
    useCallback(callback, deps) {
      const slot = index++;
      if (!slots[slot] || changedDeps(slots[slot].deps, deps)) slots[slot] = { callback, deps };
      return slots[slot].callback;
    },
    useEffect(callback, deps) {
      const slot = index++;
      if (changedDeps(slots[slot], deps)) {
        slots[slot] = deps;
        effects.push(() => {
          cleanups.get(slot)?.();
          cleanups.set(slot, callback());
        });
      }
    },
  };
  const api = {
    listStudyWorkspace: async (_filters, access) => {
      assert.equal(access.expectedUserId, owner);
      if (state.loadFail) throw state.loadFail;
      return { items: state.saved ? [state.saved] : [], courses: [] };
    },
    createStudyItem: async (input, access) => {
      state.writes.push({ method: "create", input, access });
      if (state.response) return state.response.promise;
      if (state.fail) throw state.fail;
      return (state.saved = saved({
        ...input,
        version: 1,
        progress: input.progress || "",
        nextStep: input.nextStep || "",
      }));
    },
    updateStudyItem: async (id, version, patch, access) => {
      state.writes.push({ method: "update", id, version, patch, access });
      if (state.fail) throw state.fail;
      return (state.saved = saved({ ...state.saved, ...patch, version: version + 1 }));
    },
  };
  const icon = () => null;
  const context = vm.createContext({
    exports: {},
    crypto,
    AbortController,
    window: { confirm: () => state.acceptLeave },
    require(name) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return jsx;
      if (name === "@tanstack/react-router")
        return {
          useBlocker: (config) => {
            state.blocker = config;
          },
        };
      if (name === "@tanstack/react-query")
        return {
          useQueryClient: () => ({ invalidateQueries: (input) => state.invalidations.push(input) }),
        };
      if (name === "lucide-react") return new Proxy({}, { get: () => icon });
      if (name === "../lib/study-workspace") return api;
      if (name === "./study-resources") return { StudyResourceSave: icon };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  vm.runInContext(compiled, context);
  const props = {
    userId: owner,
    conversationId: conversation,
    courses: [],
    disabled: false,
    onContextChange: (item, dirty) => state.contexts.push({ item, dirty }),
    onAsk: (prompt, item) => state.asks.push({ prompt, item }),
  };
  const render = () => {
    index = 0;
    changed = false;
    effects = [];
    tree = context.exports.AssignmentWorkspace(props);
    effects.forEach((run) => run());
  };
  const settle = async () => {
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
      if (changed || !tree) render();
    }
  };
  const button = (label) => {
    const found = walk(tree, (node) => node.type === "button" && textOf(node).includes(label));
    assert.equal(found.length, 1, `one button containing ${label}`);
    return found[0];
  };
  const field = (label) => {
    const found = walk(tree, (node) => node.type === "label" && textOf(node).startsWith(label));
    assert.equal(found.length, 1, `one field ${label}`);
    return walk(found[0], (node) => ["input", "textarea", "select"].includes(node.type))[0];
  };
  const fill = async (label, value) => {
    field(label).props.onChange({ target: { value } });
    await settle();
  };
  const click = async (label) => {
    const node = button(label);
    assert(!node.props.disabled, `${label} enabled`);
    node.props.onClick();
    await settle();
  };
  const unmount = () => {
    for (const cleanup of cleanups.values()) cleanup?.();
  };
  return { state, render, settle, click, fill, field, button, unmount, props, tree: () => tree };
}

{
  const f = fixture();
  f.render();
  await f.settle();
  assert.equal(f.state.writes.length, 0, "Opening Ask never saves assignment data");
  await f.click("Working on an assignment?");
  await f.fill("Assignment title", "My biology lab");
  await f.fill("Instructions", "Explain the result using two sources.");
  assert(f.state.blocker.enableBeforeUnload, "Unsaved assignment survives route/unload protection");
  assert(f.state.blocker.shouldBlockFn());
  await f.click("Save & understand");
  assert.equal(f.state.writes.length, 1);
  assert.equal(f.state.writes[0].input.courseId, null, "Standalone use needs no course");
  assert.equal(f.state.writes[0].input.conversationId, conversation);
  assert.equal(f.state.writes[0].access.expectedUserId, owner);
  assert.equal(f.state.asks.length, 1);
  assert.match(f.state.asks[0].prompt, /Do not invent a deadline/);
  assert.equal(
    f.state.asks[0].item.id,
    f.state.writes[0].input.id,
    "Tutor uses the server-confirmed saved source",
  );
  assert.equal(f.state.blocker.enableBeforeUnload, false);
}
{
  const f = fixture(saved());
  f.render();
  await f.settle();
  assert(textOf(f.tree()).includes("Outline the evidence"));
  await f.click("Pick up where I left off");
  assert.equal(f.state.writes.length, 0, "Resuming an unchanged assignment issues no write");
  assert.match(f.state.asks[0].prompt, /where I stopped/);
  await f.fill("My next step", "Write the first paragraph");
  await f.click("Save assignment");
  assert.equal(f.state.writes[0].version, 3, "Save is conditional on the loaded version");
  assert.equal(f.state.writes[0].patch.kind, undefined, "An edit cannot change the resource kind");
  const resumed = fixture(f.state.saved);
  resumed.render();
  await resumed.settle();
  assert.equal(resumed.field("My next step").props.value, "Write the first paragraph");
}
{
  const f = fixture(saved({ content: "" }));
  f.render();
  await f.settle();
  assert.match(textOf(f.tree()), /You can save your progress now/);
  assert(f.button("Understand assignment").props.disabled);
  assert(f.button("Help me start").props.disabled);
  assert(f.button("Pick up where I left off").props.disabled);
  // Even a stale/programmatic click cannot tutor with missing instructions.
  f.button("Understand assignment").props.onClick();
  await f.settle();
  assert.equal(f.state.asks.length, 0);
  await f.fill("What I’ve done", "Chose the topic; waiting for the rubric");
  await f.fill("Assignment status", "done");
  await f.click("Save assignment");
  assert.equal(f.state.writes[0].patch.content, "");
  assert.equal(f.state.writes[0].patch.progress, "Chose the topic; waiting for the rubric");
  assert.equal(f.state.writes[0].patch.status, "done");
  assert.equal(f.state.asks.length, 0, "Progress/status saves do not call AI");
  await f.fill("Instructions", "Compare the two sources in one paragraph.");
  assert(!f.button("Save & understand").props.disabled, "Adding instructions enables tutoring");
}
{
  const progress = "p".repeat(3500);
  const nextStep = "n".repeat(1700);
  const f = fixture(saved({ progress, nextStep }));
  f.render();
  await f.settle();
  assert.equal(f.field("What I’ve done").props.maxLength, 4000);
  assert.equal(f.field("My next step").props.maxLength, 2000);
  await f.fill("Assignment status", "done");
  await f.click("Save assignment");
  assert.equal(f.state.writes[0].patch.progress, progress);
  assert.equal(
    f.state.writes[0].patch.nextStep,
    nextStep,
    "Companion-length fields survive a web edit",
  );
}
{
  const f = fixture(saved());
  f.render();
  await f.settle();
  await f.fill("What I’ve done", "Private unsaved progress");
  f.state.fail = Object.assign(
    new Error("Newer edits exist in your Companion. Reload before saving."),
    { code: "WORKSPACE_CONFLICT" },
  );
  await f.click("Save & get started");
  assert.equal(f.state.asks.length, 0, "Never send AI the stale item when saving conflicts");
  assert.equal(f.field("What I’ve done").props.value, "Private unsaved progress");
  assert(f.state.blocker.enableBeforeUnload);
  assert(f.button("Save assignment").props.disabled);
  await f.click("Reload saved assignment");
  assert.equal(
    f.field("What I’ve done").props.value,
    "Private unsaved progress",
    "Cancelling reload keeps the student's work",
  );
}
{
  const f = fixture();
  f.render();
  await f.settle();
  await f.click("Working on an assignment?");
  await f.fill("Assignment title", "Essay");
  await f.fill("Instructions", "Compare the two arguments.");
  f.state.fail = new Error("Offline");
  await f.click("Save & understand");
  assert.equal(f.state.asks.length, 0);
  f.state.fail = null;
  await f.click("Save & understand");
  assert.equal(
    f.state.writes[0].input.id,
    f.state.writes[1].input.id,
    "Retry reuses the creation id to avoid duplicates",
  );
}
{
  const f = fixture();
  f.render();
  await f.settle();
  await f.click("Working on an assignment?");
  await f.fill("Assignment title", "Essay");
  await f.fill("Instructions", "Compare the two arguments.");
  f.state.response = deferred();
  await f.click("Save & understand");
  f.unmount();
  assert(f.state.writes[0].access.signal.aborted, "Switching accounts/unmount aborts the save");
  f.state.response.resolve(saved());
  await f.settle();
  assert.equal(
    f.state.asks.length,
    0,
    "Late save cannot submit a former account's private assignment",
  );
}
{
  const general = fixture();
  general.render();
  await general.settle();
  assert.equal(
    general.button("Working on an assignment?").props["aria-expanded"],
    false,
    "Ordinary chats keep the optional assignment editor compact",
  );
  const assignment = fixture();
  assignment.props.startExpanded = true;
  assignment.props.initialTitle = "";
  assignment.render();
  await assignment.settle();
  assert.equal(
    assignment.button("Working on an assignment?").props["aria-expanded"],
    true,
    "Explicit New assignment opens the editor even without a title handoff",
  );
  assert.equal(assignment.field("Assignment title").props.value, "");
  assert.equal(
    assignment.state.writes.length,
    0,
    "Opening the editor does not save an empty assignment",
  );
}
{
  const f = fixture(saved({ conversationId: null }));
  f.props.initialItemId = itemId;
  f.render();
  await f.settle();
  await f.click("Save & pick up");
  assert.equal(f.state.writes[0].method, "update");
  assert.equal(
    f.state.writes[0].patch.conversationId,
    conversation,
    "An orphaned assignment is explicitly attached before resuming",
  );
  assert.equal(f.state.asks[0].item.conversationId, conversation);
}
{
  const f = fixture(saved());
  f.props.initialTitle = "A different task from Today";
  f.props.initialCourseId = "44444444-4444-4444-8444-444444444444";
  f.render();
  await f.settle();
  assert.equal(
    f.field("Assignment title").props.value,
    "Biology lab",
    "A query handoff cannot overwrite an existing chat's assignment",
  );
  assert.equal(f.state.writes.length, 0);
}
{
  const f = fixture();
  f.props.initialItemId = itemId;
  f.state.loadFail = new Error("Saved work unavailable");
  f.render();
  await f.settle();
  assert(
    f.state.contexts.at(-1).dirty,
    "Explicit missing source blocks tutoring with unrelated context",
  );
  assert(
    walk(f.tree(), (node) => node.type === "fieldset")[0].props.disabled,
    "Failed initial reads cannot create a blind replacement",
  );
  assert.equal(f.state.writes.length, 0);
}
{
  const askSource = fs.readFileSync(new URL("../../src/routes/ask.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile(
    "ask.tsx",
    askSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const ask = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "Ask",
  );
  const handler = ask.body.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (entry) => entry.name.getText(ast) === "handleStartAssignment",
      ),
  );
  const state = {
    created: [],
    conversations: [{ id: "existing", title: "Existing assignment" }],
    selected: "existing",
    seed: null,
    accepts: false,
  };
  const context = vm.createContext({
    userId: owner,
    conversationBusy: false,
    loading: false,
    assignmentDirty: true,
    search: { assignment: "Essay from Today", course: "44444444-4444-4444-8444-444444444444" },
    selectedCourseId: "",
    activeUserIdRef: { current: owner },
    window: { confirm: () => state.accepts },
    createCompanionConversation: async (userId, title) => {
      state.created.push({ userId, title });
      return { id: conversation, title };
    },
    setConversationBusy() {},
    setConversationNotice() {},
    setHistoryNotice() {},
    setQuestion() {},
    setSavedResource() {},
    setResourceError() {},
    setConversations: (update) => {
      state.conversations = update(state.conversations);
    },
    setSelectedConversationId: (id) => {
      state.selected = id;
    },
    setAssignmentSeed: (seed) => {
      state.seed = seed;
    },
  });
  vm.runInContext(
    ts.transpileModule(`${handler.getText(ast)}\nglobalThis.start = handleStartAssignment;`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    context,
  );
  assert.equal(state.created.length, 0, "Reading a Today handoff never creates a chat");
  await context.start();
  assert.equal(state.created.length, 0, "Cancelled unsaved-work confirmation creates nothing");
  state.accepts = true;
  await context.start();
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0].title, "Essay from Today");
  assert.equal(state.conversations[1].title, "Existing assignment");
  assert.equal(
    state.seed.conversationId,
    conversation,
    "Only the newly created chat gets the handoff seed",
  );
  assert.equal(state.selected, conversation);
}
console.log(
  "PASS assignment workspace: explicit save-to-tutor, standalone use, durable resume, stale-edit recovery, unsaved guards and account isolation",
);
