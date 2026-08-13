import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  CalendarDays,
  MessageCircle,
  MonitorCheck,
  NotebookPen,
  Sparkles,
} from "lucide-react";
import { LogoMark } from "../components/logo-mark";

export const Route = createFileRoute("/")({ component: Index });

const walkthrough = [
  {
    eyebrow: "01 · Bring in your semester",
    title: "Start with your syllabus",
    description:
      "Upload or paste what your professor gave you. Review every date before anything is saved.",
    action: "Upload a syllabus",
    to: "/planner" as const,
    icon: BookOpen,
    preview: [
      "Upload a PDF or paste text",
      "Review detected deadlines",
      "Save only what looks right",
    ],
  },
  {
    eyebrow: "02 · See what is ahead",
    title: "Turn deadlines into a clear timeline",
    description:
      "Spot crowded weeks, add missing dates, and mark work complete from one calm dashboard.",
    action: "Explore the dashboard",
    to: "/dashboard" as const,
    icon: CalendarDays,
    preview: ["Today’s focus", "Semester pressure", "Every deadline in order"],
  },
  {
    eyebrow: "03 · Keep the important parts",
    title: "Organize notes by class",
    description: "Keep course notes close to the deadlines and conversations they support.",
    action: "Open notes",
    to: "/notes" as const,
    icon: NotebookPen,
    preview: ["Choose a course", "Write without clutter", "Find it again quickly"],
  },
  {
    eyebrow: "04 · Ask for help anywhere",
    title: "Study with UniMate beside you",
    description:
      "Ask a direct question in UniMate or use the Browser Companion while you work on another page.",
    action: "Try Ask UniMate",
    to: "/ask" as const,
    icon: MessageCircle,
    preview: ["Ask naturally", "Get the answer first", "Continue the same conversation"],
  },
] as const;

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main>
        <section className="relative px-6 py-20 sm:py-28" aria-labelledby="home-heading">
          <div className="mx-auto max-w-4xl text-center">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.24em] text-primary">
              Welcome to UniMate
            </p>
            <h1
              id="home-heading"
              className="font-serif-display text-5xl font-medium tracking-tight sm:text-6xl md:text-7xl"
            >
              Your semester, made easier to manage
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              Follow this quick tour to see where your deadlines, notes, and AI study help fit
              together. Every example links to the real tool.
            </p>
            <a
              href="#tour"
              className="mt-9 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-7 text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              See how UniMate works <ArrowDown className="h-4 w-4" />
            </a>
          </div>
        </section>

        <section id="tour" className="scroll-mt-24 px-6 pb-20" aria-label="How to use UniMate">
          <div className="mx-auto max-w-5xl space-y-6">
            {walkthrough.map((step, index) => (
              <div key={step.title}>
                <article className="grid overflow-hidden rounded-3xl border border-border bg-card/80 shadow-[var(--shadow-card)] lg:grid-cols-[1fr_0.85fr]">
                  <div className="p-7 sm:p-10">
                    <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary">
                      <step.icon className="h-6 w-6 text-primary-foreground" aria-hidden="true" />
                    </div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
                      {step.eyebrow}
                    </p>
                    <h2 className="mt-3 text-3xl font-semibold tracking-tight">{step.title}</h2>
                    <p className="mt-4 max-w-xl leading-7 text-muted-foreground">
                      {step.description}
                    </p>
                    <Link
                      to={step.to}
                      className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold transition hover:border-primary hover:bg-primary/10"
                    >
                      {step.action} <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                  <div className="border-t border-border bg-secondary/55 p-7 lg:border-l lg:border-t-0 sm:p-10">
                    <p className="mb-5 text-sm font-semibold">What you can do</p>
                    <ol className="space-y-4">
                      {step.preview.map((item, itemIndex) => (
                        <li
                          key={item}
                          className="flex items-center gap-3 rounded-xl bg-background/90 p-4 text-sm"
                        >
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                            {itemIndex + 1}
                          </span>
                          {item}
                        </li>
                      ))}
                    </ol>
                  </div>
                </article>
                {index < walkthrough.length - 1 && (
                  <ArrowDown className="mx-auto my-5 h-5 w-5 text-primary" aria-hidden="true" />
                )}
              </div>
            ))}

            <article className="rounded-3xl border border-primary/50 bg-primary/10 px-7 py-12 text-center sm:px-12">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
                <Sparkles className="h-7 w-7 text-primary-foreground" aria-hidden="true" />
              </div>
              <h2 className="font-serif-display text-4xl font-medium">
                Seen enough? Get UniMate Pro.
              </h2>
              <p className="mx-auto mt-4 max-w-xl leading-7 text-muted-foreground">
                Compare Free and Pro before deciding. Nothing changes until you choose a plan.
              </p>
              <Link
                to="/pricing"
                className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-7 text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-0.5"
              >
                View pricing <ArrowRight className="h-4 w-4" />
              </Link>
            </article>
          </div>
        </section>

        <footer className="border-t border-border/60 py-10">
          <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-5 px-6 sm:flex-row">
            <div className="flex items-center gap-2">
              <LogoMark className="h-7 w-7" />
              <span className="font-serif-display text-lg">UniMate</span>
            </div>
            <div className="flex flex-wrap justify-center gap-5 text-sm text-muted-foreground">
              <Link to="/ask" className="hover:text-foreground">
                Ask UniMate
              </Link>
              <Link to="/dashboard" className="hover:text-foreground">
                Dashboard
              </Link>
              <Link to="/pricing" className="hover:text-foreground">
                Pricing
              </Link>
              <Link to="/privacy" className="hover:text-foreground">
                Privacy
              </Link>
              <Link to="/terms" className="hover:text-foreground">
                Terms
              </Link>
              <Link to="/support" className="hover:text-foreground">
                Support
              </Link>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MonitorCheck className="h-4 w-4" /> Browser Companion ready
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
