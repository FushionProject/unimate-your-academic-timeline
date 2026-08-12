import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "../lib/auth-context";
import { NEW_ACCOUNT_SETUP_KEY } from "../lib/auth-context";
import { isSupabaseConfigured } from "../lib/supabase";

export const Route = createFileRoute("/signin")({
  component: SignIn,
});

function friendlyAuthError(message: string, code?: string): string {
  const lower = message.toLowerCase();
  if (
    code === "invalid_credentials" ||
    lower.includes("invalid login") ||
    lower.includes("invalid credentials")
  ) {
    return "That email or password did not match. Check both and try again.";
  }
  if (code === "email_not_confirmed" || lower.includes("email not confirmed")) {
    return "Check your email confirmation link before signing in.";
  }
  if (code === "network_error") {
    return "We couldn't reach UniMate. Check your connection and try again.";
  }
  return message;
}

function SignIn() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEmailConfirmed(params.get("confirmed") === "1");
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { error, errorCode } = await signIn(email.trim(), password);
      if (error) {
        setError(friendlyAuthError(error, errorCode));
      } else {
        const needsSetup = localStorage.getItem(NEW_ACCOUNT_SETUP_KEY) === "pending";
        if (needsSetup) localStorage.removeItem(NEW_ACCOUNT_SETUP_KEY);
        await navigate(
          needsSetup ? { to: "/companion-setup", search: { welcome: "1" } } : { to: "/dashboard" },
        );
      }
    } catch {
      setError("We couldn't sign you in. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">Welcome back</h1>
        <p className="mb-7 text-sm leading-6 text-muted-foreground">
          Sign in to pick up where you left off.
        </p>

        {!isSupabaseConfigured && (
          <div className="mb-4 rounded-lg bg-yellow-100 px-3 py-2 text-xs text-yellow-800">
            Auth isn't configured yet — add your Supabase keys to .env.local.
          </div>
        )}

        {emailConfirmed && (
          <div
            className="mb-4 flex items-start gap-2 rounded-lg bg-green-100 px-3 py-2 text-sm text-green-800"
            role="status"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Email confirmed. Sign in to continue.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" aria-busy={loading}>
          <div className="space-y-1.5">
            <label htmlFor="signin-email" className="text-sm font-medium text-foreground">
              Email
            </label>
            <input
              id="signin-email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "signin-error" : undefined}
              className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="signin-password" className="text-sm font-medium text-foreground">
                Password
              </label>
              <Link
                to="/forgot-password"
                className="text-sm font-medium text-foreground underline underline-offset-4"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                id="signin-password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "signin-error" : undefined}
                className="w-full rounded-lg border border-border bg-background py-3 pl-4 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                title={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          {error && (
            <p
              id="signin-error"
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
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link to="/signup" className="font-medium text-foreground underline underline-offset-4">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
