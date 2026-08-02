import { z } from "zod";
import { getAuthHeaders } from "../lib/auth-fetch";

const resourceSchema = z.object({
  type: z.enum(["portal", "textbook", "office_hours", "contact"]),
  title: z.string(),
  details: z.string(),
});

const responseSchema = z.object({
  resources: z.array(resourceSchema),
});

export async function extractResources(data: { syllabusText: string }) {
  const { syllabusText } = data;

  try {
    const response = await fetch("/api/extract-resources", {
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
    console.error("Error in extractResources:", error);
    throw error;
  }
}
