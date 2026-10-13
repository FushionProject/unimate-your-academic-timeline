/** Validate the configured destination. This does not verify Store publication. */
export function getCompanionStoreUrl(value?: string): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" &&
      url.hostname === "chromewebstore.google.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^\/detail\/(?:[^/]+\/)?[a-p]{32}\/?$/.test(url.pathname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function getCompanionAccessState(query: {
  isPending: boolean;
  isError: boolean;
  data?: { isPro: boolean; temporarilyUnavailable?: boolean };
}): "checking" | "unknown" | "free" | "pro" {
  if (query.isPending) return "checking";
  if (query.isError || !query.data || query.data.temporarilyUnavailable) return "unknown";
  return query.data.isPro ? "pro" : "free";
}
