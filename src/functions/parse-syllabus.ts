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

type SyllabusApiError = {
  error?: string;
  code?: string;
};

export class SyllabusParseError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryAfterSeconds: number | null,
  ) {
    super(message);
    this.name = "SyllabusParseError";
  }
}

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
    const payload = (await response.json().catch(() => ({}))) as SyllabusApiError;
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new SyllabusParseError(
      payload.error || "UniMate could not build this timeline right now.",
      payload.code || "SYLLABUS_PARSE_FAILED",
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : null,
    );
  }

  const responseData = await response.json();
  return responseSchema.parse(responseData);
}
