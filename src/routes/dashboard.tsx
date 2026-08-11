import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Filter,
  Flame,
  Layers3,
  Loader2,
  MessageCircleQuestion,
  NotebookPen,
  Plus,
  Puzzle,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { format, isAfter, isBefore, startOfDay } from "date-fns";
import { ProtectedRoute } from "../components/protected-route";
import {
  useAddAssignment,
  useAddCourse,
  useAssignments,
  useCourses,
  useRemoveAssignment,
  useRemoveCourse,
  useToggleAssignment,
} from "../lib/courses";
import {
  buildDailyBrief,
  buildPressureItems,
  buildSemesterWeeks,
  describePressureWeek,
  type AcademicItemType,
  type PressureItem,
  type PressureLevel,
} from "../lib/semester-pressure";
import { useSemesterEndDate } from "../hooks/use-semester-end-date";
import { formatSemesterEndDate } from "../lib/semester-date";

export const Route = createFileRoute("/dashboard")({
  component: () => (
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  ),
});

const pressureStyles: Record<PressureLevel, string> = {
  empty: "bg-secondary/45 text-muted-foreground border-border/50",
  light: "bg-[#F5C518]/18 text-foreground border-[#F5C518]/25",
  moderate: "bg-[#F5C518]/38 text-foreground border-[#F5C518]/45",
  busy: "bg-amber-500/70 text-amber-950 border-amber-500/70",
  overloaded: "bg-orange-600 text-white border-orange-600",
};

const pressureLabels: Record<PressureLevel, string> = {
  empty: "Open",
  light: "Light",
  moderate: "Moderate",
  busy: "Busy",
  overloaded: "Packed",
};

const itemTypeLabels: Record<AcademicItemType, string> = {
  assignment: "Assignment",
  quiz: "Quiz",
  paper: "Paper",
  project: "Project",
  exam: "Exam",
};

function companionStoreUrl(): string | null {
  const configured = import.meta.env.VITE_COMPANION_STORE_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" && url.hostname === "chromewebstore.google.com"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function Dashboard() {
  const { data: courses = [], isLoading: coursesLoading } = useCourses();
  const { data: assignments = [], isLoading: assignmentsLoading } = useAssignments();
  const addCourse = useAddCourse();
  const removeCourse = useRemoveCourse();
  const addAssignment = useAddAssignment();
  const removeAssignment = useRemoveAssignment();
  const toggleAssignment = useToggleAssignment();
  const {
    semesterEndDate,
    isSaving: semesterDateSaving,
    saveSemesterEndDate,
  } = useSemesterEndDate();

  const [courseFilter, setCourseFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<AcademicItemType | "all">("all");
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [courseName, setCourseName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [assignmentName, setAssignmentName] = useState("");
  const [assignmentCourseId, setAssignmentCourseId] = useState("");
  const [assignmentDue, setAssignmentDue] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [completionMessage, setCompletionMessage] = useState("");
  const [companionInstalled, setCompanionInstalled] = useState(false);
  const [semesterEndInput, setSemesterEndInput] = useState(semesterEndDate ?? "");
  const [semesterDateMessage, setSemesterDateMessage] = useState("");
  const storeUrl = companionStoreUrl();

  useEffect(() => setSemesterEndInput(semesterEndDate ?? ""), [semesterEndDate]);

  useEffect(() => {
    const detectCompanion = () => {
      setCompanionInstalled(Boolean(document.getElementById("unimate-companion-host")));
    };
    detectCompanion();
    const observer = new MutationObserver(detectCompanion);
    observer.observe(document.documentElement, { childList: true });
    return () => observer.disconnect();
  }, []);

  const pressureItems = useMemo(
    () => buildPressureItems(assignments, courses),
    [assignments, courses],
  );
  const filteredItems = useMemo(
    () =>
      pressureItems.filter(
        (item) =>
          (courseFilter === "all" || item.course_id === courseFilter) &&
          (typeFilter === "all" || item.itemType === typeFilter),
      ),
    [courseFilter, pressureItems, typeFilter],
  );
  const weeks = useMemo(() => buildSemesterWeeks(filteredItems), [filteredItems]);
  const dailyBrief = useMemo(() => buildDailyBrief(pressureItems), [pressureItems]);
  const busiestWeek = useMemo(
    () =>
      weeks.reduce(
        (busiest, week) => (week.pressure > busiest.pressure ? week : busiest),
        weeks[0],
      ),
    [weeks],
  );
  const selectedWeek = weeks.find((week) => week.id === selectedWeekId) || busiestWeek;
  const today = startOfDay(new Date());
  const nextTwoWeeks = new Date(today);
  nextTwoWeeks.setDate(nextTwoWeeks.getDate() + 14);
  const upcomingCount = pressureItems.filter((item) => {
    const due = new Date(item.due_at);
    return !item.completed && !isBefore(due, today) && !isAfter(due, nextTwoWeeks);
  }).length;
  const activeCourseCount = new Set(pressureItems.map((item) => item.course_id)).size;
  const loading = coursesLoading || assignmentsLoading;
  const progressPercent = dailyBrief.totalCount
    ? Math.round((dailyBrief.completedCount / dailyBrief.totalCount) * 100)
    : 0;

  const handleToggleAssignment = (item: PressureItem) => {
    setCompletionMessage("");
    toggleAssignment.mutate(
      { id: item.id, completed: item.completed },
      {
        onSuccess: () => {
          setCompletionMessage(
            item.completed
              ? `${item.name} is back on your list.`
              : `${item.name} is done. Your next step is already waiting below.`,
          );
        },
      },
    );
  };

  const addNewCourse = () => {
    if (!courseName.trim()) return;
    setFormMessage("");
    if (
      courses.some(
        (course) =>
          course.name.trim().toLowerCase() === courseName.trim().toLowerCase() ||
          (courseCode.trim() &&
            course.course_code.trim().toLowerCase() === courseCode.trim().toLowerCase()),
      )
    ) {
      setFormMessage("That course is already saved.");
      return;
    }
    addCourse.mutate(
      { name: courseName.trim(), course_code: courseCode.trim() },
      {
        onSuccess: () => {
          setCourseName("");
          setCourseCode("");
          setFormMessage("Course added.");
        },
      },
    );
  };

  const addNewAssignment = () => {
    if (!assignmentName.trim() || !assignmentCourseId || !assignmentDue) return;
    const dueAt = new Date(`${assignmentDue}T12:00:00`).toISOString();
    const duplicate = assignments.some(
      (assignment) =>
        assignment.course_id === assignmentCourseId &&
        assignment.name.trim().toLowerCase() === assignmentName.trim().toLowerCase() &&
        new Date(assignment.due_at).toDateString() === new Date(dueAt).toDateString(),
    );
    if (duplicate) {
      setFormMessage("That deadline is already saved.");
      return;
    }
    addAssignment.mutate(
      { name: assignmentName.trim(), course_id: assignmentCourseId, due_at: dueAt },
      {
        onSuccess: () => {
          setAssignmentName("");
          setAssignmentDue("");
          setFormMessage("Deadline added to your semester map.");
        },
      },
    );
  };

  const updateSemesterEndDate = async (value: string | null) => {
    setSemesterDateMessage("");
    try {
      await saveSemesterEndDate(value);
      setSemesterDateMessage(value ? "Semester end date saved." : "Semester end date cleared.");
    } catch {
      setSemesterDateMessage("We couldn’t save that date. Try again.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 sm:py-10">
        <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Semester map
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              See the busy weeks before they arrive.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              UniMate maps deadline density from your syllabus. It shows when work clusters—it does
              not pretend to know how difficult your assignments are.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {companionInstalled ? (
              <span className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[#F5C518]/45 bg-[#F5C518]/10 px-4 py-2.5 text-sm font-semibold text-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" /> Companion
                installed
              </span>
            ) : storeUrl ? (
              <a
                href={storeUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition hover:border-primary/60 hover:bg-[#F5C518]/10"
              >
                <Puzzle className="h-4 w-4 text-primary" aria-hidden="true" /> Add Browser Companion
              </a>
            ) : (
              <span
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-muted-foreground"
                title="The Chrome Web Store listing is not public yet"
              >
                <Puzzle className="h-4 w-4" aria-hidden="true" /> Companion coming soon
              </span>
            )}
            <Link
              to="/planner"
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-95"
            >
              <Upload className="h-4 w-4" /> Upload syllabus
            </Link>
          </div>
        </header>

        {loading ? (
          <div
            className="grid min-h-[30rem] place-items-center rounded-3xl border border-border/60 bg-card/70"
            role="status"
            aria-live="polite"
          >
            <div className="text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" aria-hidden />
              <p className="mt-3 text-sm font-medium text-foreground">Loading your semester…</p>
              <p className="mt-1 text-xs text-muted-foreground">Your deadlines are on the way.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {courses.length === 0 && (
              <section className="rounded-3xl border border-[#F5C518]/40 bg-[#F5C518]/10 p-5 sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  Your first 10 minutes
                </p>
                <h2 className="mt-2 text-xl font-semibold text-foreground">
                  Start with one useful win.
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  Upload a syllabus to build your timeline, or explore UniMate while you wait for
                  classes to begin.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <Link
                    to="/planner"
                    className="flex min-h-16 items-center gap-3 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    <Upload className="h-5 w-5" /> Build my timeline
                  </Link>
                  <Link
                    to="/ask"
                    className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <MessageCircleQuestion className="h-5 w-5 text-primary" /> Ask a study question
                  </Link>
                  <Link
                    to="/notes"
                    className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <NotebookPen className="h-5 w-5 text-primary" /> Capture my first note
                  </Link>
                </div>
                <p className="mt-4 text-xs text-muted-foreground">
                  Tip: click Uni on the right edge of any page to open the Browser Companion.
                </p>
              </section>
            )}
            {courses.length > 0 && (
              <section className="overflow-hidden rounded-3xl border border-[#F5C518]/45 bg-card shadow-[var(--shadow-card)]">
                <div className="grid gap-0 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
                  <div className="p-5 sm:p-6">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                      Today
                    </p>
                    {dailyBrief.focus ? (
                      <>
                        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                          Start with {dailyBrief.focus.name}
                        </h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {dailyBrief.focus.course?.name || "Your course"} ·{" "}
                          {format(new Date(dailyBrief.focus.due_at), "EEE, MMM d")}
                          {dailyBrief.overdue.includes(dailyBrief.focus)
                            ? " · Past due"
                            : dailyBrief.dueToday.includes(dailyBrief.focus)
                              ? " · Due today"
                              : " · Your next deadline"}
                        </p>
                        <div className="mt-5 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleToggleAssignment(dailyBrief.focus!)}
                            disabled={toggleAssignment.isPending}
                            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-4 w-4" /> Mark done
                          </button>
                          <Link
                            to="/ask"
                            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground transition hover:border-primary/50"
                          >
                            <Sparkles className="h-4 w-4 text-primary" /> Help me start
                          </Link>
                        </div>
                      </>
                    ) : (
                      <>
                        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                          You’re clear for now.
                        </h2>
                        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                          Nothing unfinished is on your timeline. Capture a note, ask a question, or
                          enjoy the breathing room.
                        </p>
                        <Link
                          to="/notes"
                          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground hover:border-primary/50"
                        >
                          <NotebookPen className="h-4 w-4 text-primary" /> Open notes
                        </Link>
                      </>
                    )}
                    {completionMessage && (
                      <p
                        className="mt-4 text-sm font-medium text-foreground"
                        role="status"
                        aria-live="polite"
                      >
                        {completionMessage}
                      </p>
                    )}
                  </div>
                  <div className="border-t border-border/60 bg-[#F5C518]/10 p-5 sm:p-6 lg:border-l lg:border-t-0">
                    <h3 className="text-sm font-semibold text-foreground">Your day at a glance</h3>
                    <dl className="mt-4 grid grid-cols-3 gap-2 lg:grid-cols-1">
                      <DailyStat label="Due today" value={dailyBrief.dueToday.length} />
                      <DailyStat label="To catch up" value={dailyBrief.overdue.length} />
                      <DailyStat label="Coming next" value={dailyBrief.upcoming.length} />
                    </dl>
                    {dailyBrief.totalCount > 0 && (
                      <div className="mt-5">
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span>Semester progress</span>
                          <span>
                            {dailyBrief.completedCount} of {dailyBrief.totalCount} cleared
                          </span>
                        </div>
                        <div
                          className="mt-2 h-2 overflow-hidden rounded-full bg-background"
                          role="progressbar"
                          aria-label="Semester deadline progress"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={progressPercent}
                        >
                          <div
                            className="h-full rounded-full bg-primary transition-[width] duration-500"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}
            <section className="grid gap-3 sm:grid-cols-3">
              <SummaryCard
                icon={<Flame className="h-4 w-4" />}
                label="Busiest saved week"
                value={busiestWeek?.pressure ? busiestWeek.label : "No deadlines yet"}
                detail={
                  busiestWeek?.pressure
                    ? describePressureWeek(busiestWeek)
                    : "Upload a syllabus to begin."
                }
              />
              <SummaryCard
                icon={<Clock3 className="h-4 w-4" />}
                label="Next 14 days"
                value={`${upcomingCount} deadline${upcomingCount === 1 ? "" : "s"}`}
                detail="Based only on dates you have confirmed."
              />
              <SummaryCard
                icon={<Layers3 className="h-4 w-4" />}
                label="Mapped courses"
                value={`${activeCourseCount || courses.length} course${(activeCourseCount || courses.length) === 1 ? "" : "s"}`}
                detail={`${pressureItems.length} semester item${pressureItems.length === 1 ? "" : "s"} saved.`}
              />
            </section>

            <section className="rounded-3xl border border-border/60 bg-card/80 p-5 shadow-[var(--shadow-card)] sm:p-6">
              <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-5 w-5 text-primary" />
                    <h2 className="text-lg font-semibold text-foreground">Semester pressure</h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Darker weeks have more unfinished deadlines close together.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <select
                    value={courseFilter}
                    onChange={(event) => setCourseFilter(event.target.value)}
                    aria-label="Filter semester map by course"
                    className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
                  >
                    <option value="all">All courses</option>
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={typeFilter}
                    onChange={(event) =>
                      setTypeFilter(event.target.value as AcademicItemType | "all")
                    }
                    aria-label="Filter semester map by item type"
                    className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
                  >
                    <option value="all">All item types</option>
                    {Object.entries(itemTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto pb-2">
                <div className="grid min-w-max grid-flow-col auto-cols-[56px] gap-2">
                  {weeks.map((week) => (
                    <button
                      key={week.id}
                      type="button"
                      onClick={() => setSelectedWeekId(week.id)}
                      aria-label={`${week.label}: ${week.items.length} deadlines, ${pressureLabels[week.level]}`}
                      aria-pressed={selectedWeek?.id === week.id}
                      className={`group min-h-24 rounded-xl border p-2 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${pressureStyles[week.level]} ${selectedWeek?.id === week.id ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
                    >
                      <span className="block text-[10px] font-medium opacity-70">
                        {week.shortLabel}
                      </span>
                      <span className="mt-4 block text-xl font-bold">{week.items.length}</span>
                      <span className="block text-[9px] font-semibold uppercase tracking-wide opacity-75">
                        {pressureLabels[week.level]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                {(Object.keys(pressureLabels) as PressureLevel[]).map((level) => (
                  <span key={level} className="inline-flex items-center gap-1.5">
                    <span className={`h-3 w-3 rounded border ${pressureStyles[level]}`} />
                    {pressureLabels[level]}
                  </span>
                ))}
              </div>

              {selectedWeek && (
                <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-border/60 bg-background/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                      {selectedWeek.label}
                    </p>
                    <p className="mt-1 font-medium text-foreground">
                      {describePressureWeek(selectedWeek)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pressure is based only on unfinished deadline count, never a hidden difficulty
                      score.
                    </p>
                  </div>
                  <Link
                    to="/ask"
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:border-primary/50"
                  >
                    Plan this week <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </section>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
              <section className="rounded-3xl border border-border/60 bg-card/80 p-5 shadow-[var(--shadow-card)] sm:p-6">
                <div className="mb-5 flex items-end justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Timeline</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Every confirmed deadline in chronological order.
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {filteredItems.length} items
                  </span>
                </div>
                <div className="max-h-[650px] space-y-3 overflow-y-auto pr-1">
                  {filteredItems.length === 0 ? (
                    <EmptyTimeline />
                  ) : (
                    filteredItems.map((item, index) => {
                      const due = new Date(item.due_at);
                      const previous = filteredItems[index - 1];
                      const newMonth =
                        !previous ||
                        format(new Date(previous.due_at), "MMMM yyyy") !== format(due, "MMMM yyyy");
                      return (
                        <div key={item.id}>
                          {newMonth && (
                            <p className="pb-2 pt-3 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground first:pt-0">
                              {format(due, "MMMM yyyy")}
                            </p>
                          )}
                          <div
                            className={`flex gap-3 rounded-2xl border border-border/50 bg-background/60 p-3.5 ${item.completed ? "opacity-55" : ""}`}
                          >
                            <button
                              type="button"
                              onClick={() => handleToggleAssignment(item)}
                              aria-label={
                                item.completed
                                  ? `Mark ${item.name} incomplete`
                                  : `Mark ${item.name} complete`
                              }
                              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                            >
                              {item.completed ? (
                                <CheckCircle2 className="h-5 w-5 text-primary" />
                              ) : (
                                <Circle className="h-5 w-5" />
                              )}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p
                                  className={`text-sm font-semibold text-foreground ${item.completed ? "line-through" : ""}`}
                                >
                                  {item.name}
                                </p>
                                <span className="rounded-full bg-[#F5C518] px-2 py-0.5 text-[10px] font-semibold text-[#1a1a1a]">
                                  {itemTypeLabels[item.itemType]}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {item.course?.name || "Unknown course"} ·{" "}
                                {format(due, "EEE, MMM d")}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeAssignment.mutate(item.id)}
                              aria-label={`Delete ${item.name}`}
                              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>

              <aside className="space-y-5">
                <section className="rounded-3xl border border-border/60 bg-card/80 p-5 shadow-[var(--shadow-card)]">
                  <div className="mb-2 flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h2 className="font-semibold text-foreground">Semester end</h2>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Add your final day to see a countdown across UniMate.
                  </p>
                  {semesterEndDate && (
                    <p className="mt-3 text-sm font-medium text-foreground">
                      {formatSemesterEndDate(semesterEndDate)}
                    </p>
                  )}
                  <form
                    className="mt-4 space-y-2.5"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void updateSemesterEndDate(semesterEndInput);
                    }}
                  >
                    <label htmlFor="semester-end-date" className="sr-only">
                      Final day of semester
                    </label>
                    <input
                      id="semester-end-date"
                      type="date"
                      value={semesterEndInput}
                      min={format(new Date(), "yyyy-MM-dd")}
                      onChange={(event) => setSemesterEndInput(event.target.value)}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={!semesterEndInput || semesterDateSaving}
                        className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-45"
                      >
                        {semesterDateSaving ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" />
                        ) : semesterEndDate ? (
                          "Update date"
                        ) : (
                          "Save date"
                        )}
                      </button>
                      {semesterEndDate && (
                        <button
                          type="button"
                          disabled={semesterDateSaving}
                          onClick={() => void updateSemesterEndDate(null)}
                          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-semibold text-foreground disabled:opacity-45"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </form>
                  {semesterDateMessage && (
                    <p
                      className="mt-3 text-xs text-muted-foreground"
                      role="status"
                      aria-live="polite"
                    >
                      {semesterDateMessage}
                    </p>
                  )}
                </section>

                <section className="rounded-3xl border border-border/60 bg-card/80 p-5 shadow-[var(--shadow-card)]">
                  <div className="mb-4 flex items-center gap-2">
                    <Plus className="h-4 w-4 text-primary" />
                    <h2 className="font-semibold text-foreground">Add a deadline</h2>
                  </div>
                  <div className="space-y-2.5">
                    <input
                      value={assignmentName}
                      onChange={(event) => setAssignmentName(event.target.value)}
                      placeholder="Assignment, exam, or project"
                      aria-label="Deadline name"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    />
                    <select
                      value={assignmentCourseId}
                      onChange={(event) => setAssignmentCourseId(event.target.value)}
                      aria-label="Deadline course"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    >
                      <option value="">Choose course</option>
                      {courses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={assignmentDue}
                      onChange={(event) => setAssignmentDue(event.target.value)}
                      aria-label="Deadline date"
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={addNewAssignment}
                      disabled={
                        !assignmentName.trim() ||
                        !assignmentCourseId ||
                        !assignmentDue ||
                        addAssignment.isPending
                      }
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-45"
                    >
                      {addAssignment.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}{" "}
                      Add deadline
                    </button>
                  </div>
                </section>

                <section className="rounded-3xl border border-border/60 bg-card/80 p-5 shadow-[var(--shadow-card)]">
                  <h2 className="font-semibold text-foreground">Courses</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Keep the semester map organized by class.
                  </p>
                  <div className="mt-4 space-y-2">
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
                    <button
                      type="button"
                      onClick={addNewCourse}
                      disabled={!courseName.trim() || addCourse.isPending}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-semibold text-foreground disabled:opacity-45"
                    >
                      <Plus className="h-4 w-4" /> Add course
                    </button>
                  </div>
                  {formMessage && (
                    <p className="mt-3 text-xs text-muted-foreground" role="status">
                      {formMessage}
                    </p>
                  )}
                  <div className="mt-4 space-y-2">
                    {courses.length === 0 && (
                      <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                        No courses yet. Add one here or upload a syllabus.
                      </p>
                    )}
                    {courses.map((course) => (
                      <div
                        key={course.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[#F5C518]/50 bg-[#F5C518] px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#1a1a1a]">
                            {course.name}
                          </p>
                          {course.course_code && (
                            <p className="text-[10px] text-[#1a1a1a]/70">{course.course_code}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeCourse.mutate(course.id)}
                          aria-label={`Delete ${course.name}`}
                          className="grid h-11 w-11 place-items-center rounded-full text-[#1a1a1a]/65 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-3xl border border-[#F5C518]/35 bg-[#F5C518]/10 p-5">
                  <div className="flex items-center gap-2 text-foreground">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <p className="text-sm font-semibold">Need a plan?</p>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Ask UniMate about a crowded week, then continue the same conversation in the
                    Browser Companion.
                  </p>
                  <Link
                    to="/ask"
                    className="mt-3 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-xs font-semibold text-foreground underline underline-offset-4"
                  >
                    Open Ask UniMate <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </section>
              </aside>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/80 p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-3 text-xl font-bold text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

function DailyStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#F5C518]/25 bg-background/75 p-3">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-bold text-foreground">{value}</dd>
    </div>
  );
}

function EmptyTimeline() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-secondary/25 p-8 text-center">
      <CalendarDays className="mx-auto h-7 w-7 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium text-foreground">Your semester timeline is empty.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Upload a syllabus or add a deadline manually.
      </p>
    </div>
  );
}
