import { Link } from "@tanstack/react-router";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "../lib/auth-context";

export function ConfirmationLinkBoundary({ children }: { children: ReactNode }) {
  const { confirmationLinkError, dismissConfirmationLinkError, resendConfirmation } = useAuth();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmationLinkError || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError("");
    try {
      const result = await resendConfirmation(email.trim(), confirmationLinkError.destination);
      if (result.error) setError(result.error);
      else setSent(true);
    } catch {
      setError("We couldn't reach UniMate. Check your connection and try again.");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  if (!confirmationLinkError) return <>{children}</>;
  const search =
    confirmationLinkError.destination === "upgrade" ? { next: "upgrade" as const } : {};
  return (
    <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
        <h1 className="mb-3 text-2xl font-semibold tracking-tight text-foreground">
          This confirmation link isn’t valid
        </h1>
        <p className="mb-5 text-sm leading-6 text-muted-foreground" role="alert">
          {confirmationLinkError.kind === "expired"
            ? "The link has expired or was already used. If you already confirmed your email, sign in below. Otherwise, request a fresh link."
            : "We couldn't confirm your email with this link. Try the latest email or request a fresh link below."}
        </p>
        {sent ? (
          <p className="rounded-lg bg-primary/10 p-4 text-sm text-foreground" role="status">
            If this email belongs to an account waiting for confirmation, a new link will arrive
            shortly. Check your spam folder too.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3" aria-busy={sending}>
            <label
              htmlFor="confirmation-email"
              className="block text-sm font-medium text-foreground"
            >
              Account email
            </label>
            <input
              id="confirmation-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "confirmation-error" : undefined}
              className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {error && (
              <p id="confirmation-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={sending}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {sending ? "Requesting link…" : "Request a new confirmation link"}
            </button>
          </form>
        )}
        <Link
          to="/signin"
          search={search}
          onClick={dismissConfirmationLinkError}
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground"
        >
          Sign in to your account
        </Link>
        <Link
          to="/support"
          onClick={dismissConfirmationLinkError}
          className="mt-2 inline-flex min-h-11 w-full items-center justify-center text-sm text-muted-foreground underline underline-offset-4"
        >
          Contact support
        </Link>
      </div>
    </main>
  );
}
