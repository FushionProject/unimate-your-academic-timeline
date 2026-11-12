// Reject an accidentally pasted server key before copying config into a browser profile.
export function assertHostedWorkspacePublicKey(key) {
  if (typeof key !== "string") throw new Error("PUBLIC_KEY_REQUIRED");
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return;
  try {
    const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    if (claims.role === "anon" && claims.ref === "gtqfaxsokdlrdxipcyqo") return;
  } catch {
    /* A key with no public project claims is not eligible. */
  }
  throw new Error("PUBLIC_KEY_REQUIRED");
}

// Operator-only persistence test policy. Serialized into a fresh extension worker.
// No service-role credentials, Stripe calls, AI requests, or existing-row deletion.
export function createHostedWorkspacePolicy({ record, app, prefix, supabase }) {
  if (
    supabase !== "https://gtqfaxsokdlrdxipcyqo.supabase.co" ||
    !/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(app) ||
    !/^\[Workspace test [0-9a-f-]{36}\]$/.test(prefix)
  )
    throw new Error("TEST_SCOPE_REQUIRED");
  let access = "",
    refresh = "";
  const itemIds = new Set();
  const chats = new Set();
  const pendingChats = new Set();
  let emptyChatListObserved = false;
  let bootstrapCreated = false;
  const stats = { blocked: 0, ai: 0, stripe: 0, auth: 0, reads: 0, saves: 0 };
  const identity = (user) =>
    user?.id === record.userId &&
    user.email === record.email &&
    user.app_metadata?.unimate_test_marker === record.marker &&
    user.app_metadata?.unimate_test_nonce === record.nonce;
  const deny = () => {
    stats.blocked++;
    throw new Error("WORKSPACE_TEST_REQUEST_BLOCKED");
  };
  const tagged = (title) => typeof title === "string" && title.startsWith(prefix);
  function authorize({ url: raw, method = "GET", authorization, body }) {
    const url = new URL(raw);
    if (url.username || url.password || url.hash) return deny();
    if (/dashboard-ai|analyze-screenshot|ask-unimate/.test(url.pathname)) {
      stats.ai++;
      return deny();
    }
    if (/stripe\.com$/.test(url.hostname) || /checkout|portal|webhook/.test(url.pathname)) {
      stats.stripe++;
      return deny();
    }
    if (url.origin === app && !url.pathname.startsWith("/api/") && method === "GET") return "asset";
    if (
      url.origin === app &&
      ["/api/health", "/api/signup-status"].includes(url.pathname) &&
      method === "GET"
    )
      return "public";
    if (url.origin === supabase && url.pathname === "/auth/v1/token" && method === "POST") {
      const grant = url.searchParams.get("grant_type");
      if (
        grant === "password" &&
        stats.auth === 0 &&
        body?.email === record.email &&
        body?.password === record.password
      ) {
        stats.auth++;
        return "auth";
      }
      if (grant === "refresh_token" && refresh && body?.refresh_token === refresh) return "auth";
      return deny();
    }
    if (!access || authorization !== `Bearer ${access}`) return deny();
    if (url.origin === supabase && url.pathname === "/auth/v1/user" && method === "GET")
      return "user";
    if (
      url.origin === app &&
      url.pathname === "/api/billing-status" &&
      method === "GET" &&
      url.search === "?reconcile=false"
    )
      return "billing";
    if (url.origin === app && url.pathname === "/api/study-workspace") {
      if (method === "GET") {
        stats.reads++;
        return "items";
      }
      if (
        method === "POST" &&
        tagged(body?.item?.title) &&
        !body.item.courseId &&
        (!body.item.conversationId || chats.has(body.item.conversationId))
      ) {
        stats.saves++;
        return "saved";
      }
      if (
        method === "PATCH" &&
        itemIds.has(body?.id) &&
        tagged(body?.patch?.title) &&
        Number.isInteger(body.expectedVersion) &&
        !body.patch.courseId &&
        (!body.patch.conversationId || chats.has(body.patch.conversationId))
      ) {
        stats.saves++;
        return "saved";
      }
      return deny();
    }
    if (url.origin === supabase && url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      if (
        method === "GET" &&
        [
          "profiles",
          "courses",
          "assignments",
          "semester_settings",
          "semesters",
          "companion_preferences",
          "companion_conversations",
          "companion_chats",
          "notes",
        ].includes(table)
      )
        return table;
      if (
        method === "POST" &&
        table === "companion_conversations" &&
        body?.user_id === record.userId &&
        (tagged(body.title) ||
          ["Assignment help", "New assignment"].includes(body.title) ||
          (body.title === "My first chat" && emptyChatListObserved && !bootstrapCreated))
      ) {
        if (body.title === "My first chat") bootstrapCreated = true;
        if (body.id) pendingChats.add(body.id);
        return "new-chat";
      }
      if (
        method === "POST" &&
        table === "companion_preferences" &&
        body?.user_id === record.userId &&
        chats.has(body.active_conversation_id)
      )
        return "preference";
    }
    return deny();
  }
  function observe(kind, result, ok = true) {
    if (!ok) return;
    if (kind === "auth" || kind === "user") {
      if (!identity(result?.user || result)) return deny();
      if (kind === "auth") {
        access = result.access_token;
        refresh = result.refresh_token;
      }
    }
    // Companion requests return=minimal, then verifies the exact new owned ID.
    if (kind === "companion_conversations") {
      if (Array.isArray(result) && result.length === 0) emptyChatListObserved = true;
      for (const row of Array.isArray(result) ? result : [result]) {
        if (pendingChats.has(row?.id)) {
          if (row.user_id && row.user_id !== record.userId) return deny();
          chats.add(row.id);
        }
      }
    }
    if (kind === "new-chat") {
      for (const row of Array.isArray(result) ? result : [result]) {
        if (row?.user_id !== record.userId) return deny();
        chats.add(row.id);
      }
    }
    if (["items", "saved"].includes(kind)) {
      for (const row of kind === "items" ? result.items || [] : [result.item]) {
        if (row?.userId !== record.userId) return deny();
        if (tagged(row.title)) {
          itemIds.add(row.id);
          if (row.conversationId) chats.add(row.conversationId);
        }
      }
    }
  }
  return { authorize, observe, stats };
}

export async function installHostedWorkspaceWorker({ record, access, prefix, supabase }) {
  const policy = globalThis.__createHostedWorkspacePolicy({
    record,
    app: access.origin,
    prefix,
    supabase,
  });
  delete globalThis.__createHostedWorkspacePolicy;
  const originalFetch = globalThis.fetch;
  const header = "x-vercel-trusted-oidc-idp-token";
  globalThis.__workspaceTestStats = policy.stats;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.delete(header);
    const body = ["POST", "PATCH", "DELETE"].includes(request.method)
      ? await request.clone().json()
      : undefined;
    const kind = policy.authorize({
      url: request.url,
      method: request.method,
      authorization: headers.get("authorization"),
      body,
    });
    if (Date.now() >= access.expiresAt - 5000) throw new Error("PREVIEW_ACCESS_EXPIRED");
    if (url.origin === access.origin) headers.set(header, access.token);
    const response = await originalFetch(new Request(request, { headers, redirect: "manual" }));
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400))
      throw new Error("PREVIEW_REDIRECT_BLOCKED");
    if (response.ok && response.headers.get("content-type")?.includes("json"))
      policy.observe(kind, await response.clone().json());
    return response;
  };
  chrome.tabs.captureVisibleTab = async () => {
    policy.stats.ai++;
    throw new Error("TEST_CAPTURE_BLOCKED");
  };
}
