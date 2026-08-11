import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const results = await readFile(new URL("../../src/routes/results.tsx", import.meta.url), "utf8");
const server = await readFile(new URL("../../src/server.ts", import.meta.url), "utf8");
const parser = await readFile(
  new URL("../../src/functions/parse-syllabus.ts", import.meta.url),
  "utf8",
);

assert.match(results, /z\.enum\(\["exam", "quiz", "assignment", "project", "deadline"\]\)/);
assert.match(results, /<option value="project">Project<\/option>/);
assert.match(server, /"exam" \| "quiz" \| "assignment" \| "project" \| "deadline"/);
assert.match(parser, /z\.enum\(\["exam", "quiz", "assignment", "project", "deadline"\]\)/);
assert.match(server, /Read the entire document from beginning to end/);
assert.match(server, /every row in weekly course schedules or tables/);
assert.match(server, /scan every page marker/);
assert.match(server, /request\.signal,\s*4000,/);
assert.match(parser, /class SyllabusParseError extends Error/);
assert.match(parser, /payload\.error \|\| "UniMate could not build this timeline right now\."/);

console.log("PASS project classification in syllabus review");
