import { z } from "zod";

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
  console.log("askUniMate called with:", { question, mode });

  try {
    const response = await fetch("/api/ask-unimate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question, conversationHistory, classContext, mode, canvasContext }),
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
    console.error("Error in askUniMate:", error);
    throw error;
  }
}
