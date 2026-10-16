import type { AuthDestination } from "./auth-destination";

export interface ConfirmationLinkError {
  kind: "expired" | "invalid";
  destination: AuthDestination;
}

const AUTH_CALLBACK_KEYS = [
  "error",
  "error_code",
  "error_description",
  "access_token",
  "refresh_token",
  "token",
  "token_hash",
  "code",
  "id_token",
  "provider_token",
  "provider_refresh_token",
  "expires_at",
  "expires_in",
  "token_type",
  "type",
];

// Read only known email-return routes. The URL is untrusted: retain an enum,
// never the provider's message, account details, tokens, or arbitrary redirect.
export function readConfirmationCallback(href: string): {
  error: ConfirmationLinkError;
  cleanUrl: string;
} | null {
  const url = new URL(href);
  if (!["/dashboard", "/upgrade", "/signin"].includes(url.pathname)) return null;
  const fragment = new URLSearchParams(url.hash.slice(1));
  const errors = [url.searchParams, fragment];
  if (
    !errors.some((params) =>
      ["error", "error_code", "error_description"].some((key) => params.has(key)),
    )
  ) {
    return null;
  }
  const expired = errors.some((params) => params.get("error_code") === "otp_expired");
  const destination =
    url.pathname === "/upgrade" ||
    (url.pathname === "/signin" && url.searchParams.get("next") === "upgrade")
      ? "upgrade"
      : "dashboard";
  for (const key of AUTH_CALLBACK_KEYS) {
    url.searchParams.delete(key);
    fragment.delete(key);
  }
  url.hash = fragment.toString();
  return {
    error: { kind: expired ? "expired" : "invalid", destination },
    cleanUrl: `${url.pathname}${url.search}${url.hash}`,
  };
}

export function confirmationResendError(code?: string): string {
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") {
    return "Please wait a few minutes before requesting another confirmation email.";
  }
  return "We couldn't send a confirmation link right now. Please try again later or contact support.";
}
