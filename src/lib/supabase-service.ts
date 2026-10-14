/** Server-only privileged requests. Never use for student/session requests. */
export function supabaseServiceHeaders(value: string): Record<string, string> {
  const key = value.trim();
  if (!key) throw new Error("Supabase server credential is not configured.");
  // Modern secret keys are opaque, not JWTs. Only legacy service-role JWTs
  // retain the Authorization header used by the existing integration.
  return key.startsWith("sb_secret_")
    ? { apikey: key }
    : { apikey: key, Authorization: `Bearer ${key}` };
}
