import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import {
  Upload,
  FileText,
  Sun,
  Moon,
  Sparkles,
  CalendarDays,
  ShieldCheck,
  Zap,
  ArrowRight,
  GraduationCap,
} from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const stored = (typeof window !== "undefined" && localStorage.getItem("theme")) as
      | "dark"
      | "light"
      | null;
    const initial = stored ?? "dark";
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem("theme", next);
  };
  return { theme, toggle };
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="relative grid h-8 w-8 place-items-center rounded-lg bg-[image:var(--gradient-primary)] shadow-[var(--shadow-glow)]">
        <GraduationCap className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
      </div>
      <span className="font-serif-display text-2xl tracking-tight text-foreground">
        UniMate
      </span>
    </div>
  );
}

function Navbar() {
  const { theme, toggle } = useTheme();
  return (
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/60 border-b border-border/60">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Logo />
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            aria-label="Toggle theme"
            className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card/60 text-muted-foreground transition hover:text-foreground hover:bg-card"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button className="hidden sm:inline-flex h-9 items-center rounded-full border border-border bg-card/60 px-4 text-sm font-medium text-foreground transition hover:bg-card">
            Sign in
          </button>
        </div>
      </div>
    </header>
  );
}

const chips = [
  { label: "Midterm", date: "Oct 14", side: "left", top: "12%", rot: -6 },
  { label: "Essay Due", date: "Nov 2", side: "right", top: "18%", rot: 5 },
  { label: "Quiz 3", date: "Sep 26", side: "left", top: "62%", rot: 4 },
  { label: "Lab Report", date: "Oct 30", side: "right", top: "68%", rot: -7 },
  { label: "Final Exam", date: "Dec 12", side: "right", top: "40%", rot: -3 },
  { label: "Reading", date: "Sep 18", side: "left", top: "36%", rot: 8 },
] as const;

function FloatingChip({
  label,
  date,
  side,
  top,
  rot,
  i,
}: {
  label: string;
  date: string;
  side: "left" | "right";
  top: string;
  rot: number;
  i: number;
}) {
  const positions =
    side === "left"
      ? "left-[2%] sm:left-[6%] md:left-[10%]"
      : "right-[2%] sm:right-[6%] md:right-[10%]";
  return (
    <div
      className={`pointer-events-none absolute hidden sm:flex ${positions} animate-float`}
      style={{
        top,
        ["--r" as string]: `${rot}deg`,
        animationDelay: `${i * 0.6}s`,
        transform: `rotate(${rot}deg)`,
      }}
    >
      <div className="flex items-center gap-2 rounded-full border border-border/70 bg-card/70 backdrop-blur-md px-3 py-1.5 text-xs shadow-[var(--shadow-card)] opacity-60">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        <span className="text-foreground/80 font-medium">{label}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground tabular-nums">{date}</span>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* dot grid */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--grid-color) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 50% 30%, black, transparent 80%)",
        }}
      />
      <div
        className="absolute inset-0 -z-10"
        style={{ background: "var(--gradient-hero)" }}
      />

      {chips.map((c, i) => (
        <FloatingChip key={c.label} {...c} i={i} />
      ))}

      <div className="mx-auto max-w-3xl px-6 pt-20 pb-10 text-center sm:pt-28">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-card/50 backdrop-blur px-3 py-1 text-xs text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" />
          <span>Built for students, by students</span>
        </div>

        <h1 className="font-serif-display mt-6 text-5xl leading-[1.05] sm:text-6xl md:text-7xl text-foreground">
          Academic planning,
          <br />
          <span className="italic text-transparent bg-clip-text bg-[image:var(--gradient-primary)]">
            organized clearly.
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-base sm:text-lg text-muted-foreground">
          Upload your syllabus. UniMate extracts every deadline, exam, quiz, and
          assignment — and maps your entire semester onto a calendar you can actually use.
        </p>
      </div>

      <div className="relative mx-auto max-w-2xl px-6 pb-24">
        <InputCard />
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs">
          <Pill icon={<Zap className="h-3.5 w-3.5" />} text="Results in 10 seconds" />
          <Pill icon={<CalendarDays className="h-3.5 w-3.5" />} text="Exports to any calendar" />
          <Pill icon={<ShieldCheck className="h-3.5 w-3.5" />} text="No account needed" />
        </div>
      </div>
    </section>
  );
}

function Pill({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 backdrop-blur px-3 py-1.5 text-muted-foreground">
      <span className="text-primary">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function InputCard() {
  const [tab, setTab] = useState<"pdf" | "text">("pdf");
  const [filename, setFilename] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative">
      {/* glow */}
      <div
        aria-hidden
        className="absolute -inset-px rounded-3xl opacity-60 blur-2xl -z-10"
        style={{ background: "var(--gradient-primary)" }}
      />
      <div className="rounded-3xl border border-border bg-card/80 backdrop-blur-xl p-2 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-1 rounded-2xl bg-secondary/60 p-1">
          <TabButton active={tab === "pdf"} onClick={() => setTab("pdf")}>
            <Upload className="h-3.5 w-3.5" /> Upload PDF
          </TabButton>
          <TabButton active={tab === "text"} onClick={() => setTab("text")}>
            <FileText className="h-3.5 w-3.5" /> Paste text
          </TabButton>
        </div>

        <div className="p-4 sm:p-6">
          {tab === "pdf" ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) setFilename(f.name);
              }}
              onClick={() => inputRef.current?.click()}
              className={`group relative cursor-pointer rounded-2xl border-2 border-dashed transition-all ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/60 hover:bg-secondary/40"
              } px-6 py-12 text-center`}
            >
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setFilename(f.name);
                }}
              />
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-secondary text-primary group-hover:scale-110 transition-transform">
                <Upload className="h-5 w-5" />
              </div>
              <p className="mt-4 text-sm font-medium text-foreground">
                {filename ?? "Drop your syllabus PDF here"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {filename ? "Ready to map" : "or click to browse · PDF up to 10MB"}
              </p>
            </div>
          ) : (
            <textarea
              placeholder="Paste your syllabus text here — assignments, exam dates, weekly readings…"
              className="w-full resize-none rounded-2xl border border-border bg-secondary/40 p-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[180px]"
            />
          )}

          <button className="group mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[image:var(--gradient-primary)] px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition-transform hover:scale-[1.01] active:scale-[0.99]">
            Map My Semester
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-card text-foreground shadow-[var(--shadow-card)]"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

const steps = [
  {
    n: "01",
    title: "Upload your syllabus",
    body: "Drop a PDF or paste the text. Works for any course, any format, any prof's chaotic Word doc.",
  },
  {
    n: "02",
    title: "AI maps every date",
    body: "Midterms, problem sets, readings, labs — extracted, categorized, and laid out on a clean timeline.",
  },
  {
    n: "03",
    title: "Export to your calendar",
    body: "One click to Google, Apple, or Outlook. Your whole semester, synced everywhere you live.",
  },
];

function HowItWorks() {
  return (
    <section className="relative border-t border-border/60 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">How it works</p>
          <h2 className="font-serif-display mt-3 text-4xl sm:text-5xl text-foreground">
            From syllabus to schedule, in three steps.
          </h2>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {steps.map((s, i) => (
            <div
              key={s.n}
              className="group relative rounded-2xl border border-border bg-card/60 p-6 backdrop-blur transition hover:border-primary/50 hover:bg-card"
            >
              <div className="flex items-center justify-between">
                <span className="font-serif-display text-5xl text-transparent bg-clip-text bg-[image:var(--gradient-primary)]">
                  {s.n}
                </span>
                <div className="h-px flex-1 ml-4 bg-gradient-to-r from-border to-transparent" />
              </div>
              <h3 className="mt-6 text-lg font-semibold text-foreground">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.body}</p>
              {i < steps.length - 1 && (
                <ArrowRight className="hidden md:block absolute -right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground/40" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Logo />
        </div>
        <p className="text-xs text-muted-foreground">
          Made for students who'd rather be doing literally anything else. © {new Date().getFullYear()} UniMate
        </p>
      </div>
    </footer>
  );
}

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main>
        <Hero />
        <HowItWorks />
      </main>
      <Footer />
    </div>
  );
}
