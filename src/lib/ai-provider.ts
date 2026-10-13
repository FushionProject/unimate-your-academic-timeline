/** Server-only provider settings. Never import this module into a browser bundle. */
export const AI_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
export const DEFAULT_AI_MODEL = "gpt-5.4-mini";

export type AiProviderErrorCode =
  | "AI_BILLING_UNAVAILABLE"
  | "AI_CONFIGURATION_ERROR"
  | "AI_RATE_LIMITED"
  | "AI_REQUEST_REJECTED"
  | "AI_PROVIDER_ERROR";

/** Only safe application metadata crosses into an API response or log. */
export class AiProviderError extends Error {
  readonly phase = "ai";
  readonly code: AiProviderErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number;

  constructor(
    code: AiProviderErrorCode,
    status: number,
    message: string,
    retryable: boolean,
    retryAfterSeconds = 0,
  ) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterSeconds = retryable ? retryAfterSeconds : 0;
  }
}

const MAX_ERROR_BYTES = 16_384;
const ERROR_READ_TIMEOUT_MS = 2_000;

async function readProviderErrorMetadata(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_ERROR_BYTES) return null;
        text += decoder.decode(chunk.value, { stream: true });
      }
      return JSON.parse(text + decoder.decode());
    } catch {
      return null;
    } finally {
      void reader.cancel().catch(() => undefined);
    }
  };
  try {
    return await Promise.race([
      read(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          void reader.cancel().catch(() => undefined);
          resolve(null);
        }, ERROR_READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function providerRetryAfter(response: Response): number {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds : (Date.parse(value) - Date.now()) / 1_000;
  return Number.isFinite(delay) ? Math.min(86_400, Math.max(0, Math.ceil(delay))) : 0;
}

/** Billing exhaustion can be HTTP 429 too; classify before ordinary throttling. */
export async function readAiProviderError(response: Response): Promise<AiProviderError> {
  const payload = await readProviderErrorMetadata(response);
  const error = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
  const detail = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const codes = [detail.code, detail.type]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
  const message = typeof detail.message === "string" ? detail.message.slice(0, 2_000) : "";
  const billingCodes = new Set([
    "insufficient_quota",
    "billing_hard_limit_reached",
    "billing_limit_reached",
    "billing_not_active",
    "usage_limit_reached",
    "credit_balance_exhausted",
    "project_spend_limit_exceeded",
    "organization_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
  ]);
  const billingMessage =
    /(?:exceeded (?:your )?(?:current |billing )?quota|(?:run out of|exhausted|insufficient) credits|no (?:credit )?balance left|(?:monthly |billing |spend(?:ing)? )(?:hard )?limit (?:has been )?(?:reached|exceeded))/i.test(
      message,
    );
  if (
    codes.some((code) => billingCodes.has(code)) ||
    (!codes.includes("rate_limit_exceeded") && billingMessage)
  ) {
    return new AiProviderError(
      "AI_BILLING_UNAVAILABLE",
      503,
      "AI help is paused while UniMate resolves its service usage limit. Your saved work is still here. Please check back later.",
      false,
    );
  }
  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 404 ||
    codes.some((code) => ["invalid_api_key", "model_not_found", "permission_denied"].includes(code))
  ) {
    return new AiProviderError(
      "AI_CONFIGURATION_ERROR",
      503,
      "UniMate’s AI connection needs attention. Your account and saved work are unchanged. Please check back later.",
      false,
    );
  }
  if (response.status === 429) {
    const wait = providerRetryAfter(response);
    return new AiProviderError(
      "AI_RATE_LIMITED",
      429,
      wait
        ? `UniMate needs a short breather. Please try again in about ${wait} seconds.`
        : "UniMate is handling a lot right now. Please wait a moment, then try again.",
      true,
      wait,
    );
  }
  if (response.status >= 500 || response.status === 408) {
    return new AiProviderError(
      "AI_PROVIDER_ERROR",
      502,
      "UniMate couldn’t finish that response right now. Your question is still here — please try again in a moment.",
      true,
      providerRetryAfter(response),
    );
  }
  return new AiProviderError(
    "AI_REQUEST_REJECTED",
    502,
    "UniMate couldn’t process that request. Try shortening it or asking in a different way.",
    false,
  );
}

export function aiModel(kind: "text" | "vision", env: Record<string, string | undefined>): string {
  const candidate = env[kind === "text" ? "OPENAI_TEXT_MODEL" : "OPENAI_VISION_MODEL"]?.trim();
  return candidate && candidate.length <= 120 && /^[a-zA-Z0-9._-]+$/.test(candidate)
    ? candidate
    : DEFAULT_AI_MODEL;
}

export function aiCompletionBody(
  kind: "text" | "vision",
  messages: unknown[],
  maxTokens: number,
  env: Record<string, string | undefined>,
) {
  const model = aiModel(kind, env);
  return {
    model,
    messages,
    max_completion_tokens: Math.max(1, Math.min(4000, Math.floor(maxTokens))),
    // Default mini supports no-reasoning mode: predictable latency and no hidden
    // reasoning consuming a small answer budget. Other overrides need an eval.
    ...(model === DEFAULT_AI_MODEL || model.startsWith(`${DEFAULT_AI_MODEL}-`)
      ? { reasoning_effort: "none" }
      : {}),
    store: false,
  };
}

export function productionAiProtectionReady(env: Record<string, string | undefined>): boolean {
  return (
    env.AI_DURABLE_QUOTAS_ENABLED === "true" &&
    env.AI_DURABLE_ENTITLEMENTS_ENABLED === "true" &&
    Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim())
  );
}
