import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAuth } from "./auth-context";

export interface Course {
  id: string;
  user_id: string;
  name: string;
  course_code: string;
  score: number | null;
  grade: string | null;
  created_at: string;
}

export interface Assignment {
  id: string;
  user_id: string;
  course_id: string;
  name: string;
  due_at: string;
  completed: boolean;
  created_at: string;
}

function requireSupabase() {
  if (!supabase)
    throw new Error("Auth isn't configured yet — add your Supabase keys to .env.local.");
  return supabase;
}

// --- Courses ---

export function useCourses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["courses", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Course[]> => {
      const { data, error } = await requireSupabase()
        .from("courses")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useAddCourse() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; course_code: string; score?: number | null }) => {
      if (!user) throw new Error("You must be signed in.");
      const { data, error } = await requireSupabase()
        .from("courses")
        .insert({
          user_id: user.id,
          name: input.name,
          course_code: input.course_code,
          score: input.score ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Course;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["courses", user?.id] });
    },
  });
}

export function useRemoveCourse() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (courseId: string) => {
      if (!user) throw new Error("You must be signed in.");
      const { error } = await requireSupabase()
        .from("courses")
        .delete()
        .eq("id", courseId)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["courses", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["assignments", user?.id] });
    },
  });
}

// --- Assignments ---

export function useAssignments() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["assignments", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Assignment[]> => {
      const { data, error } = await requireSupabase()
        .from("assignments")
        .select("*")
        .eq("user_id", user!.id)
        .order("due_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useAddAssignment() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; course_id: string; due_at: string }) => {
      if (!user) throw new Error("You must be signed in.");
      const { data, error } = await requireSupabase()
        .from("assignments")
        .insert({
          user_id: user.id,
          course_id: input.course_id,
          name: input.name,
          due_at: input.due_at,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Assignment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments", user?.id] });
    },
  });
}

export function useToggleAssignment() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; completed: boolean }) => {
      if (!user) throw new Error("You must be signed in.");
      const { error } = await requireSupabase()
        .from("assignments")
        .update({ completed: !input.completed })
        .eq("id", input.id)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments", user?.id] });
    },
  });
}

export function useRemoveAssignment() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string) => {
      if (!user) throw new Error("You must be signed in.");
      const { error } = await requireSupabase()
        .from("assignments")
        .delete()
        .eq("id", assignmentId)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments", user?.id] });
    },
  });
}

// --- Pure helpers (operate on already-fetched data, no fetching of their own) ---

export function getCourseGrade(
  courses: Course[],
  courseId: string,
): { score: number | null; grade: string | null } {
  const course = courses.find((c) => c.id === courseId);
  return { score: course?.score ?? null, grade: course?.grade ?? null };
}

export function getUpcomingAssignments(assignments: Assignment[], days: number = 14): Assignment[] {
  const now = new Date();
  const future = new Date();
  future.setDate(future.getDate() + days);

  return assignments
    .filter((a) => !a.completed && a.due_at)
    .filter((a) => {
      const due = new Date(a.due_at);
      return due >= now && due <= future;
    })
    .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
}

export function getAcademicContext(
  courses: Course[],
  assignments: Assignment[],
  assignmentLimit = 7,
): string {
  if (courses.length === 0) return "";

  let context = "Current Courses:\n";
  courses.forEach((course) => {
    context += `- ${course.name} (${course.course_code})`;
    if (course.score !== null) {
      context += ` - Current Grade: ${course.score.toFixed(1)}%`;
    }
    context += "\n";
  });

  const upcoming = assignments
    .filter((a) => !a.completed && a.due_at)
    .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
    .slice(0, assignmentLimit);
  if (upcoming.length > 0) {
    context += "\nNext Saved Assignments:\n";
    upcoming.forEach((a) => {
      const course = courses.find((c) => c.id === a.course_id);
      const dueDate = new Date(a.due_at).toLocaleDateString();
      context += `- ${a.name} (due ${dueDate}) - ${course?.name || "Unknown Course"}\n`;
    });
  }

  return context;
}
