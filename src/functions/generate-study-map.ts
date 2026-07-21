import { z } from "zod";

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
  console.log("generateStudyMap called with items:", items);

  try {
    const response = await fetch("/api/generate-study-map", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items }),
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
    console.error("Error in generateStudyMap:", error);
    throw error;
  }
}
