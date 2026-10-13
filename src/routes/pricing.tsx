import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth-context";
import { FREE_FEATURES, PRO_FEATURES, PRO_PLAN } from "../lib/plan-catalog";
import { useBillingStatus } from "../lib/profile";
import { getCompanionStoreUrl } from "../lib/companion-store";

export const Route = createFileRoute("/pricing")({ component: Pricing });

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
  const billing = useBillingStatus();
  const companionStoreUrl = getCompanionStoreUrl(import.meta.env.VITE_COMPANION_STORE_URL);

  return (
    <main className="mx-auto min-h-[calc(100vh-73px)] max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
      <header className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Simple plans
        </p>
        <h1 className="font-serif-display mt-3 text-5xl font-medium">
          A little less overwhelmed.
          <br />A lot more on top of it.
        </h1>
        <p className="mt-5 leading-7 text-muted-foreground">
          Organize your semester for free. Add Pro for a school assistant that helps you understand,
          prepare, write, and find your next step.
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
          <PlanFeatures items={FREE_FEATURES} />
          <Link
            to={user ? "/dashboard" : "/signup"}
            className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-border bg-background px-5 text-sm font-semibold transition hover:border-primary"
          >
            {user ? "Open your dashboard" : "Create a free account"}
          </Link>
        </section>

        <section className="relative rounded-3xl border border-primary bg-primary/10 p-7 shadow-[var(--shadow-card)] sm:p-9">
          <span className="absolute right-6 top-6 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
            <Sparkles className="h-3 w-3" /> Pro
          </span>
          <h2 className="text-2xl font-semibold">UniMate Pro</h2>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground">
            Help for the whole school day, from “I’m stuck” to “I’ve got this.”
          </p>
          <p className="mt-7 text-4xl font-bold">
            {PRO_PLAN.monthlyPrice}
            <span className="text-base font-normal text-muted-foreground"> / month</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Billed monthly · cancel anytime</p>
          <PlanFeatures items={PRO_FEATURES} />
          {!companionStoreUrl && (
            <p className="mt-5 rounded-xl border border-border bg-background/60 p-3 text-xs leading-5 text-muted-foreground">
              Browser Companion’s public Chrome Web Store installation isn’t available yet. Ask
              UniMate works here in the app.
            </p>
          )}
          <Link
            to={user ? "/upgrade" : "/signup"}
            search={user ? {} : { next: "upgrade" }}
            className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground transition hover:brightness-95"
          >
            {billing.data?.isPro
              ? "Manage your Pro plan"
              : user
                ? "Get UniMate Pro"
                : "Create an account for Pro"}
          </Link>
        </section>
      </div>

      <section className="mx-auto mt-12 max-w-3xl rounded-2xl border border-border bg-card/60 p-6 sm:p-8">
        <h2 className="text-lg font-semibold">Know what you’re getting</h2>
        <div className="mt-5 grid gap-6 text-sm leading-6 sm:grid-cols-2">
          <div>
            <h3 className="font-semibold">One allowance, across your schoolwork</h3>
            <p className="mt-1 text-muted-foreground">
              AI messages cover Ask UniMate and text help in the Browser Companion. Screen questions
              have their own allowance. Monthly allowances reset each calendar month in UTC and
              don’t roll over.
            </p>
          </div>
          <div>
            <h3 className="font-semibold">Your work stays yours</h3>
            <p className="mt-1 text-muted-foreground">
              UniMate helps you learn, plan, and revise. Add your class context for more relevant
              help, and check important deadlines and requirements against your original course
              materials.
            </p>
          </div>
          <div>
            <h3 className="font-semibold">No extension needed to get started</h3>
            <p className="mt-1 text-muted-foreground">
              Ask UniMate works right here. The optional Chrome Companion brings the same
              conversation alongside supported study pages.
            </p>
          </div>
          <div>
            <h3 className="font-semibold">Cancel when you need to</h3>
            <p className="mt-1 text-muted-foreground">
              Manage your subscription through secure Stripe billing. Pro stays available through
              your paid period when you cancel.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
