import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { z } from "zod";

const read = (name) => fs.readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
const model = { exports: {} };
vm.runInNewContext(compile(read("src/lib/study-workspace-model.ts")), {
  ...model,
  require: () => ({ z }),
  URL,
});
const owner = "11111111-1111-4111-8111-111111111111";
const course = "22222222-2222-4222-8222-222222222222";
const item = {
  id: "33333333-3333-4333-8333-333333333333",
  userId: owner,
  kind: "note",
  title: "Saved note",
  content: "Original explanation",
  sourceUrl: null,
  sourceTitle: "",
  courseId: null,
  conversationId: null,
  nextStep: "",
  progress: "",
  status: "active",
  version: 4,
  createdAt: "2026-11-12T12:00:00Z",
  updatedAt: "2026-11-12T12:00:00Z",
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const nodes = (root) => {
  const result = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    result.push(node);
    visit(node.props?.children);
  }
  visit(root);
  return result;
};
const text = (node) =>
  typeof node === "string"
    ? node
    : Array.isArray(node)
      ? node.map(text).join("")
      : text(node?.props?.children ?? "");
function harness() {
  const states = [],
    refs = [],
    effects = [];
  const calls = [],
    invalidations = [],
    closed = [],
    saved = [];
  let stateIndex,
    refIndex,
    effectIndex,
    blocker,
    request = null,
    confirm = true,
    user = { id: owner };
  const hooks = {
    useState(initial) {
      const i = stateIndex++;
      if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
      return [
        states[i],
        (value) => {
          states[i] = typeof value === "function" ? value(states[i]) : value;
        },
      ];
    },
    useRef(initial) {
      const i = refIndex++;
      return (refs[i] ??= { current: initial });
    },
    useEffect(effect) {
      const i = effectIndex++;
      if (!(i in effects)) effects[i] = effect();
    },
  };
  const api = {
    listStudyWorkspace() {
      throw new Error("Query mocked, network forbidden");
    },
    async createStudyItem(...args) {
      calls.push(["create", ...args]);
      return request ? await request.promise : { ...item, ...args[0] };
    },
    async updateStudyItem(...args) {
      calls.push(["update", ...args]);
      return request ? await request.promise : { ...item, ...args[2], version: 5 };
    },
    async deleteStudyItem(...args) {
      calls.push(["delete", ...args]);
      if (request) await request.promise;
    },
  };
  const stub = () => null;
  const modules = {
    react: hooks,
    "react/jsx-runtime": jsx,
    "@tanstack/react-router": {
      Link: "a",
      useBlocker: (value) => {
        blocker = value;
      },
    },
    "@tanstack/react-query": {
      useInfiniteQuery: () => ({
        data: {
          pages: [
            { items: [item], courses: [{ id: course, name: "Biology", course_code: "BIO" }] },
          ],
        },
        refetch: async () => {},
      }),
      useQuery: () => ({
        data: { items: [item], courses: [{ id: course, name: "Biology", course_code: "BIO" }] },
        refetch: async () => {},
      }),
      useQueryClient: () => ({
        invalidateQueries: (value) => {
          invalidations.push(value);
        },
      }),
    },
    "lucide-react": { BookOpen: stub, ExternalLink: stub, RefreshCw: stub },
    "../lib/auth-context": { useAuth: () => ({ user }) },
    "../lib/study-workspace": api,
    "../lib/study-workspace-model": model.exports,
    "./ui/dialog": {
      Dialog: "dialog",
      DialogContent: "section",
      DialogDescription: "p",
      DialogTitle: "h2",
    },
  };
  const ctx = {
    exports: {},
    require: (key) => {
      assert.ok(key in modules, key);
      return modules[key];
    },
    crypto,
    AbortController,
    URL,
    Error,
    window: { confirm: () => confirm },
  };
  vm.runInNewContext(
    compile(
      read("src/components/study-resources.tsx") + "\nexport { ResourceEditor, ResourceList };",
    ),
    ctx,
  );
  function render(component = "ResourceEditor", props = {}) {
    stateIndex = 0;
    refIndex = 0;
    effectIndex = 0;
    return ctx.exports[component]({
      userId: owner,
      initial: { kind: "note", initialTitle: "My note", content: "AI explanation" },
      onClose: () => closed.push(true),
      onSaved: () => saved.push(true),
      ...props,
    });
  }
  return {
    render,
    calls,
    invalidations,
    closed,
    saved,
    states,
    get blocker() {
      return blocker;
    },
    setRequest(value) {
      request = value;
    },
    setConfirm(value) {
      confirm = value;
    },
    setUser(value) {
      user = value;
    },
    unmount() {
      effects.forEach((cleanup) => cleanup?.());
    },
    exports: ctx.exports,
  };
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const submit = (tree) =>
  nodes(tree)
    .find((node) => node.type === "form")
    .props.onSubmit({ preventDefault() {} });
const setTitle = (tree, value) =>
  nodes(tree)
    .find((node) => node.type === "input" && node.props.maxLength === 160)
    .props.onChange({ target: { value } });

// A deliberate reviewed save works without courses. Double-submit cannot create two notes.
{
  const h = harness(),
    pending = deferred();
  h.setRequest(pending);
  let tree = h.render();
  assert.equal(h.calls.length, 0);
  submit(tree);
  submit(tree);
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][1].courseId, null);
  assert.equal(h.calls[0][2].expectedUserId, owner);
  tree = h.render();
  assert.equal(h.blocker.shouldBlockFn(), true);
  pending.resolve(item);
  await flush();
  assert.equal(h.saved.length, 1);
  assert.equal(h.invalidations.length, 1);
}
// Failed writes preserve the text and stable request ID, including a retry after an ambiguous network failure.
{
  const h = harness(),
    pending = deferred();
  h.setRequest(pending);
  let tree = h.render();
  setTitle(tree, "My work stays here");
  tree = h.render();
  submit(tree);
  pending.reject(new Error("Offline; try again"));
  await flush();
  tree = h.render();
  assert.equal(
    nodes(tree).find((node) => node.type === "input" && node.props.maxLength === 160).props.value,
    "My work stays here",
  );
  assert.equal(h.saved.length, 0);
  assert.ok(
    nodes(tree).some((node) => node.props?.role === "alert" && text(node).includes("Offline")),
  );
  const firstId = h.calls[0][1].id;
  h.setRequest(null);
  submit(tree);
  await flush();
  assert.equal(h.calls[1][1].id, firstId);
}
// Version conflicts never silently overwrite another device's edits.
{
  const h = harness(),
    pending = deferred();
  h.setRequest(pending);
  let tree = h.render("ResourceEditor", { existing: item });
  setTitle(tree, "Changed here");
  tree = h.render("ResourceEditor", { existing: item });
  submit(tree);
  assert.equal(h.calls[0][0], "update");
  assert.equal(h.calls[0][2], 4);
  pending.reject(Object.assign(new Error("A newer version is saved"), { status: 409 }));
  await flush();
  tree = h.render("ResourceEditor", { existing: item });
  assert.equal(
    nodes(tree).find((node) => node.type === "button" && node.props.type === "submit").props
      .disabled,
    true,
  );
  submit(tree);
  assert.equal(h.calls.length, 1);
  assert.equal(h.saved.length, 0);
}
// Discard must be confirmed, and a late save after account unmount cannot announce success or touch the new UI.
{
  const h = harness(),
    pending = deferred();
  h.setRequest(pending);
  h.setConfirm(false);
  let tree = h.render();
  setTitle(tree, "Unsaved draft");
  tree = h.render();
  assert.equal(h.blocker.shouldBlockFn(), true);
  nodes(tree)
    .find((node) => node.type === "button" && text(node) === "Cancel")
    .props.onClick();
  assert.equal(h.closed.length, 0);
  submit(tree);
  h.unmount();
  assert.equal(h.calls[0][2].signal.aborted, true);
  pending.resolve(item);
  await flush();
  assert.equal(h.saved.length, 0);
  assert.equal(h.invalidations.length, 0);
}
// Owner changes remount forms and lists. Refreshed sessions retain same-account drafts.
{
  const h = harness();
  const a = h.exports.StudyResourceSave({ kind: "note" });
  h.setUser({ id: owner, refreshed: true });
  assert.equal(h.exports.StudyResourceSave({ kind: "note" }).key, a.key);
  h.setUser({ id: course });
  assert.notEqual(h.exports.StudyResourceSave({ kind: "note" }).key, a.key);
  h.setUser(null);
  assert.equal(h.exports.StudyResources({ kind: "note" }), null);
}
// Delete confirmation and source safety are enforced before a write.
{
  const h = harness();
  h.setConfirm(false);
  const tree = h.render("ResourceList", { kind: "note" });
  nodes(tree)
    .find((node) => node.type === "button" && text(node) === "Delete")
    .props.onClick();
  await flush();
  assert.equal(h.calls.length, 0);
  const editor = harness();
  const bad = editor.render("ResourceEditor", {
    initial: { kind: "link", initialTitle: "Bad source", sourceUrl: "javascript:alert(1)" },
  });
  submit(bad);
  await flush();
  assert.equal(editor.calls.length, 0);
}
console.log(
  "PASS saved resources: explicit saves, standalone notes, retry preservation, version conflicts, unsaved guards, account isolation, deletion consent, source validation (offline)",
);
