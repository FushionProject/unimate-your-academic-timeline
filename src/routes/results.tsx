import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CalendarDays, CheckCircle2, Loader2, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { useAddAssignment, useAddCourse, useAssignments, useCourses } from "../lib/courses";
import { useAuth } from "../lib/auth-context";
import { SYLLABUS_RESULT_STORAGE_PREFIX } from "../lib/syllabus-results";

const itemSchema = z.object({
  title: z.string(),
  type: z.enum(["exam", "quiz", "assignment", "deadline"]),
  due_date: z.string(),
});

type SyllabusItem = z.infer<typeof itemSchema>;

const storedResultSchema = z.object({
  items: z.array(itemSchema),
  syllabusText: z.string().optional(),
});

const searchSchema = z.object({ resultId: z.string().optional() });

export const Route = createFileRoute("/results")({
  component: Results,
  validateSearch: searchSchema,
});

function Results() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { resultId } = Route.useSearch();
  const [items, setItems] = useState<SyllabusItem[]>(() => {
    if (!resultId || typeof window === "undefined") return [];
    const stored = sessionStorage.getItem(`${SYLLABUS_RESULT_STORAGE_PREFIX}${resultId}`);
    if (!stored) return [];
    try {
      return storedResultSchema.parse(JSON.parse(stored)).items;
    } catch {
      return [];
    }
  });
  const [courseName, setCourseName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const { data: courses = [] } = useCourses();
  const { data: assignments = [] } = useAssignments();
  const addCourse = useAddCourse();
  const addAssignment = useAddAssignment();
  const hasIncompleteItems = items.some((item) => !item.title.trim() || !item.due_date);

  const updateItem = (index: number, patch: Partial<SyllabusItem>) => {
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  };

  const saveSemester = async () => {
    if (!user || !courseName.trim() || items.length === 0 || hasIncompleteItems) return;
    setSaving(true);
    setSaveMessage("");
    try {
      const normalizedName = courseName.trim().toLowerCase();
      const normalizedCode = courseCode.trim().toLowerCase();
      const existingCourse = courses.find(
        (course) =>
          course.name.trim().toLowerCase() === normalizedName ||
          (normalizedCode && course.course_code.trim().toLowerCase() === normalizedCode),
      );
      const course =
        existingCourse ||
        (await addCourse.mutateAsync({
          name: courseName.trim(),
          course_code: courseCode.trim(),
        }));

      let added = 0;
      let skipped = 0;
      for (const item of items) {
        const dueAt = new Date(`${item.due_date}T12:00:00`).toISOString();
        const duplicate = assignments.some(
          (assignment) =>
            assignment.course_id === course.id &&
            assignment.name.trim().toLowerCase() === item.title.trim().toLowerCase() &&
            new Date(assignment.due_at).toDateString() === new Date(dueAt).toDateString(),
        );
        if (duplicate) {
          skipped += 1;
          continue;
        }
        await addAssignment.mutateAsync({
          name: item.title.trim(),
          course_id: course.id,
          due_at: dueAt,
        });
        added += 1;
      }
      setSaved(true);
      setSaveMessage(
        `${added} item${added === 1 ? "" : "s"} added to the semester map${skipped ? `; ${skipped} duplicate${skipped === 1 ? " was" : "s were"} skipped` : ""}.`,
      );
      if (resultId) sessionStorage.removeItem(`${SYLLABUS_RESULT_STORAGE_PREFIX}${resultId}`);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "The semester could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          onClick={() => navigate({ to: "/planner" })}
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to syllabus
        </button>

        {items.length === 0 && !saved ? (
          <div className="rounded-3xl border border-border bg-card p-10 text-center shadow-[var(--shadow-card)]">
            <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground" />
            <h1 className="mt-4 text-2xl font-bold text-foreground">No timeline found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Upload or paste a syllabus to extract its dated items.
            </p>
            <Link
              to="/planner"
              className="mt-5 inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Upload syllabus
            </Link>
          </div>
        ) : (
          <>
            <header className="mb-7">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                Review first
              </p>
              <h1 className="mt-2 text-3xl font-bold text-foreground">
                Confirm your semester timeline
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Fix titles or dates and remove anything UniMate misunderstood. Only the items below
                will be saved to your pressure map.
              </p>
            </header>

            {!saved && (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_320px]">
                <section className="rounded-3xl border border-border/60 bg-card/80 p-5 shadow-[var(--shadow-card)] sm:p-6">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h2 className="font-semibold text-foreground">Extracted dates</h2>
                    <span className="text-xs text-muted-foreground" aria-live="polite">
                      {items.length} {items.length === 1 ? "item" : "items"}
                    </span>
                  </div>
                  <div className="max-h-[650px] space-y-3 overflow-y-auto pr-1">
                    {items.map((item, index) => (
                      <div
                        key={`${item.title}-${index}`}
                        className="rounded-2xl border border-border/60 bg-background/65 p-4"
                      >
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_130px_145px_auto] sm:items-center">
                          <input
                            value={item.title}
                            onChange={(event) => updateItem(index, { title: event.target.value })}
                            aria-label={`Title for extracted item ${index + 1}`}
                            aria-invalid={!item.title.trim()}
                            className="min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          />
                          <select
                            value={item.type}
                            onChange={(event) =>
                              updateItem(index, {
                                type: event.target.value as SyllabusItem["type"],
                              })
                            }
                            aria-label={`Type for ${item.title}`}
                            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <option value="assignment">Assignment</option>
                            <option value="quiz">Quiz</option>
                            <option value="exam">Exam</option>
                            <option value="deadline">Other date</option>
                          </select>
                          <input
                            type="date"
                            value={item.due_date}
                            onChange={(event) =>
                              updateItem(index, { due_date: event.target.value })
                            }
                            aria-label={`Date for ${item.title}`}
                            aria-invalid={!item.due_date}
                            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setItems((current) =>
                                current.filter((_, itemIndex) => itemIndex !== index),
                              )
                            }
                            aria-label={`Remove ${item.title}`}
                            className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <aside className="h-fit rounded-3xl border border-border/60 bg-card/80 p-5 shadow-[var(--shadow-card)]">
                  <h2 className="font-semibold text-foreground">Save as a course</h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    These dates will become one course on your dashboard.
                  </p>
                  <div className="mt-4 space-y-2.5">
                    <input
                      value={courseName}
                      onChange={(event) => setCourseName(event.target.value)}
                      placeholder="Course name"
                      aria-label="Course name"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    />
                    <input
                      value={courseCode}
                      onChange={(event) => setCourseCode(event.target.value)}
                      placeholder="Course code (optional)"
                      aria-label="Course code"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    />
                    {user ? (
                      <button
                        type="button"
                        onClick={saveSemester}
                        disabled={
                          saving || !courseName.trim() || items.length === 0 || hasIncompleteItems
                        }
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-45"
                      >
                        {saving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}{" "}
                        Save semester map
                      </button>
                    ) : (
                      <Link
                        to="/signin"
                        className="inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
                      >
                        Sign in to save
                      </Link>
                    )}
                  </div>
                  {saveMessage && (
                    <p className="mt-3 text-xs text-muted-foreground" role="status">
                      {saveMessage}
                    </p>
                  )}
                  {hasIncompleteItems && (
                    <p className="mt-3 text-xs text-destructive" role="alert">
                      Add a title and date to every item before saving.
                    </p>
                  )}
                </aside>
              </div>
            )}

            {saved && (
              <div className="rounded-3xl border border-[#F5C518]/40 bg-[#F5C518]/10 p-8 text-center">
                <CheckCircle2 className="mx-auto h-9 w-9 text-primary" />
                <h2 className="mt-4 text-xl font-bold text-foreground">Semester map saved</h2>
                <p className="mt-2 text-sm text-muted-foreground">{saveMessage}</p>
                <Link
                  to="/dashboard"
                  className="mt-5 inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
                >
                  View dashboard
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
