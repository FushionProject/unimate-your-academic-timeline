import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";

const results = await readFile(new URL("../../src/routes/results.tsx", import.meta.url), "utf8");
const server = await readFile(new URL("../../src/server.ts", import.meta.url), "utf8");
const parser = await readFile(
  new URL("../../src/functions/parse-syllabus.ts", import.meta.url),
  "utf8",
);

assert.match(results, /z\.enum\(\["exam", "quiz", "assignment", "project", "deadline"\]\)/);
assert.match(server, /"exam" \| "quiz" \| "assignment" \| "project" \| "deadline"/);
assert.match(parser, /z\.enum\(\["exam", "quiz", "assignment", "project", "deadline"\]\)/);
assert.match(server, /Read the entire document from beginning to end/);
assert.match(server, /every row in weekly course schedules or tables/);
assert.match(server, /scan every page marker/);
assert.match(server, /request\.signal,\s*4000,/);
assert.match(server, /buildSyllabusExtractionContext\(syllabusText\)/);
assert.match(server, /extractionMode: "local_fallback"/);
assert.match(parser, /class SyllabusParseError extends Error/);
assert.match(parser, /payload\.error \|\| "UniMate could not build this timeline right now\."/);

// Execute the actual review component and the dashboard's category function.
// Extracted types remain accepted for old drafts, but must not be presented as
// editable choices when the persisted timeline categorizes from titles only.
const ast = ts.createSourceFile(
  "results.tsx",
  results,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const declaration = (ast, name) => {
  const node = ast.statements.find(
    (item) => ts.isFunctionDeclaration(item) && item.name?.text === name,
  );
  assert.ok(node, name);
  return node;
};
const component = declaration(ast, "Results");
const stateNames = component.body.statements.flatMap((statement) =>
  ts.isVariableStatement(statement)
    ? statement.declarationList.declarations
        .filter(
          (item) =>
            ts.isCallExpression(item.initializer) &&
            item.initializer.expression.getText(ast) === "useState",
        )
        .map((item) => item.name.elements[0].getText(ast))
    : [],
);
const pressure = await readFile(
  new URL("../../src/lib/semester-pressure.ts", import.meta.url),
  "utf8",
);
const pressureAst = ts.createSourceFile("pressure.ts", pressure, ts.ScriptTarget.Latest, true);
const nodes = (tree, predicate) =>
  Array.isArray(tree)
    ? tree.flatMap((item) => nodes(item, predicate))
    : tree && typeof tree === "object"
      ? [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)]
      : [];
const values = new Map([
  [
    "items",
    [{ rowId: "row-1", title: "Chapter 4 assessment", type: "exam", due_date: "2026-11-02" }],
  ],
  ["reviewLoaded", true],
  ["draftAvailable", true],
]);
let cursor;
const context = vm.createContext({
  exports: {},
  require: () => jsx,
  useState: (initial) => {
    const name = stateNames[cursor++];
    if (!values.has(name)) values.set(name, initial);
    return [
      values.get(name),
      (next) => values.set(name, typeof next === "function" ? next(values.get(name)) : next),
    ];
  },
  useRef: (current) => ({ current }),
  useEffect() {},
  useNavigate: () => () => {},
  useAuth: () => ({ user: { id: "synthetic-student" } }),
  Route: { useSearch: () => ({ resultId: "synthetic-review" }) },
  syllabusResultStorageKey: () => "synthetic-key",
  syllabusDateToIso: () => "2026-11-02T12:00:00.000Z",
  useCourses: () => ({}),
  useAssignments: () => ({}),
  useAddCourse: () => ({}),
  useAddAssignment: () => ({}),
  ArrowLeft: () => null,
  Loader2: () => null,
  Save: () => null,
  Trash2: () => null,
});
const code = ts.transpileModule(
  `${declaration(pressureAst, "inferAcademicItemType").getText(pressureAst)}\n${component.getText(ast)}\nglobalThis.renderReview = Results;`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
vm.runInContext(code, context);
const render = () => {
  cursor = 0;
  return context.renderReview();
};
for (const [title, expected] of [
  ["Chapter 4 assessment", "assignment"],
  ["Chapter 4 exam", "exam"],
  ["Lab presentation", "project"],
  ["Draft essay", "paper"],
  ["Practice quiz", "quiz"],
]) {
  const previous = render();
  const titleInput = nodes(
    previous,
    (node) => node.props?.["aria-label"] === "Title for extracted item 1",
  )[0];
  titleInput.props.onChange({ target: { value: title } });
  const tree = render();
  const html = renderToStaticMarkup(tree);
  assert.equal(
    nodes(tree, (node) => node.type === "select").length,
    0,
    "No ineffective category-edit control",
  );
  assert.match(html, /Categories follow each item’s title/);
  const category = nodes(
    tree,
    (node) => node.props?.["aria-label"] === "Automatic category for extracted item 1",
  )[0];
  assert.ok(category, "Automatic category has an accessible label");
  assert.equal(category.type, "output", "Category is a derived result, not an editable control");
  assert.equal(category.props.children, expected);
  assert.equal(
    category.props.children,
    context.inferAcademicItemType(title),
    "Review and dashboard use identical classification",
  );
  assert.equal(
    values.get("items")[0].type,
    "exam",
    "Existing draft metadata is not mutated to fake persistence",
  );
  assert.equal(values.get("items")[0].rowId, "row-1", "Title edits retain row identity");
}

console.log("PASS syllabus review schema and rendered title-based categories matching Today");
