import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../lib/auth-context";
import { isSupabaseConfigured } from "../lib/supabase";

export const Route = createFileRoute("/signup")({
  component: SignUp,
});

function friendlyAuthError(message: string, code?: string) {
  const lower = message.toLowerCase();
  if (code === "weak_password" || lower.includes("weak") || lower.includes("password")) {
    return "Use a stronger password with at least 6 characters.";
  }
  if (code === "user_already_exists" || lower.includes("already") || lower.includes("registered")) {
    return "An account already exists for this email. Try signing in instead.";
  }
  if (code === "over_request_rate_limit" || lower.includes("rate") || lower.includes("too many")) {
    return "Too many signup attempts. Wait a moment, then try again.";
  }
  if (code === "signup_disabled") return "New account creation is temporarily unavailable.";
  if (code === "network_error") {
    return "We couldn't reach UniMate. Check your connection and try again.";
  }
  return message || "We could not create your account. Please try again.";
}

function SignUp() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { error, errorCode, needsConfirmation } = await signUp(email.trim(), password);
      if (error) {
        setError(friendlyAuthError(error, errorCode));
      } else if (needsConfirmation) {
        setNeedsConfirmation(true);
      } else {
        await navigate({ to: "/dashboard" });
      }
    } catch {
      setError("We couldn't create your account. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  if (needsConfirmation) {
    return (
      <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background px-4 py-12 sm:px-6">
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 text-center shadow-[var(--shadow-card)] sm:p-8">
          <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-foreground mb-2">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to <span className="text-foreground">{email}</span>. Click
            it to activate your account, then come back here to sign in. If it does not show up,
            check your spam folder.
          </p>
          <Link
            to="/signin"
            className="mt-6 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground"
          >
            Continue to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
          Create your account
        </h1>
        <p className="mb-7 text-sm leading-6 text-muted-foreground">
          Bring your classes, deadlines, notes, and study help together.
        </p>

        {!isSupabaseConfigured && (
          <div className="mb-4 rounded-lg bg-yellow-100 px-3 py-2 text-xs text-yellow-800">
            Auth isn't configured yet — add your Supabase keys to .env.local.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" aria-busy={loading}>
          <div className="space-y-1.5">
            <label htmlFor="signup-email" className="text-sm font-medium text-foreground">
              Email
            </label>
            <input
              id="signup-email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "signup-error" : undefined}
              className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="signup-password" className="text-sm font-medium text-foreground">
              Password
            </label>
            <div className="relative">
              <input
                id="signup-password"
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                autoComplete="new-password"
                aria-invalid={Boolean(error)}
                aria-describedby={
                  error ? "signup-error signup-password-hint" : "signup-password-hint"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
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
            <p id="signup-password-hint" className="text-xs text-muted-foreground">
              Use at least 6 characters.
            </p>
          </div>
          {error && (
            <p
              id="signup-error"
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
            {loading ? "Creating account..." : "Sign up"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/signin" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
