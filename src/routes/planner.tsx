import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { z } from "zod";
import { Upload, FileText, Sparkles, Calendar, TrendingUp, BookOpen, Loader2, Plus, Trash2, CheckCircle2, Circle } from "lucide-react";
import { parseSyllabus } from "../functions/parse-syllabus";
import { extractPdfText } from "../lib/pdf";
import {
  useCourses,
  useAddCourse,
  useRemoveCourse,
  useAssignments,
  useAddAssignment,
  useToggleAssignment,
  useRemoveAssignment,
  getAcademicContext,
} from "../lib/courses";
import { askUniMate } from "../functions/ask-unimate";
import { useTheme } from "../components/theme-provider";
import { ProtectedRoute } from "../components/protected-route";

const searchSchema = z.object({
  view: z.enum(["dashboard", "upload"]).optional(),
});

export const Route = createFileRoute("/planner")({
  component: () => (
    <ProtectedRoute>
      <Planner />
    </ProtectedRoute>
  ),
  validateSearch: searchSchema,
});

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Planner() {
  const { theme } = useTheme();
  const { view: initialView } = Route.useSearch();
  const [view, setView] = useState<"dashboard" | "upload">(initialView ?? "dashboard");
  const [tab, setTab] = useState<"pdf" | "text">("pdf");
  const [filename, setFilename] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pdfText, setPdfText] = useState("");
  const [extractingPdf, setExtractingPdf] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [studySuggestion, setStudySuggestion] = useState("");
  const [loadingStudy, setLoadingStudy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();

  const { data: courses = [] } = useCourses();
  const { data: assignments = [] } = useAssignments();
  const addCourse = useAddCourse();
  const removeCourse = useRemoveCourse();
  const addAssignment = useAddAssignment();
  const toggleAssignment = useToggleAssignment();
  const removeAssignment = useRemoveAssignment();

  const [courseName, setCourseName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [courseScore, setCourseScore] = useState("");

  const [assignmentName, setAssignmentName] = useState("");
  const [assignmentCourseId, setAssignmentCourseId] = useState("");
  const [assignmentDue, setAssignmentDue] = useState("");

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

  const sortedAssignments = [...assignments].sort(
    (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
  );

  const handlePdfFile = async (file: File) => {
    if (file.type !== "application/pdf") {
      setPdfError("Please choose a PDF file.");
      return;
    }
    setFilename(file.name);
    setPdfError("");
    setPdfText("");
    setExtractingPdf(true);
    try {
      const text = await extractPdfText(file);
      if (!text) {
        setPdfError("Couldn't find any text in that PDF — it may be a scanned image.");
      } else {
        setPdfText(text);
      }
    } catch (error) {
      console.error("Error extracting PDF text:", error);
      setPdfError("Failed to read that PDF. Please try another file.");
    } finally {
      setExtractingPdf(false);
    }
  };

  const handleMapSemester = async () => {
    const syllabusText = tab === "pdf" ? pdfText : textareaRef.current?.value || "";
    if (!syllabusText.trim()) {
      console.log("No syllabus text provided");
      return;
    }

    setLoading(true);
    try {
      const result = await parseSyllabus({ syllabusText });
      console.log("Parsed syllabus result:", result);
      navigate({
        to: "/results",
        search: { items: result.items, syllabusText },
      });
    } catch (error) {
      console.error("Error parsing syllabus:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleStudyTonight = async () => {
    setLoadingStudy(true);
    try {
      const academicContext = getAcademicContext(courses, assignments);
      const result = await askUniMate({
        question: "Based on my current courses, grades, and upcoming assignments, what should I study tonight? Provide a specific recommendation with priorities.",
        conversationHistory: [],
        classContext: [],
        mode: "normal",
        canvasContext: academicContext,
      });
      setStudySuggestion(result.answer);
    } catch (error) {
      console.error("Error getting study suggestion:", error);
      setStudySuggestion("Failed to get study suggestion. Please try again.");
    } finally {
      setLoadingStudy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-6 py-24">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">Course Planner</h1>
          <p className="text-muted-foreground">Manage your courses and assignments</p>
        </div>

        {/* View Toggle */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex rounded-lg bg-secondary/60 p-1">
            <TabButton active={view === "dashboard"} onClick={() => setView("dashboard")}>
              <TrendingUp className="h-3.5 w-3.5" /> Dashboard
            </TabButton>
            <TabButton active={view === "upload"} onClick={() => setView("upload")}>
              <Upload className="h-3.5 w-3.5" /> Upload Syllabus
            </TabButton>
          </div>
        </div>

        {view === "dashboard" ? (
          <div className="space-y-6">
            {/* Study Tonight Card */}
            <div className="rounded-2xl border border-border/60 bg-card/90 backdrop-blur-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-foreground">What to Study Tonight</h3>
                <button
                  onClick={handleStudyTonight}
                  disabled={loadingStudy}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50"
                >
                  {loadingStudy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Get Suggestion
                </button>
              </div>
              {studySuggestion ? (
                <div className="text-sm text-foreground prose prose-sm max-w-none">
                  {studySuggestion}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Click the button above to get a personalized study recommendation based on your courses and upcoming assignments.
                </p>
              )}
            </div>

            {/* Your Courses */}
            <div className="rounded-2xl border border-border/60 bg-card/90 backdrop-blur-xl p-6">
              <h3 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Your Courses
              </h3>
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
                  Add your courses manually to start tracking grades and assignments.
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
                          <p className="text-xs text-muted-foreground mb-1">{course.course_code}</p>
                        )}
                        {course.score !== null ? (
                          <p className="text-lg font-bold text-foreground">{course.score.toFixed(1)}%</p>
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
            <div className="rounded-2xl border border-border/60 bg-card/90 backdrop-blur-xl p-6">
              <h3 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Assignments
              </h3>
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
                    disabled={!assignmentName.trim() || !assignmentCourseId || !assignmentDue || addAssignment.isPending}
                    className="inline-flex items-center justify-center rounded-lg px-3 bg-primary text-primary-foreground disabled:opacity-50 flex-shrink-0"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {sortedAssignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No assignments yet. Add one above.</p>
              ) : (
                <div className="space-y-3">
                  {sortedAssignments.map((assignment) => {
                    const course = courses.find((c) => c.id === assignment.course_id);
                    const dueDate = new Date(assignment.due_at);
                    return (
                      <div
                        key={assignment.id}
                        className={`flex items-start gap-3 p-3 rounded-lg bg-secondary/40 ${assignment.completed ? "opacity-50" : ""}`}
                      >
                        <button
                          onClick={() => handleToggleAssignment(assignment.id, assignment.completed)}
                          className="mt-0.5 text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                        >
                          {assignment.completed ? (
                            <CheckCircle2 className="h-5 w-5 text-primary" />
                          ) : (
                            <Circle className="h-5 w-5" />
                          )}
                        </button>
                        <div className="flex-1">
                          <p className={`text-sm font-medium text-foreground ${assignment.completed ? "line-through" : ""}`}>
                            {assignment.name}
                          </p>
                          <p className="text-xs text-muted-foreground">{course?.name || "Unknown Course"}</p>
                        </div>
                        <div className="text-right">
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
          </div>
        ) : (
          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-8 rounded-[2rem] opacity-40 blur-3xl -z-10 animate-pulse-glow"
              style={{ background: "var(--gradient-primary)" }}
            />
            <div
              aria-hidden
              className="absolute -inset-px rounded-3xl -z-10 opacity-80"
              style={{
                background: theme === "light" ? "#F5C518" : theme === "minimal" ? "black" : "linear-gradient(135deg, #FF006E, #00D4FF, #FF006E)",
              }}
            />
            <div className="relative rounded-3xl border border-border/60 bg-card/90 backdrop-blur-xl p-2 shadow-[var(--shadow-card)]">
              <div className="flex items-center gap-1 rounded-2xl bg-secondary/60 p-1">
                <TabButton active={tab === "pdf"} onClick={() => setTab("pdf")}>
                  <Upload className="h-3.5 w-3.5" /> Upload PDF
                </TabButton>
                <TabButton active={tab === "text"} onClick={() => setTab("text")}>
                  <FileText className="h-3.5 w-3.5" /> Paste text
                </TabButton>
              </div>

              <div className="p-4 sm:p-6">
                {tab === "pdf" ? (
                  <div>
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOver(true);
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        const f = e.dataTransfer.files?.[0];
                        if (f) handlePdfFile(f);
                      }}
                      onClick={() => inputRef.current?.click()}
                      className={`group relative cursor-pointer rounded-2xl border-2 border-dashed transition-all ${
                        dragOver
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/60 hover:bg-secondary/40"
                      } px-6 py-12 text-center`}
                    >
                      <input
                        ref={inputRef}
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handlePdfFile(f);
                        }}
                      />
                      <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-secondary text-primary group-hover:scale-110 transition-transform">
                        {extractingPdf ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Upload className="h-5 w-5" />
                        )}
                      </div>
                      <p className="mt-4 text-sm font-medium text-foreground">
                        {extractingPdf ? "Reading PDF..." : filename || "Drop your PDF here"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {pdfText
                          ? `${pdfText.length.toLocaleString()} characters extracted`
                          : "or click to browse"}
                      </p>
                    </div>
                    {pdfError && (
                      <p className="mt-2 text-xs text-destructive">{pdfError}</p>
                    )}
                  </div>
                ) : (
                  <textarea
                    ref={textareaRef}
                    placeholder="Paste your syllabus text here..."
                    className="w-full h-48 rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  />
                )}

                <button
                  onClick={handleMapSemester}
                  disabled={loading || extractingPdf || (tab === "pdf" && !pdfText)}
                  className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed ${theme === "light" ? "bg-[#F5C518] text-[#1a1a1a]" : "text-white animate-tri-gradient"}`}
                  style={{
                    backgroundImage: theme === "light" ? "none" : "linear-gradient(90deg, #FF006E, #00D4FF, #FF006E)",
                    backgroundSize: "300% 100%",
                    boxShadow: theme === "light" ? "none" : "0 0 30px rgba(255, 0, 110, 0.4), 0 0 80px rgba(0, 212, 255, 0.25)",
                  }}
                >
                  {loading ? "Processing..." : "Map My Semester"}
                  {!loading && <Sparkles className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
