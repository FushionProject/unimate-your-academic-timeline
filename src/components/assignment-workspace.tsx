import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronDown, ExternalLink, Play, Save, Sparkles } from "lucide-react";
import {
  createStudyItem,
  listStudyWorkspace,
  updateStudyItem,
  type StudyItem,
} from "../lib/study-workspace";
import { StudyResourceSave } from "./study-resources";

type AssignmentDraft = {
  title: string;
  content: string;
  sourceUrl: string;
  courseId: string;
  progress: string;
  nextStep: string;
  status: "active" | "done";
};

const emptyDraft = (title = "", courseId = ""): AssignmentDraft => ({
  title,
  content: "",
  sourceUrl: "",
  courseId,
  progress: "",
  nextStep: "",
  status: "active",
});
const itemDraft = (item: StudyItem): AssignmentDraft => ({
  title: item.title,
  content: item.content,
  sourceUrl: item.sourceUrl || "",
  courseId: item.courseId || "",
  progress: item.progress,
  nextStep: item.nextStep,
  status: item.status,
});

const assignmentPrompts = {
  understand:
    "Help me understand this saved assignment. Explain what it asks for, what a finished submission needs, and any unclear requirements. Ask one focused question if information is missing. Do not invent a deadline, rubric, or requirement.",
  start:
    "Help me get started on this saved assignment. Suggest one manageable 10–15-minute first step based on its instructions and my progress. Coach me through it and keep the work in my own voice.",
  resume:
    "Let's pick up this saved assignment from my progress and next step. Briefly remind me where I stopped, then help me continue. If progress is missing, ask where I left off.",
};

export function AssignmentWorkspace({
  userId,
  conversationId,
  initialItemId,
  initialTitle,
  initialCourseId,
  startExpanded,
  courses,
  disabled,
  onContextChange,
  onAsk,
}: {
  userId: string;
  conversationId: string;
  initialItemId?: string;
  initialTitle?: string;
  initialCourseId?: string;
  startExpanded?: boolean;
  courses: { id: string; name: string; course_code: string }[];
  disabled: boolean;
  onContextChange: (item: StudyItem | null, dirty: boolean) => void;
  onAsk: (prompt: string, item: StudyItem) => void;
}) {
  const queryClient = useQueryClient();
  const [item, setItem] = useState<StudyItem | null>(null);
  const [draft, setDraft] = useState(() => emptyDraft(initialTitle, initialCourseId));
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(emptyDraft(initialTitle, initialCourseId)),
  );
  const [expanded, setExpanded] = useState(Boolean(initialTitle || initialItemId || startExpanded));
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const operationRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);
  const savingRef = useRef(false);
  const draftId = useRef(crypto.randomUUID());
  const dirty = !loading && JSON.stringify(draft) !== baseline;
  const needsChatLink = Boolean(item && !item.conversationId);
  const canSave = Boolean(draft.title.trim());
  const canTutor = canSave && Boolean(draft.content.trim());

  useBlocker({
    shouldBlockFn: () =>
      (dirty || busy) &&
      !window.confirm("Leave this assignment? Your edits or pending save may not finish."),
    enableBeforeUnload: dirty || busy,
  });

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      operationRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    onContextChange(
      loadFailed ? null : item,
      dirty || busy || loading || needsChatLink || Boolean(initialItemId && loadFailed),
    );
  }, [item, dirty, busy, loading, needsChatLink, loadFailed, initialItemId, onContextChange]);

  const load = useCallback(async () => {
    operationRef.current?.abort();
    const controller = new AbortController();
    operationRef.current = controller;
    setLoading(true);
    setLoadFailed(false);
    setError("");
    try {
      const result = await listStudyWorkspace(
        initialItemId
          ? { id: initialItemId, kind: "assignment" }
          : { kind: "assignment", conversationId },
        { expectedUserId: userId, signal: controller.signal },
      );
      if (!aliveRef.current || controller.signal.aborted) return;
      const saved = result.items[0] || null;
      if (initialItemId && !saved)
        throw new Error("This saved assignment is unavailable. It may have been removed.");
      if (saved?.conversationId && saved.conversationId !== conversationId)
        throw new Error(
          "This assignment belongs to another chat. Open it from Today to resume the right conversation.",
        );
      setItem(saved);
      const next = saved ? itemDraft(saved) : emptyDraft(initialTitle, initialCourseId);
      setDraft(next);
      setBaseline(JSON.stringify(next));
      if (saved) setExpanded(true);
      setConflict(false);
    } catch (cause) {
      if (!aliveRef.current || controller.signal.aborted) return;
      setLoadFailed(true);
      setError(
        cause instanceof Error ? cause.message : "Your saved assignment could not be opened.",
      );
    } finally {
      if (aliveRef.current && !controller.signal.aborted) setLoading(false);
    }
  }, [userId, conversationId, initialItemId, initialTitle, initialCourseId]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (): Promise<StudyItem | null> => {
    if (savingRef.current || busy || disabled || loading || loadFailed || !canSave || conflict)
      return null;
    savingRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const controller = new AbortController();
    operationRef.current = controller;
    const input = {
      title: draft.title.trim(),
      content: draft.content.trim(),
      sourceUrl: draft.sourceUrl.trim() || null,
      sourceTitle: draft.title.trim(),
      courseId: draft.courseId || null,
      conversationId,
      progress: draft.progress.trim(),
      nextStep: draft.nextStep.trim(),
      status: draft.status,
    };
    try {
      const access = { expectedUserId: userId, signal: controller.signal };
      const saved = item
        ? await updateStudyItem(item.id, item.version, input, access)
        : await createStudyItem({ ...input, kind: "assignment", id: draftId.current }, access);
      if (!aliveRef.current || controller.signal.aborted) return null;
      setItem(saved);
      const next = itemDraft(saved);
      setDraft(next);
      setBaseline(JSON.stringify(next));
      setNotice(
        "Saved to your account. Choose “Use in browser” to continue this chat in the Companion.",
      );
      onContextChange(saved, false);
      void queryClient.invalidateQueries({ queryKey: ["study-workspace", userId] });
      return saved;
    } catch (cause) {
      if (!aliveRef.current || controller.signal.aborted) return null;
      setConflict(
        Boolean(
          cause &&
          typeof cause === "object" &&
          "code" in cause &&
          cause.code === "WORKSPACE_CONFLICT",
        ),
      );
      setError(
        cause instanceof Error
          ? cause.message
          : "Your assignment could not be saved. Your edits are still here.",
      );
      return null;
    } finally {
      savingRef.current = false;
      if (aliveRef.current && !controller.signal.aborted) setBusy(false);
    }
  };

  const ask = async (intent: keyof typeof assignmentPrompts) => {
    if (disabled || busy || loading || loadFailed || !canTutor || conflict) return;
    const saved = item && !dirty && !needsChatLink ? item : await save();
    if (saved && aliveRef.current) onAsk(assignmentPrompts[intent], saved);
  };
  const edit = <K extends keyof AssignmentDraft>(key: K, value: AssignmentDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setNotice("");
  };
  const fieldClass =
    "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  return (
    <section
      aria-label="Assignment workspace"
      className="border-b border-border/60 bg-primary/5 px-4 py-4 sm:px-6"
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        className="flex min-h-10 w-full items-center gap-2 text-left"
      >
        <BookOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            {item ? item.title : "Working on an assignment?"}
          </span>
          <span className="block text-xs text-muted-foreground">
            {item?.nextStep
              ? `Next: ${item.nextStep}`
              : "Understand it, start small, and remember your next step."}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {!expanded && error && (
        <p role="status" className="mt-2 text-xs leading-5 text-muted-foreground">
          Saved assignment context could not load. General chat is still available. Open this
          section to retry before asking about saved work.
        </p>
      )}
      {expanded && (
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-5 text-muted-foreground">
            Bring one assignment. Saving to a class is optional, and you can keep using the
            Companion on its own.
          </p>
          {loading ? (
            <p role="status" className="text-sm">
              Opening your saved work…
            </p>
          ) : (
            <fieldset
              disabled={disabled || busy || loadFailed}
              className="space-y-3 disabled:opacity-60"
            >
              {needsChatLink && (
                <p className="text-xs leading-5 text-muted-foreground">
                  Your previous chat was removed. Save this assignment to the current chat to keep
                  your work connected.
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium">
                  Assignment title
                  <input
                    value={draft.title}
                    maxLength={160}
                    onChange={(event) => edit("title", event.target.value)}
                    placeholder="e.g. Biology lab report"
                    className={fieldClass}
                  />
                </label>
                <label className="text-xs font-medium">
                  Save to a class{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                  <select
                    value={draft.courseId}
                    onChange={(event) => edit("courseId", event.target.value)}
                    className={fieldClass}
                  >
                    <option value="">Just this assignment</option>
                    {draft.courseId && !courses.some((course) => course.id === draft.courseId) && (
                      <option value={draft.courseId}>Class unavailable — choose another</option>
                    )}
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.course_code || course.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-xs font-medium">
                Instructions or the part you’re stuck on
                <textarea
                  value={draft.content}
                  onChange={(event) => edit("content", event.target.value)}
                  maxLength={12000}
                  rows={3}
                  placeholder="Paste the assignment instructions. Include the rubric if you have one."
                  className={fieldClass}
                />
              </label>
              <label className="block text-xs font-medium">
                Source link <span className="font-normal text-muted-foreground">(optional)</span>
                <input
                  type="url"
                  value={draft.sourceUrl}
                  onChange={(event) => edit("sourceUrl", event.target.value)}
                  maxLength={2000}
                  placeholder="https://…"
                  className={fieldClass}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                UniMate uses the instructions you save here. A link is a reference; its page is not
                read automatically.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!canTutor || conflict}
                  onClick={() => void ask("understand")}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {!item || dirty || needsChatLink ? "Save & understand" : "Understand assignment"}
                </button>
                <button
                  type="button"
                  disabled={!canTutor || conflict}
                  onClick={() => void ask("start")}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-semibold disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  {!item || dirty || needsChatLink ? "Save & get started" : "Help me start"}
                </button>
                {item && (
                  <button
                    type="button"
                    disabled={!canTutor || conflict}
                    onClick={() => void ask("resume")}
                    className="min-h-10 rounded-xl border border-border bg-background px-3 text-xs font-semibold disabled:opacity-50"
                  >
                    {dirty || needsChatLink ? "Save & pick up" : "Pick up where I left off"}
                  </button>
                )}
              </div>
              {!draft.content.trim() && (
                <p className="text-xs leading-5 text-muted-foreground">
                  You can save your progress now. Add the assignment instructions or the part you’re
                  stuck on above to use these tutoring actions.
                </p>
              )}
              <details
                className="rounded-xl border border-border/60 bg-background/70 p-3"
                open={Boolean(item?.progress || item?.nextStep)}
              >
                <summary className="cursor-pointer text-xs font-semibold">
                  Remember my progress
                </summary>
                <div className="mt-3 space-y-3">
                  <label className="block text-xs font-medium">
                    What I’ve done
                    <textarea
                      value={draft.progress}
                      onChange={(event) => edit("progress", event.target.value)}
                      maxLength={4000}
                      rows={2}
                      placeholder="e.g. Chose my argument and found two sources"
                      className={fieldClass}
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    My next step
                    <textarea
                      value={draft.nextStep}
                      onChange={(event) => edit("nextStep", event.target.value)}
                      maxLength={2000}
                      rows={2}
                      placeholder="e.g. Write the evidence paragraph"
                      className={fieldClass}
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    Assignment status
                    <select
                      value={draft.status}
                      onChange={(event) =>
                        edit("status", event.target.value as AssignmentDraft["status"])
                      }
                      className={fieldClass}
                    >
                      <option value="active">In progress</option>
                      <option value="done">Done</option>
                    </select>
                  </label>
                  <p className="text-xs text-muted-foreground">
                    This records your work here. It does not submit the assignment or change a
                    deadline on your timeline.
                  </p>
                </div>
              </details>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!canSave || conflict || Boolean(item && !dirty && !needsChatLink)}
                  onClick={() => void save()}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-semibold disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {busy ? "Saving…" : needsChatLink ? "Save to this chat" : "Save assignment"}
                </button>
                {dirty && (
                  <span className="text-xs text-amber-700 dark:text-amber-300">
                    Unsaved changes
                  </span>
                )}
              </div>
            </fieldset>
          )}
          {item?.sourceUrl && !dirty && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 items-center gap-1 font-semibold underline underline-offset-4"
              >
                <ExternalLink className="h-3 w-3" />
                Open saved source
              </a>
              <StudyResourceSave
                kind="link"
                initialTitle={item.sourceTitle || item.title}
                content=""
                sourceUrl={item.sourceUrl}
                courseId={item.courseId}
                conversationId={conversationId}
                triggerLabel="Save link to Bulletin"
                disabled={busy || disabled}
              />
            </div>
          )}
          {notice && (
            <p role="status" className="text-xs text-foreground">
              {notice}
            </p>
          )}
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5"
            >
              <p>{error}</p>
              <p>Your current edits stay here until you choose to reload or leave.</p>
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => {
                  if (
                    !dirty ||
                    window.confirm("Reload the saved assignment? This replaces your unsaved edits.")
                  )
                    void load();
                }}
                className="mt-2 min-h-9 font-semibold underline underline-offset-4"
              >
                Reload saved assignment
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
