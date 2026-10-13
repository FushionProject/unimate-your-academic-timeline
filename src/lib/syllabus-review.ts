export function syllabusDateToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(`${value}T12:00:00`);
  if (
    year < 1000 ||
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() + 1 !== month ||
    date.getDate() !== day
  )
    return null;
  return date.toISOString();
}

export function syllabusAssignmentKey(name: string, dueAt: string): string {
  const date = new Date(dueAt);
  return JSON.stringify([
    name.trim().toLowerCase(),
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ]);
}

export function validateSyllabusCheckpoint(
  checkpoint: { userId: string | null; courseId?: string; confirmed: Set<string> },
  userId: string,
  courses: readonly { id: string; user_id: string }[],
) {
  const valid =
    checkpoint.userId === userId &&
    courses.some((course) => course.id === checkpoint.courseId && course.user_id === userId);
  if (!valid) {
    checkpoint.courseId = undefined;
    checkpoint.confirmed.clear();
  }
  checkpoint.userId = userId;
  return checkpoint.courseId;
}

// Keep the confirmed successes between attempts, even before query caches refresh.
// A fresh server snapshot is also required by the caller before retrying.
export async function saveReviewedItems({
  items,
  courseId,
  existing,
  confirmed,
  add,
  onProgress,
  assertCurrent = () => {},
}: {
  items: readonly { title: string; due_date: string }[];
  courseId: string;
  existing: readonly { course_id: string; name: string; due_at: string }[];
  confirmed: Set<string>;
  add: (input: { course_id: string; name: string; due_at: string }) => Promise<unknown>;
  onProgress?: (saved: number, total: number) => void;
  assertCurrent?: () => void;
}) {
  // Validate the entire review before any write; JS silently rolls February 30 into March.
  const validated = items.map((item) => {
    const due_at = syllabusDateToIso(item.due_date);
    if (!item.title.trim() || !due_at)
      throw new Error("Add a title and valid date to every item before saving.");
    return { course_id: courseId, name: item.title.trim(), due_at };
  });
  const known = new Set(
    existing
      .filter((item) => item.course_id === courseId)
      .map((item) => syllabusAssignmentKey(item.name, item.due_at)),
  );
  let added = 0;
  let skipped = 0;
  for (const input of validated) {
    assertCurrent();
    const key = syllabusAssignmentKey(input.name, input.due_at);
    if (known.has(key) || confirmed.has(key)) {
      skipped += 1;
    } else {
      await add(input);
      assertCurrent();
      confirmed.add(key);
      known.add(key);
      added += 1;
    }
    onProgress?.(added + skipped, validated.length);
  }
  return { added, skipped };
}
