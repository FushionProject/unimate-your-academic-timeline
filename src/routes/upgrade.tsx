import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth-context";
import { useIsPro } from "../lib/profile";

export const Route = createFileRoute("/upgrade")({
  component: Upgrade,
});

function Upgrade() {
  const { user, session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const success = params.get("success") === "true";
  const canceled = params.get("canceled") === "true";

  const { data: isPro, isLoading } = useIsPro({ refetchInterval: success ? 2000 : false });

  const handleUpgrade = async () => {
    if (!session) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start checkout");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/90 backdrop-blur-xl p-8 shadow-[var(--shadow-card)] text-center">
        <div
          className="h-14 w-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ background: "var(--gradient-primary)" }}
        >
          <Sparkles className="h-7 w-7 text-[#1a1a1a]" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-1">UniMate Pro</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Unlock the screen-capture homework helper and more.
        </p>

        {!user ? (
          <>
            <p className="text-sm text-muted-foreground mb-4">Sign in to upgrade.</p>
            <Link
              to="/signin"
              className="inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground"
            >
              Sign in
            </Link>
          </>
        ) : isLoading ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
        ) : isPro ? (
          <div className="flex items-center justify-center gap-2 text-green-600 font-medium text-sm">
            <CheckCircle2 className="h-5 w-5" />
            You're already on UniMate Pro.
          </div>
        ) : (
          <>
            {success && (
              <p className="mb-4 text-sm text-green-600">
                Payment received — activating your account...
              </p>
            )}
            {canceled && <p className="mb-4 text-sm text-muted-foreground">Checkout canceled.</p>}
            <ul className="text-sm text-left text-muted-foreground mb-6 space-y-2">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                Screen-capture homework helper (browser extension)
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                Unlimited AI questions
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                Priority study plan generation
              </li>
            </ul>
            <button
              onClick={handleUpgrade}
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold bg-primary text-primary-foreground disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Upgrade to Pro
            </button>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
