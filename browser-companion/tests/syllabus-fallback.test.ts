import assert from "node:assert/strict";
import {
  buildSyllabusExtractionContext,
  extractDatedSyllabusItems,
} from "../../src/lib/syllabus-extraction.ts";

const sample = `--- Page 1 of 3 ---
ACC 230 Fall 2026
This long policy paragraph should not dominate extraction.
Students must follow every institutional policy.
--- Page 2 of 3 ---
IMPORTANT DATES
Last day to withdraw: November 6.
ESG Data Project Deadline Oct. 16
--- Page 3 of 3 ---
CLASS SCHEDULE
Week 1 – session 1 Review syllabus
(begin 8/17/26)
Week 1 – session 2 Finish Chapter 1
Week 2 – session 1 Exam 1 (begin 8/24/26)
Week beginning - Fall Break - No Class
11/23/26`;

const context = buildSyllabusExtractionContext(sample);
assert.match(context, /Week 1 – session 2/);
assert.match(context, /ESG Data Project Deadline Oct\. 16/);

const items = extractDatedSyllabusItems(context);
assert.ok(
  items.some((item) => item.title.includes("Week 1 – session 1") && item.due_date === "2026-08-17"),
);
assert.ok(
  items.some((item) => item.title.includes("Week 1 – session 2") && item.due_date === "2026-08-17"),
);
assert.ok(items.some((item) => item.type === "exam" && item.due_date === "2026-08-24"));
assert.ok(
  items.some((item) => item.title.includes("Fall Break") && item.due_date === "2026-11-23"),
);
assert.ok(items.some((item) => item.type === "project" && item.due_date === "2026-10-16"));

console.log("PASS compact syllabus context and provider-independent fallback");
