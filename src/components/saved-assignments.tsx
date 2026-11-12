import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, BookOpen, RefreshCw } from "lucide-react";
import { useAuth } from "../lib/auth-context";
import { listStudyWorkspace } from "../lib/study-workspace";

export function SavedAssignments() {
  const { user } = useAuth();
  const userId = user?.id;
  const query = useQuery({
    queryKey: ["study-workspace", userId, "assignment"],
    enabled: Boolean(userId),
    queryFn: ({ signal }) =>
      listStudyWorkspace({ kind: "assignment" }, { expectedUserId: userId!, signal }),
    staleTime: 30_000,
  });
  if (!userId) return null;
  const active = query.data?.items.filter((item) => item.status === "active") || [];
  return (
    <section
      aria-labelledby="saved-assignments-title"
      className="rounded-3xl border border-border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="saved-assignments-title"
            className="flex items-center gap-2 text-lg font-semibold"
          >
            <BookOpen className="h-5 w-5 text-primary" />
            Pick up where you left off
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Assignments saved in Ask or the Companion, with your progress and next step.
          </p>
        </div>
        <button
          type="button"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
          aria-label="Refresh saved assignments"
          className="grid h-10 w-10 place-items-center rounded-xl border border-border disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>
      {query.isLoading ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Opening your saved work…
        </p>
      ) : query.isError ? (
        <p role="alert" className="mt-4 text-sm text-muted-foreground">
          Your saved work is unavailable right now. Your existing courses and deadlines are still
          below. Try refreshing this section.
        </p>
      ) : active.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {active.slice(0, 6).map((item) => {
            const course = query.data?.courses.find((entry) => entry.id === item.courseId);
            const params = new URLSearchParams({ workspace: item.id });
            if (item.conversationId) params.set("conversation", item.conversationId);
            if (item.courseId) params.set("course", item.courseId);
            return (
              <a
                key={item.id}
                href={`/ask?${params}`}
                className="group rounded-2xl border border-border bg-background p-4 transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <p className="text-xs text-muted-foreground">
                  {course?.course_code || course?.name || "Personal schoolwork"}
                </p>
                <h3 className="mt-1 font-semibold">{item.title}</h3>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                  {item.nextStep
                    ? `Next: ${item.nextStep}`
                    : item.progress || "Your instructions and conversation are ready when you are."}
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold">
                  Continue with UniMate <ArrowUpRight className="h-3.5 w-3.5" />
                </span>
              </a>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Start an assignment in Ask UniMate or the Pro Companion. Save what you’ve done and your
          next step to find it here. A class is optional.
        </p>
      )}
      {active.length > 6 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Showing your six most recently updated active assignments. Older work is available in its
          saved chat in Ask.
        </p>
      )}
      {query.data?.hasMore && (
        <p className="mt-3 text-xs text-muted-foreground">
          This section loads your most recent saved work. Use your chat history to resume older
          assignments.
        </p>
      )}
    </section>
  );
}
