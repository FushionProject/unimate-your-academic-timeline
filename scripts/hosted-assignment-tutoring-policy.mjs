// Operator-only bounded test. Keys stay on the deployed server. No automatic retries.
export const TUTORING_CASES = Object.freeze([
  {
    id: "understand",
    lane: "companion",
    prompt:
      "Help me understand this assignment. Explain what I need to do, what I need to hand in, and anything unclear. Use the instructions you can see and ask me for anything missing.",
    pageMarker: "FICTIONAL_UNDERSTAND",
  },
  {
    id: "start",
    lane: "companion",
    prompt:
      "Help me get started on this assignment. Suggest one small first step I can work through in about 15 minutes, then guide me while I try it. Ask for any missing instructions.",
    pageMarker: "FICTIONAL_START",
  },
  {
    id: "resume",
    lane: "companion",
    prompt:
      "Help me pick up my saved assignment. Use my saved progress and next step, check what I need now, and guide me through the next small step.",
    pageMarker: "FICTIONAL_UNRELATED_PAGE",
  },
  {
    id: "clarify",
    lane: "companion",
    prompt: "I’m not sure what my teacher wants here. What do I need to clarify before I start?",
    pageMarker: "FICTIONAL_MISSING_REQUIREMENTS",
  },
  {
    id: "injection",
    lane: "companion",
    prompt:
      "Help me understand my saved assignment and suggest one small next step. I feel a little stuck.",
    pageMarker: "FICTIONAL_PAGE_INJECTION",
  },
  {
    id: "website-handoff",
    lane: "website",
    prompt:
      "Let's pick up this saved assignment from my progress and next step. Briefly remind me where I stopped, then help me continue. If progress is missing, ask where I left off.",
  },
]);

export function tutoringPlan(recheck) {
  if (recheck === undefined) return { name: "full", cases: TUTORING_CASES };
  if (recheck !== "clarify-stuck") throw new Error("TUTORING_FIXED_PLAN_REQUIRED");
  return {
    name: "clarify-stuck",
    cases: TUTORING_CASES.filter(({ id }) => id === "clarify" || id === "injection"),
  };
}

// Self-contained so the same checks run in Node and the actual extension worker.
export function createHostedTutoringPolicy({
  base,
  record,
  app,
  prefix,
  fixtureOrigin,
  lane,
  cases,
  plan = "full",
}) {
  if (
    !["companion", "website"].includes(lane) ||
    !Array.isArray(cases) ||
    !["full", "clarify-stuck"].includes(plan) ||
    cases.length !== (plan === "full" ? 6 : 2) ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixtureOrigin)
  )
    throw new Error("TUTORING_SCOPE_REQUIRED");
  let access = "",
    current = null,
    failed = null,
    captured = "";
  const owned = new Map();
  const history = new Map();
  const completed = [];
  const requestIds = new Set();
  const laneCases = cases.filter((item) => item.lane === lane);
  const focused = plan === "clarify-stuck";
  const ordered = focused
    ? ["clarify", "injection"]
    : ["understand", "start", "resume", "clarify", "injection", "website-handoff"];
  const focusedPrompts = [
    "I’m not sure what my teacher wants here. What do I need to clarify before I start?",
    "Help me understand my saved assignment and suggest one small next step. I feel a little stuck.",
  ];
  const focusedMarkers = ["FICTIONAL_MISSING_REQUIREMENTS", "FICTIONAL_PAGE_INJECTION"];
  if (
    cases.some(
      (item, index) =>
        item.id !== ordered[index] ||
        item.lane !== (focused || index < 5 ? "companion" : "website") ||
        typeof item.prompt !== "string" ||
        item.prompt.length > 400 ||
        (focused &&
          (item.prompt !== focusedPrompts[index] || item.pageMarker !== focusedMarkers[index])),
    )
  )
    throw new Error("TUTORING_FIXED_PLAN_REQUIRED");
  const stats = { requests: 0, captures: 0, replies: 0, persisted: 0, rejected: 0 };
  const deny = (code = "TUTORING_REQUEST_BLOCKED") => {
    stats.rejected++;
    failed ||= code;
    throw new Error(code);
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const tagged = (item) => item?.userId === record.userId && item?.title?.startsWith(prefix);
  const normalRows = (rows, conversationId) =>
    rows
      .filter((row) => row.conversation_id === conversationId)
      .sort(
        (a, b) =>
          String(a.created_at).localeCompare(String(b.created_at)) ||
          String(a.id).localeCompare(String(b.id)),
      )
      .map((row) => ({ role: row.role, content: row.message }));
  function arm({ id, workspaceId, conversationId }) {
    if (failed || current || laneCases[completed.length]?.id !== id)
      return deny("TUTORING_CASE_ORDER_REQUIRED");
    const item = owned.get(workspaceId);
    if (!item || item.conversationId !== conversationId || item.kind !== "assignment")
      return deny("TUTORING_OWNED_ASSIGNMENT_REQUIRED");
    current = {
      ...laneCases[completed.length],
      workspaceId,
      conversationId,
      prompt: laneCases[completed.length].prompt,
      savedAssignment: {
        title: item.title,
        content: item.content,
        progress: item.progress,
        nextStep: item.nextStep,
        version: item.version,
      },
      attempted: false,
      persisted: false,
      captureCount: 0,
    };
    captured = "";
  }
  function captureAllowed(tabUrl) {
    if (
      lane !== "companion" ||
      failed ||
      !current ||
      current.attempted ||
      current.captureCount ||
      tabUrl !== `${fixtureOrigin}/`
    )
      return deny("TUTORING_CAPTURE_SCOPE_REQUIRED");
    current.captureCount++;
  }
  function recordCapture(image) {
    if (
      !current ||
      current.captureCount !== 1 ||
      typeof image !== "string" ||
      !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(image) ||
      image.length < 1000 ||
      image.length > 900000
    )
      return deny("TUTORING_CAPTURE_BOUND_EXCEEDED");
    captured = image;
    stats.captures++;
  }
  function authorize(request) {
    const { url: raw, method = "GET", authorization, body, requestId } = request;
    const url = new URL(raw);
    const ai = ["/api/analyze-screenshot", "/api/dashboard-ai", "/api/ask-unimate"].includes(
      url.pathname,
    );
    if (ai) {
      if (
        failed ||
        !current ||
        current.attempted ||
        !access ||
        authorization !== `Bearer ${access}` ||
        url.origin !== app ||
        url.search ||
        url.hash ||
        url.username ||
        url.password ||
        method !== "POST" ||
        stats.requests >= laneCases.length ||
        typeof requestId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(requestId) ||
        requestIds.has(requestId)
      )
        return deny("TUTORING_SINGLE_REQUEST_REQUIRED");
      const path = lane === "companion" ? "/api/analyze-screenshot" : "/api/ask-unimate";
      const allowedKeys =
        lane === "companion"
          ? [
              "imageBase64",
              "question",
              "pageContext",
              "chatHistory",
              "workspaceId",
              "conversationId",
            ]
          : [
              "question",
              "conversationHistory",
              "classContext",
              "mode",
              "canvasContext",
              "selectedCourseId",
              "timezone",
              "workspaceId",
            ];
      if (
        url.pathname !== path ||
        !body ||
        Object.keys(body).some((key) => !allowedKeys.includes(key)) ||
        body.question !== current.prompt ||
        body.workspaceId !== current.workspaceId ||
        body.selectedCourseId ||
        body.canvasContext ||
        body.classContext?.length ||
        (body.mode && body.mode !== "normal")
      )
        return deny("TUTORING_FIXED_INPUT_REQUIRED");
      const chat = lane === "companion" ? body.chatHistory : body.conversationHistory;
      if (
        !Array.isArray(chat) ||
        chat.length > 10 ||
        JSON.stringify(chat).length > 16000 ||
        chat.some(
          (row) =>
            !["user", "assistant"].includes(row.role) ||
            typeof row.content !== "string" ||
            row.content.length > 4000,
        )
      )
        return deny("TUTORING_HISTORY_BOUND_EXCEEDED");
      const known = history.get(current.conversationId) || [];
      if (chat.length !== Math.min(known.length, 10) || !same(chat, known.slice(-10)))
        return deny("TUTORING_HISTORY_MISMATCH");
      if (lane === "companion") {
        const ctx = body.pageContext;
        if (
          body.conversationId !== current.conversationId ||
          body.imageBase64 !== captured ||
          !captured ||
          !ctx ||
          Object.keys(ctx).some(
            (key) =>
              ![
                "selectedText",
                "matchedPageText",
                "visiblePageText",
                "pageTitle",
                "pageUrl",
              ].includes(key),
          ) ||
          ctx.pageUrl !== `${fixtureOrigin}/` ||
          ctx.pageTitle !== "UniMate fictional tutoring check" ||
          typeof ctx.visiblePageText !== "string" ||
          !ctx.visiblePageText.includes(current.pageMarker) ||
          ctx.visiblePageText.length > 3500 ||
          String(ctx.selectedText || "").length > 2000 ||
          String(ctx.matchedPageText || "").length > 2500
        )
          return deny("TUTORING_FIXTURE_CONTEXT_REQUIRED");
      }
      current.attempted = true;
      current.requestId = requestId;
      current.sentHistory = chat;
      current.pageContext = lane === "companion" ? body.pageContext : null;
      current.imageCharacters = captured.length;
      captured = "";
      stats.requests++;
      requestIds.add(requestId);
      return "tutoring-ai";
    }
    if (url.pathname === "/rest/v1/companion_chats" && method === "POST") {
      if (
        !current?.answer ||
        current.persistAttempted ||
        authorization !== `Bearer ${access}` ||
        !Array.isArray(body) ||
        body.length !== 2 ||
        body.some(
          (row) => row.user_id !== record.userId || row.conversation_id !== current.conversationId,
        ) ||
        body[0].role !== "user" ||
        body[0].message !== current.prompt ||
        body[1].role !== "assistant" ||
        body[1].message !== current.answer
      )
        return deny("TUTORING_EXACT_EXCHANGE_REQUIRED");
      // Base policy already pins Supabase for every ordinary request. Pin it here too.
      if (
        url.origin !== "https://gtqfaxsokdlrdxipcyqo.supabase.co" ||
        url.username ||
        url.password ||
        url.hash
      )
        return deny();
      current.persistAttempted = true;
      return "tutoring-exchange";
    }
    if (url.pathname === "/api/study-workspace" && ["POST", "PATCH"].includes(method)) {
      const item = body?.item || body?.patch;
      if (
        !item ||
        String(item.content || "").length > 4000 ||
        String(item.progress || "").length > 500 ||
        String(item.nextStep || "").length > 500 ||
        (item.sourceUrl !== null && item.sourceUrl !== undefined)
      )
        return deny("TUTORING_SMALL_ASSIGNMENT_REQUIRED");
    }
    return base.authorize(request);
  }
  function observe(kind, result, ok = true, status = 200) {
    if (kind === "tutoring-ai") {
      if (
        !ok ||
        !current?.attempted ||
        typeof result?.answer !== "string" ||
        !result.answer.trim() ||
        result.answer.length > (lane === "companion" ? 4000 : 6000)
      )
        return deny("TUTORING_PROVIDER_RESPONSE_FAILED");
      current.answer = result.answer.trim();
      current.status = status;
      current.grounding = result.grounding || null;
      stats.replies++;
      return;
    }
    if (kind === "tutoring-exchange") {
      if (
        !ok ||
        !current ||
        !Array.isArray(result) ||
        result.length !== 2 ||
        result.some(
          (row) => row.user_id !== record.userId || row.conversation_id !== current.conversationId,
        ) ||
        !result.some((row) => row.role === "user" && row.message === current.prompt) ||
        !result.some((row) => row.role === "assistant" && row.message === current.answer)
      )
        return deny("TUTORING_PERSISTENCE_FAILED");
      const old = history.get(current.conversationId) || [];
      history.set(current.conversationId, [
        ...old,
        { role: "user", content: current.prompt },
        { role: "assistant", content: current.answer },
      ]);
      current.persisted = true;
      current.rowIds = result.map((row) => row.id);
      stats.persisted++;
      completed.push({ ...current });
      current = null;
      return;
    }
    base.observe(kind, result, ok);
    if (!ok) return;
    if (kind === "auth") access = result.access_token;
    if (["items", "saved"].includes(kind)) {
      for (const item of kind === "items" ? result.items || [] : [result.item])
        if (tagged(item)) owned.set(item.id, item);
    }
    if (kind === "companion_chats" && Array.isArray(result)) {
      // Website history may resolve before the saved-item query. Keep only rows
      // explicitly owned by the marked account; arm still requires a tagged item.
      for (const conversationId of new Set(
        result.filter((row) => row.user_id === record.userId).map((row) => row.conversation_id),
      )) {
        const rows = result.filter((row) => row.conversation_id === conversationId);
        if (rows.every((row) => row.user_id === record.userId && typeof row.message === "string"))
          history.set(conversationId, normalRows(rows, conversationId));
      }
    }
  }
  return {
    arm,
    captureAllowed,
    recordCapture,
    authorize,
    observe,
    stop(code) {
      failed ||= code;
    },
    snapshot() {
      return {
        plan,
        stats: { ...stats },
        baseStats: { ...base.stats },
        failed,
        pendingCase: current?.id || null,
        pending: current ? { ...current } : null,
        completed,
      };
    },
  };
}

export async function installHostedTutoringWorker({
  record,
  access,
  prefix,
  supabase,
  fixtureOrigin,
  cases,
  plan = "full",
}) {
  const base = globalThis.__createHostedWorkspacePolicy({
    record,
    app: access.origin,
    prefix,
    supabase,
  });
  const policy = globalThis.__createHostedTutoringPolicy({
    base,
    record,
    app: access.origin,
    prefix,
    fixtureOrigin,
    lane: "companion",
    cases,
    plan,
  });
  delete globalThis.__createHostedWorkspacePolicy;
  delete globalThis.__createHostedTutoringPolicy;
  globalThis.__tutoringTestPolicy = policy;
  const originalFetch = globalThis.fetch;
  const originalCapture = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
  chrome.tabs.captureVisibleTab = async (windowId, options) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      policy.captureAllowed(tab?.url);
      const image = await originalCapture(windowId, options);
      policy.recordCapture(image);
      return image;
    } catch {
      policy.stop("TUTORING_CAPTURE_FAILED");
      throw new Error("TUTORING_CAPTURE_FAILED");
    }
  };
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.delete("x-vercel-trusted-oidc-idp-token");
    const body = ["POST", "PATCH", "DELETE"].includes(request.method)
      ? await request.clone().json()
      : undefined;
    const kind = policy.authorize({
      url: request.url,
      method: request.method,
      authorization: headers.get("authorization"),
      requestId: headers.get("x-unimate-request-id"),
      body,
    });
    if (Date.now() >= access.expiresAt - 5000) throw new Error("TUTORING_PREVIEW_ACCESS_EXPIRED");
    if (url.origin === access.origin) headers.set("x-vercel-trusted-oidc-idp-token", access.token);
    let response;
    try {
      response = await originalFetch(new Request(request, { headers, redirect: "manual" }));
    } catch {
      if (kind === "tutoring-ai") policy.stop("TUTORING_NETWORK_FAILURE");
      throw new Error("TUTORING_NETWORK_FAILURE");
    }
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      policy.stop("TUTORING_REDIRECT_BLOCKED");
      throw new Error("TUTORING_REDIRECT_BLOCKED");
    }
    const result = response.headers.get("content-type")?.includes("json")
      ? await response.clone().json()
      : null;
    if (result !== null || kind.startsWith("tutoring-"))
      policy.observe(kind, result, response.ok, response.status);
    return response;
  };
}
