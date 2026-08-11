import assert from "node:assert/strict";
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
