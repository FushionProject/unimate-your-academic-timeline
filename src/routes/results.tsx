import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { ArrowLeft, Save, CheckCircle2, Loader2 } from "lucide-react";
import { z } from "zod";
import { useState, useEffect } from "react";
import { extractResources } from "../functions/extract-resources";
import { generateStudyMap } from "../functions/generate-study-map";
import { useAddCourse, useAddAssignment } from "../lib/courses";
import { useAuth } from "../lib/auth-context";

const itemSchema = z.object({
  title: z.string(),
  type: z.enum(["exam", "quiz", "assignment", "deadline"]),
  due_date: z.string(),
});

const searchSchema = z.object({
  items: z.array(itemSchema),
  syllabusText: z.string().optional(),
});

export const Route = createFileRoute("/results")({
  component: Results,
  validateSearch: searchSchema,
});

function Results() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { items, syllabusText } = Route.useSearch();
  const [tab, setTab] = useState<"timeline" | "study-map">("timeline");
  const [resources, setResources] = useState<any[] | null>(null);
  const [studyTasks, setStudyTasks] = useState<any[] | null>(null);
  const [loadingResources, setLoadingResources] = useState(false);
  const [loadingStudyMap, setLoadingStudyMap] = useState(false);
  const [saveCourseName, setSaveCourseName] = useState("");
  const [saveCourseCode, setSaveCourseCode] = useState("");
  const [savedToPlanner, setSavedToPlanner] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const addCourse = useAddCourse();
  const addAssignment = useAddAssignment();

  useEffect(() => {
    if (syllabusText) {
      extractResources({ syllabusText })
        .then((data) => setResources(data.resources))
        .catch((error) => console.error("Error extracting resources:", error));
    }
  }, [syllabusText]);

  useEffect(() => {
    if (tab === "study-map" && items && !studyTasks) {
      setLoadingStudyMap(true);
      generateStudyMap({ items })
        .then((data) => {
          setStudyTasks(data.study_tasks);
          setLoadingStudyMap(false);
        })
        .catch((error) => {
          console.error("Error generating study map:", error);
          setLoadingStudyMap(false);
        });
    }
  }, [tab, items, studyTasks]);

  const handleSaveToPlanner = async () => {
    if (!saveCourseName.trim() || !items || items.length === 0) return;
    setSaveError("");
    setSaving(true);
    try {
      const course = await addCourse.mutateAsync({
        name: saveCourseName.trim(),
        course_code: saveCourseCode.trim(),
      });
      await Promise.all(
        items.map((item) =>
          addAssignment.mutateAsync({
            name: item.title,
            course_id: course.id,
            due_at: new Date(item.due_date + "T12:00:00").toISOString(),
          })
        )
      );
      setSavedToPlanner(true);
    } catch (error) {
      console.error("Error saving to planner:", error);
      setSaveError(error instanceof Error ? error.message : "Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "exam":
        return "bg-red-100 text-red-800 border-red-200";
      case "quiz":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "assignment":
        return "bg-green-100 text-green-800 border-green-200";
      case "deadline":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  // Calculate semester week intensity from items
  const calculateWeekIntensity = (items: any[]) => {
    if (!items || items.length === 0) return [];

    // Infer semester start from the earliest date
    const dates = items.map((item) => new Date(item.due_date + "T12:00:00").getTime());
    const semesterStart = Math.min(...dates);
    const semesterStartDate = new Date(semesterStart);

    // Calculate week number for each item based on semester start
    const weekMap = new Map<number, number>();

    items.forEach((item) => {
      const itemDate = new Date(item.due_date + "T12:00:00");
      const timeDiff = itemDate.getTime() - semesterStartDate.getTime();
      const weekNumber = Math.floor(timeDiff / (7 * 24 * 60 * 60 * 1000)) + 1;
      const currentCount = weekMap.get(weekNumber) || 0;
      weekMap.set(weekNumber, currentCount + 1);
    });

    // Create 16 weeks with intensity counts
    const weeks = Array.from({ length: 16 }, (_, i) => ({
      week: i + 1,
      intensity: weekMap.get(i + 1) || 0,
    }));

    return weeks;
  };

  const weekData = items ? calculateWeekIntensity(items) : [];

  const getResourceIcon = (type: string) => {
    switch (type) {
      case "portal":
        return "🌐";
      case "textbook":
        return "📚";
      case "office_hours":
        return "🕐";
      case "contact":
        return "📧";
      default:
        return "📄";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "bg-red-100 text-red-800 border-red-200";
      case "medium":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "low":
        return "bg-green-100 text-green-800 border-green-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => navigate({ to: "/" })}
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </button>

        <h1 className="text-3xl font-bold text-foreground mb-2">Your Semester Timeline</h1>
        <p className="text-muted-foreground mb-6">
          {items?.length || 0} items extracted from your syllabus
        </p>

        {/* Save to Course Planner */}
        {items && items.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm mb-6">
            {!user ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Sign in to save these {items.length} item{items.length !== 1 ? "s" : ""} to your Course Planner.
                </p>
                <Link
                  to="/signin"
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-primary text-primary-foreground flex-shrink-0"
                >
                  Sign in
                </Link>
              </div>
            ) : savedToPlanner ? (
              <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                Saved {items.length} item{items.length !== 1 ? "s" : ""} to "{saveCourseName}" in your Course Planner.
              </div>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-foreground mb-1">Save to Course Planner</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Add these {items.length} items to your dashboard by saving them under a course.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={saveCourseName}
                    onChange={(e) => setSaveCourseName(e.target.value)}
                    placeholder="Course name (e.g. Organic Chemistry)"
                    className="flex-1 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <input
                    type="text"
                    value={saveCourseCode}
                    onChange={(e) => setSaveCourseCode(e.target.value)}
                    placeholder="Course code (optional)"
                    className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-48"
                  />
                  <button
                    onClick={handleSaveToPlanner}
                    disabled={!saveCourseName.trim() || saving}
                    className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50 flex-shrink-0"
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save to Planner
                  </button>
                </div>
                {saveError && <p className="mt-2 text-xs text-destructive">{saveError}</p>}
              </>
            )}
          </div>
        )}

        {/* Semester Heatmap */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-3">Semester Heatmap</h2>
          <div className="grid grid-cols-8 gap-2">
            {weekData.map((week) => {
              const getColor = (intensity: number) => {
                if (intensity === 0) return "#1e3a8a";
                if (intensity === 1) return "#93c5fd";
                if (intensity === 2) return "#f97316";
                return "#dc2626";
              };
              return (
                <div
                  key={week.week}
                  className="aspect-square rounded-lg flex items-center justify-center text-xs font-medium transition-all hover:scale-105"
                  style={{ backgroundColor: getColor(week.intensity) }}
                  title={`Week ${week.week}: ${week.intensity} item(s)`}
                >
                  {week.week}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <span>Week 1</span>
            <div className="flex items-center gap-2">
              <span>0 items</span>
              <div className="flex gap-1">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: "#1e3a8a" }} />
                <div className="w-4 h-4 rounded" style={{ backgroundColor: "#93c5fd" }} />
                <div className="w-4 h-4 rounded" style={{ backgroundColor: "#f97316" }} />
                <div className="w-4 h-4 rounded" style={{ backgroundColor: "#dc2626" }} />
              </div>
              <span>3+ items</span>
            </div>
            <span>Week 16</span>
          </div>
        </div>

        {/* Tab System */}
        <div className="flex items-center gap-1 rounded-2xl bg-secondary/60 p-1 mb-6">
          <button
            onClick={() => setTab("timeline")}
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              tab === "timeline"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Timeline
          </button>
          <button
            onClick={() => setTab("study-map")}
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              tab === "study-map"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Study Map
          </button>
        </div>

        {tab === "timeline" && (
          <>
            {!items || items.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No items found. Please try again.</p>
              </div>
            ) : (
              <div className="grid gap-4 mb-8">
                {items.map((item, index) => (
                  <div
                    key={index}
                    className="rounded-xl border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground text-lg">{item.title}</h3>
                        <div className="flex items-center gap-3 mt-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${getTypeColor(item.type)}`}
                          >
                            {item.type}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            Due: {new Date(item.due_date + "T12:00:00").toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Resources & Links Section */}
            <div className="mt-8">
              <h2 className="text-2xl font-bold text-foreground mb-4">Resources & Links</h2>
              {!resources || resources.length === 0 ? (
                <div className="text-center py-8 border border-border rounded-xl">
                  <p className="text-muted-foreground">No resources found.</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {resources.map((resource, index) => (
                    <div
                      key={index}
                      className="rounded-xl border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 flex-1">
                          <span className="text-2xl">{getResourceIcon(resource.type)}</span>
                          <div className="flex-1">
                            <h3 className="font-semibold text-foreground">{resource.title}</h3>
                            <p className="text-sm text-muted-foreground mt-1">{resource.details}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {tab === "study-map" && (
          <>
            {loadingStudyMap ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Generating your study map...</p>
              </div>
            ) : !studyTasks || studyTasks.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No study tasks generated.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {studyTasks.map((task, index) => (
                  <div
                    key={index}
                    className="rounded-xl border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-semibold text-foreground">{task.title}</h3>
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${getPriorityColor(task.priority)}`}
                          >
                            {task.priority}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mb-3">{task.description}</p>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>
                            📅 {new Date(task.start_date + "T12:00:00").toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })} - {new Date(task.end_date + "T12:00:00").toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                          <span>⏱️ {task.estimated_hours}h</span>
                          <span>📝 {task.related_to}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
