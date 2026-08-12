import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, ExternalLink, Puzzle } from "lucide-react";
import { ProtectedRoute } from "../components/protected-route";

export const Route = createFileRoute("/companion-setup")({
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
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-card)] sm:p-9">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary">
            <Puzzle className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="mt-5 text-3xl font-bold tracking-tight">Add the Browser Companion</h1>
          <p className="mt-3 leading-7 text-muted-foreground">
            The Companion is a Chrome extension, so creating a UniMate account does not install it
            automatically. Install it once, then use the same email and password.
          </p>
          <ol className="mt-7 space-y-4">
            {[
              "Install the UniMate Browser Companion in Chrome.",
              "Open any normal website and click Uni on the right edge.",
              "Sign in with this UniMate account. Your selected Ask UniMate chat will follow you.",
            ].map((step, index) => (
              <li
                key={step}
                className="flex gap-3 rounded-2xl border border-border bg-background p-4"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {index + 1}
                </span>
                <span className="text-sm leading-6">{step}</span>
              </li>
            ))}
          </ol>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground"
            >
              Install from Chrome Web Store <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <div className="mt-7 rounded-2xl border border-primary/40 bg-primary/10 p-4">
              <p className="font-semibold">The public install link is not connected yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The extension itself is built, but UniMate needs its Chrome Web Store listing URL
                before students can install it here.
              </p>
            </div>
          )}
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" /> No separate Companion account is
            required.
          </div>
          <Link
            to="/ask"
            className="mt-6 inline-block text-sm font-semibold underline underline-offset-4"
          >
            Return to Ask UniMate
          </Link>
        </div>
      </div>
    </main>
  );
}
