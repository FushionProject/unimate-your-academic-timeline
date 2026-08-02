import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth-context";

export const Route = createFileRoute("/reset-password")({
  component: ResetPassword,
});

function friendlyUpdateError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("same password") || lower.includes("different")) {
    return "Choose a password you have not used for this account.";
  }
  if (lower.includes("weak") || lower.includes("password")) {
    return "Use a stronger password with at least 8 characters.";
  }
  if (lower.includes("expired") || lower.includes("invalid")) {
    return "This reset link has expired or was already used. Request a new one below.";
  }
  return message || "We could not update your password. Please request a new reset link.";
}

function ResetPassword() {
  const { loading: authLoading, recoveryMode, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(
      `${window.location.search}&${window.location.hash.slice(1)}`,
    );
    const description = params.get("error_description");
    if (description) setLinkError(description);
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const result = await updatePassword(password);
    setLoading(false);
    if (result.error) {
      setError(friendlyUpdateError(result.error));
      return;
    }
    setComplete(true);
  };

  if (authLoading) {
    return (
      <main
        className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background"
        aria-busy="true"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Verifying your reset link…
        </div>
      </main>
    );
  }

  if (complete) {
    return (
      <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background px-4 py-12 sm:px-6">
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 text-center shadow-[var(--shadow-card)] sm:p-8">
          <CheckCircle2 className="mx-auto mb-4 h-10 w-10 text-green-600" aria-hidden="true" />
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
            Password updated
          </h1>
          <p className="text-sm leading-6 text-muted-foreground" role="status">
            Your new password is ready. Continue to your dashboard when you’re ready.
          </p>
          <button
            type="button"
            onClick={() => navigate({ to: "/dashboard" })}
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Continue to dashboard
          </button>
        </div>
      </main>
    );
  }

  if (!recoveryMode || linkError) {
    return (
      <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background px-4 py-12 sm:px-6">
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 text-center shadow-[var(--shadow-card)] sm:p-8">
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
            This reset link isn’t valid
          </h1>
          <p className="text-sm leading-6 text-muted-foreground" role="alert">
            {linkError
              ? "The link may have expired or already been used. Request a fresh link to continue."
              : "Open the latest password-reset link from your email, or request a new one."}
          </p>
          <Link
            to="/forgot-password"
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Request a new link
          </Link>
          <Link
            to="/signin"
            className="mt-3 inline-flex min-h-11 items-center justify-center px-4 py-2.5 text-sm font-medium text-foreground underline underline-offset-4"
          >
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
          Choose a new password
        </h1>
        <p className="mb-7 text-sm leading-6 text-muted-foreground">
          Use a password that is unique to your UniMate account.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4" aria-busy={loading}>
          <div className="space-y-1.5">
            <label htmlFor="new-password" className="text-sm font-medium text-foreground">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby="new-password-hint"
              className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p id="new-password-hint" className="text-xs text-muted-foreground">
              Use at least 8 characters.
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="confirm-password" className="text-sm font-medium text-foreground">
              Confirm new password
            </label>
            <input
              id="confirm-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "password-update-error" : undefined}
              className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {error && (
            <p
              id="password-update-error"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {loading ? "Updating password…" : "Update password"}
          </button>
        </form>
      </div>
    </main>
  );
}
