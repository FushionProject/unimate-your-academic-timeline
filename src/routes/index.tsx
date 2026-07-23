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
        <section className="relative py-[140px]">
          <div className="mx-auto max-w-4xl px-6 text-center">
            <h1 className="font-serif-display text-5xl sm:text-6xl md:text-7xl font-medium tracking-tight text-foreground mb-6">
              Your entire academic life, in one place
            </h1>
            <p className="mx-auto max-w-2xl text-[18px] text-[#555555] mb-8">
              Add your classes, grades, and due dates — then let AI help you actually stay on top of
              it all
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/planner"
                className="inline-flex items-center justify-center gap-2 rounded-[50px] px-8 py-4 text-base font-bold transition-transform hover:scale-[1.02] active:scale-[0.98] bg-[#F5C518] text-[#1a1a1a]"
                style={{ padding: "16px 32px" }}
              >
                Upload a Syllabus
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/ask" className="text-sm text-[#555555] hover:underline transition-colors">
                Try Ask UniMate
              </Link>
            </div>
          </div>
        </section>

        {/* 3-Step Setup Section */}
        <section className="py-20">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center mb-12">
              <h2 className="font-serif-display text-xl font-normal text-foreground/70 mb-4 tracking-wide uppercase">
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
                  Start with the document your professor gave you
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
                <p className="text-muted-foreground">Check the dates UniMate found before saving</p>
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
                <p className="text-muted-foreground">Send deadlines to your dashboard when ready</p>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Grid Section */}
        <section className="py-20">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center mb-12">
              <h2 className="font-serif-display text-3xl sm:text-4xl font-medium text-foreground mb-4">
                What UniMate helps you do
              </h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="rounded-2xl border p-6 hover:border-primary/50 transition-colors border-border bg-card/60">
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
                  Answers based on the classes and grades you enter
                </p>
              </div>
              <div className="rounded-2xl border p-6 hover:border-primary/50 transition-colors border-border bg-card/60">
                <div
                  className="h-12 w-12 rounded-xl flex items-center justify-center mb-4"
                  style={{
                    background: "var(--gradient-primary)",
                  }}
                >
                  <FileText className="h-6 w-6 text-[#1a1a1a]" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Smart Notes</h3>
                <p className="text-sm text-muted-foreground">Organized by the courses you add</p>
              </div>
              <div className="rounded-2xl border p-6 hover:border-primary/50 transition-colors border-border bg-card/60">
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
                  Add and track every assignment yourself
                </p>
              </div>
              <div className="rounded-2xl border p-6 hover:border-primary/50 transition-colors border-border bg-card/60">
                <div
                  className="h-12 w-12 rounded-xl flex items-center justify-center mb-4"
                  style={{
                    background: "var(--gradient-primary)",
                  }}
                >
                  <BookOpen className="h-6 w-6 text-[#1a1a1a]" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Study Planner</h3>
                <p className="text-sm text-muted-foreground">Built around your real deadlines</p>
              </div>
            </div>
          </div>
        </section>

        {/* Footer CTA Section */}
        <section className="py-20">
          <div className="mx-auto max-w-4xl px-6 text-center">
            <h2 className="font-serif-display text-3xl sm:text-4xl font-medium text-foreground mb-6">
              Built for students who'd rather be doing anything else
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
              <div className="flex items-center gap-6">
                <Link
                  to="/"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Home
                </Link>
                <Link
                  to="/ask"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Ask UniMate
                </Link>
                <Link
                  to="/planner"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Upload
                </Link>
                <Link
                  to="/dashboard"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Dashboard
                </Link>
                <Link
                  to="/notes"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Notes
                </Link>
              </div>
              <p className="text-sm text-muted-foreground">
                Made for students who'd rather be doing anything else.
              </p>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
