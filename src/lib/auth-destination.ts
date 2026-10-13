export type AuthDestination = "dashboard" | "upgrade";

// Only a named, local destination can survive the authentication handoff.
// Never use an arbitrary URL supplied through the query string.
export function validateAuthIntentSearch(search: Record<string, unknown>): { next?: "upgrade" } {
  return search.next === "upgrade" ? { next: "upgrade" } : {};
}

export function authDestinationPath(destination?: unknown): "/dashboard" | "/upgrade" {
  return destination === "upgrade" ? "/upgrade" : "/dashboard";
}
