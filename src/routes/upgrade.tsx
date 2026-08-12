import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth-context";
import { useBillingStatus } from "../lib/profile";

export const Route = createFileRoute("/upgrade")({ component: Upgrade });

function secureStripeUrl(value: unknown, host: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === host ? value : null;
  } catch {
    return null;
  }
}

function Upgrade() {
  const { user, session } = useAuth();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState("");

  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const success = params.get("success") === "true";
  const canceled = params.get("canceled") === "true";
  const [confirming, setConfirming] = useState(success);
  const billing = useBillingStatus({ refetchInterval: confirming ? 2000 : false });
  const status = billing.data;

  useEffect(() => {
    if (!confirming) return;
    if (status?.isPro) {
      setConfirming(false);
      return;
    }
    const timeout = window.setTimeout(() => setConfirming(false), 30_000);
    return () => window.clearTimeout(timeout);
  }, [confirming, status?.isPro]);

  const authenticatedRequest = async (path: string) => {
    if (!session) throw new Error("Sign in to manage UniMate Pro.");
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    const data = (await response.json()) as {
      error?: string;
      url?: string | null;
      alreadySubscribed?: boolean;
    };
    if (!response.ok) throw new Error(data.error || "Billing is temporarily unavailable.");
    return data;
  };

  const handleUpgrade = async () => {
    setError("");
    setCheckoutLoading(true);
    try {
      const data = await authenticatedRequest("/api/create-checkout-session");
      if (data.alreadySubscribed && !data.url) {
        await billing.refetch();
        throw new Error(
          "This account already has a subscription. Refresh or manage billing below.",
        );
      }
      const url = secureStripeUrl(
        data.url,
        data.alreadySubscribed ? "billing.stripe.com" : "checkout.stripe.com",
      );
      if (!url) throw new Error("Stripe did not return a valid secure link.");
      window.location.assign(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Checkout could not start.");
      setCheckoutLoading(false);
    }
  };

  const handleManageBilling = async () => {
    setError("");
    setPortalLoading(true);
    try {
      const data = await authenticatedRequest("/api/create-portal-session");
      const url = secureStripeUrl(data.url, "billing.stripe.com");
      if (!url) throw new Error("Stripe did not return a valid billing-management link.");
      window.location.assign(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Billing management could not open.");
      setPortalLoading(false);
    }
  };

  const renewalDate = status?.currentPeriodEnd
    ? new Date(status.currentPeriodEnd * 1000).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/90 p-7 text-center shadow-[var(--shadow-card)] sm:p-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
          <Sparkles className="h-7 w-7 text-[#1a1a1a]" />
        </div>
        <h1 className="mb-1 text-2xl font-bold text-foreground">UniMate Pro</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Keep UniMate beside your coursework for $5.99 per month.
        </p>

        {!user ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground">Sign in before upgrading.</p>
            <Link
              to="/signin"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
            >
              Sign in
            </Link>
          </>
        ) : billing.isLoading ? (
          <div className="py-8" role="status">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
            <p className="mt-3 text-sm text-muted-foreground">Checking your Pro access…</p>
          </div>
        ) : (
          <>
            {success && confirming && !status?.isPro && (
              <div
                className="mb-5 rounded-xl bg-primary/10 px-4 py-3 text-left"
                role="status"
                aria-live="polite"
              >
                <p className="text-sm font-medium text-foreground">Checkout complete.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Stripe is confirming your Pro access. This usually takes a few seconds.
                </p>
              </div>
            )}
            {success && !confirming && !status?.isPro && (
              <div className="mb-5 rounded-xl bg-secondary px-4 py-3 text-left" role="status">
                <p className="text-sm font-medium text-foreground">
                  Confirmation is taking longer than expected.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Refresh this page shortly. You will not be charged again by refreshing.
                </p>
              </div>
            )}
            {canceled && (
              <p
                className="mb-5 rounded-xl bg-secondary px-4 py-3 text-sm text-muted-foreground"
                role="status"
              >
                Checkout canceled. Your account was not changed.
              </p>
            )}

            {status?.state === "past_due" && (
              <BillingWarning>
                Your latest payment failed. Pro remains available during the recovery period; update
                your payment method to avoid interruption.
              </BillingWarning>
            )}
            {status?.state === "canceling" && (
              <BillingWarning>
                Your subscription is set to end
                {renewalDate ? ` on ${renewalDate}` : " at the end of this billing period"}. Pro
                stays active until then.
              </BillingWarning>
            )}
            {status?.temporarilyUnavailable && (
              <BillingWarning>
                Stripe could not be reached, so UniMate is showing your last verified access state.
              </BillingWarning>
            )}

            {status?.isPro ? (
              <div>
                <div className="flex items-center justify-center gap-2 text-sm font-medium text-green-700">
                  <CheckCircle2 className="h-5 w-5" />
                  {status.state === "development_override"
                    ? "Development Pro access"
                    : "UniMate Pro is active"}
                </div>
                {renewalDate && status.state !== "canceling" && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Current billing period ends {renewalDate}.
                  </p>
                )}
                {status.canManage && (
                  <button
                    type="button"
                    onClick={handleManageBilling}
                    disabled={portalLoading}
                    className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground hover:border-primary/50 disabled:opacity-50"
                  >
                    {portalLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ExternalLink className="h-4 w-4" />
                    )}
                    Manage billing
                  </button>
                )}
              </div>
            ) : (
              <>
                {(["canceled", "unpaid", "paused", "incomplete"] as const).includes(
                  status?.state as "canceled" | "unpaid" | "paused" | "incomplete",
                ) && (
                  <BillingWarning>
                    Your previous subscription is not active. You can restart Pro securely through
                    Stripe.
                  </BillingWarning>
                )}
                <ul className="mb-6 space-y-2 text-left text-sm text-muted-foreground">
                  <Feature>Browser Companion on supported study pages</Feature>
                  <Feature>Grounded screen-aware tutoring</Feature>
                  <Feature>Shared conversations with Ask UniMate</Feature>
                </ul>
                <button
                  type="button"
                  onClick={handleUpgrade}
                  disabled={checkoutLoading || confirming}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:brightness-95 disabled:opacity-50"
                >
                  {checkoutLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {status?.state === "canceled" || status?.state === "unpaid"
                    ? "Restart Pro"
                    : "Upgrade to Pro"}
                </button>
              </>
            )}

            {error && (
              <p
                className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
                role="alert"
              >
                {error}
              </p>
            )}
            <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
              Secure checkout and billing management are hosted by Stripe. UniMate never receives
              your card details.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      {children}
    </li>
  );
}

function BillingWarning({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-5 flex gap-2 rounded-xl bg-amber-50 px-4 py-3 text-left text-sm text-amber-900"
      role="status"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{children}</p>
    </div>
  );
}
