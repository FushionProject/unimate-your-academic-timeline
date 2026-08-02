import { z } from "zod";
import { getAuthHeaders } from "../lib/auth-fetch";

const responseSchema = z.object({
  answer: z.string(),
  webResults: z.array(
    z.object({
      title: z.string(),
      link: z.string(),
      snippet: z.string(),
    }),
  ),
  relatedConcepts: z.array(z.string()).optional(),
});

const errorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  phase: z.string().optional(),
});

export class UniMateApiError extends Error {
  status: number;
  code?: string;
  phase?: string;

  constructor(message: string, status: number, code?: string, phase?: string) {
    super(message);
    this.name = "UniMateApiError";
    this.status = status;
    this.code = code;
    this.phase = phase;
  }
}

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function askUniMate(data: {
  question: string;
  conversationHistory?: ConversationMessage[];
  classContext?: string[];
  mode?: "normal" | "simpler" | "deeper";
  canvasContext?: string;
}) {
  const { question, conversationHistory, classContext, mode = "normal", canvasContext } = data;

  const response = await fetch("/api/ask-unimate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: JSON.stringify({ question, conversationHistory, classContext, mode, canvasContext }),
  });

  if (!response.ok) {
    const parsed = errorSchema.safeParse(await response.json().catch(() => null));
    throw new UniMateApiError(
      parsed.success ? parsed.data.error : "UniMate couldn't finish that response.",
      response.status,
      parsed.success ? parsed.data.code : undefined,
      parsed.success ? parsed.data.phase : undefined,
    );
  }

  return responseSchema.parse(await response.json());
}
