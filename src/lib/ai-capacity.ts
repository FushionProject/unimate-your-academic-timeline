export type AiFeature = "ask_unimate" | "browser_companion";
export type AiEntitlement = "free" | "pro";
export type AiCompletionStatus = "succeeded" | "provider_error" | "cancelled";

export type CapacityReservation = {
  allowed: boolean;
  code: string;
  requestId: string;
  retryAfterSeconds: number;
  dailyUsed?: number;
  dailyLimit?: number;
  monthlyUsed?: number;
  monthlyLimit?: number;
};

type RpcReservation = {
  allowed?: boolean;
  code?: string;
  retry_after_seconds?: number;
  daily_used?: number;
  daily_limit?: number;
  monthly_used?: number;
  monthly_limit?: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function integerEnv(name: string, fallback: number, minimum = -1): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

function csvSet(value: string | undefined): Set<string> {
  return new Set(
    (value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function aiSystemMode(): "normal" | "degraded" | "off" {
  const value = process.env.AI_SYSTEM_MODE?.trim().toLowerCase();
  return value === "off" || value === "degraded" ? value : "normal";
}

export function aiFeatureEnabled(feature: "web_search" | "screenshot"): boolean {
  if (aiSystemMode() === "off") return false;
  if (aiSystemMode() === "degraded") return false;
  if (feature === "web_search") return process.env.AI_WEB_SEARCH_ENABLED !== "false";
  return process.env.AI_SCREENSHOT_ENABLED !== "false";
}

export function durableQuotasEnabled(): boolean {
  return process.env.AI_DURABLE_QUOTAS_ENABLED === "true";
}

export function quotaOverrideEnabled(userId: string): boolean {
  return csvSet(process.env.AI_QUOTA_OVERRIDE_USER_IDS).has(userId);
}

export function capacityAdminEnabled(userId: string): boolean {
  return csvSet(process.env.AI_USAGE_ADMIN_USER_IDS).has(userId);
}

export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.max(1, Math.ceil(text.length / 4));
}

export function requestIdFor(request: Request): string {
  const supplied = request.headers.get("x-unimate-request-id")?.trim();
  return supplied && UUID_PATTERN.test(supplied) ? supplied : crypto.randomUUID();
}

function limitsFor(
  feature: AiFeature,
  entitlement: AiEntitlement,
): { daily: number; monthly: number } {
  const tier = entitlement === "pro" ? "PRO" : "FREE";
  const surface = feature === "browser_companion" ? "COMPANION" : "ASK";
  const defaultDaily = entitlement === "pro" ? 100 : feature === "browser_companion" ? 0 : 20;
  const defaultMonthly = entitlement === "pro" ? 2_000 : feature === "browser_companion" ? 0 : 300;
  return {
    daily: integerEnv(`AI_${tier}_${surface}_DAILY_LIMIT`, defaultDaily),
    monthly: integerEnv(`AI_${tier}_${surface}_MONTHLY_LIMIT`, defaultMonthly),
  };
}

function serviceConfiguration(): { url: string; key: string } | null {
  const url = process.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

async function serviceRpc<T>(
  name: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const config = serviceConfiguration();
  if (!config) throw new Error("AI_USAGE_CONFIGURATION_MISSING");
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error("AI_USAGE_RPC_UNAVAILABLE");
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function reserveAiCapacity(options: {
  request: Request;
  userId: string;
  feature: AiFeature;
  entitlement: AiEntitlement;
  input: unknown;
  provider?: string;
}): Promise<CapacityReservation> {
  const requestId = requestIdFor(options.request);
  if (aiSystemMode() === "off") {
    return { allowed: false, code: "AI_SYSTEM_UNAVAILABLE", requestId, retryAfterSeconds: 60 };
  }
  if (!durableQuotasEnabled()) {
    return { allowed: true, code: "DURABLE_QUOTAS_DISABLED", requestId, retryAfterSeconds: 0 };
  }
  const limits = limitsFor(options.feature, options.entitlement);
  const override = quotaOverrideEnabled(options.userId);
  const result = await serviceRpc<RpcReservation>(
    "reserve_ai_usage",
    {
      p_user_id: options.userId,
      p_request_id: requestId,
      p_feature: options.feature,
      p_entitlement: options.entitlement,
      p_provider: options.provider || process.env.AI_TEXT_PROVIDER || "groq",
      p_daily_limit: override ? -1 : limits.daily,
      p_monthly_limit: override ? -1 : limits.monthly,
      p_global_daily_limit: integerEnv("AI_GLOBAL_DAILY_REQUEST_LIMIT", 50_000),
      p_estimated_input_tokens: estimateTokens(options.input),
    },
    options.request.signal,
  );
  return {
    allowed: result.allowed === true,
    code: result.code || "AI_CAPACITY_UNAVAILABLE",
    requestId,
    retryAfterSeconds: Math.max(0, result.retry_after_seconds || 0),
    dailyUsed: result.daily_used,
    dailyLimit: result.daily_limit,
    monthlyUsed: result.monthly_used,
    monthlyLimit: result.monthly_limit,
  };
}

export async function completeAiCapacity(options: {
  userId: string;
  requestId: string;
  status: AiCompletionStatus;
  output?: unknown;
  errorKind?: string;
}): Promise<void> {
  if (!durableQuotasEnabled()) return;
  await serviceRpc<void>("complete_ai_usage", {
    p_user_id: options.userId,
    p_request_id: options.requestId,
    p_status: options.status,
    p_estimated_output_tokens: options.output === undefined ? 0 : estimateTokens(options.output),
    p_error_kind: options.errorKind?.slice(0, 40) || null,
  });
}

export async function recordProviderSignal(options: {
  provider?: string;
  success: boolean;
  rateLimited?: boolean;
}): Promise<void> {
  if (!durableQuotasEnabled() || process.env.AI_PROVIDER_CIRCUIT_BREAKER_ENABLED === "false")
    return;
  await serviceRpc<void>("record_ai_provider_signal", {
    p_provider: options.provider || process.env.AI_TEXT_PROVIDER || "groq",
    p_success: options.success,
    p_rate_limited: options.rateLimited === true,
    p_error_threshold: integerEnv("AI_PROVIDER_ERROR_THRESHOLD", 5, 1),
    p_cooldown_seconds: integerEnv("AI_PROVIDER_COOLDOWN_SECONDS", 60, 1),
  });
}

export async function getAiUsageSummary(date: string | null): Promise<unknown> {
  const summary = await serviceRpc<Record<string, unknown>>("get_ai_usage_summary", {
    p_usage_date: date || new Date().toISOString().slice(0, 10),
  });
  const secret = process.env.AI_USAGE_HASH_SECRET;
  const accounts = Array.isArray(summary.top_accounts) ? summary.top_accounts : [];
  summary.top_accounts = await Promise.all(
    accounts.map(async (entry) => {
      const record = entry as Record<string, unknown>;
      const userId = String(record.user_id || "");
      const material = new TextEncoder().encode(userId);
      let account = "redacted";
      if (secret && userId) {
        const key = await crypto.subtle.importKey(
          "raw",
          new TextEncoder().encode(secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );
        const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, material));
        account = Array.from(signature.slice(0, 8), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
      }
      return { account, requests: record.requests };
    }),
  );
  return summary;
}

export function capacityErrorPayload(reservation: CapacityReservation): {
  status: number;
  headers: HeadersInit;
  body: Record<string, unknown>;
} {
  const messages: Record<string, string> = {
    FREE_DAILY_LIMIT_REACHED: "You’ve reached today’s free AI limit. You can continue tomorrow.",
    FREE_MONTHLY_LIMIT_REACHED: "You’ve reached this month’s free AI limit.",
    PRO_FAIR_USE_LIMIT_REACHED:
      "You’ve reached UniMate Pro’s fair-use limit. Please try again later.",
    GLOBAL_CAPACITY_REACHED: "UniMate is at capacity right now. Please try again shortly.",
    PROVIDER_UNAVAILABLE:
      "AI help is temporarily unavailable. Your other UniMate tools still work.",
    AI_SYSTEM_UNAVAILABLE:
      "AI help is temporarily unavailable. Your other UniMate tools still work.",
    DUPLICATE_IN_FLIGHT: "That request is already being answered.",
    DUPLICATE_REQUEST: "That request was already processed. Send it again if you still need help.",
  };
  const status = reservation.code.startsWith("DUPLICATE")
    ? 409
    : reservation.code === "AI_SYSTEM_UNAVAILABLE" || reservation.code === "PROVIDER_UNAVAILABLE"
      ? 503
      : 429;
  return {
    status,
    headers:
      reservation.retryAfterSeconds > 0
        ? { "retry-after": String(reservation.retryAfterSeconds) }
        : {},
    body: {
      error: messages[reservation.code] || "AI help is temporarily unavailable. Please try again.",
      code: reservation.code,
      retryAfterSeconds: reservation.retryAfterSeconds,
    },
  };
}

export function needsWebSearch(question: string): boolean {
  const normalized = question.toLowerCase();
  const explicit = /\b(search|look up|browse|web|online|source|citation|link)\b/.test(normalized);
  const current =
    /\b(today|tonight|latest|current|currently|recent|news|this week|this month|price|weather|schedule|score|election|president|ceo|law|regulation|202[5-9])\b/.test(
      normalized,
    );
  return explicit || current;
}
