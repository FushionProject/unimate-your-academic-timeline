import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth-context";
import { isSupabaseConfigured } from "../lib/supabase";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPassword,
});

function friendlyResetError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("rate") || lower.includes("too many")) {
    return "Too many reset requests. Wait a few minutes, then try again.";
  }
  if (lower.includes("fetch") || lower.includes("network")) {
    return "We could not reach the sign-in service. Check your connection and try again.";
  }
  return message || "We could not send the reset email. Please try again.";
}

function ForgotPassword() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    const normalizedEmail = email.trim();
    const result = await requestPasswordReset(normalizedEmail);
    setLoading(false);
    if (result.error) {
      setError(friendlyResetError(result.error));
      return;
    }
    setSubmittedEmail(normalizedEmail);
  };

  if (submittedEmail) {
    return (
      <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background px-4 py-12 sm:px-6">
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 text-center shadow-[var(--shadow-card)] sm:p-8">
          <CheckCircle2 className="mx-auto mb-4 h-10 w-10 text-green-600" aria-hidden="true" />
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
            Check your email
          </h1>
          <p className="text-sm leading-6 text-muted-foreground" role="status">
            If an account exists for{" "}
            <span className="font-medium text-foreground">{submittedEmail}</span>, you’ll receive a
            secure password-reset link. Check your spam folder if it does not arrive in a few
            minutes.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Link
              to="/signin"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Back to sign in
            </Link>
            <button
              type="button"
              onClick={() => setSubmittedEmail("")}
              className="min-h-11 rounded-lg px-4 py-2.5 text-sm font-medium text-foreground underline underline-offset-4"
            >
              Try another email
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
          Reset your password
        </h1>
        <p className="mb-7 text-sm leading-6 text-muted-foreground">
          Enter your account email and we’ll send you a secure reset link.
        </p>

        {!isSupabaseConfigured && (
          <div
            className="mb-4 rounded-lg bg-yellow-100 px-3 py-2 text-xs text-yellow-800"
            role="alert"
          >
            Auth isn't configured yet — add your Supabase keys to .env.local.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" aria-busy={loading}>
          <div className="space-y-1.5">
            <label htmlFor="reset-email" className="text-sm font-medium text-foreground">
              Email
            </label>
            <input
              id="reset-email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.edu"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "reset-request-error" : undefined}
              className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {error && (
            <p
              id="reset-request-error"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading || !isSupabaseConfigured}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {loading ? "Sending reset link…" : "Send reset link"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Remembered it?{" "}
          <Link to="/signin" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
