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

  const response = await fetch("/api/extract-resources", {
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
