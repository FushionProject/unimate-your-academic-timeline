import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  GraduationCap,
  MessageCircle,
  PanelRight,
  Plus,
  Sparkles,
} from "lucide-react";
import { LogoMark } from "../components/logo-mark";
import { ClassicHome } from "../components/classic-home";
import { ExperienceSwitch } from "../components/journey-experience";
import { useJourneyExperience } from "../lib/journey-experience";
import { useAuth } from "../lib/auth-context";
import "../journey.css";

export const Route = createFileRoute("/")({ component: Index });

const examples = [
  {
    label: "Help me get started",
    question: "This essay feels like a lot. Where do I start?",
    answer: "Let’s make the first step smaller.",
    steps: [
      "Find the question your essay needs to answer.",
      "Write one sentence with your current point of view.",
      "Choose two ideas from class to support it.",
    ],
    followup: "Bring your assignment into Ask UniMate and we’ll work through it together.",
  },
  {
    label: "Explain a concept",
    question: "Can you explain opportunity cost simply?",
    answer: "It’s the best alternative you give up when you make a choice.",
    steps: [
      "Imagine you have one free hour.",
      "You choose to study instead of taking a paid shift.",
      "The pay you miss is part of the opportunity cost.",
    ],
    followup: "Try your own example in Ask UniMate to check your understanding.",
  },
  {
    label: "Make a study plan",
    question: "How can I prepare for an exam without cramming?",
    answer: "A little structure goes a long way.",
    steps: [
      "List the topics and flag the ones that feel fuzzy.",
      "Practice recalling ideas before rereading your notes.",
      "Spread short practice sessions across the days you have.",
    ],
    followup: "Share your exam date and topics for a plan that fits your week.",
  },
];

function Index() {
  const { user, loading } = useAuth();
  const { classic, ready } = useJourneyExperience();
  const navigate = useNavigate();
  const [example, setExample] = useState(0);
  const selected = examples[example];
  useEffect(() => {
    if (ready && !classic && !loading && user) void navigate({ to: "/dashboard", replace: true });
  }, [ready, classic, loading, user, navigate]);
  if (classic)
    return (
      <>
        <ClassicHome />
        <div className="py-5 text-center">
          <ExperienceSwitch />
        </div>
      </>
    );

  return (
    <main className="journey-home bg-background text-foreground">
      <section
        className="journey-hero mx-auto grid max-w-7xl items-center gap-12 px-6 pb-16 pt-12 lg:grid-cols-[1.02fr_1fr] lg:gap-16 lg:px-10 lg:pb-24 lg:pt-20"
        aria-labelledby="home-heading"
      >
        <div>
          <p className="journey-eyebrow mb-6 inline-flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#B18A14]" /> A little more clarity. A lot less
            overwhelm.
          </p>
          <h1
            id="home-heading"
            className="font-serif-display text-[3.5rem] leading-[1.02] tracking-tight sm:text-7xl lg:text-[5.2rem]"
          >
            Big semester.
            <br />
            Small steps.
            <br />
            <span className="journey-highlight">You’ve got this.</span>
          </h1>
          <p className="mt-7 max-w-md text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Meet UniMate, your study sidekick. Turn your syllabus into a clear plan, know what
            matters today, and get a hand when you’re stuck.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link to="/signup" className="journey-button">
              Build my semester <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#meet-unimate"
              className="inline-flex min-h-12 items-center gap-2 text-sm font-semibold"
            >
              Meet your study sidekick <ChevronRight className="h-4 w-4" />
            </a>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Start free · Review every deadline before saving
          </p>
        </div>
        <div className="journey-preview-wrap">
          <div className="journey-sample-note">
            <Sparkles className="h-3.5 w-3.5" /> A look at life with UniMate
          </div>
          <div className="journey-preview">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <div className="flex items-center gap-2">
                <LogoMark className="h-7 w-7" />
                <span className="font-serif-display text-xl">UniMate</span>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide">
                Example semester
              </span>
            </div>
            <div className="p-5 sm:p-7">
              <p className="journey-eyebrow">YOUR TODAY</p>
              <h2 className="mt-2 font-serif-display text-3xl">One thing at a time.</h2>
              <p className="mt-2 text-sm text-muted-foreground">Here’s a good place to start.</p>
              <div className="mt-6 rounded-2xl border border-[#E0C65D]/50 bg-[#F5C518]/12 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[.14em]">NEXT UP</span>
                  <span className="text-xs text-muted-foreground">Tomorrow</span>
                </div>
                <h3 className="mt-2 font-semibold">Draft your essay outline</h3>
                <p className="mt-1 text-xs text-muted-foreground">English Composition · Essay 01</p>
                <a
                  href="#meet-unimate"
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-xs font-semibold text-background"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Help me start
                </a>
              </div>
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-border/70 p-3.5">
                <span className="h-4 w-4 rounded-full border border-border" />
                <span className="flex-1 text-xs font-medium">Review chapter 3 notes</span>
                <span className="text-[10px] text-muted-foreground">Friday</span>
              </div>
              <div className="mt-5 flex gap-3 rounded-2xl bg-muted p-4">
                <LogoMark className="h-8 w-8 shrink-0" />
                <div>
                  <p className="text-xs font-semibold">A little help from Uni</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    An outline can start with just three ideas. Want to find yours together?
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="journey-paper-note">
            <Check className="h-4 w-4" />
            <span>Less “where do I even start?”</span>
          </div>
        </div>
      </section>
      <section
        className="border-y border-border/60 bg-card/40 px-6 py-5"
        aria-label="Your semester workflow"
      >
        <div className="mx-auto grid max-w-5xl gap-4 text-sm sm:grid-cols-3">
          {[
            { icon: FileText, text: "Bring your semester together" },
            { icon: BookOpen, text: "Find your next small step" },
            { icon: MessageCircle, text: "Learn with a sidekick" },
          ].map(({ icon: Icon, text }, index) => (
            <div key={text} className="flex items-center justify-center gap-3">
              <span className="journey-step-number">0{index + 1}</span>
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{text}</span>
            </div>
          ))}
        </div>
      </section>
      <section
        id="meet-unimate"
        className="mx-auto grid max-w-6xl scroll-mt-28 gap-10 px-6 py-20 lg:grid-cols-[.8fr_1fr] lg:gap-20 lg:py-28"
      >
        <div className="lg:pt-7">
          <p className="journey-eyebrow">MEET YOUR STUDY SIDEKICK</p>
          <h2 className="mt-4 font-serif-display text-4xl leading-tight sm:text-5xl">
            For the “wait,
            <br />
            how do I do this?”
          </h2>
          <p className="mt-5 max-w-md leading-7 text-muted-foreground">
            A patient explanation. A starting point for a tricky assignment. A plan for the week
            ahead. UniMate helps you move from stuck to started.
          </p>
          <div className="mt-7 flex flex-wrap gap-2" aria-label="Choose an example conversation">
            {examples.map((item, index) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setExample(index)}
                aria-pressed={example === index}
                className={`journey-example-chip ${example === index ? "is-active" : ""}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <Link to="/ask" className="mt-7 inline-flex items-center gap-2 text-sm font-semibold">
            Ask your own question <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="rounded-3xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:p-7">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LogoMark className="h-8 w-8" />
              <span className="font-semibold">Ask UniMate</span>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Sample conversation
            </span>
          </div>
          <div className="ml-5 rounded-2xl rounded-br-md bg-muted px-4 py-3 text-sm leading-6">
            {selected.question}
          </div>
          <div className="mt-6" aria-live="polite">
            <div className="flex gap-3">
              <LogoMark className="h-7 w-7 shrink-0" />
              <div>
                <p className="text-sm font-semibold leading-6">{selected.answer}</p>
                <ol className="mt-4 space-y-3">
                  {selected.steps.map((step, index) => (
                    <li key={step} className="flex gap-3 text-sm leading-6 text-muted-foreground">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-foreground">
                        {index + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
                <p className="mt-5 text-xs leading-6 text-muted-foreground">{selected.followup}</p>
              </div>
            </div>
          </div>
          <Link
            to="/ask"
            className="mt-6 flex min-h-12 items-center justify-between rounded-xl border border-border px-4 text-sm text-muted-foreground"
          >
            What are you working on? <Plus className="h-4 w-4" />
          </Link>
        </div>
      </section>
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-6 md:grid-cols-2">
          <article className="journey-feature-card">
            <span className="journey-icon-tile">
              <FileText className="h-6 w-6" />
            </span>
            <p className="journey-eyebrow mt-6">A PLAN THAT STARTS WITH YOUR CLASSES</p>
            <h2 className="mt-3 font-serif-display text-3xl">Your syllabus, with a next step.</h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Upload a PDF or paste your syllabus. Check the dates, save your course, and see the
              deadlines that need your attention.
            </p>
            <Link
              to="/planner"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold"
            >
              Bring in my first class <ArrowRight className="h-4 w-4" />
            </Link>
          </article>
          <article className="journey-feature-card journey-companion-card">
            <div className="flex items-center justify-between">
              <span className="journey-icon-tile">
                <PanelRight className="h-6 w-6" />
              </span>
              <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold">
                UniMate Pro
              </span>
            </div>
            <p className="journey-eyebrow mt-6">HELP, RIGHT BESIDE YOUR COURSEWORK</p>
            <h2 className="mt-3 font-serif-display text-3xl">Take your sidekick with you.</h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              With Browser Companion, ask about the page you’re studying and keep the conversation
              beside your work.
            </p>
            <Link
              to="/pricing"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold"
            >
              Explore Browser Companion <ArrowRight className="h-4 w-4" />
            </Link>
          </article>
        </div>
      </section>
      <section className="border-y border-border/60 bg-primary/10 px-6 py-16 text-center">
        <GraduationCap className="mx-auto h-8 w-8" />
        <h2 className="mt-5 font-serif-display text-4xl sm:text-5xl">
          Make a little room to breathe.
        </h2>
        <p className="mx-auto mt-4 max-w-lg leading-7 text-muted-foreground">
          You don’t need your whole semester figured out. Start with one class. We’ll take it from
          there.
        </p>
        <Link to="/signup" className="journey-button mt-7">
          Find my first step <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
      <footer className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 py-9 sm:flex-row">
        <div className="flex items-center gap-2">
          <LogoMark className="h-7 w-7" />
          <span className="font-serif-display text-xl">UniMate</span>
        </div>
        <div className="flex flex-wrap justify-center gap-5 text-xs text-muted-foreground">
          <Link to="/pricing">Pricing</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/support">Support</Link>
        </div>
        <ExperienceSwitch />
      </footer>
    </main>
  );
}
