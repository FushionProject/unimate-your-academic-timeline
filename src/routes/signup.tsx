import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { useAuth } from "../lib/auth-context";
import { isSupabaseConfigured } from "../lib/supabase";

export const Route = createFileRoute("/signup")({
  component: SignUp,
});

function SignUp() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error, needsConfirmation } = await signUp(email, password);
    setLoading(false);
    if (error) {
      setError(error);
    } else if (needsConfirmation) {
      setNeedsConfirmation(true);
    } else {
      navigate({ to: "/dashboard" });
    }
  };

  if (needsConfirmation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/90 backdrop-blur-xl p-8 text-center shadow-[var(--shadow-card)]">
          <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-foreground mb-2">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to <span className="text-foreground">{email}</span>. Click it to activate your account, then sign in.
          </p>
          <Link
            to="/signin"
            className="mt-6 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground"
          >
            Go to Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/90 backdrop-blur-xl p-8 shadow-[var(--shadow-card)]">
        <h1 className="text-2xl font-bold text-foreground mb-1">Create an account</h1>
        <p className="text-sm text-muted-foreground mb-6">Get started with UniMate.</p>

        {!isSupabaseConfigured && (
          <div className="mb-4 rounded-lg bg-yellow-100 px-3 py-2 text-xs text-yellow-800">
            Auth isn't configured yet — add your Supabase keys to .env.local.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-lg border border-border bg-secondary/40 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min. 6 characters)"
            className="w-full rounded-lg border border-border bg-secondary/40 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign up
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/signin" className="text-foreground underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
