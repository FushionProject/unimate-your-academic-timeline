export type CourseFact = { id: string; name: string; course_code: string };
export type AssignmentFact = {
  course_id: string;
  name: string;
  due_at: string;
  completed: boolean;
};

export function studentTimeZone(value: unknown): string {
  if (typeof value !== "string" || value.length > 80) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

/** These are saved planner facts, not the original syllabus or an LMS snapshot. */
export function courseworkEvidence(
  courses: CourseFact[],
  assignments: AssignmentFact[],
  timezone: unknown,
  now = new Date(),
) {
  const timeZone = studentTimeZone(timezone);
  const date = new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "full" });
  const dueDate = new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
  });
  const names = new Map(courses.map((course) => [course.id, course.name]));
  const items = assignments
    .filter((item) => names.has(item.course_id) && !item.completed)
    .slice(0, 40);
  const evidence = JSON.stringify({
    today: date.format(now),
    timeZone,
    courses: courses.slice(0, 30).map((course) => ({
      name: course.name.slice(0, 150),
      code: course.course_code?.slice(0, 40),
    })),
    openAssignments: items.map((item) => ({
      course: names.get(item.course_id)?.slice(0, 150),
      title: item.name.slice(0, 200),
      due: Number.isNaN(Date.parse(item.due_at))
        ? "Unknown"
        : dueDate.format(new Date(item.due_at)),
    })),
  });
  return {
    evidence,
    grounding: courses.length
      ? {
          label: "Your saved coursework",
          detail: `${courses.length} course${courses.length === 1 ? "" : "s"} and ${items.length} open assignment${items.length === 1 ? "" : "s"} considered (up to 30 upcoming and 10 recent overdue). Saved planner data may be incomplete; confirm deadlines with your instructor.`,
        }
      : {
          label: "General study help",
          detail:
            "No saved courses yet. Add your semester for help grounded in your planner. General explanations are not citations from a syllabus.",
        },
  };
}
