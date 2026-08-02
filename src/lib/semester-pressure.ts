import { addWeeks, differenceInCalendarWeeks, endOfWeek, format, startOfWeek } from "date-fns";
import type { Assignment, Course } from "./courses";

export type AcademicItemType = "exam" | "project" | "paper" | "quiz" | "assignment";
export type PressureLevel = "empty" | "light" | "moderate" | "busy" | "overloaded";

export interface PressureItem extends Assignment {
  course?: Course;
  itemType: AcademicItemType;
  pressureWeight: number;
}

export interface PressureWeek {
  id: string;
  start: Date;
  end: Date;
  label: string;
  shortLabel: string;
  items: PressureItem[];
  pressure: number;
  level: PressureLevel;
}

export interface DailyBrief {
  focus: PressureItem | null;
  dueToday: PressureItem[];
  overdue: PressureItem[];
  upcoming: PressureItem[];
  completedCount: number;
  totalCount: number;
}

function calendarDayKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Builds a calm, deterministic daily brief from the deadline data already loaded. */
export function buildDailyBrief(items: PressureItem[], today = new Date()): DailyBrief {
  const todayKey = calendarDayKey(today);
  const unfinished = items.filter((item) => !item.completed);
  const dueToday = unfinished.filter((item) => calendarDayKey(new Date(item.due_at)) === todayKey);
  const overdue = unfinished.filter((item) => calendarDayKey(new Date(item.due_at)) < todayKey);
  const upcoming = unfinished.filter((item) => calendarDayKey(new Date(item.due_at)) > todayKey);

  return {
    focus: overdue[0] || dueToday[0] || upcoming[0] || null,
    dueToday,
    overdue,
    upcoming,
    completedCount: items.filter((item) => item.completed).length,
    totalCount: items.length,
  };
}

export function inferAcademicItemType(name: string): AcademicItemType {
  const normalized = name.toLowerCase();
  if (/\b(midterm|final|exam|test)\b/.test(normalized)) return "exam";
  if (/\b(project|presentation|portfolio)\b/.test(normalized)) return "project";
  if (/\b(paper|essay|report|proposal)\b/.test(normalized)) return "paper";
  if (/\bquiz\b/.test(normalized)) return "quiz";
  return "assignment";
}

export function pressureLevel(pressure: number): PressureLevel {
  if (pressure <= 0) return "empty";
  if (pressure <= 1) return "light";
  if (pressure <= 3) return "moderate";
  if (pressure <= 5) return "busy";
  return "overloaded";
}

export function buildPressureItems(assignments: Assignment[], courses: Course[]): PressureItem[] {
  return assignments
    .filter(
      (assignment) => assignment.due_at && !Number.isNaN(new Date(assignment.due_at).getTime()),
    )
    .map((assignment) => {
      const itemType = inferAcademicItemType(assignment.name);
      return {
        ...assignment,
        course: courses.find((course) => course.id === assignment.course_id),
        itemType,
        // Pressure measures deadline density, not an inferred difficulty.
        pressureWeight: assignment.completed ? 0 : 1,
      };
    })
    .sort((left, right) => new Date(left.due_at).getTime() - new Date(right.due_at).getTime());
}

export function buildSemesterWeeks(items: PressureItem[], today = new Date()): PressureWeek[] {
  const validDates = items.map((item) => new Date(item.due_at));
  const earliest = validDates[0];
  const latest = validDates[validDates.length - 1];
  const currentWeek = startOfWeek(today, { weekStartsOn: 1 });
  const firstWeek = earliest
    ? startOfWeek(earliest < currentWeek ? earliest : currentWeek, { weekStartsOn: 1 })
    : currentWeek;
  const minimumEnd = addWeeks(firstWeek, 15);
  const desiredEnd = latest && latest > minimumEnd ? latest : minimumEnd;
  const weekCount = Math.min(
    26,
    Math.max(16, differenceInCalendarWeeks(desiredEnd, firstWeek, { weekStartsOn: 1 }) + 1),
  );

  return Array.from({ length: weekCount }, (_, index) => {
    const start = addWeeks(firstWeek, index);
    const end = endOfWeek(start, { weekStartsOn: 1 });
    const weekItems = items.filter((item) => {
      const due = new Date(item.due_at);
      return due >= start && due <= end;
    });
    const pressure = weekItems.reduce((sum, item) => sum + item.pressureWeight, 0);
    return {
      id: format(start, "yyyy-MM-dd"),
      start,
      end,
      label: `${format(start, "MMM d")}–${format(end, "MMM d")}`,
      shortLabel: format(start, "MMM d"),
      items: weekItems,
      pressure,
      level: pressureLevel(pressure),
    };
  });
}

export function describePressureWeek(week: PressureWeek): string {
  if (week.items.length === 0) return "No saved deadlines in this week.";
  const courseCount = new Set(week.items.map((item) => item.course_id)).size;
  const majorCount = week.items.filter(
    (item) => item.itemType === "exam" || item.itemType === "project",
  ).length;
  const deadlineLabel = `${week.items.length} deadline${week.items.length === 1 ? "" : "s"}`;
  const courseLabel = `${courseCount} course${courseCount === 1 ? "" : "s"}`;
  if (majorCount > 0) {
    return `${deadlineLabel} across ${courseLabel}, including ${majorCount} major ${majorCount === 1 ? "item" : "items"}.`;
  }
  return `${deadlineLabel} across ${courseLabel}.`;
}
