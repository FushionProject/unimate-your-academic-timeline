import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

// Execute the actual route with queued React-style state/effect updates and
// synthetic browser storage. No browser launch or personal storage is used.
const source = fs.readFileSync(new URL("../../src/routes/bulletin.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "bulletin.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const component = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "Bulletin",
);
const stateNames = component.body.statements.flatMap((statement) =>
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
const compiled = ts.transpileModule(
  `${source}\nglobalThis.component = Bulletin; globalThis.wrapper = BulletinRoute;`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
const text = (node) =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(text).join(" ")
      : text(node?.props?.children || "");
const link = (name, classTag = "Course") => ({
  id: `id-${name}`,
  title: `Private ${name}`,
  url: `https://${name.toLowerCase()}.example.test/`,
  classTag,
});
function harness() {
  const stored = new Map(),
    reads = [],
    writes = [],
    removals = [];
  const slots = [],
    pending = new Map(),
    effects = [];
  let user = { id: "A" },
    index,
    effectIndex,
    work,
    tree,
    timer = 0;
  const flags = { getFails: false, setFails: false };
  const hooks = {
    useState(initial) {
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
    useEffect(callback, deps) {
      const slot = effectIndex++,
        prior = effects[slot];
      if (!prior || deps.some((value, i) => !Object.is(value, prior.deps[i])))
        work.push(() => {
          prior?.cleanup?.();
          effects[slot] = { deps, cleanup: callback() };
        });
    },
  };
  const context = vm.createContext({
    exports: {},
    URL,
    crypto,
    localStorage: {
      getItem(key) {
        reads.push(key);
        if (flags.getFails) throw new Error("blocked");
        return stored.get(key) ?? null;
      },
      setItem(key, value) {
        if (flags.setFails) throw new Error("quota");
        writes.push([key, value]);
        stored.set(key, value);
      },
      removeItem(key) {
        removals.push(key);
        stored.delete(key);
      },
    },
    window: {
      addEventListener() {},
      removeEventListener() {},
      setTimeout: () => ++timer,
      clearTimeout() {},
    },
    require: (name) =>
      name === "react"
        ? hooks
        : name === "react/jsx-runtime"
          ? jsx
          : name === "@tanstack/react-router"
            ? { createFileRoute: () => (options) => options }
            : name.endsWith("auth-context")
              ? { useAuth: () => ({ user }) }
              : new Proxy({}, { get: () => () => null }),
  });
  vm.runInContext(compiled, context);
  const flush = () => {
    for (const [slot, value] of pending) slots[slot] = value;
    pending.clear();
  };
  const render = () => {
    index = 0;
    effectIndex = 0;
    work = [];
    tree = context.component();
    for (const effect of work) effect();
    return tree;
  };
  const settle = () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      flush();
      render();
      if (!pending.size) return tree;
    }
    throw Error("fixture did not settle");
  };
  const find = (predicate) => {
    const match = nodes(tree).find(predicate);
    assert.ok(match, "Expected production control");
    return match;
  };
  const button = (label) => find((node) => node.type === "button" && text(node).trim() === label);
  return {
    stored,
    reads,
    writes,
    removals,
    flags,
    render,
    settle,
    button,
    find,
    get tree() {
      return tree;
    },
    state: (name) => slots[stateNames.indexOf(name)],
    setUser: (value) => {
      user = value;
    },
    wrapper: () => context.wrapper(),
    add(title, classTag = "Math") {
      button("Add link").props.onClick();
      settle();
      for (const [id, value] of [
        ["bulletin-title", title],
        ["bulletin-url", "course.example.test"],
        ["bulletin-class", classTag],
      ]) {
        find((node) => node.props?.id === id).props.onChange({ target: { value } });
        settle();
      }
      find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
      settle();
    },
  };
}

// Account-keyed wrappers unmount all private state on A→B/sign-out, but preserve
// drafts for same-account token refresh. Retained-slot tests below additionally
// reproduce the former old-effect/new-key overwrite race without remounting.
const h = harness();
const firstKey = h.wrapper().props.children.key;
h.setUser({ id: "A", refreshed: true });
assert.equal(h.wrapper().props.children.key, firstKey);
h.setUser({ id: "B" });
assert.notEqual(h.wrapper().props.children.key, firstKey);
h.setUser(null);
assert.notEqual(h.wrapper().props.children.key, firstKey);
h.setUser({ id: "A" });
h.stored.set("bulletinLinks:A", JSON.stringify([link("A")]));
h.stored.set("bulletinLinks:B", JSON.stringify([link("B")]));
h.stored.set("bulletinLinks", JSON.stringify([link("Legacy")]));
h.settle();
assert.match(text(h.tree), /Private A/);
assert.equal(h.writes.length, 0, "Loading must not write even valid saved links");
h.setUser({ id: "B" });
assert.doesNotMatch(
  text(h.render()),
  /Private A/,
  "Old account content is hidden before load effects commit",
);
assert.equal(h.writes.length, 0, "Old closures cannot persist A under B's key");
h.settle();
assert.match(text(h.tree), /Private B/);
assert.doesNotMatch(text(h.tree), /Private A|Private Legacy/);
assert.deepEqual(JSON.parse(h.stored.get("bulletinLinks:A")), [link("A")]);
assert.deepEqual(JSON.parse(h.stored.get("bulletinLinks:B")), [link("B")]);
h.setUser({ id: "C" });
h.settle();
assert.match(text(h.tree), /Your board is ready/);
assert.ok(!h.reads.includes("bulletinLinks"), "Never inspect/adopt ownerless legacy data");
assert.ok(h.stored.has("bulletinLinks"));
assert.equal(h.removals.length, 0);
h.add("C link", "__proto__");
assert.match(text(h.tree), /__proto__/);
assert.equal(JSON.parse(h.stored.get("bulletinLinks:C"))[0].title, "C link");
assert.equal(JSON.parse(h.stored.get("bulletinLinks:C"))[0].url, "https://course.example.test/");
assert.ok(
  h.writes.every(([key, value]) => key === "bulletinLinks:C" && !value.includes("Private A")),
);

for (const invalid of [
  "{broken",
  "",
  "null",
  "{}",
  "42",
  JSON.stringify([null]),
  JSON.stringify([{ ...link("Bad"), url: "javascript:alert(1)" }]),
  JSON.stringify([{ ...link("Bad"), url: "https://user:secret@example.test" }]),
  JSON.stringify([{ ...link("Bad"), classTag: {} }]),
  JSON.stringify([link("Bad"), link("Bad")]),
]) {
  const bad = harness();
  bad.stored.set("bulletinLinks:A", invalid);
  bad.settle();
  assert.match(text(bad.tree), /have not been changed/);
  assert.equal(bad.button("Add link").props.disabled, true);
  assert.equal(bad.writes.length, 0);
  assert.equal(bad.stored.get("bulletinLinks:A"), invalid);
  bad.button("Try loading again").props.onClick();
  bad.settle();
  assert.equal(bad.stored.get("bulletinLinks:A"), invalid);
}
const blocked = harness();
blocked.stored.set("bulletinLinks:A", JSON.stringify([link("A")]));
blocked.flags.getFails = true;
blocked.settle();
assert.equal(blocked.writes.length, 0);
assert.match(text(blocked.tree), /Try loading again/);
blocked.flags.getFails = false;
blocked.button("Try loading again").props.onClick();
blocked.settle();
assert.match(text(blocked.tree), /Private A/);
assert.equal(blocked.writes.length, 0);

const quota = harness();
quota.stored.set("bulletinLinks:A", JSON.stringify([link("A")]));
quota.settle();
quota.flags.setFails = true;
quota.add("Unsaved link");
assert.match(text(quota.tree), /only in this tab/);
assert.match(text(quota.tree), /Unsaved link/);
assert.deepEqual(JSON.parse(quota.stored.get("bulletinLinks:A")), [link("A")]);
quota.flags.setFails = false;
quota.button("Try saving again").props.onClick();
quota.settle();
assert.equal(JSON.parse(quota.stored.get("bulletinLinks:A")).length, 2);
assert.equal(quota.state("storageError"), "");
quota.find((node) => node.props?.["aria-label"] === "Delete Unsaved link").props.onClick();
quota.settle();
assert.equal(JSON.parse(quota.stored.get("bulletinLinks:A")).length, 1);
quota.setUser(null);
quota.settle();
assert.doesNotMatch(text(quota.tree), /Private A|Unsaved link/);
console.log(
  "PASS Bulletin account isolation, ownerless legacy preservation, malformed-data protection and recoverable browser storage failures",
);
