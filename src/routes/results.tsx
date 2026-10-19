import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Loader2,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAddAssignment, useAddCourse, useAssignments, useCourses } from "../lib/courses";
import { useAuth } from "../lib/auth-context";
import { ProtectedRoute } from "../components/protected-route";
import { syllabusResultStorageKey } from "../lib/syllabus-results";
import { askJourneyHref } from "../lib/journey-experience";
import { inferAcademicItemType } from "../lib/semester-pressure";
import { removeBrowserStorage, writeBrowserStorage } from "../lib/browser-storage";
import {
  saveReviewedItems,
  syllabusDateToIso,
  validateSyllabusCheckpoint,
} from "../lib/syllabus-review";

const itemSchema = z.object({
  title: z.string(),
  type: z.enum(["exam", "quiz", "assignment", "project", "deadline"]),
  due_date: z.string(),
});

type SyllabusItem = z.infer<typeof itemSchema>;

// Each editable row needs an identity that survives title edits — keying rows
// on the title remounts the input mid-keystroke and drops focus.
type EditableSyllabusItem = SyllabusItem & { rowId: string };

const storedResultSchema = z.object({
  userId: z.string(),
  items: z.array(itemSchema),
  syllabusText: z.string().optional(),
  courseName: z.string().optional(),
  courseCode: z.string().optional(),
});

const searchSchema = z.object({ resultId: z.string().optional() });

export const Route = createFileRoute("/results")({
  component: ResultsRoute,
  validateSearch: searchSchema,
});

function ResultsRoute() {
  const { user } = useAuth();
  const { resultId } = Route.useSearch();
  return (
    <ProtectedRoute>
      <Results key={`${user?.id ?? "signed-out"}:${resultId ?? ""}`} />
    </ProtectedRoute>
  );
}

function Results() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { resultId } = Route.useSearch();
  const storageKey = syllabusResultStorageKey(user?.id, resultId);
  const [items, setItems] = useState<EditableSyllabusItem[]>([]);
  const [reviewLoaded, setReviewLoaded] = useState(false);
  const [draftAvailable, setDraftAvailable] = useState(false);
  const [draftWarning, setDraftWarning] = useState("");
  const [syllabusText, setSyllabusText] = useState<string>();
  const [courseName, setCourseName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [savedCourseId, setSavedCourseId] = useState<string>();
  const coursesQuery = useCourses();
  const assignmentsQuery = useAssignments();
  const saveInFlight = useRef(false);
  const checkpoint = useRef<{ userId: string | null; courseId?: string; confirmed: Set<string> }>({
    userId: user?.id ?? null,
    confirmed: new Set(),
  });
  const accountScope = useRef({ userId: user?.id ?? null });
  if (accountScope.current.userId !== (user?.id ?? null))
    accountScope.current = { userId: user?.id ?? null };
  const mounted = useRef(true);
  const addCourse = useAddCourse();
  const addAssignment = useAddAssignment();
  const hasIncompleteItems = items.some(
    (item) => !item.title.trim() || !syllabusDateToIso(item.due_date),
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    checkpoint.current = { userId: user?.id ?? null, confirmed: new Set() };
    setSaved(false);
    setSavedCourseId(undefined);
    setSaveMessage("");
  }, [user?.id]);

  useEffect(() => {
    try {
      const raw = storageKey ? sessionStorage.getItem(storageKey) : null;
      if (raw) {
        const draft = storedResultSchema.parse(JSON.parse(raw));
        if (draft.userId !== user?.id) throw new Error("Review belongs to another account");
        setItems(draft.items.map((item) => ({ ...item, rowId: crypto.randomUUID() })));
        setCourseName(draft.courseName ?? "");
        setCourseCode(draft.courseCode ?? "");
        setSyllabusText(draft.syllabusText);
        setDraftAvailable(true);
      }
    } catch {
      setDraftWarning(
        "We couldn’t open this review. Allow browser storage and try your syllabus again.",
      );
    }
    setReviewLoaded(true);
  }, [storageKey, user?.id]);

  useEffect(() => {
    if (!draftAvailable || !storageKey || !user || saved) return;
    const stored = writeBrowserStorage(
      () => sessionStorage,
      storageKey,
      JSON.stringify({ userId: user.id, items, syllabusText, courseName, courseCode }),
    );
    setDraftWarning(
      stored
        ? ""
        : "Your edits are available on this page, but this browser couldn’t keep a draft. Keep this tab open until saving finishes.",
    );
  }, [draftAvailable, storageKey, user, saved, items, syllabusText, courseName, courseCode]);

  const updateItem = (index: number, patch: Partial<SyllabusItem>) => {
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  };

  const saveSemester = async () => {
    if (
      saveInFlight.current ||
      !user ||
      !courseName.trim() ||
      items.length === 0 ||
      hasIncompleteItems
    )
      return;
    saveInFlight.current = true;
    const requestScope = accountScope.current;
    const requestUserId = user.id;
    const isCurrent = () => mounted.current && accountScope.current === requestScope;
    const assertCurrent = () => {
      if (!isCurrent()) throw new Error("Account changed while saving");
    };
    setSaving(true);
    setSaveMessage("");
    try {
      const [coursesResult, assignmentsResult] = await Promise.all([
        coursesQuery.refetch(),
        assignmentsQuery.refetch(),
      ]);
      assertCurrent();
      if (
        coursesResult.isError ||
        assignmentsResult.isError ||
        !coursesResult.data ||
        !assignmentsResult.data
      ) {
        throw new Error("Could not check saved work");
      }
      const courses = coursesResult.data.filter((course) => course.user_id === requestUserId);
      const retainedCourseId = validateSyllabusCheckpoint(
        checkpoint.current,
        requestUserId,
        courses,
      );
      const normalizedName = courseName.trim().toLowerCase();
      const normalizedCode = courseCode.trim().toLowerCase();
      const existingCourse = courses.find(
        (course) =>
          course.name.trim().toLowerCase() === normalizedName ||
          (normalizedCode && course.course_code.trim().toLowerCase() === normalizedCode),
      );
      const course =
        (retainedCourseId ? { id: retainedCourseId } : existingCourse) ||
        (await addCourse.mutateAsync({
          name: courseName.trim(),
          course_code: courseCode.trim(),
        }));

      assertCurrent();
      checkpoint.current.courseId = course.id;
      const { added, skipped } = await saveReviewedItems({
        items,
        courseId: course.id,
        existing: assignmentsResult.data.filter(
          (assignment) => assignment.user_id === requestUserId,
        ),
        confirmed: checkpoint.current.confirmed,
        assertCurrent,
        add: (input) => {
          assertCurrent();
          return addAssignment.mutateAsync(input);
        },
        onProgress: (done, total) =>
          setSaveMessage(`Saving your dates… ${done} of ${total} checked.`),
      });
      assertCurrent();
      setSavedCourseId(course.id);
      setSaved(true);
      setSaveMessage(
        `${added} item${added === 1 ? "" : "s"} added to the semester map${skipped ? `; ${skipped} duplicate${skipped === 1 ? " was" : "s were"} skipped` : ""}.`,
      );
      if (storageKey) removeBrowserStorage(() => sessionStorage, storageKey);
    } catch {
      if (!isCurrent()) return;
      setSaveMessage(
        checkpoint.current.courseId
          ? `Your course is saved${checkpoint.current.confirmed.size ? `, along with ${checkpoint.current.confirmed.size} date${checkpoint.current.confirmed.size === 1 ? "" : "s"}` : ""}. We couldn’t finish the rest. Retry to check saved work and continue.`
          : "We couldn’t check or save your course right now. Your review is still here. Check your connection and retry.",
      );
    } finally {
      saveInFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          disabled={saving}
          onClick={() => navigate({ to: "/planner" })}
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to syllabus
        </button>

        {draftWarning && (
          <p
            role="alert"
            className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm"
          >
            {draftWarning}
          </p>
        )}

        {!reviewLoaded ? (
          <div role="status" className="rounded-3xl border border-border bg-card p-10 text-center">
            <Loader2 aria-hidden className="mx-auto h-6 w-6 animate-spin" />
            <p className="mt-3 text-sm">Opening your syllabus review…</p>
          </div>
        ) : items.length === 0 && !saved ? (
          <EmptySyllabusReview hasReview={draftAvailable} />
        ) : (
          <>
            <header className="mb-7">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                STEP 2 OF 3 · REVIEW YOUR DATES
              </p>
              <h1 className="mt-2 text-3xl font-bold text-foreground">
                A quick check, then you’re ready.
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Fix titles or dates and remove anything UniMate misunderstood. Only the items below
                will be saved to your semester timeline.
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
                  <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
                    Categories follow each item’s title, just like in Today. Edit a title to update
                    its automatic category.
                  </p>
                  <div className="max-h-[650px] space-y-3 overflow-y-auto pr-1">
                    {items.map((item, index) => (
                      <div
                        key={item.rowId}
                        className="rounded-2xl border border-border/60 bg-background/65 p-4"
                      >
                        <fieldset
                          disabled={saving || !!checkpoint.current.courseId}
                          className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_130px_145px_auto] sm:items-center disabled:opacity-70"
                        >
                          <input
                            value={item.title}
                            onChange={(event) => updateItem(index, { title: event.target.value })}
                            aria-label={`Title for extracted item ${index + 1}`}
                            aria-invalid={!item.title.trim()}
                            className="min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          />
                          <output
                            aria-label={`Automatic category for extracted item ${index + 1}`}
                            className="rounded-lg bg-secondary/50 px-3 py-2 text-sm capitalize text-muted-foreground"
                          >
                            {inferAcademicItemType(item.title)}
                          </output>
                          <input
                            type="date"
                            value={item.due_date}
                            onChange={(event) =>
                              updateItem(index, { due_date: event.target.value })
                            }
                            aria-label={`Date for ${item.title}`}
                            aria-invalid={!syllabusDateToIso(item.due_date)}
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
                        </fieldset>
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
                      disabled={saving || !!checkpoint.current.courseId}
                      onChange={(event) => setCourseName(event.target.value)}
                      placeholder="Course name"
                      aria-label="Course name"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    />
                    <input
                      value={courseCode}
                      disabled={saving || !!checkpoint.current.courseId}
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
                        {saving
                          ? "Saving your class…"
                          : checkpoint.current.courseId
                            ? "Retry remaining dates"
                            : "Save my class & deadlines"}
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
                      Add a title and valid calendar date to every item before saving.
                    </p>
                  )}
                </aside>
              </div>
            )}

            {saved && (
              <div className="rounded-3xl border border-[#F5C518]/40 bg-[#F5C518]/10 p-8 text-center">
                <CheckCircle2 className="mx-auto h-9 w-9 text-primary" />
                <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  STEP 3 OF 3 · FIND YOUR FOCUS
                </p>
                <h2 className="mt-2 font-serif-display text-4xl text-foreground">
                  One class closer to feeling on top of it.
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">{saveMessage}</p>
                <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                  Your dates are ready in Today. Start with the next deadline, or ask UniMate to
                  help you find a first step.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Link
                    to="/dashboard"
                    className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
                  >
                    See what matters today <ArrowRight className="h-4 w-4" />
                  </Link>
                  <a
                    href={askJourneyHref(
                      `I just added ${courseName.trim()}. Help me get started with this class. Ask what I’m working on and help me choose a practical first step.`,
                      savedCourseId,
                    )}
                    className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-semibold"
                  >
                    <Sparkles className="h-4 w-4" /> Ask UniMate for a hand
                  </a>
                </div>
                <Link
                  to="/planner"
                  className="mt-6 inline-block text-sm text-muted-foreground underline underline-offset-4"
                >
                  Add another class
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptySyllabusReview({ hasReview }: { hasReview: boolean }) {
  return (
    <div className="rounded-3xl border border-border bg-card p-10 text-center shadow-[var(--shadow-card)]">
      <CalendarDays aria-hidden="true" className="mx-auto h-8 w-8 text-muted-foreground" />
      <h1 className="mt-4 text-2xl font-bold text-foreground">
        {hasReview ? "No dated items to review yet" : "Let’s start with your syllabus"}
      </h1>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
        {hasReview
          ? "We couldn’t find dated items to save in this review. Try the course schedule or paste the section with due dates. You can also add your class and deadlines yourself."
          : "Upload or paste a syllabus to review its dates before saving. No syllabus yet? You can build your plan one deadline at a time."}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link
          to="/planner"
          className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          {hasReview ? "Try another syllabus or paste text" : "Bring in my syllabus"}
        </Link>
        <Link
          to="/dashboard"
          hash="course-setup"
          className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 py-2 text-sm font-semibold"
        >
          Add my class manually
        </Link>
      </div>
    </div>
  );
}
