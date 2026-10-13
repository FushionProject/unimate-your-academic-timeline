import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X, Camera, Loader2, Trash2, Send } from "lucide-react";
import { useAuth } from "../lib/auth-context";
import { LogoMark } from "./logo-mark";
import { useAssistantEnabled } from "../hooks/use-assistant-enabled";
import { useBillingStatus } from "../lib/profile";

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
  const billing = useBillingStatus();

  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>(
    [],
  );
  const requestRef = useRef<AbortController | null>(null);
  const captureRef = useRef(false);
  const generationRef = useRef(0);
  const isPro = billing.data?.isPro === true;

  useEffect(() => {
    setPhoto(null);
    setHistory([]);
    setAnswer(null);
    setConsent(false);
    setQuestion("");
    return () => {
      generationRef.current += 1;
      requestRef.current?.abort();
    };
  }, [user?.id]);

  useEffect(() => {
    if (!enabled || !isPro) {
      generationRef.current += 1;
      requestRef.current?.abort();
      setPhoto(null);
      setHistory([]);
      setAnswer(null);
      setConsent(false);
    }
  }, [enabled, isPro]);

  if (!enabled || !user) return null;

  async function grabFrame(stream: MediaStream): Promise<string> {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // Give the first frame a moment to paint before drawing.
    await new Promise((r) => setTimeout(r, 200));
    const canvas = document.createElement("canvas");
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const scale = Math.min(1, 1920 / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Screen capture is unavailable.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause();
    video.srcObject = null;
    return canvas.toDataURL("image/jpeg", 0.9);
  }

  async function handleCapture() {
    if (captureRef.current || asking || !isPro || !consent) return;
    captureRef.current = true;
    const generation = generationRef.current;
    setCapturing(true);
    setAnswer(null);
    let stream: MediaStream | null = null;
    try {
      const access = await billing.refetch();
      if (generation !== generationRef.current) return;
      if (access.error || access.data?.isPro !== true) {
        setAnswer({
          kind: "error",
          text: "We couldn’t confirm Pro access. Check your plan and try again.",
        });
        return;
      }
      if (!navigator.mediaDevices?.getDisplayMedia) {
        setAnswer({
          kind: "error",
          text: "Screen capture isn’t supported in this browser. Try a desktop browser that supports screen sharing.",
        });
        return;
      }
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const img = await grabFrame(stream);
      if (generation !== generationRef.current) return;
      setPhoto(img);
      setHistory([]);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") return;
      setAnswer({ kind: "error", text: "Couldn't capture that. Try again." });
    } finally {
      // Release immediately so the browser's "sharing your screen" banner
      // goes away — this is what makes it feel like a screenshot, not a share.
      stream?.getTracks().forEach((t) => t.stop());
      captureRef.current = false;
      setCapturing(false);
    }
  }

  function deletePhoto() {
    requestRef.current?.abort();
    setPhoto(null);
    setAnswer(null);
    setHistory([]);
  }

  async function handleAsk() {
    if (!photo || asking || !isPro || !consent || !session?.access_token) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = setTimeout(() => controller.abort("timeout"), 60_000);
    const submittedQuestion =
      question.trim() || "Help me understand this screenshot and suggest a useful next step.";
    setAsking(true);
    try {
      const res = await fetch("/api/analyze-screenshot", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
          "X-UniMate-Request-Id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          imageBase64: photo,
          question: submittedQuestion,
          chatHistory: history.slice(-12),
        }),
      });
      const data = await res.json().catch(() => null);
      if (controller.signal.aborted) return;

      if (res.status === 402 || (res.status === 403 && data?.code === "PRO_REQUIRED")) {
        setAnswer({
          kind: "error",
          text: "This is a UniMate Pro feature — visit /upgrade to unlock it.",
        });
      } else if (res.status === 401 || (!res.ok && data?.code === "AUTH_REQUIRED")) {
        setAnswer({
          kind: "error",
          text: "Your session expired. Refresh the page and sign in again.",
        });
      } else if (!res.ok) {
        setAnswer({
          kind: "error",
          text:
            data?.error ||
            "I couldn’t finish that just yet. Your screenshot and question are still here — try again.",
        });
      } else if (typeof data?.answer !== "string" || !data.answer.trim()) {
        setAnswer({ kind: "error", text: "I didn’t get a complete answer. Please try again." });
      } else {
        setAnswer({ kind: "answer", text: data.answer });
        setHistory((previous) =>
          [
            ...previous,
            { role: "user" as const, content: submittedQuestion },
            { role: "assistant" as const, content: data.answer },
          ].slice(-12),
        );
        setQuestion((current) => (current === question ? "" : current));
      }
    } catch {
      if (controller.signal.aborted && controller.signal.reason !== "timeout") return;
      setAnswer({
        kind: "error",
        text:
          controller.signal.reason === "timeout"
            ? "That took a little too long. Your question is still here — try again."
            : "Couldn't reach UniMate. Check your connection and try again.",
      });
    } finally {
      clearTimeout(timeout);
      requestRef.current = null;
      setAsking(false);
    }
  }

  return (
    <>
      {/* Floating dock button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="UniMate Study Assistant"
        aria-expanded={open}
        aria-controls="unimate-screen-assistant"
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
          id="unimate-screen-assistant"
          role="dialog"
          aria-label="Study Assistant"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          className="rounded-2xl border border-border/60 bg-card shadow-2xl"
          style={{
            position: "fixed",
            right: "20px",
            bottom: "84px",
            zIndex: 60,
            width: "min(380px, calc(100vw - 40px))",
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
            {!isPro ? (
              <div className="space-y-3 text-sm leading-6">
                <p className="font-semibold">A study buddy for what’s on your screen.</p>
                <p className="text-muted-foreground">
                  {billing.isLoading
                    ? "Checking your plan…"
                    : billing.isError
                      ? "We couldn’t check your plan. Try again to confirm access."
                      : "Screen help is included with Pro. Upgrade to share a screenshot and work through it together."}
                </p>
                <Link
                  to="/upgrade"
                  className="inline-flex rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground"
                >
                  Explore Pro
                </Link>
                <button
                  type="button"
                  disabled={billing.isFetching}
                  onClick={() => void billing.refetch()}
                  className="ml-3 underline disabled:opacity-50"
                >
                  Check access
                </button>
              </div>
            ) : !consent ? (
              <div className="space-y-3 text-sm leading-6">
                <p className="font-semibold">You choose what I can see.</p>
                <p className="text-muted-foreground">
                  Choose a tab or window to capture once. When you ask, your screenshot and question
                  are sent to UniMate and its AI provider. There’s no ongoing recording. Avoid
                  sharing private information you don’t need help with.
                </p>
                <button
                  type="button"
                  onClick={() => setConsent(true)}
                  className="w-full rounded-xl bg-primary px-4 py-2.5 font-semibold text-primary-foreground"
                >
                  Allow screenshots for this session
                </button>
              </div>
            ) : photo ? (
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
                    disabled={asking}
                    className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <textarea
                  value={question}
                  aria-label="Your question about this screenshot"
                  maxLength={4000}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={
                    history.length
                      ? "Ask a follow-up about this screenshot…"
                      : "What would you like help with?"
                  }
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
                    {asking
                      ? "Working through it…"
                      : answer?.kind === "error"
                        ? "Try again"
                        : "Ask UniMate"}
                  </button>
                  <button
                    onClick={handleCapture}
                    disabled={capturing || asking}
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
                  {capturing ? "Preparing your screenshot…" : "Choose a screen to share"}
                </button>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Opens your browser's screen picker — choose the tab, window, or screen to
                  snapshot. UniMate grabs one frame and stops immediately (no ongoing sharing).
                </p>
              </>
            )}

            {answer && (
              <div
                role={answer.kind === "error" ? "alert" : "status"}
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
