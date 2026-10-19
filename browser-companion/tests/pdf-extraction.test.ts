import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { reconstructPdfPageText } from "../../src/lib/pdf.ts";

const text = reconstructPdfPageText([
  { str: "DATE", transform: [1, 0, 0, 1, 20, 700] },
  { str: "TOPIC", transform: [1, 0, 0, 1, 180, 700] },
  { str: "Week 1", transform: [1, 0, 0, 1, 20, 680] },
  { str: "Chapter 1", transform: [1, 0, 0, 1, 180, 680] },
  { str: "Week 2", transform: [1, 0, 0, 1, 20, 660] },
  { str: "Exam 1", transform: [1, 0, 0, 1, 180, 660] },
]);

assert.equal(text, "DATE TOPIC\nWeek 1 Chapter 1\nWeek 2 Exam 1");
assert.doesNotMatch(text, /TOPIC Week 1/);

console.log("PASS PDF page row reconstruction");

// Run the unchanged extraction module with only the browser PDF library and
// worker-URL import replaced. No browser, network, AI or real student PDF is used.
const compiled = ts.transpileModule(
  readFileSync(new URL("../../src/lib/pdf.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;

function extractionFixture(
  options: {
    pages?: number;
    failure?: "load" | "page" | "text" | "file" | "import";
    cleanupFails?: boolean;
    cleanupWait?: Promise<void>;
  } = {},
) {
  const originalError = new Error(`Synthetic ${options.failure ?? "cleanup"} failure`);
  const calls = { imports: [] as string[], created: 0, destroyed: 0, pages: [] as number[] };
  const warnings: unknown[][] = [];
  const library = {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: ({ data }: { data: ArrayBuffer }) => {
      calls.created += 1;
      assert.ok(data instanceof ArrayBuffer);
      return {
        get promise() {
          if (options.failure === "load") return Promise.reject(originalError);
          return Promise.resolve({
            numPages: options.pages ?? 2,
            getPage: async (pageNumber: number) => {
              calls.pages.push(pageNumber);
              if (options.failure === "page") throw originalError;
              return {
                getTextContent: async () => {
                  if (options.failure === "text") throw originalError;
                  return {
                    items: [{ str: `Lesson ${pageNumber}`, transform: [1, 0, 0, 1, 20, 700] }],
                  };
                },
              };
            },
            // The loading-task owner must be released even when document load fails.
            destroy: async () => {
              throw new Error("Use the owning loading task for cleanup");
            },
          });
        },
        destroy: async () => {
          calls.destroyed += 1;
          await options.cleanupWait;
          if (options.cleanupFails) throw new Error("Synthetic cleanup failure");
        },
      };
    },
  };
  const context = vm.createContext({
    exports: {},
    console: { warn: (...args: unknown[]) => warnings.push(args) },
    require: (name: string) => {
      calls.imports.push(name);
      if (options.failure === "import") throw originalError;
      if (name === "pdfjs-dist") return library;
      assert.equal(name, "pdfjs-dist/build/pdf.worker.min.mjs?url");
      return { default: "/synthetic-pdf-worker.mjs" };
    },
  });
  vm.runInContext(compiled, context);
  assert.deepEqual(calls.imports, [], "PDF stays lazy and safe to import in SSR");
  const file = {
    arrayBuffer: async () => {
      if (options.failure === "file") throw originalError;
      return new ArrayBuffer(8);
    },
  };
  return {
    run: () => context.exports.extractPdfText(file) as Promise<string>,
    calls,
    warnings,
    library,
    originalError,
  };
}

{
  const fixture = extractionFixture();
  assert.equal(
    await fixture.run(),
    "--- Page 1 of 2 ---\nLesson 1\n\n--- Page 2 of 2 ---\nLesson 2",
  );
  assert.deepEqual(fixture.calls.pages, [1, 2]);
  assert.equal(fixture.calls.destroyed, 1, "Successful extraction must release its PDF worker");
  assert.equal(fixture.library.GlobalWorkerOptions.workerSrc, "/synthetic-pdf-worker.mjs");
  assert.deepEqual(fixture.warnings, []);
  await fixture.run();
  assert.equal(fixture.calls.created, 2);
  assert.equal(fixture.calls.destroyed, 2, "Repeated uploads must each release their worker");
}

for (const failure of ["load", "page", "text"] as const) {
  const fixture = extractionFixture({ failure });
  await assert.rejects(fixture.run(), (error) => error === fixture.originalError);
  assert.equal(fixture.calls.destroyed, 1, `${failure} failure must release the loading task`);
}

{
  const fixture = extractionFixture({ pages: 101 });
  await assert.rejects(fixture.run(), /PDF exceeds the 100-page limit\./);
  assert.deepEqual(fixture.calls.pages, [], "Oversized PDFs must not extract any page");
  assert.equal(fixture.calls.destroyed, 1);
  const boundary = extractionFixture({ pages: 100 });
  assert.match(await boundary.run(), /--- Page 100 of 100 ---\nLesson 100$/);
  assert.equal(boundary.calls.destroyed, 1);
}

for (const failure of ["file", "import"] as const) {
  const fixture = extractionFixture({ failure });
  await assert.rejects(fixture.run(), (error) => error === fixture.originalError);
  assert.equal(fixture.calls.created, 0);
  assert.equal(fixture.calls.destroyed, 0, "No cleanup is needed before a task exists");
}

for (const failure of [undefined, "load", "page", "text"] as const) {
  const fixture = extractionFixture({ failure, cleanupFails: true });
  if (failure) await assert.rejects(fixture.run(), (error) => error === fixture.originalError);
  else assert.match(await fixture.run(), /Lesson 2$/);
  assert.equal(fixture.calls.destroyed, 1);
  assert.deepEqual(fixture.warnings, [["PDF resources could not be fully released."]]);
}

{
  const cleanup = Promise.withResolvers<void>();
  const fixture = extractionFixture({ cleanupWait: cleanup.promise });
  let completed = false;
  const extraction = fixture.run().then(() => {
    completed = true;
  });
  // Drain a turn without a timer; extraction should still await task destruction.
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fixture.calls.destroyed, 1);
  assert.equal(completed, false);
  cleanup.resolve();
  await extraction;
  assert.equal(completed, true);
}

console.log(
  "PASS PDF extraction cleanup: success, repeat, load/page/text errors, limits and async destruction",
);
