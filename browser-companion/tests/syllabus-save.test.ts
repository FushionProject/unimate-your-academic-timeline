import assert from "node:assert/strict";
import {
  saveReviewedItems,
  syllabusDateToIso,
  validateSyllabusCheckpoint,
} from "../../src/lib/syllabus-review.ts";

for (const invalid of [
  "",
  "2025-02-29",
  "2026-02-30",
  "2026-13-01",
  "2026-1-01",
  "2026-01-01T00:00:00",
  "0999-01-01",
]) {
  assert.equal(syllabusDateToIso(invalid), null, `reject invalid calendar date ${invalid}`);
}
assert.ok(syllabusDateToIso("2028-02-29"), "accept leap day in a leap year");

const items = [
  { title: "Essay", due_date: "2026-10-20" },
  { title: " essay ", due_date: "2026-10-20" },
  { title: "Quiz", due_date: "2026-10-22" },
  { title: "Essay", due_date: "2026-10-27" },
];
type Saved = { course_id: string; name: string; due_at: string };
const writes: Saved[] = [];
const confirmed = new Set<string>();
let shouldFail = true;
const add = async (input: Saved) => {
  if (shouldFail && input.name === "Quiz") throw new Error("Simulated connection loss");
  writes.push(input);
};
await assert.rejects(
  saveReviewedItems({ items, courseId: "course-1", existing: [], confirmed, add }),
  /connection loss/,
);
assert.equal(writes.length, 1, "a repeated extraction row isn't inserted twice in one attempt");
assert.equal(confirmed.size, 1, "successful writes survive a partial failure");
shouldFail = false;
const retried = await saveReviewedItems({
  items,
  courseId: "course-1",
  existing: [],
  confirmed,
  add,
});
assert.deepEqual(retried, { added: 2, skipped: 2 });
assert.equal(
  writes.length,
  3,
  "retry doesn't duplicate confirmed writes even with a stale snapshot",
);

const repeatedImport = await saveReviewedItems({
  items,
  courseId: "course-1",
  existing: writes,
  confirmed: new Set(),
  add,
});
assert.deepEqual(
  repeatedImport,
  { added: 0, skipped: 4 },
  "a fresh snapshot dedupes a reopened review",
);

const otherCourse = await saveReviewedItems({
  items: items.slice(0, 1),
  courseId: "course-2",
  existing: writes,
  confirmed: new Set(),
  add,
});
assert.equal(otherCourse.added, 1, "same title/date in another class is distinct");

const beforeInvalid = writes.length;
await assert.rejects(
  saveReviewedItems({
    items: [items[0], { title: "Invalid date", due_date: "2026-02-30" }],
    courseId: "course-3",
    existing: [],
    confirmed: new Set(),
    add,
  }),
  /valid date/,
);
assert.equal(writes.length, beforeInvalid, "the whole review is validated before any write");

const checkpoint: { userId: string | null; courseId?: string; confirmed: Set<string> } = {
  userId: "student-a",
  courseId: "partial-course",
  confirmed: new Set(["already-saved"]),
};
assert.equal(
  validateSyllabusCheckpoint(checkpoint, "student-a", [
    { id: "partial-course", user_id: "student-a" },
  ]),
  "partial-course",
);
assert.equal(checkpoint.confirmed.size, 1, "valid retry retains successes for this account/course");
assert.equal(
  validateSyllabusCheckpoint(checkpoint, "student-a", []),
  undefined,
  "deleted partial course cannot be reused",
);
assert.equal(checkpoint.confirmed.size, 0, "recreated course must receive every reviewed date");

checkpoint.courseId = "partial-course";
checkpoint.confirmed.add("already-saved");
assert.equal(
  validateSyllabusCheckpoint(checkpoint, "student-b", [
    { id: "partial-course", user_id: "student-b" },
  ]),
  undefined,
  "account change invalidates the old checkpoint even if an id is reused",
);
assert.equal(checkpoint.userId, "student-b");
assert.equal(checkpoint.confirmed.size, 0);
checkpoint.courseId = "foreign-course";
checkpoint.confirmed.add("foreign-date");
assert.equal(
  validateSyllabusCheckpoint(checkpoint, "student-b", [
    { id: "foreign-course", user_id: "student-a" },
  ]),
  undefined,
  "snapshot rows must belong to the current account",
);
assert.equal(checkpoint.confirmed.size, 0);

let currentAccount = "student-a";
const guardedWrites: Saved[] = [];
const guardedConfirmed = new Set<string>();
const assertCurrent = () => {
  if (currentAccount !== "student-a") throw new Error("Account changed");
};
await assert.rejects(
  saveReviewedItems({
    items,
    courseId: "course-a",
    existing: [],
    confirmed: guardedConfirmed,
    assertCurrent,
    add: async (input) => {
      guardedWrites.push(input);
      currentAccount = "student-b";
    },
  }),
  /Account changed/,
);
assert.equal(
  guardedWrites.length,
  1,
  "an account change during an awaited save prevents all subsequent writes",
);
assert.equal(
  guardedConfirmed.size,
  0,
  "the old response cannot update the new account's checkpoint",
);
await assert.rejects(
  saveReviewedItems({
    items,
    courseId: "course-a",
    existing: [],
    confirmed: guardedConfirmed,
    assertCurrent,
    add: async (input) => {
      guardedWrites.push(input);
    },
  }),
  /Account changed/,
);
assert.equal(
  guardedWrites.length,
  1,
  "an account change during initial reads prevents the first write",
);

console.log(
  "PASS syllabus validation, duplicates, deleted-course recovery, and account-change write guards",
);
