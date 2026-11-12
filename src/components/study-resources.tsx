import { useEffect, useRef, useState } from "react";
import { Link, useBlocker } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ExternalLink, RefreshCw } from "lucide-react";
import { useAuth } from "../lib/auth-context";
import {
  createStudyItem,
  deleteStudyItem,
  listStudyWorkspace,
  updateStudyItem,
  type StudyItem,
  type StudyItemInput,
} from "../lib/study-workspace";
import { studyInputSchema } from "../lib/study-workspace-model";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

type ResourceKind = "note" | "link";
export interface StudyResourceSaveProps {
  kind: ResourceKind;
  initialTitle?: string;
  content?: string;
  sourceUrl?: string | null;
  courseId?: string | null;
  conversationId?: string | null;
  triggerLabel?: string;
  disabled?: boolean;
}
const fieldClass =
  "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const buttonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50";
const destination = (kind: ResourceKind) => (kind === "note" ? "Notes" : "Bulletin Board");
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Saving didn’t finish. Your draft is still here. Try again.";

function useResourceList(userId: string, kind?: ResourceKind) {
  return useQuery({
    queryKey: ["study-workspace", userId, kind ?? "all"],
    queryFn: ({ signal }) =>
      listStudyWorkspace(kind ? { kind } : {}, { expectedUserId: userId, signal }),
    retry: false,
    staleTime: 15_000,
  });
}

/** Every save is reviewed by the student; model output cannot invoke this action. */
export function StudyResourceSave(props: StudyResourceSaveProps) {
  const { user } = useAuth();
  return user ? <ResourceSave key={user.id} {...props} userId={user.id} /> : null;
}

function ResourceSave(props: StudyResourceSaveProps & { userId: string }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(
    () => setSaved(false),
    [
      props.kind,
      props.initialTitle,
      props.content,
      props.sourceUrl,
      props.courseId,
      props.conversationId,
    ],
  );
  return (
    <>
      <button
        type="button"
        disabled={props.disabled}
        className={buttonClass}
        onClick={() => setOpen(true)}
      >
        {props.triggerLabel ?? `Save to ${destination(props.kind)}`}
      </button>
      {saved && (
        <p role="status" className="text-xs text-muted-foreground">
          Saved to your account.{" "}
          <Link to={props.kind === "note" ? "/notes" : "/bulletin"} className="underline">
            Open {destination(props.kind)}
          </Link>
        </p>
      )}
      {open && (
        <ResourceEditor
          userId={props.userId}
          initial={props}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setSaved(true);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function ResourceEditor({
  userId,
  initial,
  existing,
  onClose,
  onSaved,
}: {
  userId: string;
  initial: StudyResourceSaveProps;
  existing?: StudyItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useResourceList(userId);
  const [id] = useState(() => existing?.id ?? crypto.randomUUID());
  const [draft, setDraft] = useState(() => ({
    title: existing?.title ?? initial.initialTitle ?? "",
    content: existing?.content ?? initial.content ?? "",
    sourceUrl: existing?.sourceUrl ?? initial.sourceUrl ?? "",
    courseId: existing?.courseId ?? initial.courseId ?? "",
  }));
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const alive = useRef(true);
  const flight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  const dirty = baseline !== JSON.stringify(draft);
  const mayClose = () =>
    !pending && (!dirty || window.confirm("Discard the changes to this draft?"));
  useBlocker({
    disabled: !dirty && !pending,
    enableBeforeUnload: dirty || pending,
    shouldBlockFn: () =>
      pending ||
      (dirty && !window.confirm("Your draft has unsaved changes. Leave and discard them?")),
  });
  const set = (key: keyof typeof draft, value: string) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  async function save() {
    if (flight.current || conflict) return;
    const input: StudyItemInput = {
      id,
      kind: initial.kind,
      title: draft.title,
      content: draft.content,
      sourceUrl: draft.sourceUrl.trim() || null,
      courseId: draft.courseId || null,
      conversationId: existing?.conversationId ?? initial.conversationId ?? null,
      sourceTitle: existing?.sourceTitle ?? "",
    };
    const parsed = studyInputSchema.safeParse(input);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      setError(
        field === "title"
          ? "Add a title with no more than 160 characters."
          : field === "content"
            ? "Shorten this note to 12,000 characters before saving."
            : field === "sourceUrl"
              ? "Use a public http or https address without sign-in credentials."
              : field === "courseId"
                ? "Choose one of your saved classes, or leave this unassigned."
                : "Check the note or link before saving.",
      );
      return;
    }
    if (initial.kind === "link" && !parsed.data.sourceUrl) {
      setError("Add a web address for this link.");
      return;
    }
    flight.current = true;
    setPending(true);
    setError("");
    controller.current = new AbortController();
    const access = { expectedUserId: userId, signal: controller.current.signal };
    try {
      if (existing) {
        await updateStudyItem(
          id,
          existing.version,
          {
            title: parsed.data.title,
            content: parsed.data.content,
            sourceUrl: parsed.data.sourceUrl,
            courseId: parsed.data.courseId,
          },
          access,
        );
      } else await createStudyItem(parsed.data, access);
      if (!alive.current) return;
      setBaseline(JSON.stringify(draft));
      void queryClient.invalidateQueries({ queryKey: ["study-workspace", userId] });
      onSaved();
    } catch (cause) {
      if (!alive.current) return;
      setError(message(cause));
      if (cause && typeof cause === "object" && "status" in cause && cause.status === 409)
        setConflict(true);
    } finally {
      flight.current = false;
      if (alive.current) setPending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && mayClose()) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl">
        <DialogTitle>
          {existing
            ? `Edit ${initial.kind === "note" ? "note" : "saved link"}`
            : `Save to ${destination(initial.kind)}`}
        </DialogTitle>
        <DialogDescription>
          Review what you want to keep. Saved to this UniMate account; adding a class is optional.
        </DialogDescription>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <fieldset disabled={pending} className="space-y-4">
            <label className="block text-sm font-medium">
              Title
              <input
                required
                maxLength={160}
                className={fieldClass}
                value={draft.title}
                onChange={(event) => set("title", event.target.value)}
                autoFocus
              />
            </label>
            <label className="block text-sm font-medium">
              {initial.kind === "note" ? "Note" : "Why this link is useful"}
              <textarea
                rows={initial.kind === "note" ? 9 : 3}
                maxLength={12000}
                className={fieldClass}
                value={draft.content}
                onChange={(event) => set("content", event.target.value)}
              />
            </label>
            {draft.content.length > 12000 && (
              <p role="alert" className="text-sm text-destructive">
                This answer is longer than a note can hold. Shorten it to 12,000 characters before
                saving.
              </p>
            )}
            <label className="block text-sm font-medium">
              {initial.kind === "link" ? "Web address" : "Source link (optional)"}
              <input
                type="url"
                required={initial.kind === "link"}
                maxLength={2000}
                placeholder="https://…"
                className={fieldClass}
                value={draft.sourceUrl}
                onChange={(event) => set("sourceUrl", event.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              Class
              <select
                className={fieldClass}
                value={draft.courseId}
                onChange={(event) => set("courseId", event.target.value)}
              >
                <option value="">No class — keep it on its own</option>
                {draft.courseId &&
                  !query.data?.courses.some((course) => course.id === draft.courseId) && (
                    <option value={draft.courseId}>Previously selected class</option>
                  )}
                {query.data?.courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
          {error && (
            <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm">
              {error}
            </p>
          )}
          {conflict && (
            <p className="text-sm text-muted-foreground">
              Keep a copy of your edits, then close and refresh to open the latest saved version.
              Nothing has been overwritten.
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={pending}
              onClick={() => {
                if (mayClose()) onClose();
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`${buttonClass} bg-primary text-primary-foreground`}
              disabled={pending || conflict}
            >
              {pending ? "Saving…" : "Save to my account"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StudyResources({ kind }: { kind: ResourceKind }) {
  const { user } = useAuth();
  return user ? <ResourceList key={`${user.id}:${kind}`} userId={user.id} kind={kind} /> : null;
}

function ResourceList({ userId, kind }: { userId: string; kind: ResourceKind }) {
  const query = useInfiniteQuery({
    queryKey: ["study-workspace", userId, kind, "pages"],
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      listStudyWorkspace({ kind, offset: pageParam }, { expectedUserId: userId, signal }),
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    staleTime: 15_000,
    retry: false,
  });
  const data = query.data
    ? {
        items: [
          ...new Map(
            query.data.pages.flatMap((page) => page.items).map((item) => [item.id, item]),
          ).values(),
        ],
        courses: query.data.pages[0]?.courses ?? [],
      }
    : undefined;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<StudyItem | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  const items = (data?.items ?? []).filter((item) =>
    `${item.title} ${item.content}`.toLowerCase().includes(filter.toLowerCase()),
  );
  async function remove(item: StudyItem) {
    if (
      inFlight.current ||
      !window.confirm(`Delete “${item.title}” from your account? This cannot be undone.`)
    )
      return;
    inFlight.current = true;
    setRemoving(item.id);
    setError("");
    controller.current = new AbortController();
    try {
      await deleteStudyItem(item.id, item.version, {
        expectedUserId: userId,
        signal: controller.current.signal,
      });
      if (alive.current)
        await queryClient.invalidateQueries({ queryKey: ["study-workspace", userId] });
    } catch (cause) {
      if (alive.current) setError(message(cause));
    } finally {
      inFlight.current = false;
      if (alive.current) setRemoving(null);
    }
  }
  return (
    <section
      className="mb-8 rounded-3xl border border-border bg-card p-5 sm:p-7"
      aria-label={`Account ${destination(kind)}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-primary">
            WITH YOU ACROSS UNIMATE
          </p>
          <h2 className="mt-2 text-2xl font-semibold">
            {kind === "note" ? "Your saved notes" : "Your saved links"}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            {kind === "note"
              ? "Keep your own notes or save a helpful answer from Ask or Companion. Choose a note to discuss it with UniMate."
              : "Keep useful pages from your Companion or add a link here. Add a class whenever it helps."}
          </p>
        </div>
        <button
          type="button"
          aria-label="Refresh saved resources"
          className={buttonClass}
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>
      <div className="my-5 flex flex-wrap items-center gap-3">
        <StudyResourceSave
          kind={kind}
          triggerLabel={kind === "note" ? "New account note" : "Save a link"}
        />
        {kind === "note" && (
          <Link
            to="/ask"
            search={{
              prompt:
                "Help me make clear study notes. Ask what topic or material I want to work from before you start.",
            }}
            className={buttonClass}
          >
            <BookOpen className="h-4 w-4" />
            Draft with UniMate · Pro
          </Link>
        )}
        <input
          aria-label={`Search saved ${kind === "note" ? "notes" : "links"}`}
          placeholder="Search saved work"
          className={`${fieldClass} mt-0 sm:max-w-xs`}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading your saved work…
        </p>
      )}
      {(query.error || error) && (
        <p role="alert" className="mb-4 rounded-xl bg-destructive/10 p-3 text-sm">
          {error || message(query.error)}
        </p>
      )}
      {data && items.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          {filter
            ? "No saved items match that search."
            : kind === "note"
              ? "A helpful explanation is worth keeping. Save an answer to Notes, or write your first note here."
              : "Found a useful reading or assignment page? Save it here to find it again."}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <article key={item.id} className="min-w-0 rounded-2xl border border-border p-4">
            <h3 className="break-words font-semibold">{item.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {data?.courses.find((course) => course.id === item.courseId)?.name ?? "No class"} ·
              Saved {new Date(item.updatedAt).toLocaleDateString()}
            </p>
            {item.content && (
              <p className="mt-3 line-clamp-4 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                {item.content}
              </p>
            )}
            {item.sourceUrl && (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm underline"
              >
                Open source
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={buttonClass} onClick={() => setEditing(item)}>
                Open & edit
              </button>
              <Link to="/ask" search={{ resource: item.id }} className={buttonClass}>
                Discuss with UniMate
              </Link>
              <button
                type="button"
                className={`${buttonClass} text-muted-foreground`}
                disabled={removing !== null}
                onClick={() => void remove(item)}
              >
                {removing === item.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {query.hasNextPage && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-muted-foreground">
            Search covers the items loaded so far. Load older items to include them.
          </p>
          <button
            type="button"
            className={buttonClass}
            disabled={query.isFetching}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "Loading…" : "Load older items"}
          </button>
        </div>
      )}
      {editing && (
        <ResourceEditor
          key={`${editing.id}:${editing.version}`}
          userId={userId}
          existing={editing}
          initial={{ kind }}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </section>
  );
}
