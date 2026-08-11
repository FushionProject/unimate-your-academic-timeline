import { z } from "zod";
import { getAuthHeaders } from "../lib/auth-fetch";

const itemSchema = z.object({
  title: z.string(),
  type: z.enum(["exam", "quiz", "assignment", "project", "deadline"]),
  due_date: z.string(),
});

const responseSchema = z.object({
  items: z.array(itemSchema),
});

export async function parseSyllabus(data: { syllabusText: string }) {
  const { syllabusText } = data;

  const response = await fetch("/api/parse-syllabus", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-UniMate-Request-Id": crypto.randomUUID(),
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({ syllabusText }),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const responseData = await response.json();
  return responseSchema.parse(responseData);
}
