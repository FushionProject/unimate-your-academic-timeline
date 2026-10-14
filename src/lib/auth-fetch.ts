import { supabase } from "./supabase";

export class AuthSessionChangedError extends Error {
  readonly code = "AUTH_SESSION_CHANGED";
  readonly retryable = false;

  constructor() {
    super("Your signed-in account changed. Reopen this conversation to continue.");
    this.name = "AuthSessionChangedError";
  }
}

export async function getAuthHeaders(options?: {
  expectedUserId: string;
  signal?: AbortSignal;
}): Promise<Record<string, string>> {
  const expectedUserId = options?.expectedUserId;
  const signal = options?.signal;
  signal?.throwIfAborted();
  if (options && (typeof expectedUserId !== "string" || !expectedUserId.trim() || !supabase))
    throw new AuthSessionChangedError();
  if (!supabase) return {};
  const { data, error } = await supabase.auth.getSession();
  signal?.throwIfAborted();
  // Bind private request content to its originating account, not whichever
  // account happens to finish signing in while getSession is awaiting a lock.
  if (
    options &&
    (error || data.session?.user?.id !== expectedUserId || !data.session?.access_token)
  ) {
    throw new AuthSessionChangedError();
  }
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
