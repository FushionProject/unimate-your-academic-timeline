import { createFileRoute } from "@tanstack/react-router";
import { Plus, Globe, X, ExternalLink, Link2 } from "lucide-react";
import { useState, useEffect } from "react";
import { ProtectedRoute } from "../components/protected-route";
import { useAuth } from "../lib/auth-context";

export const Route = createFileRoute("/bulletin")({
  component: BulletinRoute,
});

function BulletinRoute() {
  const { user } = useAuth();
  return (
    <ProtectedRoute>
      <Bulletin key={user?.id ?? "signed-out"} />
    </ProtectedRoute>
  );
}

interface Link {
  id: string;
  title: string;
  url: string;
  classTag: string;
}

function readStoredLinks(value: unknown): Link[] {
  if (!Array.isArray(value)) throw new Error("Invalid saved links");
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid saved link");
    const link = entry as Record<string, unknown>;
    if (
      !["id", "title", "url", "classTag"].every(
        (field) => typeof link[field] === "string" && (link[field] as string).trim(),
      )
    )
      throw new Error("Invalid saved link");
    const parsed = new URL(link.url as string);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      seen.has(link.id as string)
    )
      throw new Error("Invalid saved link");
    seen.add(link.id as string);
    return {
      id: link.id as string,
      title: link.title as string,
      url: parsed.toString(),
      classTag: link.classTag as string,
    };
  });
}

function Bulletin() {
  const { user } = useAuth();
  const [links, setLinks] = useState<Link[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newLink, setNewLink] = useState({ title: "", url: "", classTag: "" });
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadedLinksKey, setLoadedLinksKey] = useState<string | null>(null);
  const [storageError, setStorageError] = useState("");
  const [savePending, setSavePending] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const storageKey = user ? `bulletinLinks:${user.id}` : null;
  const hasLoaded = Boolean(storageKey && loadedLinksKey === storageKey);

  useEffect(() => {
    setLoadedLinksKey(null);
    setLinks([]);
    setStorageError("");
    setSavePending(false);
    setNotice("");
    setFormError("");
    setIsModalOpen(false);
    setNewLink({ title: "", url: "", classTag: "" });
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey);
      // Ownerless legacy "bulletinLinks" data cannot safely be attributed to
      // this account. Never read, adopt, overwrite or delete it automatically.
      setLinks(saved === null ? [] : readStoredLinks(JSON.parse(saved)));
      setLoadedLinksKey(storageKey);
    } catch {
      setStorageError(
        "We couldn’t open your saved links. They have not been changed. Check browser storage permissions and try loading again; if this continues, contact support before clearing any data.",
      );
    }
  }, [storageKey, loadAttempt]);

  // Persist only intentional edits after this exact account finished loading.
  // Loading/normalizing never writes, including after a read or parse failure.
  const saveLinks = (next: Link[]) => {
    if (!storageKey || !hasLoaded) return false;
    setLinks(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageError("");
      setSavePending(false);
      return true;
    } catch {
      setSavePending(true);
      setStorageError(
        "Your changes are only in this tab because browser storage is unavailable. Keep this tab open, allow or free browser storage, then try saving again.",
      );
      return false;
    }
  };

  useEffect(() => {
    if (!isModalOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsModalOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isModalOpen]);

  const handleAddLink = () => {
    if (!hasLoaded) return;
    const title = newLink.title.trim();
    const classTag = newLink.classTag.trim();
    let url = newLink.url.trim();
    if (!title || !url || !classTag) {
      setFormError("Add a title, web address, and class.");
      return;
    }
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      const parsedUrl = new URL(url);
      if (
        !["http:", "https:"].includes(parsedUrl.protocol) ||
        parsedUrl.username ||
        parsedUrl.password
      )
        throw new Error();
      const saved = saveLinks([
        ...links,
        {
          id: crypto.randomUUID(),
          title,
          url: parsedUrl.toString(),
          classTag,
        },
      ]);
      setNewLink({ title: "", url: "", classTag: "" });
      setFormError("");
      setNotice(
        saved
          ? `${title} added to ${classTag}.`
          : `${title} added in this tab; saving still needs attention.`,
      );
      setIsModalOpen(false);
    } catch {
      setFormError("Enter a valid web address, like canvas.edu.");
    }
  };

  const handleDeleteLink = (id: string) => {
    if (!hasLoaded) return;
    const removed = links.find((link) => link.id === id);
    const saved = saveLinks(links.filter((link) => link.id !== id));
    setNotice(
      saved
        ? removed
          ? `${removed.title} removed.`
          : "Link removed."
        : "Removed in this tab; saving still needs attention.",
    );
  };

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const groupedLinks = new Map<string, Link[]>();
  for (const link of hasLoaded ? links : [])
    groupedLinks.set(link.classTag, [...(groupedLinks.get(link.classTag) ?? []), link]);

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
        <div className="mb-10 text-center sm:mb-12">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Class shortcuts
          </p>
          <h1 className="font-serif-display mb-4 text-4xl font-medium tracking-tight text-foreground sm:text-6xl">
            Bulletin Board
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Keep every class portal, reading, and resource within reach.
          </p>
          <p className="mt-3 text-xs font-medium text-muted-foreground">
            Saved in this browser for this UniMate account
          </p>
        </div>

        <div className="flex justify-center mb-8">
          <button
            onClick={() => setIsModalOpen(true)}
            disabled={!hasLoaded}
            className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-base font-bold transition-transform hover:scale-[1.02] active:scale-[0.98] bg-[#F5C518] text-[#1a1a1a]"
          >
            <Plus className="h-4 w-4" />
            Add link
          </button>
        </div>
        {storageError && (
          <div
            className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
            role="alert"
          >
            <p>{storageError}</p>
            <button
              type="button"
              className="mt-3 min-h-11 font-semibold underline underline-offset-4"
              onClick={() => {
                if (savePending && hasLoaded) {
                  if (saveLinks(links)) setNotice("Your links are saved in this browser.");
                } else setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              {savePending ? "Try saving again" : "Try loading again"}
            </button>
          </div>
        )}
        {hasLoaded && notice && (
          <p className="-mt-4 mb-6 text-center text-sm font-medium text-foreground" role="status">
            {notice}
          </p>
        )}

        {!hasLoaded ? (
          <p className="py-10 text-center text-sm text-muted-foreground" role="status">
            {storageError
              ? "Your saved board is protected until it can be loaded safely."
              : "Loading your links…"}
          </p>
        ) : groupedLinks.size === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-card/40 px-6 py-14 text-center">
            <Link2 className="mx-auto h-8 w-8 text-primary" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold text-foreground">Your board is ready</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Add Canvas, course readings, office hours, or any link you reach for each week.
            </p>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="mt-5 inline-flex min-h-11 items-center rounded-md px-2 text-sm font-semibold text-foreground underline decoration-primary decoration-2 underline-offset-4"
            >
              Add your first link
            </button>
          </div>
        ) : (
          <div className="space-y-8">
            {[...groupedLinks.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([classTag, classLinks]) => (
                <div key={classTag}>
                  <h2 className="font-serif-display text-2xl font-medium text-foreground mb-4">
                    {classTag}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {classLinks.map((link) => (
                      <div
                        key={link.id}
                        className="group relative rounded-2xl border border-border bg-card/70 p-4 shadow-[var(--shadow-card)] transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md"
                      >
                        <button
                          onClick={() => handleDeleteLink(link.id)}
                          aria-label={`Delete ${link.title}`}
                          title="Delete link"
                          className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground opacity-70 transition-colors hover:bg-destructive/10 hover:text-destructive focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive sm:h-9 sm:w-9 sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <div className="flex items-start gap-3 mb-3">
                          <div
                            className="h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: "var(--gradient-primary)" }}
                          >
                            <Globe className="h-4 w-4 text-[#1a1a1a]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-foreground text-sm truncate">
                              {link.title}
                            </h3>
                            <p className="text-xs text-muted-foreground">{classTag}</p>
                          </div>
                        </div>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 transition-colors bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                          Open
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </main>

      {hasLoaded && isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setIsModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-link-title"
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]"
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2
                  id="add-link-title"
                  className="font-serif-display text-2xl font-medium text-foreground"
                >
                  Add a class link
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  You can edit your board anytime.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close add link dialog"
                className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleAddLink();
              }}
            >
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="bulletin-title"
                    className="mb-2 block text-sm font-medium text-foreground"
                  >
                    Title
                  </label>
                  <input
                    id="bulletin-title"
                    type="text"
                    value={newLink.title}
                    onChange={(e) => setNewLink({ ...newLink, title: e.target.value })}
                    placeholder="Pearson login"
                    autoFocus
                    className="w-full rounded-lg border px-4 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary border-border bg-background"
                  />
                </div>
                <div>
                  <label
                    htmlFor="bulletin-url"
                    className="mb-2 block text-sm font-medium text-foreground"
                  >
                    Web address
                  </label>
                  <input
                    id="bulletin-url"
                    type="text"
                    inputMode="url"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={newLink.url}
                    onChange={(e) => setNewLink({ ...newLink, url: e.target.value })}
                    placeholder="canvas.instructure.com"
                    className="w-full rounded-lg border px-4 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary border-border bg-background"
                  />
                </div>
                <div>
                  <label
                    htmlFor="bulletin-class"
                    className="mb-2 block text-sm font-medium text-foreground"
                  >
                    Class
                  </label>
                  <input
                    id="bulletin-class"
                    type="text"
                    value={newLink.classTag}
                    onChange={(e) => setNewLink({ ...newLink, classTag: e.target.value })}
                    placeholder="MAT 121"
                    className="w-full rounded-lg border px-4 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary border-border bg-background"
                  />
                </div>
              </div>
              {formError && (
                <p className="mt-4 text-sm text-destructive" role="alert">
                  {formError}
                </p>
              )}
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="min-h-11 flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card/60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-11 flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Add link
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
