export type OperationalEnvironment = Record<string, string | undefined>;

type ReadinessCheck = {
  status: "ready" | "not_configured";
  requiredFor: "core" | "ai" | "search" | "billing" | "operations";
};

export type OperationalReadiness = {
  status: "configuration_ready" | "configuration_required";
  generatedAt: string;
  checks: Record<string, ReadinessCheck>;
  billingMode: "test" | "live" | "unknown" | "disabled";
};

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function configured(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function check(
  value: string | undefined,
  requiredFor: ReadinessCheck["requiredFor"],
): ReadinessCheck {
  return { status: configured(value) ? "ready" : "not_configured", requiredFor };
}

function stripeMode(secret: string | undefined): OperationalReadiness["billingMode"] {
  if (!configured(secret)) return "disabled";
  if (secret!.startsWith("sk_test_") || secret!.startsWith("rk_test_")) return "test";
  if (secret!.startsWith("sk_live_") || secret!.startsWith("rk_live_")) return "live";
  return "unknown";
}

/**
 * Builds a privacy-safe configuration report. It intentionally returns only
 * categorical states: never environment values, key fragments, project URLs,
 * account identifiers, quotas, or customer data.
 */
export function buildOperationalReadiness(
  env: OperationalEnvironment,
  now = new Date(),
): OperationalReadiness {
  const checks: OperationalReadiness["checks"] = {
    supabaseUrl: check(env.VITE_SUPABASE_URL, "core"),
    supabasePublishableKey: check(env.VITE_SUPABASE_ANON_KEY, "core"),
    aiProvider: check(env.GROQ_API_KEY, "ai"),
    searchProvider: check(env.SERPAPI_KEY, "search"),
    operatorReadinessKey: check(env.OPERATIONS_READINESS_KEY, "operations"),
    stripeApiKey: check(env.STRIPE_SECRET_KEY, "billing"),
    stripePrice: check(env.STRIPE_PRICE_ID, "billing"),
    stripeWebhookSigningSecret: check(env.STRIPE_WEBHOOK_SECRET, "billing"),
    entitlementWriter: check(env.SUPABASE_SERVICE_ROLE_KEY, "billing"),
    durableCapacity: {
      status: enabled(env.AI_DURABLE_QUOTAS_ENABLED) ? "ready" : "disabled",
      requiredFor: "ai",
    },
    durableEntitlements: {
      status: enabled(env.AI_DURABLE_ENTITLEMENTS_ENABLED) ? "ready" : "disabled",
      requiredFor: "ai",
    },
  };
  const coreReady =
    checks.supabaseUrl.status === "ready" && checks.supabasePublishableKey.status === "ready";
  const aiReady =
    checks.aiProvider.status === "ready" &&
    checks.entitlementWriter.status === "ready" &&
    checks.durableCapacity.status === "ready" &&
    checks.durableEntitlements.status === "ready";
  return {
    // This is deliberately configuration readiness, not a claim that capacity,
    // backups, alerting, or billing lifecycle tests have passed.
    status: coreReady && aiReady ? "configuration_ready" : "configuration_required",
    generatedAt: now.toISOString(),
    checks,
    billingMode: stripeMode(env.STRIPE_SECRET_KEY),
  };
}

export function readinessKeyMatches(
  provided: string | null,
  expected: string | undefined,
): boolean {
  if (!provided || !expected || expected.length < 32 || provided.length !== expected.length)
    return false;
  let mismatch = 0;
  for (let index = 0; index < provided.length; index += 1) {
    mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}
