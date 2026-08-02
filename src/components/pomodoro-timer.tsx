import { useState, useEffect, useRef } from "react";
import { Timer, Play, Pause, RotateCcw, Clock } from "lucide-react";

type TimerMode = "focus" | "shortBreak" | "longBreak";

const MODES = {
  focus: { duration: 25 * 60, label: "Focus" },
  shortBreak: { duration: 5 * 60, label: "Break" },
  longBreak: { duration: 15 * 60, label: "Long break" },
};

const STUDY_QUOTES = [
  "The secret of getting ahead is getting started.",
  "Focus on being productive instead of busy.",
  "Small steps every day lead to big results.",
  "Your future is created by what you do today.",
  "Success is the sum of small efforts repeated daily.",
  "The only way to do great work is to love what you do.",
  "Discipline is choosing between what you want now and what you want most.",
  "Progress, not perfection.",
  "Start where you are. Use what you have. Do what you can.",
  "Believe you can and you're halfway there.",
];

type WebAudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

export function PomodoroTimer() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [mode, setMode] = useState<TimerMode>("focus");
  const [timeLeft, setTimeLeft] = useState(MODES.focus.duration);
  const [pomodorosCompleted, setPomodorosCompleted] = useState(0);
  const [celebration, setCelebration] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const playChime = () => {
    const AudioContextConstructor =
      window.AudioContext || (window as WebAudioWindow).webkitAudioContext;
    if (!AudioContextConstructor) return;
    const audioContext = new AudioContextConstructor();

    // Create a soft chime sound
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 880; // A5 note
    oscillator.type = "sine";

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 1);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const toggleTimer = () => {
    setIsRunning(!isRunning);
  };

  const resetTimer = () => {
    setIsRunning(false);
    setTimeLeft(MODES[mode].duration);
  };

  const switchMode = (newMode: TimerMode) => {
    setMode(newMode);
    setIsRunning(false);
    setTimeLeft(MODES[newMode].duration);
  };

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setIsRunning(false);
            playChime();

            if (mode === "focus") {
              setCelebration("Focus session complete — nice work. Take a real break.");
              setPomodorosCompleted((prev) => {
                const newCount = prev + 1;
                if (newCount % 4 === 0) {
                  switchMode("longBreak");
                } else {
                  switchMode("shortBreak");
                }
                return newCount;
              });
            } else {
              setCelebration("Break complete — ready when you are.");
              switchMode("focus");
            }

            return MODES[mode].duration;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning, mode]);

  useEffect(() => {
    if (!celebration) return;
    const timeout = window.setTimeout(() => setCelebration(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [celebration]);

  useEffect(() => {
    if (!isExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isExpanded]);

  return (
    <div className="fixed bottom-24 right-4 z-50 sm:bottom-20">
      {/* Collapsed State */}
      {!isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          aria-label="Open focus timer"
          aria-expanded="false"
          aria-controls="pomodoro-panel"
          title="Focus timer"
          className="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg hover:scale-110 transition-transform"
        >
          <Timer className="h-5 w-5" />
        </button>
      )}

      {/* Expanded State */}
      {isExpanded && (
        <div
          id="pomodoro-panel"
          role="region"
          aria-label="Focus timer"
          className="bg-background border border-border/60 rounded-2xl shadow-2xl w-72 overflow-hidden"
        >
          {/* Header */}
          <div className="p-4 border-b border-border/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Focus timer</span>
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              aria-label="Close focus timer"
              className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors"
            >
              ×
            </button>
          </div>

          {/* Mode Selection */}
          <div className="p-3">
            <div className="grid grid-cols-3 gap-2">
              {(["focus", "shortBreak", "longBreak"] as TimerMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  aria-pressed={mode === m}
                  className={`p-2 rounded-lg text-xs font-medium transition-colors ${
                    mode === m
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-card/60 text-muted-foreground"
                  }`}
                >
                  {MODES[m].label}
                </button>
              ))}
            </div>
          </div>

          {/* Timer Display */}
          <div className="px-4 py-6 text-center">
            <div
              role="timer"
              aria-label={`${MODES[mode].label}: ${formatTime(timeLeft)} remaining`}
              className="text-5xl font-bold text-foreground mb-2 font-mono tabular-nums"
            >
              {formatTime(timeLeft)}
            </div>
            <div className="text-sm text-muted-foreground">{MODES[mode].label}</div>
          </div>

          {/* Pomodoros Counter */}
          <div className="px-4 py-2 border-t border-border/60 text-center">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>
                {pomodorosCompleted} {pomodorosCompleted === 1 ? "session" : "sessions"} completed
              </span>
            </div>
            {celebration && (
              <p className="mt-2 text-xs font-medium text-primary" role="status" aria-live="polite">
                {celebration}
              </p>
            )}
          </div>

          {/* Controls */}
          <div className="p-4 border-t border-border/60 flex items-center justify-center gap-3">
            <button
              onClick={resetTimer}
              aria-label="Reset timer"
              title="Reset timer"
              className="h-10 w-10 rounded-full border border-border text-muted-foreground flex items-center justify-center hover:bg-card/60 transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              onClick={toggleTimer}
              aria-label={isRunning ? "Pause timer" : "Start timer"}
              title={isRunning ? "Pause timer" : "Start timer"}
              className="h-12 w-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors"
            >
              {isRunning ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
