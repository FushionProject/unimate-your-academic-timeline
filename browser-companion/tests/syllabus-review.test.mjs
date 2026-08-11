import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const results = await readFile(new URL("../../src/routes/results.tsx", import.meta.url), "utf8");
const server = await readFile(new URL("../../src/server.ts", import.meta.url), "utf8");

assert.match(results, /z\.enum\(\["exam", "quiz", "assignment", "project", "deadline"\]\)/);
assert.match(results, /<option value="project">Project<\/option>/);
assert.match(server, /"exam" \| "quiz" \| "assignment" \| "project" \| "deadline"/);

console.log("PASS project classification in syllabus review");
