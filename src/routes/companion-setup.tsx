import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { CheckCircle2, ExternalLink, LockKeyhole, MonitorCheck } from "lucide-react";
import { ProtectedRoute } from "../components/protected-route";
import { useBillingStatus } from "../lib/profile";
import { LogoMark } from "../components/logo-mark";
import { getCompanionAccessState, getCompanionStoreUrl } from "../lib/companion-store";

export const Route = createFileRoute("/companion-setup")({
  validateSearch: (search: Record<string, unknown>): { welcome?: string } => ({
    welcome: search.welcome === "1" ? "1" : undefined,
  }),
  component: () => (
    <ProtectedRoute>
      <CompanionSetup />
    </ProtectedRoute>
  ),
});

function CompanionSetup() {
  const url = getCompanionStoreUrl(import.meta.env.VITE_COMPANION_STORE_URL);
  const { welcome } = Route.useSearch();
  const billing = useBillingStatus();
  const access = getCompanionAccessState(billing);
  const isPro = access === "pro";
  const [accessChecked, setAccessChecked] = useState(false);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <header className="text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary">
            <LogoMark className="h-10 w-10" />
          </div>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-primary">
            {welcome ? "You’re in · Make yourself at home" : "Your study buddy, a tab away"}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            A little help, right beside your coursework
          </h1>
          <p className="mx-auto mt-3 max-w-2xl leading-7 text-muted-foreground">
            UniMate Companion helps you understand what’s on your page, work through a tricky
            problem, and keep your place. It’s included with UniMate Pro.
          </p>
        </header>

        <section className="mt-8 grid overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-card)] md:grid-cols-[1fr_0.75fr]">
          <div className="p-6 sm:p-8">
            <h2 className="text-xl font-semibold">
              {isPro ? "Let’s get you connected" : "Your path to Companion"}
            </h2>
            <ol className="mt-6 space-y-5">
              <SetupStep number="1" title="Confirm Companion access">
                <p role="status" aria-live="polite" aria-atomic="true">
                  {billing.isFetching || access === "checking"
                    ? "Checking your UniMate plan…"
                    : access === "unknown"
                      ? "We couldn’t confirm your plan right now. This doesn’t mean you need another subscription. Try checking again below."
                      : isPro
                        ? "Your account has UniMate Pro. Companion access is ready."
                        : accessChecked
                          ? "This account is still on Free. If you just upgraded, wait a moment and check again using the same account."
                          : "Start with your Free account, then upgrade to Pro. Companion unlocks only after your purchase is confirmed."}
                </p>
                {access === "free" && (
                  <Link
                    to="/upgrade"
                    className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
                  >
                    Explore UniMate Pro
                  </Link>
                )}
                <button
                  type="button"
                  disabled={billing.isFetching}
                  onClick={() => {
                    if (billing.isFetching) return;
                    setAccessChecked(true);
                    void billing.refetch();
                  }}
                  className="mt-3 block text-sm font-semibold text-foreground underline underline-offset-4 disabled:opacity-50"
                >
                  {billing.isFetching
                    ? "Checking access…"
                    : isPro
                      ? "Refresh access"
                      : access === "unknown"
                        ? "Try checking again"
                        : "Already upgraded? Check access"}
                </button>
              </SetupStep>
              <SetupStep number="2" title="Install the Chrome extension">
                {access === "checking" || access === "unknown"
                  ? "The install action will appear once we can confirm your Pro access and the Store listing is available."
                  : !isPro
                    ? "Installation unlocks after this account has confirmed Pro access."
                    : url
                      ? "Open the UniMate Chrome Web Store listing and choose Add to Chrome."
                      : "The Chrome Web Store install link isn’t available yet. You can still study with Ask UniMate while Companion installation is being prepared."}
                {isPro && url && (
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
                {isPro
                  ? "Open Uni on the right edge of a regular webpage. Review the page-sharing notice, then sign in with the same UniMate email and password."
                  : "Once Pro is active and Companion is installed, connect this same account. You won’t need a second account."}
              </SetupStep>
              <SetupStep number="4" title="Choose your browser chat">
                In Ask UniMate, select “Use in browser” beside the conversation you want the
                extension to display.
                <p className="mt-2">
                  You choose when to share. Pressing Send shares one image of the visible tab and a
                  short text sample. Companion does not record continuously.
                </p>
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
                label={
                  access === "checking"
                    ? "Checking your plan…"
                    : access === "unknown"
                      ? "Plan access could not be confirmed"
                      : isPro
                        ? "Pro access active"
                        : "Pro access required for Companion AI"
                }
              />
              <StatusRow
                ready={isPro && Boolean(url)}
                icon={MonitorCheck}
                label={
                  access === "checking" || access === "unknown"
                    ? "Installation waiting for access check"
                    : !isPro
                      ? "Installation locked until Pro is active"
                      : url
                        ? "Store link configured · opens in Chrome Web Store"
                        : "Chrome Web Store link pending"
                }
              />
            </div>
            {isPro && !url && (
              <div className="mt-6 rounded-2xl border border-primary/40 bg-primary/10 p-4">
                <p className="text-sm font-semibold">Your Pro access is ready</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  The public installation link is still being prepared. Your study tools are ready
                  in Ask UniMate, and this page will show the install button when the listing is
                  available.
                </p>
              </div>
            )}
            <div className="mt-6 flex flex-col gap-2">
              <Link
                to="/ask"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                {isPro ? "Continue to Ask UniMate" : "Explore Ask UniMate · Pro"}
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
