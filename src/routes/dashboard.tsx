import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import {
  GraduationCap,
  Calendar,
  BookOpen,
  Flame,
  Sparkles,
  TrendingUp,
  Send,
  Loader2,
  Bot,
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useStudyStreak } from "../hooks/use-study-streak";
// import { useAssistantEnabled } from "../hooks/use-assistant-enabled"; // Hidden for now — future rollout
import { useTheme } from "../components/theme-provider";
import { ProtectedRoute } from "../components/protected-route";
import {
  useCourses,
  useAssignments,
  useAddCourse,
  useRemoveCourse,
  useAddAssignment,
  useToggleAssignment,
  useRemoveAssignment,
  getCourseGrade,
  getUpcomingAssignments,
} from "../lib/courses";

export const Route = createFileRoute("/dashboard")({
  component: () => (
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  ),
});

function scoreToGPA(score: number): number {
  if (score >= 93) return 4.0;
  if (score >= 90) return 3.7;
  if (score >= 87) return 3.3;
  if (score >= 83) return 3.0;
  if (score >= 80) return 2.7;
  if (score >= 77) return 2.3;
  if (score >= 73) return 2.0;
  if (score >= 70) return 1.7;
  if (score >= 67) return 1.3;
  if (score >= 63) return 1.0;
  if (score >= 60) return 0.7;
  return 0.0;
}

function getGPAColor(gpa: number) {
  if (gpa >= 3.5)
    return { text: "text-green-600", bg: "bg-green-100", bar: "bg-green-500", label: "Excellent" };
  if (gpa >= 2.5)
    return { text: "text-yellow-600", bg: "bg-yellow-100", bar: "bg-yellow-500", label: "Solid" };
  return { text: "text-red-600", bg: "bg-red-100", bar: "bg-red-500", label: "Needs attention" };
}

function getAssignmentUrgency(dueAt: string): "red" | "yellow" | "green" {
  const diff = new Date(dueAt).getTime() - Date.now();
  if (diff < 86400 * 1000) return "red";
  if (diff < 3 * 86400 * 1000) return "yellow";
  return "green";
}

function formatRelativeTime(dueAt: string): string {
  const diff = new Date(dueAt).getTime() - Date.now();
  if (diff < 0) return "Overdue";
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (hours < 24) return `${hours}h`;
  if (days === 1) return "Tomorrow";
  return `${days}d`;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

function Dashboard() {
  const { theme } = useTheme();
  const { streak, bestStreak } = useStudyStreak();
  // const { enabled: assistantEnabled, setAssistantEnabled } = useAssistantEnabled(); // Hidden for now — future rollout

  const { data: manualCourses = [], isLoading: coursesLoading } = useCourses();
  const { data: manualAssignments = [], isLoading: assignmentsLoading } = useAssignments();
  const isLoadingData = coursesLoading || assignmentsLoading;

  const addCourse = useAddCourse();
  const removeCourse = useRemoveCourse();
  const addAssignment = useAddAssignment();
  const toggleAssignment = useToggleAssignment();
  const removeAssignment = useRemoveAssignment();

  const courses = manualCourses;
  const hasData = courses.length > 0 || manualAssignments.length > 0;

  const courseGrades = courses.map((course) => {
    const g = getCourseGrade(manualCourses, course.id);
    return { ...course, score: g.score, grade: g.grade };
  });

  const validScores = courseGrades.filter((c) => c.score !== null);
  const gpa =
    validScores.length > 0
      ? validScores.reduce((sum, c) => sum + scoreToGPA(c.score!), 0) / validScores.length
      : null;

  const upcomingAssignments = getUpcomingAssignments(manualAssignments, 14)
    .filter((a) => a.due_at)
    .sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime())
    .slice(0, 5);

  const sortedAssignments = [...manualAssignments].sort(
    (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime(),
  );

  // Course entry form
  const [courseName, setCourseName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [courseScore, setCourseScore] = useState("");

  // Assignment entry form
  const [assignmentName, setAssignmentName] = useState("");
  const [assignmentCourseId, setAssignmentCourseId] = useState("");
  const [assignmentDue, setAssignmentDue] = useState("");

  // "What to Study Tonight" suggestion
  const [studySuggestion, setStudySuggestion] = useState("");
  const [loadingStudy, setLoadingStudy] = useState(false);

  const [motivationText, setMotivationText] = useState("");
  const [motivationLoading, setMotivationLoading] = useState(true);
  const [actionResponse, setActionResponse] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<"study-tonight" | "on-track" | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const buildContext = () => {
    let ctx = "Student's Academic Profile:\n";
    courseGrades.forEach((c) => {
      ctx += `- ${c.name} (${c.course_code}): ${c.score !== null ? `${c.score.toFixed(1)}%` : "No grade"} ${c.grade ? `(${c.grade})` : ""}\n`;
    });
    ctx += "\nUpcoming Assignments:\n";
    upcomingAssignments.forEach((a) => {
      const courseName = courses.find((c) => c.id === a.course_id)?.name || "Unknown";
      ctx += `- ${a.name} (${courseName}): due in ${formatRelativeTime(a.due_at!)}\n`;
    });
    if (gpa !== null) ctx += `\nCurrent GPA estimate: ${gpa.toFixed(2)}/4.0`;
    return ctx;
  };

  const callDashboardAI = async (
    type: string,
    message?: string,
    history?: ChatMessage[],
  ): Promise<string> => {
    const res = await fetch("/api/dashboard-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        academicContext: buildContext(),
        message,
        chatHistory: history?.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "API error");
    return data.answer as string;
  };

  const [hasFetchedMotivation, setHasFetchedMotivation] = useState(false);

  useEffect(() => {
    if (isLoadingData || hasFetchedMotivation) return;
    setHasFetchedMotivation(true);

    if (!hasData) {
      setMotivationText("Add your courses and assignments to get a personalized daily insight.");
      setMotivationLoading(false);
      return;
    }
    const ctx = buildContext();
    setMotivationLoading(true);
    fetch("/api/dashboard-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "motivation", academicContext: ctx }),
    })
      .then((r) => r.json())
      .then((data) => setMotivationText(data.answer || ""))
      .catch(() =>
        setMotivationText("Keep showing up every day — consistency beats intensity every time."),
      )
      .finally(() => setMotivationLoading(false));
    // Intentionally fires once, as soon as course data has finished loading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingData, hasFetchedMotivation]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleAction = async (action: "study-tonight" | "on-track") => {
    if (actionLoading) return;
    setActiveAction(action);
    setActionLoading(true);
    setActionResponse("");
    try {
      const text = await callDashboardAI(action);
      setActionResponse(text);
    } catch {
      setActionResponse("Something went wrong. Please try again.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    const userMsg: ChatMessage = { role: "user", content: msg };
    const newHistory = [...chatMessages, userMsg];
    setChatMessages(newHistory);
    setChatInput("");
    setChatLoading(true);
    try {
      const text = await callDashboardAI("chat", msg, chatMessages);
      setChatMessages([...newHistory, { role: "assistant", content: text }]);
    } catch {
      setChatMessages([
        ...newHistory,
        { role: "assistant", content: "Sorry, something went wrong. Please try again." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleStudyTonight = async () => {
    if (loadingStudy) return;
    setLoadingStudy(true);
    try {
      const text = await callDashboardAI("study-tonight");
      setStudySuggestion(text);
    } catch {
      setStudySuggestion("Couldn't get a suggestion right now. Please try again.");
    } finally {
      setLoadingStudy(false);
    }
  };

  const handleAddCourse = () => {
    if (!courseName.trim()) return;
    const score = courseScore.trim() ? parseFloat(courseScore) : null;
    addCourse.mutate({
      name: courseName.trim(),
      course_code: courseCode.trim(),
      score: score !== null && !isNaN(score) ? score : null,
    });
    setCourseName("");
    setCourseCode("");
    setCourseScore("");
  };

  const handleRemoveCourse = (id: string) => {
    removeCourse.mutate(id);
  };

  const handleAddAssignment = () => {
    if (!assignmentName.trim() || !assignmentCourseId || !assignmentDue) return;
    addAssignment.mutate({
      name: assignmentName.trim(),
      course_id: assignmentCourseId,
      due_at: new Date(assignmentDue + "T12:00:00").toISOString(),
    });
    setAssignmentName("");
    setAssignmentDue("");
  };

  const handleToggleAssignment = (id: string, completed: boolean) => {
    toggleAssignment.mutate({ id, completed });
  };

  const handleRemoveAssignment = (id: string) => {
    removeAssignment.mutate(id);
  };

  const gpaColors = gpa !== null ? getGPAColor(gpa) : null;

  const sendBtnClass = "bg-[#F5C518] text-[#1a1a1a] hover:bg-[#F5C518]/90";

  const iconBg = "var(--gradient-primary)";

  const motivationBorder =
    theme === "light"
      ? { background: "linear-gradient(135deg, #FFF9E0, #FFF3C0)", border: "1px solid #F5C518" }
      : { background: "rgba(245, 197, 24, 0.08)", border: "1px solid rgba(245, 197, 24, 0.3)" };

  const accentTextColor = theme === "light" ? "#c89600" : "#F5C518";

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Your courses, assignments, and academic snapshot — all in one place.
            </p>
          </div>
          <Link
            to="/planner"
            className="mb-0.5 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border border-border bg-secondary/40 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload syllabus
          </Link>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          {/* LEFT: Data Cards */}
          <div className="lg:col-span-3 space-y-5">
            {isLoadingData ? (
              <div className="rounded-2xl border border-border/60 bg-card/90 backdrop-blur-xl p-10 text-center shadow-[var(--shadow-card)]">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
              </div>
            ) : (
              <>
                {/* GPA Card */}
                <div className="rounded-2xl border border-border/60 bg-card/90 backdrop-blur-xl p-6 shadow-[var(--shadow-card)]">
                  <div className="flex items-center gap-2 mb-4">
                    <GraduationCap className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      GPA
                    </h3>
                  </div>
                  {gpa !== null && gpaColors ? (
                    <>
                      <div className="flex items-end gap-4 mb-4">
                        <span className={`text-6xl font-bold leading-none ${gpaColors.text}`}>
                          {gpa.toFixed(2)}
                        </span>
                        <div className="mb-1 space-y-1">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${gpaColors.bg} ${gpaColors.text}`}
                          >
                            {gpaColors.label}
                          </span>
                          <p className="text-xs text-muted-foreground">
                            Across {validScores.length} course{validScores.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                          <span>0.0</span>
                          <span>4.0</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${gpaColors.bar}`}
                            style={{ width: `${(gpa / 4.0) * 100}%` }}
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Add a course with a grade below to see your GPA.
                    </p>
                  )}
                </div>

                {/* Your Courses */}
                <div className="rounded-2xl border border-border/60 bg-card/90 backdrop-blur-xl p-6 shadow-[var(--shadow-card)]">
                  <div className="flex items-center gap-2 mb-4">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Your Courses
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                    <input
                      type="text"
                      value={courseName}
                      onChange={(e) => setCourseName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddCourse()}
                      placeholder="Course name"
                      className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <input
                      type="text"
                      value={courseCode}
                      onChange={(e) => setCourseCode(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddCourse()}
                      placeholder="Course code (optional)"
                      className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={courseScore}
                        onChange={(e) => setCourseScore(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddCourse()}
                        placeholder="Grade % (optional)"
                        className="flex-1 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <button
                        onClick={handleAddCourse}
                        disabled={!courseName.trim() || addCourse.isPending}
                        className="inline-flex items-center justify-center rounded-lg px-3 bg-primary text-primary-foreground disabled:opacity-50 flex-shrink-0"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {courses.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Add your courses to start tracking grades, GPA, and assignments.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {courses.map((course) => (
                        <div
                          key={course.id}
                          className="flex items-start justify-between gap-2 p-4 rounded-lg bg-secondary/40"
                        >
                          <div>
                            <p className="text-sm font-medium text-foreground">{course.name}</p>
                            {course.course_code && (
                              <p className="text-xs text-muted-foreground mb-1">
                                {course.course_code}
                              </p>
                            )}
                            {course.score !== null ? (
                              <p className="text-lg font-bold text-foreground">
                                {course.score.toFixed(1)}%
                              </p>
                            ) : (
                              <p className="text-sm text-muted-foreground">No grade entered</p>
                            )}
                          </div>
                          <button
                            onClick={() => handleRemoveCourse(course.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Assignments */}
                <div className="rounded-2xl border border-border/60 bg-card/90 backdrop-blur-xl p-6 shadow-[var(--shadow-card)]">
                  <div className="flex items-center gap-2 mb-4">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Assignments
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-4">
                    <input
                      type="text"
                      value={assignmentName}
                      onChange={(e) => setAssignmentName(e.target.value)}
                      placeholder="Assignment name"
                      className="sm:col-span-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <select
                      value={assignmentCourseId}
                      onChange={(e) => setAssignmentCourseId(e.target.value)}
                      className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Course</option>
                      {courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={assignmentDue}
                        onChange={(e) => setAssignmentDue(e.target.value)}
                        className="flex-1 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <button
                        onClick={handleAddAssignment}
                        disabled={
                          !assignmentName.trim() ||
                          !assignmentCourseId ||
                          !assignmentDue ||
                          addAssignment.isPending
                        }
                        className="inline-flex items-center justify-center rounded-lg px-3 bg-primary text-primary-foreground disabled:opacity-50 flex-shrink-0"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {courses.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Add a course first, then you can track its assignments here.
                    </p>
                  ) : sortedAssignments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No assignments yet. Add one above.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {sortedAssignments.map((assignment) => {
                        const course = courses.find((c) => c.id === assignment.course_id);
                        const dueDate = new Date(assignment.due_at);
                        const urgency = getAssignmentUrgency(assignment.due_at);
                        const dotColor = assignment.completed
                          ? "bg-muted-foreground/40"
                          : urgency === "red"
                            ? "bg-red-500"
                            : urgency === "yellow"
                              ? "bg-yellow-500"
                              : "bg-green-500";
                        return (
                          <div
                            key={assignment.id}
                            className={`flex items-start gap-3 p-3 rounded-lg bg-secondary/40 ${assignment.completed ? "opacity-50" : ""}`}
                          >
                            <button
                              onClick={() =>
                                handleToggleAssignment(assignment.id, assignment.completed)
                              }
                              className="mt-0.5 text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                            >
                              {assignment.completed ? (
                                <CheckCircle2 className="h-5 w-5 text-primary" />
                              ) : (
                                <Circle className="h-5 w-5" />
                              )}
                            </button>
                            <div className="flex-1 min-w-0">
                              <p
                                className={`text-sm font-medium text-foreground ${assignment.completed ? "line-through" : ""}`}
                              >
                                {assignment.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {course?.name || "Unknown Course"}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <div className={`h-2 w-2 rounded-full ${dotColor}`} />
                              <p className="text-sm font-medium text-foreground">
                                {dueDate.toLocaleDateString()}
                              </p>
                            </div>
                            <button
                              onClick={() => handleRemoveAssignment(assignment.id)}
                              className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* What to Study Tonight */}
                <div className="rounded-2xl border border-border/60 bg-card/90 backdrop-blur-xl p-6 shadow-[var(--shadow-card)]">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        What to Study Tonight
                      </h3>
                    </div>
                    <button
                      onClick={handleStudyTonight}
                      disabled={loadingStudy}
                      className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50 flex-shrink-0"
                    >
                      {loadingStudy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      Get Suggestion
                    </button>
                  </div>
                  {studySuggestion ? (
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
                      {studySuggestion}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Get a personalized recommendation based on your courses, grades, and upcoming
                      deadlines.
                    </p>
                  )}
                </div>
              </>
            )}

            {/* Study Streak */}
            <div className="rounded-2xl border border-border/60 bg-card/90 backdrop-blur-xl p-6 shadow-[var(--shadow-card)]">
              <div className="flex items-center gap-2 mb-4">
                <Flame className="h-4 w-4 text-orange-500" />
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Study Streak
                </h3>
              </div>
              <div className="flex items-end gap-4">
                <span className="text-5xl font-bold leading-none text-orange-500">{streak}</span>
                <div className="mb-0.5">
                  <p className="text-sm font-medium text-foreground">
                    day{streak !== 1 ? "s" : ""} in a row
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Best: {bestStreak} day{bestStreak !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {streak === 0
                  ? "Start your streak today — open the app and study for at least 15 minutes."
                  : streak < 3
                    ? "Building momentum. Come back tomorrow to keep the chain going."
                    : streak < 7
                      ? "Strong week so far. Don't break the streak this weekend."
                      : "Serious consistency. This kind of discipline compounds over a semester."}
              </p>
            </div>

            {/* Study Assistant card hidden for now — future rollout */}
          </div>

          {/* RIGHT: AI Panel */}
          <div className="lg:col-span-2">
            <div className="sticky top-24">
              <div
                className="rounded-2xl border border-border/60 bg-card/90 backdrop-blur-xl shadow-[var(--shadow-card)] flex flex-col overflow-hidden"
                style={{ maxHeight: "calc(100vh - 7rem)" }}
              >
                {/* Panel header */}
                <div className="p-4 border-b border-border/60 flex items-center gap-2.5 flex-shrink-0">
                  <div
                    className="h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: iconBg }}
                  >
                    <Bot className="h-4 w-4" style={{ color: "var(--primary-foreground)" }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground leading-none">
                      AI Academic Advisor
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Powered by Llama 3.3</p>
                  </div>
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
                  {/* Daily Motivation */}
                  <div className="rounded-xl p-4" style={motivationBorder}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Sparkles
                        className="h-3.5 w-3.5 flex-shrink-0"
                        style={{ color: accentTextColor }}
                      />
                      <span
                        className="text-xs font-semibold uppercase tracking-wide"
                        style={{ color: accentTextColor }}
                      >
                        Today's Insight
                      </span>
                    </div>
                    {motivationLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
                        Generating insight...
                      </div>
                    ) : (
                      <p className="text-sm text-foreground leading-relaxed">{motivationText}</p>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleAction("study-tonight")}
                      disabled={actionLoading}
                      className={`flex flex-col items-start gap-1.5 rounded-xl p-3 text-left transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 border ${
                        activeAction === "study-tonight" && !actionLoading
                          ? "border-primary bg-primary/10"
                          : "border-border/60 hover:border-primary/50 hover:bg-secondary/40"
                      }`}
                    >
                      <Sparkles className="h-4 w-4 text-primary" />
                      <span className="text-xs font-semibold text-foreground">Study Tonight</span>
                      <span className="text-xs text-muted-foreground leading-tight">
                        What to focus on
                      </span>
                    </button>
                    <button
                      onClick={() => handleAction("on-track")}
                      disabled={actionLoading}
                      className={`flex flex-col items-start gap-1.5 rounded-xl p-3 text-left transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 border ${
                        activeAction === "on-track" && !actionLoading
                          ? "border-primary bg-primary/10"
                          : "border-border/60 hover:border-primary/50 hover:bg-secondary/40"
                      }`}
                    >
                      <TrendingUp className="h-4 w-4 text-primary" />
                      <span className="text-xs font-semibold text-foreground">Am I On Track?</span>
                      <span className="text-xs text-muted-foreground leading-tight">
                        Semester forecast
                      </span>
                    </button>
                  </div>

                  {/* Action Response */}
                  {(actionLoading || actionResponse) && (
                    <div className="rounded-xl border border-border/60 bg-secondary/30 p-4">
                      {actionLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
                          Thinking...
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-1.5 mb-2">
                            {activeAction === "study-tonight" ? (
                              <Sparkles className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                            ) : (
                              <TrendingUp className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                            )}
                            <span className="text-xs font-semibold text-primary uppercase tracking-wide">
                              {activeAction === "study-tonight"
                                ? "Study Recommendation"
                                : "Semester Forecast"}
                            </span>
                          </div>
                          <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
                            {actionResponse}
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {/* Chat Messages */}
                  {chatMessages.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-px bg-border/60" />
                        <span className="text-xs text-muted-foreground px-1">Chat</span>
                        <div className="flex-1 h-px bg-border/60" />
                      </div>
                      {chatMessages.map((msg, i) => (
                        <div
                          key={i}
                          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                              msg.role === "user"
                                ? "bg-foreground text-background rounded-br-sm"
                                : "bg-secondary/60 text-foreground rounded-bl-sm"
                            }`}
                          >
                            {msg.content}
                          </div>
                        </div>
                      ))}
                      {chatLoading && (
                        <div className="flex justify-start">
                          <div className="rounded-2xl rounded-bl-sm px-3 py-2 bg-secondary/60">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>
                  )}
                </div>

                {/* Chat Input */}
                <div className="p-3 border-t border-border/60 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleChat();
                        }
                      }}
                      placeholder="Ask anything about your academics..."
                      className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button
                      onClick={handleChat}
                      disabled={chatLoading || !chatInput.trim()}
                      className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all disabled:opacity-40 disabled:pointer-events-none ${sendBtnClass}`}
                    >
                      {chatLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
