import { useState } from "react";
import { X, Camera, Loader2, Trash2, Send } from "lucide-react";
import { useAuth } from "../lib/auth-context";
import { LogoMark } from "./logo-mark";
import { useAssistantEnabled } from "../hooks/use-assistant-enabled";

type Answer = { text: string; kind: "answer" | "error" };

// A Cluely-style floating assistant on every UniMate page. A web page can't
// silently screenshot the screen (no such browser API — it would be a security
// hole), and it can't read other sites directly (same-origin policy). So this
// uses getDisplayMedia to grab ONE frame of a tab/window/screen the user picks,
// then immediately releases the stream — so it behaves like taking a screenshot
// rather than an ongoing screen-share (no persistent "sharing" banner). The
// captured photo persists so the user can delete it or ask multiple questions
// about the same shot without re-capturing.
export function ScreenAssistant() {
  const { user, session } = useAuth();
  const { enabled } = useAssistantEnabled();

  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  if (!enabled || !user) return null;

  async function grabFrame(stream: MediaStream): Promise<string> {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // Give the first frame a moment to paint before drawing.
    await new Promise((r) => setTimeout(r, 200));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause();
    video.srcObject = null;
    return canvas.toDataURL("image/png");
  }

  async function handleCapture() {
    if (capturing) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch {
      return; // user dismissed the picker — nothing to do
    }
    setCapturing(true);
    setAnswer(null);
    try {
      const img = await grabFrame(stream);
      setPhoto(img);
    } catch {
      setAnswer({ kind: "error", text: "Couldn't capture that. Try again." });
    } finally {
      // Release immediately so the browser's "sharing your screen" banner
      // goes away — this is what makes it feel like a screenshot, not a share.
      stream.getTracks().forEach((t) => t.stop());
      setCapturing(false);
    }
  }

  function deletePhoto() {
    setPhoto(null);
    setAnswer(null);
  }

  async function handleAsk() {
    if (!photo || asking) return;
    setAsking(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/analyze-screenshot", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ imageBase64: photo, question }),
      });
      const data = await res.json();

      if (res.status === 402) {
        setAnswer({
          kind: "error",
          text: "This is a UniMate Pro feature — visit /upgrade to unlock it.",
        });
      } else if (res.status === 401) {
        setAnswer({
          kind: "error",
          text: "Your session expired. Refresh the page and sign in again.",
        });
      } else if (!res.ok) {
        setAnswer({ kind: "error", text: data.error || "Something went wrong. Try again." });
      } else {
        setAnswer({ kind: "answer", text: data.answer });
      }
    } catch {
      setAnswer({
        kind: "error",
        text: "Couldn't reach UniMate. Check your connection and try again.",
      });
    } finally {
      setAsking(false);
    }
  }

  return (
    <>
      {/* Floating dock button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="UniMate Study Assistant"
        style={{
          position: "fixed",
          right: "20px",
          bottom: "20px",
          zIndex: 60,
          height: "52px",
          width: "52px",
          borderRadius: "16px",
          border: "none",
          cursor: "pointer",
          background: "var(--gradient-primary)",
          boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <LogoMark className="h-8 w-8" />
      </button>

      {/* Panel */}
      {open && (
        <div
          className="rounded-2xl border border-border/60 bg-card shadow-2xl"
          style={{
            position: "fixed",
            right: "20px",
            bottom: "84px",
            zIndex: 60,
            width: "340px",
            maxHeight: "70vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ background: "var(--gradient-primary)", color: "var(--primary-foreground)" }}
          >
            <span className="text-sm font-bold">Study Assistant</span>
            <button onClick={() => setOpen(false)} aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto p-4">
            {photo ? (
              <>
                {/* Captured photo with a delete control */}
                <div className="relative">
                  <img
                    src={photo}
                    alt="Captured screen"
                    className="w-full rounded-lg border border-border"
                  />
                  <button
                    onClick={deletePhoto}
                    aria-label="Delete photo"
                    className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask about this screenshot (optional)..."
                  className="w-full resize-none rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  rows={2}
                />

                <div className="flex gap-2">
                  <button
                    onClick={handleAsk}
                    disabled={asking}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {asking ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {asking ? "Thinking..." : "Ask"}
                  </button>
                  <button
                    onClick={handleCapture}
                    disabled={capturing}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-foreground hover:bg-secondary/40 disabled:opacity-50"
                  >
                    <Camera className="h-4 w-4" />
                    Retake
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  onClick={handleCapture}
                  disabled={capturing}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {capturing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                  {capturing ? "Capturing..." : "Capture Screen"}
                </button>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Opens your browser's screen picker — choose the tab, window, or screen to
                  snapshot. UniMate grabs one frame and stops immediately (no ongoing sharing).
                </p>
              </>
            )}

            {answer && (
              <div
                className={`rounded-lg border p-3 text-sm leading-relaxed ${
                  answer.kind === "error"
                    ? "border-destructive/30 bg-destructive/5 text-destructive"
                    : "border-border/60 bg-secondary/30 text-foreground"
                }`}
                style={{ whiteSpace: "pre-wrap" }}
              >
                {answer.text}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
