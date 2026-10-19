import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";

const root = new URL("../../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
function functions(path, names) {
  const source = ts.createSourceFile(
    path,
    read(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return names
    .map((name) => {
      const found = source.statements.find(
        (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
      );
      assert.ok(found, name);
      return found.getText(source);
    })
    .join("\n");
}
const link = ({ to, children, ...props }) => createElement("a", { ...props, href: to }, children);
const icon = (props) => createElement("svg", props);
function harness(kind, initialQuery) {
  const query = { isPending: false, isFetching: false, isError: false, ...initialQuery };
  let checked = false;
  let user = { id: "student-a" };
  let draftRef;
  let cleanup;
  let mounted = false;
  let refetches = 0;
  query.refetch = async () => {
    refetches += 1;
    return query;
  };
  const names =
    kind === "ask"
      ? ["AskAccessGate", "AskProIntroduction", "ProStep"]
      : ["CompanionSetup", "SetupStep", "StatusRow"];
  const context = vm.createContext({
    exports: {},
    require: () => jsx,
    URL,
    useAuth: () => ({ user }),
    useRef: (value) => (draftRef ??= { current: value }),
    useCallback: (callback) => callback,
    useEffect: (callback) => {
      if (!mounted) {
        mounted = true;
        cleanup = callback();
      }
    },
    useState: () => [
      checked,
      (value) => {
        checked = value;
      },
    ],
    useBillingStatus: () => query,
    Route: { useSearch: () => ({}) },
    storeValue: "https://chromewebstore.google.com/detail/unimate/" + "a".repeat(32),
    Link: link,
    LogoMark: icon,
    LoaderCircle: icon,
    Sparkles: icon,
    LockKeyhole: icon,
    CheckCircle2: icon,
    ExternalLink: icon,
    MonitorCheck: icon,
    PRO_PLAN: { textMonthly: 200, monthlyPrice: "$9.99" },
    Ask: () => createElement("textarea", { "aria-label": "Allowed chat boundary" }),
  });
  const code = ts.transpileModule(
    functions("src/lib/companion-store.ts", ["getCompanionAccessState", "getCompanionStoreUrl"]) +
      "\n" +
      functions(`src/routes/${kind === "ask" ? "ask" : "companion-setup"}.tsx`, names).replace(
        "import.meta.env.VITE_COMPANION_STORE_URL",
        "globalThis.storeValue",
      ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText;
  vm.runInContext(`${code}\nglobalThis.Target = ${names[0]};`, context);
  function tree(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap((child) => tree(child));
    if (typeof node.type === "function") return tree(node.type(node.props));
    return [node, ...tree(node.props?.children)];
  }
  return {
    query,
    context,
    tree: () => tree(context.Target()),
    calls: () => refetches,
    view: () => context.Target(),
    setUser: (value) => {
      user = value;
    },
    unmount: () => cleanup?.(),
    html: () => renderToStaticMarkup(createElement(context.Target)),
  };
}

{
  const fixture = harness("ask", { data: { isPro: true } });
  const initial = fixture.view();
  initial.props.onDraftChange("Unsent private question A");
  fixture.query.isError = true;
  assert.doesNotMatch(
    fixture.html(),
    /Allowed chat boundary|Unsent private question A/,
    "Unknown plan hides composer and private text, not merely disables a send button",
  );
  assert.match(fixture.html(), /unsent question is kept in this tab/);
  initial.props.onDraftChange("Late response must not replace the draft");
  fixture.query.isError = false;
  const recovered = fixture.view();
  assert.equal(recovered.props.initialDraft, "Unsent private question A");
  assert.deepEqual(
    Object.keys(recovered.props).sort(),
    ["initialDraft", "onDraftChange"],
    "Only bounded composer text crosses the gate; no transcript or pending request survives",
  );
  initial.props.onDraftChange("Late callback after recovery");
  assert.equal(fixture.view().props.initialDraft, "Unsent private question A");
  recovered.props.onDraftChange("B".repeat(4500));
  assert.equal(fixture.view().props.initialDraft.length, 4000);
  fixture.query.data = { isPro: false };
  fixture.view();
  fixture.query.data = { isPro: true };
  assert.equal(
    fixture.view().props.initialDraft,
    undefined,
    "Confirmed Free clears draft retention",
  );
}

for (const boundary of ["signout", "account-switch", "unmount"]) {
  const fixture = harness("ask", { data: { isPro: true } });
  const original = fixture.view();
  original.props.onDraftChange("Private old-account draft");
  if (boundary === "unmount") fixture.unmount();
  else {
    fixture.setUser(boundary === "signout" ? null : { id: "student-b" });
    const changed = fixture.view();
    if (boundary === "signout") assert.equal(changed, null);
    else {
      assert.equal(changed.key, "student-b");
      assert.equal(changed.props.initialDraft, undefined);
    }
  }
  original.props.onDraftChange("Late old-account update");
  fixture.setUser({ id: "student-a" });
  assert.equal(
    fixture.view().props.initialDraft,
    undefined,
    `${boundary} cannot resurrect a private draft`,
  );
}

// Exercise the actual composer state setup and search-handoff effect. A restore
// must win over the original URL prompt, while a later deliberate handoff works.
{
  const source = ts.createSourceFile(
    "ask.tsx",
    read("src/routes/ask.tsx"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const ask = source.statements.find((node) => node.name?.text === "Ask");
  const statements = ask.body.statements;
  const prefixEnd = statements.findIndex((node) =>
    node.getText(source).startsWith("const lastHandoff"),
  );
  const seedEffect = statements.find(
    (node) =>
      node.getText(source).startsWith("useEffect(") &&
      node.getText(source).includes("onDraftChange(questionValueRef.current)"),
  );
  const effect = statements.find(
    (node) =>
      node.getText(source).startsWith("useEffect(") &&
      node.getText(source).includes("lastHandoff.current.prompt"),
  );
  const code = `function composer(initialDraft, onDraftChange) { ${statements
    .slice(0, prefixEnd + 1)
    .map((node) => node.getText(source))
    .join(
      "\n",
    )} ${seedEffect.getText(source)} ${effect.getText(source)} return {question, setQuestion}; }`;
  const slots = [];
  let cursor = 0;
  let questionFromGate;
  const search = { prompt: "Original handoff", course: "course-a" };
  const context = vm.createContext({
    Route: { useSearch: () => search },
    useState: (initial) => {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = initial;
      return [
        slots[slot],
        (value) => {
          slots[slot] = value;
        },
      ];
    },
    useRef: (initial) => {
      const slot = cursor++;
      return (slots[slot] ??= { current: initial });
    },
    useCallback: (callback) => callback,
    useEffect: (callback) => callback(),
    setSelectedCourseId: () => {},
    setSendError: () => {},
  });
  vm.runInContext(
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    context,
  );
  const render = () => {
    cursor = 0;
    return context.composer("Restored edited draft", (value) => {
      questionFromGate = value;
    });
  };
  assert.equal(render().question, "Restored edited draft");
  assert.equal(
    questionFromGate,
    "Restored edited draft",
    "Untouched restored text is seeded in the gate",
  );
  render().setQuestion("Typing B");
  assert.equal(
    questionFromGate,
    "Typing B",
    "Typing synchronously updates the bounded gate buffer",
  );
  render().setQuestion((current) => current || "Failed A");
  assert.equal(render().question, "Typing B");
  search.prompt = "New deliberate handoff";
  render();
  assert.equal(render().question, "New deliberate handoff");
  slots.length = 0;
  cursor = 0;
  const fixture = harness("ask", { data: { isPro: true } });
  const activeChat = fixture.view();
  context.composer(undefined, activeChat.props.onDraftChange);
  fixture.query.isError = true;
  fixture.view();
  fixture.query.isError = false;
  assert.equal(
    fixture.view().props.initialDraft,
    "New deliberate handoff",
    "An untouched search.prompt survives a plan-check outage through the actual composer seed effect",
  );
}

for (const kind of ["ask", "setup"]) {
  for (const query of [
    { isPending: true },
    { data: { isPro: false } },
    { isError: true, data: { isPro: true } },
    { data: { isPro: true, temporarilyUnavailable: true } },
    { data: { isPro: true } },
  ]) {
    const fixture = harness(kind, query);
    const html = fixture.html();
    const pro = query.data?.isPro && !query.isError && !query.data.temporarilyUnavailable;
    if (kind === "ask") assert.equal(html.includes("Allowed chat boundary"), Boolean(pro));
    else assert.equal(html.includes('href="https://chromewebstore.google.com/'), Boolean(pro));
    if (query.isError || query.data?.temporarilyUnavailable) {
      assert.doesNotMatch(
        html,
        /Get UniMate Pro|Explore UniMate Pro/,
        "Unknown access is not a sales gate",
      );
      assert.match(html, /another subscription/);
    }
  }
  const fixture = harness(kind, { data: { isPro: false } });
  const button = fixture
    .tree()
    .find(
      (node) => node.type === "button" && node.props.children === "Already upgraded? Check access",
    );
  assert.ok(button, `${kind}: a cached Free plan needs an explicit upgrade-return check`);
  button.props.onClick();
  assert.equal(fixture.calls(), 1);
  fixture.query.isFetching = true;
  const pendingButton = fixture.tree().find((node) => node.type === "button");
  assert.equal(pendingButton.props.disabled, true);
  pendingButton.props.onClick();
  assert.equal(
    fixture.calls(),
    1,
    "Repeated interaction while fetching cannot issue another check",
  );
  assert.ok(
    fixture
      .tree()
      .some((node) => node.props?.role === "status" && node.props["aria-live"] === "polite"),
  );
  fixture.query.isFetching = false;
  assert.match(fixture.html(), /still on Free/);
  fixture.query.isError = true;
  assert.match(fixture.html(), /another subscription/);
  fixture.query.isError = false;
  fixture.query.data = { isPro: true };
  assert.match(
    fixture.html(),
    kind === "ask" ? /Allowed chat boundary/ : /Companion access is ready/,
  );
}

const freeAsk = harness("ask", { data: { isPro: false } });
assert.match(freeAsk.html(), /href="\/dashboard"[^>]*>Back to Today/);
const unknownAsk = harness("ask", { isError: true });
assert.match(unknownAsk.html(), /href="\/dashboard"[^>]*>Back to Today/);
const setup = harness("setup", { data: { isPro: true } });
assert.match(setup.html(), /Store link configured/);
assert.doesNotMatch(setup.html(), /Public install link ready/);
setup.context.storeValue = "https://example.test/not-the-store";
assert.doesNotMatch(setup.html(), />Add to Chrome/);
assert.match(setup.html(), /Store link pending/);

console.log(
  "PASS rendered Free/unknown/Pro boundaries, explicit upgrade-return recheck, network recovery, live status and honest Store-link state",
);
