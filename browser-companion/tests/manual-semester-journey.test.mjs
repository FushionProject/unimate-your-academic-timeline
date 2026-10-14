import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";

const root = new URL("../../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const parse = (path) =>
  ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const link = ({ to, hash, children, ...props }) =>
  createElement("a", { ...props, href: `${to}${hash ? `#${hash}` : ""}` }, children);
const icon = (props) => createElement("svg", props);
function component(path, name) {
  const ast = parse(path);
  const node = ast.statements.find(
    (item) => ts.isFunctionDeclaration(item) && item.name?.text === name,
  );
  assert.ok(node, name);
  const source = ts.transpileModule(node.getText(ast), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const context = vm.createContext({
    exports: {},
    require: () => jsx,
    Link: link,
    ArrowRight: icon,
    Check: icon,
    CalendarDays: icon,
    LogoMark: icon,
  });
  vm.runInContext(`${source}\nglobalThis.component = ${name};`, context);
  return context.component;
}

const SemesterStart = component("src/components/semester-start.tsx", "SemesterStart");
for (const courseCount of [0, 1]) {
  const html = renderToStaticMarkup(
    createElement(SemesterStart, { courseCount, deadlineCount: 0, completedCount: 0 }),
  );
  assert.match(html, new RegExp(`href="#${courseCount ? "deadline" : "course"}-setup"`));
  assert.match(html, /href="\/planner"/);
  assert.doesNotMatch(
    html,
    /href="\/ask"/,
    "No-syllabus fallback must not dead-end in a Pro paywall",
  );
}
assert.equal(
  renderToStaticMarkup(
    createElement(SemesterStart, { courseCount: 1, deadlineCount: 1, completedCount: 1 }),
  ),
  "",
);

const EmptyReview = component("src/routes/results.tsx", "EmptySyllabusReview");
for (const hasReview of [false, true]) {
  const html = renderToStaticMarkup(createElement(EmptyReview, { hasReview }));
  assert.match(html, /href="\/dashboard#course-setup"/);
  assert.match(html, /href="\/planner"/);
  assert.match(html, hasReview ? /No dated items to review yet/ : /Let’s start with your syllabus/);
  assert.doesNotMatch(
    html,
    /No timeline found/,
    "Missing review is not presented as a failed extraction",
  );
}

// Exercise the actual dashboard effect with delayed query completion. The hash
// target must receive keyboard focus only after its form has rendered.
const dashboard = parse("src/routes/dashboard.tsx");
let focusEffect;
const targets = new Set();
function visit(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(dashboard) === "useEffect" &&
    node.arguments[0]?.getText(dashboard).includes('hash !== "#course-setup"')
  )
    focusEffect = node;
  if (ts.isJsxOpeningElement(node) && node.tagName.getText(dashboard) === "section") {
    const attrs = node.attributes.properties;
    const id = attrs.find((attr) => attr.name?.text === "id")?.initializer?.text;
    if (["course-setup", "deadline-setup"].includes(id)) {
      targets.add(id);
      assert.ok(
        attrs.some(
          (attr) =>
            attr.name?.text === "tabIndex" && attr.initializer.getText(dashboard) === "{-1}",
        ),
      );
      assert.ok(
        attrs.some(
          (attr) =>
            attr.name?.text === "aria-labelledby" && attr.initializer.text === `${id}-heading`,
        ),
      );
    }
  }
  ts.forEachChild(node, visit);
}
visit(dashboard);
assert.equal(targets.size, 2);
assert.ok(focusEffect);
for (const hash of ["#course-setup", "#deadline-setup", "#unrelated"]) {
  for (const [loading, loadError] of [
    [true, false],
    [false, true],
    [false, false],
  ]) {
    const events = [];
    const context = vm.createContext({
      loading,
      loadError,
      window: { location: { hash } },
      useEffect: (callback) => callback(),
      document: {
        getElementById: (id) => ({
          focus: () => events.push(`focus:${id}`),
          scrollIntoView: () => events.push(`scroll:${id}`),
        }),
      },
    });
    vm.runInContext(focusEffect.getText(dashboard), context);
    assert.deepEqual(
      events,
      !loading && !loadError && hash !== "#unrelated"
        ? [`focus:${hash.slice(1)}`, `scroll:${hash.slice(1)}`]
        : [],
    );
  }
}
console.log(
  "PASS rendered manual-setup journey links, honest empty-review states, and accessible async dashboard arrival",
);
