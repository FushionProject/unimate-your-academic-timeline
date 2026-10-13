/** Server-only provider settings. Never import this module into a browser bundle. */
export const AI_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
export const DEFAULT_AI_MODEL = "gpt-5.4-mini";

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
