import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

// Execute the real API clients against synthetic responses. This protects the
// response/error contract when the schema library changes major versions.
function client(file) {
  const source = fs.readFileSync(
    new URL(`../../src/functions/${file}.ts`, import.meta.url),
    "utf8",
  );
  const exports = {};
  const calls = [];
  let response;
  const context = vm.createContext({
    exports,
    crypto,
    fetch: async (url, options) => {
      assert.ok(url.startsWith("/api/"), "Only synthetic local API routes are allowed");
      assert.ok(response, "Every request must have an explicit fixture response");
      calls.push({ url, options });
      return response.clone();
    },
    require: (specifier) => {
      if (specifier === "zod") return { z };
      if (specifier === "../lib/auth-fetch") {
        return { getAuthHeaders: async () => ({ Authorization: "Bearer synthetic-session" }) };
      }
      throw new Error(`Unexpected import: ${specifier}`);
    },
  });
  vm.runInContext(
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    context,
  );
  return { exports, calls, respond: (value) => (response = value) };
}

const access = { expectedUserId: "synthetic-student" };
const cases = [
  {
    file: "ask-unimate",
    method: "askUniMate",
    input: { question: "Explain opportunity cost", selectedCourseId: "course-1" },
    valid: {
      answer: "The best alternative you give up.",
      webResults: [],
      grounding: { label: "Your saved coursework", detail: "Course names and dates only." },
      usage: { used: 1, limit: 750, period: "2026-11" },
    },
    invalid: { answer: "An answer", webResults: [{ title: "Missing link and snippet" }] },
  },
  {
    file: "parse-syllabus",
    method: "parseSyllabus",
    input: { syllabusText: "Essay due November 12" },
    valid: { items: [{ title: "Essay", type: "assignment", due_date: "2026-11-12" }] },
    invalid: { items: [{ title: "Essay", type: "unsupported", due_date: "2026-11-12" }] },
  },
  {
    file: "extract-resources",
    method: "extractResources",
    input: { syllabusText: "Office hours on Tuesday" },
    valid: { resources: [{ type: "office_hours", title: "Office hours", details: "Tuesday" }] },
    invalid: { resources: [{ type: "office_hours", title: "Office hours", details: 123 }] },
  },
  {
    file: "generate-study-map",
    method: "generateStudyMap",
    input: { items: [{ title: "Exam", type: "exam", due_date: "2026-11-20" }] },
    valid: {
      study_tasks: [
        {
          title: "Review concepts",
          description: "Recall the key concepts",
          start_date: "2026-11-18",
          end_date: "2026-11-19",
          estimated_hours: 1.5,
          priority: "high",
          related_to: "Exam",
        },
      ],
    },
    invalid: { study_tasks: [{ title: "Incomplete task" }] },
  },
];

for (const fixture of cases) {
  const api = client(fixture.file);
  api.respond(Response.json(fixture.valid));
  const result = await api.exports[fixture.method](fixture.input, access);
  assert.deepEqual(result, fixture.valid, `${fixture.file} preserves valid response data`);
  assert.equal(api.calls[0].url, `/api/${fixture.file}`);
  assert.equal(api.calls[0].options.headers.Authorization, "Bearer synthetic-session");
  assert.deepEqual(JSON.parse(api.calls[0].options.body), {
    ...fixture.input,
    ...(fixture.file === "ask-unimate" ? { mode: "normal" } : {}),
  });
  api.respond(Response.json(fixture.invalid));
  await assert.rejects(
    api.exports[fixture.method](fixture.input, access),
    (error) => error instanceof z.ZodError,
    `${fixture.file} rejects malformed success responses`,
  );
}

const ask = client("ask-unimate");
ask.respond(
  Response.json(
    { error: "AI help is paused", code: "AI_BILLING_UNAVAILABLE", retryable: false },
    { status: 503 },
  ),
);
await assert.rejects(
  ask.exports.askUniMate({ question: "Help" }, access),
  (error) => error.status === 503 && error.code === "AI_BILLING_UNAVAILABLE" && !error.retryable,
);
ask.respond(
  Response.json({ error: { privateProviderDetail: "must not become UI copy" } }, { status: 502 }),
);
await assert.rejects(
  ask.exports.askUniMate({ question: "Help" }, access),
  (error) => error.status === 502 && error.message === "UniMate couldn't finish that response.",
);

const syllabus = client("parse-syllabus");
syllabus.respond(
  Response.json(
    { error: "Monthly allowance reached", code: "QUOTA_EXCEEDED" },
    { status: 429, headers: { "retry-after": "7" } },
  ),
);
await assert.rejects(
  syllabus.exports.parseSyllabus({ syllabusText: "An assignment" }, access),
  (error) =>
    error.status === 429 && error.code === "QUOTA_EXCEEDED" && error.retryAfterSeconds === 7,
);
console.log(
  "PASS API schema migration: real clients accept valid data, reject malformed responses, and preserve safe error contracts (offline)",
);
