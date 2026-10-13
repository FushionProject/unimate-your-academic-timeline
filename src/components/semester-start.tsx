import { Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { LogoMark } from "./logo-mark";

export function SemesterStart({
  courseCount,
  deadlineCount,
  completedCount,
}: {
  courseCount: number;
  deadlineCount: number;
  completedCount: number;
}) {
  const steps = [
    {
      label: "Bring in a class",
      detail: courseCount
        ? `${courseCount} course${courseCount === 1 ? "" : "s"} saved`
        : "Start with one syllabus",
      complete: courseCount > 0,
    },
    {
      label: "Make a clear plan",
      detail: deadlineCount
        ? `${deadlineCount} deadline${deadlineCount === 1 ? "" : "s"} on your timeline`
        : "Review and save your dates",
      complete: deadlineCount > 0,
    },
    {
      label: "Take your first step",
      detail: completedCount
        ? `${completedCount} item${completedCount === 1 ? "" : "s"} completed`
        : "Finish something, then mark it done",
      complete: completedCount > 0,
    },
  ];
  const completeCount = steps.filter((step) => step.complete).length;
  if (completeCount === 3) return null;
  return (
    <section
      className="rounded-3xl border border-border bg-card p-5 sm:p-7"
      aria-labelledby="semester-start-heading"
    >
      <div className="flex items-start gap-4">
        <LogoMark className="h-11 w-11 shrink-0" />
        <div className="flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="journey-eyebrow">LET’S GET YOU SETTLED</p>
            <span className="text-xs text-muted-foreground">{completeCount} of 3 steps</span>
          </div>
          <h2 id="semester-start-heading" className="mt-1 font-serif-display text-3xl">
            {courseCount === 0
              ? "Your semester starts with one class."
              : deadlineCount === 0
                ? "Let’s give your class a plan."
                : "Your plan is here. Make one small start."}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {deadlineCount === 0
              ? "Upload a syllabus, check the dates, and let UniMate bring the next deadline into focus."
              : "Pick the assignment below. If you’re unsure where to begin, UniMate can help you break it into manageable steps."}
          </p>
        </div>
      </div>
      <ol className="mt-6 grid gap-3 md:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.label} className="journey-onboarding-step">
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${step.complete ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}
            >
              {step.complete ? <Check className="h-4 w-4" aria-label="Complete" /> : index + 1}
            </span>
            <div>
              <p className="text-sm font-semibold">{step.label}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      {deadlineCount === 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Link to="/planner" className="journey-button">
            {courseCount ? "Add my syllabus" : "Bring in my first class"}{" "}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/ask"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            No syllabus yet? Ask a study question
          </Link>
        </div>
      )}
    </section>
  );
}
