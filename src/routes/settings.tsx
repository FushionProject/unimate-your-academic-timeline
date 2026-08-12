import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Check, KeyRound, Loader2, LogOut, Moon, Puzzle, Sun, UserRound } from "lucide-react";
import { ProtectedRoute } from "../components/protected-route";
import { useTheme } from "../components/theme-provider";
import { useAuth } from "../lib/auth-context";
import { useIsPro } from "../lib/profile";

export const Route = createFileRoute("/settings")({
  component: () => (
    <ProtectedRoute>
      <Settings />
    </ProtectedRoute>
  ),
});

function Settings() {
  const { user, requestPasswordReset, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { data: isPro, isLoading: planLoading } = useIsPro();
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<"reset" | "signout" | null>(null);
  if (!user) return null;

  const resetPassword = async () => {
    if (!user.email || busy) return;
    setBusy("reset");
    const result = await requestPasswordReset(user.email);
    setStatus(result.error || `Password reset instructions were sent to ${user.email}.`);
    setBusy(null);
  };

  const handleSignOut = async () => {
    if (busy) return;
    setBusy("signout");
    await signOut();
    await navigate({ to: "/" });
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Your account
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Settings
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your account, plan, appearance, and Browser Companion.
        </p>

        <section className="mt-7 flex flex-col gap-5 rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/20">
              <UserRound className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Signed in as</p>
              <p className="truncate font-semibold">{user.email}</p>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-background px-4 py-3 text-sm">
            <span className="text-muted-foreground">Current plan: </span>
            <strong>{planLoading ? "Checking…" : isPro ? "UniMate Pro" : "Free"}</strong>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-7">
            <h2 className="font-semibold">Appearance</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose the theme that feels easiest to read.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3" role="radiogroup" aria-label="Color theme">
              {(
                [
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={theme === option.value}
                  onClick={() => setTheme(option.value)}
                  className={`flex min-h-12 items-center gap-3 rounded-2xl border p-4 ${theme === option.value ? "border-primary bg-primary/10" : "border-border bg-background"}`}
                >
                  <option.icon className="h-5 w-5" />
                  <span className="flex-1 text-left text-sm font-medium">{option.label}</span>
                  {theme === option.value && <Check className="h-4 w-4 text-primary" />}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-7">
            <div className="flex gap-3">
              <Puzzle className="h-5 w-5 text-primary" />
              <div>
                <h2 className="font-semibold">Browser Companion</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {planLoading
                    ? "Checking your Companion access…"
                    : isPro
                      ? "Your Pro account can install the extension and sign in with this same UniMate account."
                      : "Browser Companion is available with UniMate Pro."}
                </p>
              </div>
            </div>
            {!planLoading &&
              (isPro ? (
                <Link
                  to="/companion-setup"
                  className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
                >
                  Set up Browser Companion
                </Link>
              ) : (
                <Link
                  to="/upgrade"
                  className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
                >
                  Upgrade to Pro
                </Link>
              ))}
          </section>

          <section className="rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-7 lg:col-span-2">
            <div className="flex items-center gap-3">
              <KeyRound className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">Account access</h2>
            </div>
            <div className="mt-5 divide-y divide-border rounded-2xl border border-border bg-background">
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Reset password</p>
                  <p className="text-sm text-muted-foreground">
                    Send a secure reset link to your email.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetPassword}
                  disabled={Boolean(busy)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold"
                >
                  {busy === "reset" && <Loader2 className="h-4 w-4 animate-spin" />}Reset password
                </button>
              </div>
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Sign out</p>
                  <p className="text-sm text-muted-foreground">
                    End your UniMate session on this device.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={Boolean(busy)}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-destructive/30 px-4 text-sm font-semibold text-destructive"
                >
                  {busy === "signout" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="h-4 w-4" />
                  )}
                  Sign out
                </button>
              </div>
            </div>
            {status && (
              <p className="mt-4 text-sm text-muted-foreground" role="status">
                {status}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
