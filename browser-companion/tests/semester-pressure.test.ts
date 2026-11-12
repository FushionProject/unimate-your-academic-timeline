import assert from "node:assert/strict";
import {
  buildDailyBrief,
  buildPressureItems,
  buildSemesterWeeks,
  describePressureWeek,
  inferAcademicItemType,
  pressureLevel,
} from "../../src/lib/semester-pressure.ts";
import type { Assignment, Course } from "../../src/lib/courses.ts";
import { syllabusDateToIso } from "../../src/lib/syllabus-review.ts";
import { courseworkEvidence } from "../../src/lib/coursework-grounding.ts";

const courses = [
  {
    id: "biology",
    user_id: "student",
    name: "Biology",
    course_code: "BIO 101",
    score: null,
    grade: null,
    created_at: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "calculus",
    user_id: "student",
    name: "Calculus",
    course_code: "MATH 201",
    score: null,
    grade: null,
    created_at: "2026-08-01T00:00:00.000Z",
  },
] satisfies Course[];

const assignments = [
  {
    id: "exam",
    user_id: "student",
    course_id: "biology",
    name: "Midterm exam",
    due_at: "2026-09-15T12:00:00.000Z",
    completed: false,
    created_at: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "project",
    user_id: "student",
    course_id: "calculus",
    name: "Modeling project",
    due_at: "2026-09-17T12:00:00.000Z",
    completed: false,
    created_at: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "quiz",
    user_id: "student",
    course_id: "biology",
    name: "Chapter quiz",
    due_at: "2026-09-18T12:00:00.000Z",
    completed: false,
    created_at: "2026-08-01T00:00:00.000Z",
  },
] satisfies Assignment[];

assert.equal(inferAcademicItemType("Final exam"), "exam");
assert.equal(inferAcademicItemType("Research paper"), "paper");
assert.equal(inferAcademicItemType("Weekly worksheet"), "assignment");
assert.equal(pressureLevel(0), "empty");
assert.equal(pressureLevel(5), "busy");
assert.equal(pressureLevel(6), "overloaded");

const items = buildPressureItems(assignments, courses);
const weeks = buildSemesterWeeks(items, new Date("2026-08-24T12:00:00.000Z"));
const crowdedWeek = weeks.find((week) => week.items.length === 3);

assert.ok(crowdedWeek, "the three clustered deadlines should share a week");
assert.equal(crowdedWeek.level, "moderate");
assert.match(describePressureWeek(crowdedWeek), /3 deadlines across 2 courses/);
assert.equal(weeks.length, 16, "a semester map should show at least sixteen weeks");

for (const completed of [true, false]) {
  const retainedItems = buildPressureItems(
    [
      { ...assignments[0], id: "old", due_at: "2026-01-15T12:00:00Z", completed },
      { ...assignments[1], id: "current", due_at: "2026-11-12T12:00:00Z" },
      { ...assignments[2], id: "far-future", due_at: "2028-01-15T12:00:00Z" },
    ],
    courses,
  );
  const currentWeeks = buildSemesterWeeks(retainedItems, new Date("2026-11-11T12:00:00Z"));
  assert.ok(
    currentWeeks.some((week) => week.items.some((item) => item.id === "current")),
    "Retained deadlines from old terms must not hide current deadlines",
  );
  assert.ok(currentWeeks.length <= 26, "A distant date must not create an unbounded map");
  assert.equal(retainedItems.length, 3, "Outside-window items stay available in the timeline");
}

// Noon is only the storage convention for a calendar date, never a known due time.
const dateOnlyEvidence = JSON.parse(
  courseworkEvidence(
    courses,
    [{ ...assignments[0], due_at: syllabusDateToIso("2026-11-12")! }],
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    new Date("2026-11-11T12:00:00Z"),
  ).evidence,
);
assert.equal(dateOnlyEvidence.openAssignments[0].due, "Thursday, November 12, 2026");
assert.match(dateOnlyEvidence.deadlinePrecision, /times are not recorded/);
assert.doesNotMatch(dateOnlyEvidence.openAssignments[0].due, /12:00|AM|PM/);

const dailyItems = buildPressureItems(
  [
    { ...assignments[0], id: "overdue", name: "Late lab", due_at: "2026-09-14T12:00:00.000Z" },
    { ...assignments[1], id: "today", name: "Problem set", due_at: "2026-09-15T12:00:00.000Z" },
    { ...assignments[2], id: "next", name: "Reading", due_at: "2026-09-16T12:00:00.000Z" },
    {
      ...assignments[2],
      id: "done",
      name: "Finished quiz",
      completed: true,
      due_at: "2026-09-15T12:00:00.000Z",
    },
  ],
  courses,
);
const dailyBrief = buildDailyBrief(dailyItems, new Date("2026-09-15T08:00:00.000Z"));
assert.equal(dailyBrief.focus?.id, "overdue", "catch-up work should be surfaced first");
assert.deepEqual(
  dailyBrief.overdue.map((item) => item.id),
  ["overdue"],
);
assert.deepEqual(
  dailyBrief.dueToday.map((item) => item.id),
  ["today"],
);
assert.deepEqual(
  dailyBrief.upcoming.map((item) => item.id),
  ["next"],
);
assert.equal(dailyBrief.completedCount, 1);
assert.equal(dailyBrief.totalCount, 4);

console.log("PASS transparent semester pressure and daily brief calculations");
