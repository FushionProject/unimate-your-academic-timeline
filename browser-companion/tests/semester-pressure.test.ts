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
