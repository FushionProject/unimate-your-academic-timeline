import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { Upload, FileText, Sparkles, Loader2 } from "lucide-react";
import { parseSyllabus } from "../functions/parse-syllabus";
import { extractPdfText } from "../lib/pdf";
import { ProtectedRoute } from "../components/protected-route";

export const Route = createFileRoute("/planner")({
  component: () => (
    <ProtectedRoute>
      <Planner />
    </ProtectedRoute>
  ),
});

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
      aria-pressed={active}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Planner() {
  const [tab, setTab] = useState<"pdf" | "text">("pdf");
  const [filename, setFilename] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pdfText, setPdfText] = useState("");
  const [extractingPdf, setExtractingPdf] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();

  const handlePdfFile = async (file: File) => {
    if (file.type !== "application/pdf") {
      setPdfError("Please choose a PDF file.");
      return;
    }
    setFilename(file.name);
    setPdfError("");
    setPdfText("");
    setExtractingPdf(true);
    try {
      const text = await extractPdfText(file);
      if (!text) {
        setPdfError("Couldn't find any text in that PDF — it may be a scanned image.");
      } else {
        setPdfText(text);
      }
    } catch (error) {
      console.error("Error extracting PDF text:", error);
      setPdfError("Failed to read that PDF. Please try another file.");
    } finally {
      setExtractingPdf(false);
    }
  };

  const handleMapSemester = async () => {
    const syllabusText = tab === "pdf" ? pdfText : textareaRef.current?.value || "";
    if (!syllabusText.trim()) {
      console.log("No syllabus text provided");
      return;
    }

    setLoading(true);
    try {
      const result = await parseSyllabus({ syllabusText });
      console.log("Parsed syllabus result:", result);
      navigate({
        to: "/results",
        search: { items: result.items, syllabusText },
      });
    } catch (error) {
      console.error("Error parsing syllabus:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-6 py-24">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">Upload Syllabus</h1>
          <p className="text-muted-foreground">
            Paste text for the fastest start, or upload a text-based PDF. You can review everything
            before saving it to your dashboard.
          </p>
        </div>

        <div className="relative">
          <div
            aria-hidden
            className="absolute -inset-8 rounded-[2rem] opacity-40 blur-3xl -z-10 animate-pulse-glow"
            style={{ background: "var(--gradient-primary)" }}
          />
          <div
            aria-hidden
            className="absolute -inset-px rounded-3xl -z-10 opacity-80"
            style={{
              background: "var(--gradient-primary)",
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
                <div>
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
                      if (f) handlePdfFile(f);
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
                      aria-label="Choose syllabus PDF"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handlePdfFile(f);
                      }}
                    />
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-secondary text-primary group-hover:scale-110 transition-transform">
                      {extractingPdf ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Upload className="h-5 w-5" />
                      )}
                    </div>
                    <p className="mt-4 text-sm font-medium text-foreground">
                      {extractingPdf ? "Reading PDF..." : filename || "Drop your PDF here"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {pdfText
                        ? `${pdfText.length.toLocaleString()} characters extracted`
                        : "or click to browse"}
                    </p>
                  </div>
                  {pdfError && <p className="mt-2 text-xs text-destructive">{pdfError}</p>}
                  {!pdfText && !extractingPdf && !pdfError && (
                    <p className="mt-3 text-center text-xs text-muted-foreground">
                      If your PDF is scanned or hard to read, switch to Paste text for a smoother
                      first run.
                    </p>
                  )}
                </div>
              ) : (
                <textarea
                  ref={textareaRef}
                  placeholder="Paste your syllabus text here..."
                  aria-label="Syllabus text"
                  className="w-full h-48 rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              )}

              <button
                onClick={handleMapSemester}
                disabled={loading || extractingPdf || (tab === "pdf" && !pdfText)}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed bg-[#F5C518] text-[#1a1a1a]"
              >
                {loading ? "Processing..." : "Map My Semester"}
                {!loading && <Sparkles className="h-4 w-4" />}
              </button>

              <p className="mt-3 text-center text-xs text-muted-foreground">
                Next step: review the timeline, then save the items to your{" "}
                <span className="font-medium text-foreground">Dashboard</span>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
