// Local dev only: load .env.local into process.env. This block is compiled out
// of the production build (import.meta.env.DEV === false), so the deployed
// Cloudflare Worker never touches the filesystem — set GROQ_API_KEY and
// SERPAPI_KEY as Worker secrets instead (`wrangler secret put <NAME>`).
if (import.meta.env.DEV) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local — fall through to whatever is already in process.env.
  }
}

import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type SearchResult = {
  title: string;
  link: string;
  snippet?: string;
  description?: string;
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type GroqChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

// Handle /api/ask-unimate endpoint
async function handleAskUniMate(request: Request): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const body = await request.json();
    const { question, conversationHistory, classContext, mode, canvasContext } = body;

    if (!question) {
      return new Response(JSON.stringify({ error: "Question is required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const serpApiKey = process.env.SERPAPI_KEY;
    const groqApiKey = process.env.GROQ_API_KEY;

    // Return mock data if no API keys are set
    if (!serpApiKey) {
      console.warn("SERPAPI_KEY not set, returning mock data");
      return new Response(
        JSON.stringify({
          answer:
            "This is a mock answer for testing. The SerpAPI key is not configured, so I cannot perform real web searches. Please add SERPAPI_KEY to your environment variables.",
          webResults: [
            {
              title: "Mock Web Result 1",
              link: "https://example.com/1",
              snippet: "This is a mock web result for testing purposes.",
            },
            {
              title: "Mock Web Result 2",
              link: "https://example.com/2",
              snippet: "Another mock result to demonstrate the UI layout.",
            },
          ],
          relatedConcepts: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    // Call SerpAPI for web search
    const serpResponse = await fetch(
      `https://serpapi.com/search?engine=google&q=${encodeURIComponent(question)}&api_key=${serpApiKey}&num=5`,
    );

    if (!serpResponse.ok) {
      const errorText = await serpResponse.text();
      console.error("SerpAPI error:", errorText);
      return new Response(JSON.stringify({ error: `SerpAPI error: ${serpResponse.status}` }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const serpData = (await serpResponse.json()) as { organic_results?: SearchResult[] };
    const organicResults = serpData.organic_results || [];

    // Get top 3 web results
    const top3Results = organicResults.slice(0, 3).map((item) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet || item.description || "",
    }));

    console.log("Top 3 web results:", top3Results);

    // If no Groq API key, return just the web results without AI answer
    if (!groqApiKey) {
      console.warn("GROQ_API_KEY not set, returning web results only");
      return new Response(
        JSON.stringify({
          answer:
            "AI answer not available. Please add GROQ_API_KEY to your environment variables to enable AI-powered answers.",
          webResults: top3Results,
          relatedConcepts: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    // Build system prompt with class context
    let systemPrompt =
      "You are an academic tutor. Given this question and web search results, provide a clear concise answer with step-by-step explanation if needed.";
    if (classContext && classContext.length > 0) {
      systemPrompt += ` The student is currently taking these courses: ${classContext.join(", ")}. Tailor your explanations to be relevant to their coursework.`;
    }
    if (canvasContext) {
      systemPrompt += `\n\n${canvasContext}`;
    }

    // Build messages array with conversation history
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: systemPrompt,
      },
    ];

    // Add conversation history if provided
    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      messages.push(...conversationHistory);
    }

    // Handle different modes
    let userContent = "";
    if (mode === "simpler") {
      userContent = `Please explain the previous answer in simpler terms, using more basic language and avoiding jargon where possible.`;
    } else if (mode === "deeper") {
      userContent = `Please provide a more detailed breakdown of the previous answer, going deeper into the concepts and providing additional context or examples.`;
    } else {
      const context = top3Results
        .map((result, i) => `Source ${i + 1}: ${result.title}\n${result.snippet}`)
        .join("\n\n");
      userContent = `Question: ${question}\n\nWeb Search Results:\n${context}\n\nPlease provide a helpful answer based on these results.`;
    }

    messages.push({
      role: "user",
      content: userContent,
    });

    // Call Groq API
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      console.error("Groq API error:", errorText);
      return new Response(JSON.stringify({ error: `Groq API error: ${groqResponse.status}` }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const groqData = (await groqResponse.json()) as GroqChatResponse;
    const answer = groqData.choices?.[0]?.message?.content || "No answer generated.";

    console.log("AI answer generated:", answer);

    // Generate related concepts
    let relatedConcepts: string[] = [];
    if (mode !== "simpler" && mode !== "deeper") {
      try {
        const conceptsResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${groqApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              {
                role: "system",
                content:
                  "You are an academic tutor. Based on the question and answer, suggest 2-3 related concepts the student might want to explore next. Return ONLY a JSON array of strings, no other text.",
              },
              {
                role: "user",
                content: `Question: ${question}\nAnswer: ${answer}\n\nSuggest 2-3 related concepts as a JSON array of strings.`,
              },
            ],
            temperature: 0.5,
            max_tokens: 200,
          }),
        });

        if (conceptsResponse.ok) {
          const conceptsData = (await conceptsResponse.json()) as GroqChatResponse;
          const conceptsText = conceptsData.choices?.[0]?.message?.content || "[]";
          try {
            relatedConcepts = JSON.parse(conceptsText);
          } catch (e) {
            console.error("Failed to parse related concepts:", conceptsText);
          }
        }
      } catch (e) {
        console.error("Error generating related concepts:", e);
      }
    }

    return new Response(JSON.stringify({ answer, webResults: top3Results, relatedConcepts }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    console.error("Error in handleAskUniMate:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

// Handle /api/dashboard-ai endpoint
async function handleDashboardAI(request: Request): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const body = await request.json();
    const { type, academicContext, message, chatHistory } = body;

    const groqApiKey = process.env.GROQ_API_KEY;

    if (!groqApiKey) {
      const mockResponses: Record<string, string> = {
        "study-tonight":
          "Tonight, focus on Physics I — your lowest grade at 79%. Review the last problem set and redo any missed questions. Spend 45 minutes, then close with 15 minutes reviewing Calculus for the upcoming quiz.",
        "on-track":
          "CS 101 (A-): On track for an A.\nCalculus II (B+): Push hard on the next quiz to secure an A-.\nEnglish Comp (A): Solid — maintain momentum.\nPhysics I (C+): At risk — needs dedicated attention this week to avoid a grade drop.",
        motivation:
          "You're carrying 4 courses and still maintaining above a 3.4 GPA. The Physics grade is the one thing standing between you and a 3.5+. Fix that, and this is a strong semester.",
        chat: "Based on your grades and upcoming deadlines, prioritize assignments due within 48 hours first, then spend 30 minutes daily on your weakest subject. Consistency beats cramming every time.",
      };
      return new Response(
        JSON.stringify({ answer: mockResponses[type] || mockResponses["chat"] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    let systemPrompt = "";
    let userMessage = "";

    if (type === "study-tonight") {
      systemPrompt =
        "You are an academic advisor for a college student. Give a specific, actionable study recommendation for tonight based on their grades and upcoming assignments. Be direct — name the subject, say why, give a time estimate. Keep it under 120 words.";
      userMessage = `${academicContext}\n\nWhat should this student specifically study tonight?`;
    } else if (type === "on-track") {
      systemPrompt =
        'You are an academic advisor. Analyze the student\'s current grades and give a brief course-by-course end-of-semester prediction. Be honest and specific. Format: "Course name: current grade → projected outcome. One short note." Keep total response under 150 words.';
      userMessage = `${academicContext}\n\nPredict the end-of-semester outcome per course.`;
    } else if (type === "motivation") {
      systemPrompt =
        "You are a motivational academic coach. Write exactly 2-3 sentences that are SPECIFIC to this student's actual grades and situation — no generic platitudes. Reference their real numbers or specific challenges. Make it feel personal, not corporate.";
      userMessage = `${academicContext || "A college student working hard on their coursework."}\n\nWrite a brief, specific motivational message.`;
    } else if (type === "chat") {
      systemPrompt = `You are UniMate, an AI academic advisor for college students. You have the student's academic data below and can help with coursework questions, study strategies, grade analysis, and academic planning. Be helpful, specific, and concise (under 200 words per response).\n\n${academicContext}`;
      userMessage = message || "Hello";
    } else {
      return new Response(JSON.stringify({ error: "Invalid type" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];

    if (type === "chat" && chatHistory && Array.isArray(chatHistory)) {
      messages.push(...chatHistory.slice(-10));
    }

    messages.push({ role: "user", content: userMessage });

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        temperature: type === "motivation" ? 0.85 : 0.7,
        max_tokens: type === "chat" ? 512 : 300,
      }),
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      console.error("Groq API error:", errorText);
      return new Response(JSON.stringify({ error: `Groq API error: ${groqResponse.status}` }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const groqData = (await groqResponse.json()) as GroqChatResponse;
    const answer = groqData.choices?.[0]?.message?.content || "No response generated.";

    return new Response(JSON.stringify({ answer }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    console.error("Error in handleDashboardAI:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Shared Groq chat-completion call that expects a JSON payload back.
async function callGroqJson(
  groqApiKey: string,
  systemPrompt: string,
  userContent: string,
): Promise<unknown> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error: ${response.status} - ${errorText}`);
  }

  const apiData = await response.json();
  const content = apiData.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No content returned from Groq API");
  }
  return JSON.parse(content);
}

// Handle /api/parse-syllabus endpoint
async function handleParseSyllabus(request: Request): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const { syllabusText } = await request.json();
    if (!syllabusText) {
      return jsonResponse({ error: "Syllabus text is required" }, 400);
    }

    const groqApiKey = process.env.GROQ_API_KEY;

    // For testing without API key, return mock data
    if (!groqApiKey) {
      console.warn("GROQ_API_KEY not set, returning mock data for testing");
      return jsonResponse({
        items: [
          { title: "Midterm Exam", type: "exam", due_date: "2025-03-15" },
          { title: "Problem Set 1", type: "assignment", due_date: "2025-02-20" },
          { title: "Quiz 1", type: "quiz", due_date: "2025-02-28" },
        ],
      });
    }

    const items = await callGroqJson(
      groqApiKey,
      `You are a helpful assistant that extracts academic deadlines, exams, quizzes, and assignments from syllabus text.
            Extract all relevant dates and events. Return the results as a JSON array with the following structure:
            [
              {
                "title": "Event title",
                "type": "exam" | "quiz" | "assignment" | "deadline",
                "due_date": "YYYY-MM-DD"
              }
            ]
            Only return the JSON array, no other text.`,
      syllabusText,
    );

    return jsonResponse({ items });
  } catch (error) {
    console.error("Error in handleParseSyllabus:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

// Handle /api/extract-resources endpoint
async function handleExtractResources(request: Request): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const { syllabusText } = await request.json();
    if (!syllabusText) {
      return jsonResponse({ error: "Syllabus text is required" }, 400);
    }

    const groqApiKey = process.env.GROQ_API_KEY;

    // For testing without API key, return mock data
    if (!groqApiKey) {
      console.warn("GROQ_API_KEY not set, returning mock data for testing");
      return jsonResponse({
        resources: [
          {
            type: "portal",
            title: "Canvas Course Portal",
            details: "https://canvas.university.edu/courses/cs101",
          },
          {
            type: "textbook",
            title: "Introduction to Algorithms",
            details: "3rd Edition, ISBN: 978-0262033848",
          },
          {
            type: "office_hours",
            title: "Professor Smith",
            details: "Mon/Wed 2-4pm, Building A, Room 301",
          },
          { type: "contact", title: "Email", details: "smith@university.edu" },
        ],
      });
    }

    const resources = await callGroqJson(
      groqApiKey,
      `You are a helpful assistant that extracts course resources from syllabus text.
            Extract course portals, textbook information, office hours, and professor contact information.
            Return the results as a JSON array with the following structure:
            [
              {
                "type": "portal" | "textbook" | "office_hours" | "contact",
                "title": "Resource title",
                "details": "Detailed information (URL, hours, email, etc.)"
              }
            ]
            Only return the JSON array, no other text.`,
      syllabusText,
    );

    return jsonResponse({ resources });
  } catch (error) {
    console.error("Error in handleExtractResources:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

// Handle /api/generate-study-map endpoint
async function handleGenerateStudyMap(request: Request): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const { items } = await request.json();
    if (!items || !Array.isArray(items)) {
      return jsonResponse({ error: "Items array is required" }, 400);
    }

    const groqApiKey = process.env.GROQ_API_KEY;

    // For testing without API key, return mock data
    if (!groqApiKey) {
      console.warn("GROQ_API_KEY not set, returning mock data for testing");
      return jsonResponse({
        study_tasks: [
          {
            title: "Study for Midterm Exam",
            description: "Review chapters 1-5, complete practice problems",
            start_date: "2025-03-01",
            end_date: "2025-03-14",
            estimated_hours: 20,
            priority: "high",
            related_to: "Midterm Exam",
          },
          {
            title: "Work on Problem Set 1",
            description: "Complete problems 1-5, seek help if needed",
            start_date: "2025-02-15",
            end_date: "2025-02-19",
            estimated_hours: 8,
            priority: "medium",
            related_to: "Problem Set 1",
          },
          {
            title: "Prepare for Quiz 1",
            description: "Review lecture notes, complete quiz practice",
            start_date: "2025-02-22",
            end_date: "2025-02-27",
            estimated_hours: 5,
            priority: "medium",
            related_to: "Quiz 1",
          },
        ],
      });
    }

    const studyTasks = await callGroqJson(
      groqApiKey,
      `You are a helpful assistant that generates study schedules from academic deadlines.
            Based on the provided items (exams, quizzes, assignments, deadlines), create a study plan with specific study tasks.
            For each item, suggest when to start studying and how many hours to allocate.
            Return the results as a JSON array with the following structure:
            [
              {
                "title": "Study task title",
                "description": "What to study or do",
                "start_date": "YYYY-MM-DD",
                "end_date": "YYYY-MM-DD",
                "estimated_hours": number,
                "priority": "high" | "medium" | "low",
                "related_to": "Title of the related exam/quiz/assignment"
              }
            ]
            Only return the JSON array, no other text.`,
      JSON.stringify(items, null, 2),
    );

    return jsonResponse({ study_tasks: studyTasks });
  } catch (error) {
    console.error("Error in handleGenerateStudyMap:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

// Handle /api/canvas-proxy endpoint — the Canvas REST API doesn't send CORS
// headers, so browsers can't call it directly. The client sends the user's
// Canvas host + token here and we forward the request server-side.
async function handleCanvasProxy(request: Request): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const { apiUrl, apiToken, path } = await request.json();
    if (!apiUrl || !apiToken || !path) {
      return jsonResponse({ error: "apiUrl, apiToken, and path are required" }, 400);
    }

    let canvasUrl: URL;
    try {
      canvasUrl = new URL(apiUrl);
    } catch {
      return jsonResponse({ error: "Invalid Canvas URL" }, 400);
    }

    // Only forward https requests to Canvas /api/v1/ paths — this is not a
    // general-purpose proxy.
    if (canvasUrl.protocol !== "https:") {
      return jsonResponse({ error: "Canvas URL must use https" }, 400);
    }
    const hostname = canvasUrl.hostname;
    if (
      hostname === "localhost" ||
      !hostname.includes(".") ||
      /^[\d.]+$/.test(hostname) ||
      hostname.includes(":")
    ) {
      return jsonResponse({ error: "Invalid Canvas host" }, 400);
    }
    if (typeof path !== "string" || !path.startsWith("/api/v1/")) {
      return jsonResponse({ error: "Only Canvas /api/v1/ paths are allowed" }, 400);
    }

    const upstream = await fetch(`${canvasUrl.origin}${path}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (error) {
    console.error("Error in handleCanvasProxy:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

// Checks whether the caller's Supabase access token belongs to a Pro user.
// Queries their own profiles row over Supabase's REST API — RLS restricts
// this to the caller's own row, so no service-role key is needed here.
async function getIsProFromToken(accessToken: string): Promise<boolean> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return false;

  try {
    // Reads the is_pro column from the public.profiles table ONLY — never
    // raw_user_meta_data or any auth-user field, which a user can influence.
    // RLS ("profiles_select_own") scopes this to the caller's own row.
    const res = await fetch(`${supabaseUrl}/rest/v1/profiles?select=is_pro&limit=1`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0]?.is_pro === true;
  } catch (error) {
    console.error("Error checking pro status:", error);
    return false;
  }
}

// Handle /api/analyze-screenshot endpoint — called by the browser extension's
// "capture and ask" feature. Uses a vision-capable Groq model since the text
// models used elsewhere in this file can't read images. Gated to Pro users.
async function handleAnalyzeScreenshot(request: Request): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const authHeader = request.headers.get("Authorization");
    const accessToken = authHeader?.replace(/^Bearer\s+/i, "");
    if (!accessToken) {
      return jsonResponse({ error: "Sign in required" }, 401);
    }

    const isPro = await getIsProFromToken(accessToken);
    if (!isPro) {
      return jsonResponse({ error: "UniMate Pro required", upgradeRequired: true }, 402);
    }

    const body = await request.json();
    const { imageBase64, question } = body;

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return jsonResponse({ error: "imageBase64 is required" }, 400);
    }

    const groqApiKey = process.env.GROQ_API_KEY;

    if (!groqApiKey) {
      console.warn("GROQ_API_KEY not set, returning mock data for testing");
      return jsonResponse({
        answer:
          "This is a mock answer for testing. Add GROQ_API_KEY to your environment variables to enable real screenshot analysis.",
      });
    }

    const userPrompt =
      typeof question === "string" && question.trim()
        ? question.trim()
        : "This is a homework or study question captured from a screen. Identify the question and give a clear, direct answer.";

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Vision-capable model available on this Groq account (verified it
        // reads text out of images). Groq's model lineup shifts often — if
        // this 400s with model_decommissioned/model_not_found, hit
        // GET /openai/v1/models and pick another that accepts image_url content.
        model: "qwen/qwen3.6-27b",
        // qwen is a reasoning model; without this it spends the whole token
        // budget "thinking" and never reaches an answer. "none" turns that off.
        reasoning_effort: "none",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              { type: "image_url", image_url: { url: imageBase64 } },
            ],
          },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      }),
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      console.error("Groq vision API error:", errorText);
      return jsonResponse({ error: `Groq API error: ${groqResponse.status}` }, 500);
    }

    const groqData = await groqResponse.json();
    const raw = groqData.choices?.[0]?.message?.content || "No answer generated.";
    // qwen is a reasoning model that emits a <think>...</think> block before
    // the actual answer — strip it so the user only sees the answer.
    const answer = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() || raw.trim();

    return jsonResponse({ answer });
  } catch (error) {
    console.error("Error in handleAnalyzeScreenshot:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

// Handle /api/create-checkout-session — starts a Stripe Checkout flow for
// UniMate Pro. Calls Stripe's REST API directly with fetch rather than the
// Stripe Node SDK, since that SDK's Cloudflare Workers compatibility isn't
// something that can be verified without running it against a real request.
async function handleCreateCheckoutSession(request: Request): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const authHeader = request.headers.get("Authorization");
    const accessToken = authHeader?.replace(/^Bearer\s+/i, "");
    if (!accessToken) {
      return jsonResponse({ error: "Sign in required" }, 401);
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const stripePriceId = process.env.STRIPE_PRICE_ID;
    if (!stripeSecretKey || !stripePriceId) {
      return jsonResponse(
        {
          error:
            "Payments aren't configured yet. Add STRIPE_SECRET_KEY and STRIPE_PRICE_ID to your environment.",
        },
        501,
      );
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ error: "Auth isn't configured" }, 500);
    }

    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) {
      return jsonResponse({ error: "Invalid session" }, 401);
    }
    const userData = await userRes.json();
    const userId = userData.id as string;
    const email = userData.email as string | undefined;

    const { origin } = new URL(request.url);

    const params = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": stripePriceId,
      "line_items[0][quantity]": "1",
      success_url: `${origin}/upgrade?success=true`,
      cancel_url: `${origin}/upgrade?canceled=true`,
      client_reference_id: userId,
      "metadata[user_id]": userId,
    });
    if (email) params.set("customer_email", email);

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!stripeRes.ok) {
      const errText = await stripeRes.text();
      console.error("Stripe checkout session error:", errText);
      return jsonResponse({ error: "Failed to start checkout" }, 500);
    }

    const session = await stripeRes.json();
    return jsonResponse({ url: session.url });
  } catch (error) {
    console.error("Error in handleCreateCheckoutSession:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
}

// Verifies a Stripe webhook signature (HMAC-SHA256 over "timestamp.payload")
// using Web Crypto, since the Stripe SDK's own verifier isn't something that
// can be assumed to work unmodified on Workers.
async function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key, value];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return expectedSignature === signature;
}

// Handle /api/stripe-webhook — the only thing allowed to flip a user's
// is_pro flag. Uses the service_role key (server-only, bypasses RLS by
// design) since this must be able to write regardless of the user's own
// permissions.
async function handleStripeWebhook(request: Request): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.warn("STRIPE_WEBHOOK_SECRET not set — rejecting webhook");
      return new Response("Webhook not configured", { status: 501 });
    }

    const signatureHeader = request.headers.get("Stripe-Signature");
    const payload = await request.text();
    if (
      !signatureHeader ||
      !(await verifyStripeSignature(payload, signatureHeader, webhookSecret))
    ) {
      return new Response("Invalid signature", { status: 400 });
    }

    const event = JSON.parse(payload);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId: string | undefined = session.client_reference_id || session.metadata?.user_id;
      const customerId: string | undefined = session.customer;

      if (userId) {
        const supabaseUrl = process.env.VITE_SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseUrl && serviceRoleKey) {
          await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
            method: "PATCH",
            headers: {
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({ is_pro: true, stripe_customer_id: customerId }),
          });
        } else {
          console.error("Cannot update pro status — SUPABASE_SERVICE_ROLE_KEY not configured");
        }
      }
    }

    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("Error in handleStripeWebhook:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);

    // Handle /api/ask-unimate endpoint
    if (url.pathname === "/api/ask-unimate") {
      return handleAskUniMate(request);
    }

    // Handle /api/dashboard-ai endpoint
    if (url.pathname === "/api/dashboard-ai") {
      return handleDashboardAI(request);
    }

    // Handle /api/parse-syllabus endpoint
    if (url.pathname === "/api/parse-syllabus") {
      return handleParseSyllabus(request);
    }

    // Handle /api/extract-resources endpoint
    if (url.pathname === "/api/extract-resources") {
      return handleExtractResources(request);
    }

    // Handle /api/generate-study-map endpoint
    if (url.pathname === "/api/generate-study-map") {
      return handleGenerateStudyMap(request);
    }

    // Handle /api/canvas-proxy endpoint
    if (url.pathname === "/api/canvas-proxy") {
      return handleCanvasProxy(request);
    }

    // Handle /api/analyze-screenshot endpoint
    if (url.pathname === "/api/analyze-screenshot") {
      return handleAnalyzeScreenshot(request);
    }

    // Handle /api/create-checkout-session endpoint
    if (url.pathname === "/api/create-checkout-session") {
      return handleCreateCheckoutSession(request);
    }

    // Handle /api/stripe-webhook endpoint
    if (url.pathname === "/api/stripe-webhook") {
      return handleStripeWebhook(request);
    }

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
};
