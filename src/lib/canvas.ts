// Canvas LMS Integration
// All data stored in localStorage, no server-side storage

export interface CanvasConfig {
  apiUrl: string;
  apiToken: string;
  connected: boolean;
}

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  enrollment_state: string;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  description: string;
  due_at: string | null;
  points_possible: number;
  course_id: number;
  submission_types: string[];
}

export interface CanvasEvent {
  id: number;
  title: string;
  description: string;
  start_at: string;
  end_at: string;
  context_type: string;
  context_id: number;
}

export interface CanvasTodo {
  id: number;
  assignment: CanvasAssignment;
  type: string;
  course_id: number;
}

export interface CanvasEnrollment {
  id: number;
  course_id: number;
  user_id: number;
  type: string;
  enrollment_state: string;
  grades: {
    current_score: number | null;
    final_score: number | null;
    current_grade: string | null;
    final_grade: string | null;
  };
}

const CANVAS_CONFIG_KEY = "canvasConfig";
const CANVAS_COURSES_KEY = "canvasCourses";
const CANVAS_ASSIGNMENTS_KEY = "canvasAssignments";
const CANVAS_EVENTS_KEY = "canvasEvents";
const CANVAS_TODOS_KEY = "canvasTodos";
const CANVAS_ENROLLMENTS_KEY = "canvasEnrollments";

// Get Canvas config from localStorage
export function getCanvasConfig(): CanvasConfig | null {
  try {
    const config = localStorage.getItem(CANVAS_CONFIG_KEY);
    return config ? JSON.parse(config) : null;
  } catch (error) {
    console.error("Error reading Canvas config:", error);
    return null;
  }
}

// Save Canvas config to localStorage
export function saveCanvasConfig(config: CanvasConfig): void {
  try {
    localStorage.setItem(CANVAS_CONFIG_KEY, JSON.stringify(config));
  } catch (error) {
    console.error("Error saving Canvas config:", error);
  }
}

// Clear Canvas config and data
export function clearCanvasData(): void {
  try {
    localStorage.removeItem(CANVAS_CONFIG_KEY);
    localStorage.removeItem(CANVAS_COURSES_KEY);
    localStorage.removeItem(CANVAS_ASSIGNMENTS_KEY);
    localStorage.removeItem(CANVAS_EVENTS_KEY);
    localStorage.removeItem(CANVAS_TODOS_KEY);
    localStorage.removeItem(CANVAS_ENROLLMENTS_KEY);
  } catch (error) {
    console.error("Error clearing Canvas data:", error);
  }
}

// All Canvas requests go through our server-side proxy (/api/canvas-proxy)
// because the Canvas REST API doesn't send CORS headers for browser requests.
function canvasProxyFetch(apiUrl: string, apiToken: string, path: string): Promise<Response> {
  return fetch("/api/canvas-proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ apiUrl: apiUrl.replace(/\/$/, ""), apiToken, path }),
  });
}

// Test Canvas connection
export async function testCanvasConnection(
  apiUrl: string,
  apiToken: string,
): Promise<{ success: boolean; courses?: CanvasCourse[]; error?: string }> {
  try {
    const response = await canvasProxyFetch(
      apiUrl,
      apiToken,
      "/api/v1/courses?enrollment_state=active&per_page=100",
    );

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Canvas API error: ${response.status} - ${errorText}` };
    }

    const courses: CanvasCourse[] = await response.json();
    return { success: true, courses };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// Fetch all Canvas data
export async function fetchCanvasData(): Promise<{ success: boolean; error?: string }> {
  const config = getCanvasConfig();
  if (!config) {
    return { success: false, error: "Canvas not connected" };
  }

  try {
    const { apiUrl, apiToken } = config;

    // Fetch courses
    const coursesResponse = await canvasProxyFetch(
      apiUrl,
      apiToken,
      "/api/v1/courses?enrollment_state=active&per_page=100",
    );
    if (!coursesResponse.ok) throw new Error("Failed to fetch courses");
    const courses: CanvasCourse[] = await coursesResponse.json();
    localStorage.setItem(CANVAS_COURSES_KEY, JSON.stringify(courses));

    // Fetch upcoming events
    const eventsResponse = await canvasProxyFetch(
      apiUrl,
      apiToken,
      "/api/v1/users/self/upcoming_events?per_page=50",
    );
    if (!eventsResponse.ok) throw new Error("Failed to fetch events");
    const events: CanvasEvent[] = await eventsResponse.json();
    localStorage.setItem(CANVAS_EVENTS_KEY, JSON.stringify(events));

    // Fetch todos
    const todosResponse = await canvasProxyFetch(apiUrl, apiToken, "/api/v1/users/self/todo");
    if (!todosResponse.ok) throw new Error("Failed to fetch todos");
    const todos: CanvasTodo[] = await todosResponse.json();
    localStorage.setItem(CANVAS_TODOS_KEY, JSON.stringify(todos));

    // Fetch enrollments (grades) for each course
    const enrollments: CanvasEnrollment[] = [];
    for (const course of courses) {
      try {
        const enrollmentResponse = await canvasProxyFetch(
          apiUrl,
          apiToken,
          `/api/v1/courses/${course.id}/enrollments?user_id=self`,
        );
        if (enrollmentResponse.ok) {
          const courseEnrollments: CanvasEnrollment[] = await enrollmentResponse.json();
          enrollments.push(...courseEnrollments);
        }
      } catch (error) {
        console.error(`Failed to fetch enrollment for course ${course.id}:`, error);
      }
    }
    localStorage.setItem(CANVAS_ENROLLMENTS_KEY, JSON.stringify(enrollments));

    // Fetch assignments for each course
    const assignments: CanvasAssignment[] = [];
    for (const course of courses) {
      try {
        const assignmentsResponse = await canvasProxyFetch(
          apiUrl,
          apiToken,
          `/api/v1/courses/${course.id}/assignments?bucket=upcoming&per_page=50`,
        );
        if (assignmentsResponse.ok) {
          const courseAssignments: CanvasAssignment[] = await assignmentsResponse.json();
          assignments.push(...courseAssignments);
        }
      } catch (error) {
        console.error(`Failed to fetch assignments for course ${course.id}:`, error);
      }
    }
    localStorage.setItem(CANVAS_ASSIGNMENTS_KEY, JSON.stringify(assignments));

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// Get cached Canvas data
export function getCanvasCourses(): CanvasCourse[] {
  try {
    const data = localStorage.getItem(CANVAS_COURSES_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    return [];
  }
}

export function getCanvasAssignments(): CanvasAssignment[] {
  try {
    const data = localStorage.getItem(CANVAS_ASSIGNMENTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    return [];
  }
}

export function getCanvasEvents(): CanvasEvent[] {
  try {
    const data = localStorage.getItem(CANVAS_EVENTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    return [];
  }
}

export function getCanvasTodos(): CanvasTodo[] {
  try {
    const data = localStorage.getItem(CANVAS_TODOS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    return [];
  }
}

export function getCanvasEnrollments(): CanvasEnrollment[] {
  try {
    const data = localStorage.getItem(CANVAS_ENROLLMENTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    return [];
  }
}

// Get grade for a specific course
export function getCourseGrade(courseId: number): { score: number | null; grade: string | null } {
  const enrollments = getCanvasEnrollments();
  const enrollment = enrollments.find((e) => e.course_id === courseId);
  return {
    score: enrollment?.grades.current_score ?? null,
    grade: enrollment?.grades.current_grade ?? null,
  };
}

// Get assignments due in next N days
export function getUpcomingAssignments(days: number = 7): CanvasAssignment[] {
  const assignments = getCanvasAssignments();
  const now = new Date();
  const future = new Date();
  future.setDate(future.getDate() + days);

  return assignments
    .filter((a) => a.due_at)
    .filter((a) => {
      const dueDate = new Date(a.due_at!);
      return dueDate >= now && dueDate <= future;
    })
    .sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime());
}

// Get Canvas context for AI prompts
export function getCanvasContext(): string {
  const courses = getCanvasCourses();
  const upcomingAssignments = getUpcomingAssignments(7);
  const enrollments = getCanvasEnrollments();

  if (courses.length === 0) return "";

  let context = "Current Courses:\n";
  courses.forEach((course) => {
    const grade = getCourseGrade(course.id);
    context += `- ${course.name} (${course.course_code})`;
    if (grade.score !== null) {
      context += ` - Current Grade: ${grade.score.toFixed(1)}%`;
    }
    context += "\n";
  });

  if (upcomingAssignments.length > 0) {
    context += "\nUpcoming Assignments (next 7 days):\n";
    upcomingAssignments.forEach((assignment) => {
      const course = courses.find((c) => c.id === assignment.course_id);
      const dueDate = new Date(assignment.due_at!).toLocaleDateString();
      context += `- ${assignment.name} (due ${dueDate}) - ${course?.name || "Unknown Course"}\n`;
    });
  }

  return context;
}
