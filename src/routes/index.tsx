import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Brain,
  FileText,
  Calendar,
  Sparkles,
  BookOpen,
  NotebookPen,
  CalendarCheck,
  Telescope,
  MonitorCheck,
} from "lucide-react";
import { LogoMark } from "../components/logo-mark";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main>
        {/* Hero Section */}
        <section className="relative py-24 sm:py-32 lg:py-36" aria-labelledby="home-heading">
          <div className="mx-auto max-w-4xl px-6 text-center">
            <h1
              id="home-heading"
              className="font-serif-display mb-6 text-5xl font-medium tracking-tight text-foreground sm:text-6xl md:text-7xl"
            >
              Your entire academic life, in one place
            </h1>
            <p className="mx-auto mb-9 max-w-2xl text-lg leading-8 text-muted-foreground">
              Turn your syllabi into one clear timeline, then use AI help when you get stuck.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/planner"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#F5C518] px-8 py-3 text-base font-semibold text-[#1a1a1a] transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                Upload a Syllabus
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/ask"
                className="inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline"
              >
                Try Ask UniMate
              </Link>
            </div>
            <p className="mt-7 text-xs font-medium text-muted-foreground">
              Review before saving · Screenshots only when you ask · Built around your real semester
            </p>
          </div>
        </section>

        {/* 3-Step Setup Section */}
        <section className="py-16 sm:py-20" aria-labelledby="getting-started-heading">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center mb-12">
              <h2
                id="getting-started-heading"
                className="font-serif-display mb-4 text-xl font-normal uppercase tracking-wide text-foreground/70"
              >
                Get started in 3 steps
              </h2>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="text-center">
                <div
                  className="h-20 w-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
                  style={{
                    background: "transparent",
                    border: "2px solid #F5C518",
                    boxShadow: "0 4px 12px rgba(245, 197, 24, 0.15)",
                  }}
                >
                  <NotebookPen className="h-10 w-10 text-[#F5C518]" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  Upload or paste a syllabus
                </h3>
                <p className="text-muted-foreground">
                  Start with the document your professor gave you.
                </p>
              </div>
              <div className="text-center">
                <div
                  className="h-20 w-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
                  style={{
                    background: "transparent",
                    border: "2px solid #F5C518",
                    boxShadow: "0 4px 12px rgba(245, 197, 24, 0.15)",
                  }}
                >
                  <CalendarCheck className="h-10 w-10 text-[#F5C518]" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Review your timeline</h3>
                <p className="text-muted-foreground">
                  Check the dates UniMate found before saving.
                </p>
              </div>
              <div className="text-center">
                <div
                  className="h-20 w-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
                  style={{
                    background: "transparent",
                    border: "2px solid #F5C518",
                    boxShadow: "0 4px 12px rgba(245, 197, 24, 0.15)",
                  }}
                >
                  <Telescope className="h-10 w-10 text-[#F5C518]" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  Save and plan your week
                </h3>
                <p className="text-muted-foreground">
                  Send deadlines to your dashboard when ready.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Grid Section */}
        <section className="py-16 sm:py-20" aria-labelledby="features-heading">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center mb-12">
              <h2
                id="features-heading"
                className="font-serif-display mb-4 text-3xl font-medium text-foreground sm:text-4xl"
              >
                What UniMate helps you do
              </h2>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
              <Link
                to="/ask"
                className="group rounded-2xl border border-border bg-card/60 p-6 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div
                  className="h-12 w-12 rounded-xl flex items-center justify-center mb-4"
                  style={{
                    background: "var(--gradient-primary)",
                  }}
                >
                  <Brain className="h-6 w-6 text-[#1a1a1a]" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Ask UniMate</h3>
                <p className="text-sm text-muted-foreground">
                  Get direct help based on your classes, deadlines, and questions.
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-foreground opacity-70 transition group-hover:opacity-100">
                  Start a chat <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
              <Link
                to="/notes"
                className="group rounded-2xl border border-border bg-card/60 p-6 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div
                  className="h-12 w-12 rounded-xl flex items-center justify-center mb-4"
                  style={{
                    background: "var(--gradient-primary)",
                  }}
                >
                  <FileText className="h-6 w-6 text-[#1a1a1a]" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Smart Notes</h3>
                <p className="text-sm text-muted-foreground">
                  Keep notes organized by the courses you add.
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-foreground opacity-70 transition group-hover:opacity-100">
                  Open notes <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
              <Link
                to="/dashboard"
                className="group rounded-2xl border border-border bg-card/60 p-6 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div
                  className="h-12 w-12 rounded-xl flex items-center justify-center mb-4"
                  style={{
                    background: "var(--gradient-primary)",
                  }}
                >
                  <Calendar className="h-6 w-6 text-[#1a1a1a]" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Homework Tracker</h3>
                <p className="text-sm text-muted-foreground">
                  Keep every assignment and deadline in one clear timeline.
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-foreground opacity-70 transition group-hover:opacity-100">
                  See timeline <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
              <Link
                to="/planner"
                className="group rounded-2xl border border-border bg-card/60 p-6 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <div
                  className="h-12 w-12 rounded-xl flex items-center justify-center mb-4"
                  style={{
                    background: "var(--gradient-primary)",
                  }}
                >
                  <BookOpen className="h-6 w-6 text-[#1a1a1a]" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Study Planner</h3>
                <p className="text-sm text-muted-foreground">
                  Plan study time around your real deadlines.
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-foreground opacity-70 transition group-hover:opacity-100">
                  Map semester <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
              <div className="rounded-2xl border border-border bg-card/60 p-6 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[var(--shadow-card)]">
                <div
                  className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{ background: "var(--gradient-primary)" }}
                >
                  <MonitorCheck className="h-6 w-6 text-[#1a1a1a]" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-foreground">Browser Companion</h3>
                <p className="text-sm text-muted-foreground">
                  Ask about whatever is visible without leaving the page.
                </p>
                <span className="mt-4 block text-xs font-semibold text-foreground/70">
                  Look for Uni on the right edge
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Footer CTA Section */}
        <section className="py-20">
          <div className="mx-auto max-w-4xl px-6 text-center">
            <h2 className="font-serif-display text-3xl sm:text-4xl font-medium text-foreground mb-6">
              Your all-in-one student assistant
            </h2>
            <Link
              to="/planner"
              className="inline-flex items-center justify-center gap-2 rounded-xl px-8 py-4 text-base font-bold transition-transform hover:scale-[1.02] active:scale-[0.98] bg-[#F5C518] text-[#1a1a1a]"
            >
              Start with a Syllabus
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t py-12 border-border/60">
          <div className="mx-auto max-w-6xl px-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-2">
                <LogoMark className="h-7 w-7" />
                <span className="font-serif-display text-lg text-foreground">UniMate</span>
              </div>
              <nav
                aria-label="Footer navigation"
                className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3"
              >
                <Link
                  to="/"
                  className="inline-flex min-h-10 items-center px-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Home
                </Link>
                <Link
                  to="/ask"
                  className="inline-flex min-h-10 items-center px-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Ask UniMate
                </Link>
                <Link
                  to="/planner"
                  className="inline-flex min-h-10 items-center px-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Upload
                </Link>
                <Link
                  to="/dashboard"
                  className="inline-flex min-h-10 items-center px-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Dashboard
                </Link>
                <Link
                  to="/notes"
                  className="inline-flex min-h-10 items-center px-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Notes
                </Link>
              </nav>
              <p className="max-w-xs text-center text-sm text-muted-foreground md:text-right">
                Classes, deadlines, notes, and AI help — all in one place.
              </p>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
