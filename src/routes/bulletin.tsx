import { createFileRoute } from "@tanstack/react-router";
import { Plus, Globe, X, ExternalLink } from "lucide-react";
import { useTheme } from "../components/theme-provider";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/bulletin")({
  component: Bulletin,
});

interface Link {
  id: string;
  title: string;
  url: string;
  classTag: string;
}

function Bulletin() {
  const { theme } = useTheme();
  const [links, setLinks] = useState<Link[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newLink, setNewLink] = useState({ title: "", url: "", classTag: "" });

  useEffect(() => {
    const saved = localStorage.getItem("bulletinLinks");
    if (saved) {
      setLinks(JSON.parse(saved));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("bulletinLinks", JSON.stringify(links));
  }, [links]);

  const handleAddLink = () => {
    if (newLink.title && newLink.url && newLink.classTag) {
      setLinks([
        ...links,
        {
          id: Date.now().toString(),
          title: newLink.title,
          url: newLink.url,
          classTag: newLink.classTag,
        },
      ]);
      setNewLink({ title: "", url: "", classTag: "" });
      setIsModalOpen(false);
    }
  };

  const handleDeleteLink = (id: string) => {
    setLinks(links.filter((link) => link.id !== id));
  };

  const groupedLinks = links.reduce((acc, link) => {
    if (!acc[link.classTag]) {
      acc[link.classTag] = [];
    }
    acc[link.classTag].push(link);
    return acc;
  }, {} as Record<string, Link[]>);

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <main className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h1 className="font-serif-display text-5xl sm:text-6xl font-medium tracking-tight text-foreground mb-4">
            Bulletin Board
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Save links to everything you need for class — all in one place.
          </p>
        </div>

        <div className="flex justify-center mb-8">
          <button
            onClick={() => setIsModalOpen(true)}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-base font-bold transition-transform hover:scale-[1.02] active:scale-[0.98] ${theme === "light" ? "bg-[#F5C518] text-[#1a1a1a]" : "text-white animate-tri-gradient"}`}
            style={{
              backgroundImage: theme === "light" ? "none" : "linear-gradient(90deg, #FF006E, #00D4FF, #FF006E)",
              backgroundSize: "300% 100%",
              boxShadow: theme === "light" ? "none" : "0 0 30px rgba(255, 0, 110, 0.4), 0 0 80px rgba(0, 212, 255, 0.25)",
            }}
          >
            <Plus className="h-4 w-4" />
            Add New Link
          </button>
        </div>

        {Object.keys(groupedLinks).length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No links saved yet. Add your first link to get started!</p>
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(groupedLinks)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([classTag, classLinks]) => (
                <div key={classTag}>
                  <h2 className="font-serif-display text-2xl font-medium text-foreground mb-4">{classTag}</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {classLinks.map((link) => (
                      <div
                        key={link.id}
                        className="rounded-xl border p-4 border-border bg-card/60 shadow-[var(--shadow-card)] relative group"
                      >
                        <button
                          onClick={() => handleDeleteLink(link.id)}
                          className="absolute top-2 right-2 h-6 w-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card/80 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <div className="flex items-start gap-3 mb-3">
                          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#FF006E] to-[#00D4FF] flex items-center justify-center flex-shrink-0"
                            style={{
                              background: "linear-gradient(135deg, #FF006E, #00D4FF)",
                            }}
                          >
                            <Globe className="h-4 w-4 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-foreground text-sm truncate">{link.title}</h3>
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

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div
            className="rounded-2xl border p-6 w-full max-w-md border-border bg-card shadow-[var(--shadow-card)]"
          >
            <h2 className="font-serif-display text-2xl font-medium text-foreground mb-6">Add New Link</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Link Title</label>
                <input
                  type="text"
                  value={newLink.title}
                  onChange={(e) => setNewLink({ ...newLink, title: e.target.value })}
                  placeholder="e.g., Pearson Login"
                  className="w-full rounded-lg border px-4 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary border-border bg-background"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">URL</label>
                <input
                  type="url"
                  value={newLink.url}
                  onChange={(e) => setNewLink({ ...newLink, url: e.target.value })}
                  placeholder="https://..."
                  className="w-full rounded-lg border px-4 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary border-border bg-background"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Class Tag</label>
                <input
                  type="text"
                  value={newLink.classTag}
                  onChange={(e) => setNewLink({ ...newLink, classTag: e.target.value })}
                  placeholder="e.g., MAT 121, PSY 101"
                  className="w-full rounded-lg border px-4 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary border-border bg-background"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setIsModalOpen(false)}
                className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-card/60 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddLink}
                className="flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors bg-primary hover:bg-primary/90"
              >
                Add Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
