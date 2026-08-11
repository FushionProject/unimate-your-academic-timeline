import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth-context";

export const Route = createFileRoute("/pricing")({ component: Pricing });

const freeFeatures = [
  "Semester timeline and dashboard",
  "Course notes",
  "A starter allowance for Ask UniMate",
];

const proFeatures = [
  "Everything in Free",
  "Browser Companion access",
  "Higher fair-use limits for AI study help",
  "Shared conversations between UniMate and the Companion",
];

function PlanFeatures({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-7 space-y-3 text-left text-sm text-muted-foreground">
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Pricing() {
  const { user } = useAuth();

  return (
    <main className="mx-auto min-h-[calc(100vh-73px)] max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
      <header className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Simple plans</p>
        <h1 className="font-serif-display mt-3 text-5xl font-medium">
          Choose what fits your semester
        </h1>
        <p className="mt-5 leading-7 text-muted-foreground">
          Start free. Upgrade only when you want the Browser Companion and more AI study support.
        </p>
      </header>

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        <section className="rounded-3xl border border-border bg-card p-7 sm:p-9">
          <h2 className="text-2xl font-semibold">Free</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The essentials for organizing a semester.
          </p>
          <p className="mt-7 text-4xl font-bold">$0</p>
          <p className="mt-1 text-xs text-muted-foreground">No card required</p>
          <PlanFeatures items={freeFeatures} />
          <Link
            to={user ? "/" : "/signup"}
            className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-border bg-background px-5 text-sm font-semibold transition hover:border-primary"
          >
            {user ? "Continue with Free" : "Create a free account"}
          </Link>
        </section>

        <section className="relative rounded-3xl border border-primary bg-primary/10 p-7 shadow-[var(--shadow-card)] sm:p-9">
          <span className="absolute right-6 top-6 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
            <Sparkles className="h-3 w-3" /> Pro
          </span>
          <h2 className="text-2xl font-semibold">UniMate Pro</h2>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground">
            For students who want UniMate beside them across the web.
          </p>
          <p className="mt-7 text-4xl font-bold">Pro</p>
          <p className="mt-1 text-xs text-muted-foreground">Final price shown before checkout</p>
          <PlanFeatures items={proFeatures} />
          <Link
            to={user ? "/upgrade" : "/signup"}
            className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground transition hover:brightness-95"
          >
            {user ? "Choose Pro" : "Create an account for Pro"}
          </Link>
        </section>
      </div>

      <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-5 text-muted-foreground">
        This page compares plans only. Pro checkout remains separate, and no purchase is made from
        this page.
      </p>
    </main>
  );
}
