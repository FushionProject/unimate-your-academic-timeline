import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { LogoMark } from "./logo-mark";

export function LegalPage({
  eyebrow,
  title,
  summary,
  children,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6 sm:py-14">
      <article className="mx-auto max-w-3xl rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-card)] sm:p-10">
        <div className="flex items-center gap-3">
          <LogoMark className="h-10 w-10" />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
            <p className="text-xs text-muted-foreground">Effective August 12, 2026</p>
          </div>
        </div>
        <h1 className="mt-7 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-4 leading-7 text-muted-foreground">{summary}</p>
        <div className="legal-copy mt-9 space-y-8 text-sm leading-7 text-foreground">
          {children}
        </div>
        <footer className="mt-10 flex flex-wrap gap-4 border-t border-border pt-6 text-sm">
          <Link to="/privacy" className="underline underline-offset-4">
            Privacy
          </Link>
          <Link to="/terms" className="underline underline-offset-4">
            Terms
          </Link>
          <Link to="/support" className="underline underline-offset-4">
            Support
          </Link>
        </footer>
      </article>
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-2 space-y-3 text-muted-foreground">{children}</div>
    </section>
  );
}
