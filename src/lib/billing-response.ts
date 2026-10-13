export async function readBillingActionResponse(response: Pick<Response, "ok" | "json">): Promise<{
  url?: string | null;
  alreadySubscribed?: boolean;
}> {
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Billing is temporarily unavailable. Please try again shortly.");
  }
  const payload = data as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" && payload.error.trim()
        ? payload.error
        : "Billing is temporarily unavailable. Please try again shortly.",
    );
  }
  return {
    url: typeof payload.url === "string" ? payload.url : null,
    alreadySubscribed: payload.alreadySubscribed === true,
  };
}
