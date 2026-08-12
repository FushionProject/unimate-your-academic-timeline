import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CheckCircle2, ExternalLink, LockKeyhole, MonitorCheck, Puzzle } from "lucide-react";
import { ProtectedRoute } from "../components/protected-route";
import { useBillingStatus } from "../lib/profile";

export const Route = createFileRoute("/companion-setup")({
  validateSearch: (search: Record<string, unknown>) => ({
    welcome: search.welcome === "1" ? "1" : undefined,
  }),
  component: () => (
    <ProtectedRoute>
      <CompanionSetup />
    </ProtectedRoute>
  ),
});

function storeUrl(): string | null {
  const value = import.meta.env.VITE_COMPANION_STORE_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function CompanionSetup() {
  const url = storeUrl();
  const { welcome } = Route.useSearch();
  const billing = useBillingStatus();
  const isPro = Boolean(billing.data?.isPro);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <header className="text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary">
            <Puzzle className="h-6 w-6 text-primary-foreground" />
          </div>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-primary">
            {welcome ? "Account created · One optional step" : "Browser Companion setup"}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Take UniMate into your browser
          </h1>
          <p className="mx-auto mt-3 max-w-2xl leading-7 text-muted-foreground">
            The Companion is a Chrome extension. Install it once, sign in with this account, and
            choose which Ask UniMate chat appears while you study.
          </p>
        </header>

        <section className="mt-8 grid overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-card)] md:grid-cols-[1fr_0.75fr]">
          <div className="p-6 sm:p-8">
            <h2 className="text-xl font-semibold">Finish setup</h2>
            <ol className="mt-6 space-y-5">
              <SetupStep number="1" title="Confirm Companion access">
                {billing.isLoading
                  ? "Checking your UniMate plan…"
                  : isPro
                    ? "Your account has UniMate Pro. Companion access is ready."
                    : "Browser Companion AI is a Pro feature. You can keep using Free or test the Pro checkout in Stripe’s sandbox."}
                {!billing.isLoading && !isPro && (
                  <Link
                    to="/upgrade"
                    className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
                  >
                    View Pro checkout
                  </Link>
                )}
              </SetupStep>
              <SetupStep number="2" title="Install the Chrome extension">
                {url
                  ? "Open the verified Chrome Web Store listing and choose Add to Chrome."
                  : "The extension is built, but its public Chrome Web Store link has not been connected to UniMate yet."}
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold"
                  >
                    Add to Chrome <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </SetupStep>
              <SetupStep number="3" title="Connect this account">
                Open Uni on the right edge of a normal webpage and sign in with the same UniMate
                email and password. No second account is created.
              </SetupStep>
              <SetupStep number="4" title="Choose your browser chat">
                In Ask UniMate, select “Use in browser” beside the conversation you want the
                extension to display.
              </SetupStep>
            </ol>
          </div>

          <aside className="border-t border-border bg-secondary/45 p-6 md:border-l md:border-t-0 sm:p-8">
            <h2 className="font-semibold">Current status</h2>
            <div className="mt-5 space-y-3 text-sm">
              <StatusRow ready icon={CheckCircle2} label="UniMate account created" />
              <StatusRow
                ready={isPro}
                icon={LockKeyhole}
                label={isPro ? "Pro access active" : "Pro access required for Companion AI"}
              />
              <StatusRow
                ready={Boolean(url)}
                icon={MonitorCheck}
                label={url ? "Public install link ready" : "Chrome Web Store link pending"}
              />
            </div>
            {!url && (
              <div className="mt-6 rounded-2xl border border-primary/40 bg-primary/10 p-4">
                <p className="text-sm font-semibold">Why you cannot enable it yet</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  UniMate needs the published Chrome Web Store URL. Stripe cannot solve this part;
                  publishing and connecting the extension listing will.
                </p>
              </div>
            )}
            <div className="mt-6 flex flex-col gap-2">
              <Link
                to="/ask"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                Continue to Ask UniMate
              </Link>
              <Link
                to="/dashboard"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-semibold"
              >
                Go to Dashboard
              </Link>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function SetupStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {number}
      </span>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <div className="mt-1 text-sm leading-6 text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

function StatusRow({
  ready,
  icon: Icon,
  label,
}: {
  ready: boolean;
  icon: typeof CheckCircle2;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
      <Icon className={`h-4 w-4 ${ready ? "text-primary" : "text-muted-foreground"}`} />
      <span className={ready ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}
