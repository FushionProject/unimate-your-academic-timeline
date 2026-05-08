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

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* aurora blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className="absolute -top-40 left-1/4 h-[500px] w-[500px] rounded-full opacity-40 blur-3xl animate-blob"
          style={{ background: "radial-gradient(circle, oklch(0.7 0.3 350 / 0.45), transparent 70%)" }}
        />
        <div
          className="absolute top-20 right-1/4 h-[420px] w-[420px] rounded-full opacity-35 blur-3xl animate-blob"
          style={{ background: "radial-gradient(circle, oklch(0.85 0.2 220 / 0.5), transparent 70%)", animationDelay: "5s" }}
        />
        <div
          className="absolute top-40 left-1/2 h-[360px] w-[360px] rounded-full opacity-25 blur-3xl animate-blob"
          style={{ background: "radial-gradient(circle, oklch(0.9 0.32 140 / 0.45), transparent 70%)", animationDelay: "10s" }}
        />
      </div>

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

      <div className="mx-auto max-w-3xl px-6 pt-20 pb-10 text-center sm:pt-28">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-primary/20 bg-card/50 backdrop-blur px-3 py-1 text-xs text-muted-foreground shadow-[0_0_30px_-10px_var(--primary)]">
          <Sparkles className="h-3 w-3 text-primary animate-twinkle" />
          <span>Built for students, by students</span>
        </div>

        <h1 className="font-serif-display mt-6 text-5xl leading-[1.05] sm:text-6xl md:text-7xl text-foreground">
          Academic planning,
          <br />
          <span
            className="italic animate-tri-gradient bg-clip-text text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(90deg, #FF006E, #00D4FF, #9B59B6, #FF006E)",
              backgroundSize: "300% 100%",
              WebkitBackgroundClip: "text",
            }}
          >
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
      {/* outer glow halo */}
      <div
        aria-hidden
        className="absolute -inset-8 rounded-[2rem] opacity-40 blur-3xl -z-10 animate-pulse-glow"
        style={{ background: "var(--gradient-primary)" }}
      />
      {/* neon border */}
      <div
        aria-hidden
        className="absolute -inset-px rounded-3xl opacity-80 -z-10"
        style={{
          background:
            "linear-gradient(135deg, var(--neon-blue), var(--neon-lime), var(--neon-pink), var(--neon-yellow))",
        }}
      />
      <div className="relative rounded-3xl border border-border/60 bg-card/90 backdrop-blur-xl p-2 shadow-[var(--shadow-card)]">
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

          <button
            className="group mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold text-white transition-transform hover:scale-[1.01] active:scale-[0.99] animate-tri-gradient"
            style={{
              backgroundImage:
                "linear-gradient(90deg, #FF006E, #00D4FF, #9B59B6, #FF006E)",
              backgroundSize: "300% 100%",
              boxShadow:
                "0 0 30px rgba(255, 0, 110, 0.4), 0 0 80px rgba(0, 212, 255, 0.25)",
            }}
          >
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
    color: "var(--neon-blue)",
    glow: "oklch(0.85 0.2 220 / 0.55)",
  },
  {
    n: "02",
    title: "AI maps every date",
    body: "Midterms, problem sets, readings, labs — extracted, categorized, and laid out on a clean timeline.",
    color: "var(--neon-yellow)",
    glow: "oklch(0.94 0.22 100 / 0.55)",
  },
  {
    n: "03",
    title: "Export to your calendar",
    body: "One click to Google, Apple, or Outlook. Your whole semester, synced everywhere you live.",
    color: "var(--neon-pink)",
    glow: "oklch(0.7 0.3 350 / 0.55)",
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
                <span
                  className="font-serif-display text-5xl"
                  style={{
                    color: s.color,
                    textShadow: `0 0 18px ${s.glow}, 0 0 40px ${s.glow}`,
                  }}
                >
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
