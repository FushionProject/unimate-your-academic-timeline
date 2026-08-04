import { z } from "zod";
import { getAuthHeaders } from "../lib/auth-fetch";

const studyTaskSchema = z.object({
  title: z.string(),
  description: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  estimated_hours: z.number(),
  priority: z.enum(["high", "medium", "low"]),
  related_to: z.string(),
});

const responseSchema = z.object({
  study_tasks: z.array(studyTaskSchema),
});

type SyllabusItem = {
  title: string;
  type: "exam" | "quiz" | "assignment" | "deadline";
  due_date: string;
};

export async function generateStudyMap(data: { items: SyllabusItem[] }) {
  const { items } = data;

  const response = await fetch("/api/generate-study-map", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-UniMate-Request-Id": crypto.randomUUID(),
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const responseData = await response.json();
  return responseSchema.parse(responseData);
}
