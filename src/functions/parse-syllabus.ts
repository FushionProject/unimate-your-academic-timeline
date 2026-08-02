import { z } from "zod";
import { getAuthHeaders } from "../lib/auth-fetch";

const itemSchema = z.object({
  title: z.string(),
  type: z.enum(["exam", "quiz", "assignment", "deadline"]),
  due_date: z.string(),
});

const responseSchema = z.object({
  items: z.array(itemSchema),
});

export async function parseSyllabus(data: { syllabusText: string }) {
  const { syllabusText } = data;

  try {
    const response = await fetch("/api/parse-syllabus", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getAuthHeaders()),
      },
      body: JSON.stringify({ syllabusText }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error:", errorText);
      throw new Error(`API error: ${response.status}`);
    }

    const responseData = await response.json();
    const validatedData = responseSchema.parse(responseData);
    return validatedData;
  } catch (error) {
    console.error("Error in parseSyllabus:", error);
    throw error;
  }
}
