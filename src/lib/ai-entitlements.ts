/**
 * Launch entitlement contract. Keep product limits centralized so the web app,
 * Browser Companion, server guards, and database reservation RPC cannot drift.
 */
export const AI_ENTITLEMENTS = Object.freeze({
  free: Object.freeze({ syllabusLifetime: 2, textMonthly: 0, screenshotMonthly: 0 }),
  pro: Object.freeze({
    syllabusMonthly: 30,
    textMonthly: 750,
    screenshotDaily: 25,
    screenshotMonthly: 300,
  }),
});

export type AiPlan = "free" | "pro";
export type AiFeature = "syllabus" | "text" | "screenshot";
export type QuotaPeriod = "lifetime" | "month";
export type AiEntitlement = Readonly<{
  allowed: boolean;
  limit: number;
  period: QuotaPeriod;
  code?: "PRO_REQUIRED";
}>;

export function entitlementFor(plan: AiPlan, feature: AiFeature): AiEntitlement {
  if (plan === "free") {
    if (feature === "syllabus") {
      return { allowed: true, limit: AI_ENTITLEMENTS.free.syllabusLifetime, period: "lifetime" };
    }
    return { allowed: false, limit: 0, period: "month", code: "PRO_REQUIRED" };
  }
  const limit =
    feature === "syllabus"
      ? AI_ENTITLEMENTS.pro.syllabusMonthly
      : feature === "screenshot"
        ? AI_ENTITLEMENTS.pro.screenshotMonthly
        : AI_ENTITLEMENTS.pro.textMonthly;
  return { allowed: true, limit, period: "month" };
}

export function planFromProfile(profile: { is_pro?: boolean } | null | undefined): AiPlan {
  return profile?.is_pro === true ? "pro" : "free";
}

export type EntitlementReservation = {
  allowed: boolean;
  used: number;
  limit: number;
  period: string;
  code?: "PRO_REQUIRED" | "QUOTA_EXCEEDED" | "DUPLICATE_REQUEST" | "ENTITLEMENT_UNAVAILABLE";
};

export function durableEntitlementsEnabled(): boolean {
  return process.env.AI_DURABLE_ENTITLEMENTS_ENABLED === "true";
}

/**
 * Reserves the product-level allowance before an AI provider is called. This
 * uses a server-only credential and is intentionally separate from browser
 * state, so refreshing or reinstalling cannot reset usage.
 */
export async function reserveEntitlementUsage(options: {
  userId: string;
  feature: AiFeature;
  requestId: string;
  signal?: AbortSignal;
}): Promise<EntitlementReservation> {
  if (!durableEntitlementsEnabled()) {
    return { allowed: true, used: 0, limit: -1, period: "disabled" };
  }
  const url = process.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { allowed: false, used: 0, limit: 0, period: "none", code: "ENTITLEMENT_UNAVAILABLE" };
  }
  const response = await fetch(`${url}/rest/v1/rpc/reserve_ai_entitlement_usage`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requested_user_id: options.userId,
      requested_feature: options.feature,
      requested_request_id: options.requestId,
    }),
    signal: options.signal,
  });
  if (!response.ok) {
    return { allowed: false, used: 0, limit: 0, period: "none", code: "ENTITLEMENT_UNAVAILABLE" };
  }
  const payload = await response.json();
  const row = Array.isArray(payload) ? payload[0] : payload;
  return {
    allowed: row?.allowed === true,
    used: Number(row?.used || 0),
    limit: Number(row?.quota_limit || 0),
    period: String(row?.period_key || "none"),
    code: row?.denial_code || undefined,
  };
}
