import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import {
  Send,
  ExternalLink,
  Plus,
  History,
  Sparkles,
  Trash2,
  MonitorCheck,
  MessageSquarePlus,
  LoaderCircle,
  LockKeyhole,
  BookOpen,
  CalendarDays,
  PenLine,
  ListChecks,
  GraduationCap,
  ArrowUpRight,
} from "lucide-react";
import { askUniMate, UniMateApiError } from "../functions/ask-unimate";
import ReactMarkdown from "react-markdown";
import { LogoMark } from "../components/logo-mark";
import { useCourses, useAssignments } from "../lib/courses";
import { PRO_PLAN } from "../lib/plan-catalog";
import { ProtectedRoute } from "../components/protected-route";
import { useAuth } from "../lib/auth-context";
import { useBillingStatus } from "../lib/profile";
import { getCompanionAccessState } from "../lib/companion-store";
import {
  createCompanionConversation,
  deleteCompanionConversation,
  loadCompanionChats,
  loadConversationDashboard,
  saveCompanionExchange,
  setBrowserConversation,
  type CompanionConversation,
} from "../lib/companion-chats";

export const Route = createFileRoute("/ask")({
  validateSearch: (search: Record<string, unknown>): { prompt?: string; course?: string } => ({
    prompt: typeof search.prompt === "string" ? search.prompt.slice(0, 4000) : undefined,
    course: typeof search.course === "string" ? search.course.slice(0, 100) : undefined,
  }),
  component: () => (
    <ProtectedRoute>
      <AskAccessGate />
    </ProtectedRoute>
  ),
});

function AskAccessGate() {
  const billing = useBillingStatus();
  const access = getCompanionAccessState(billing);

  if (access === "checking") {
    return (
      <main className="grid min-h-[calc(100vh-73px)] place-items-center bg-background px-4">
        <div className="text-center" role="status" aria-live="polite">
          <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-foreground">Checking your UniMate plan…</p>
        </div>
      </main>
    );
  }

  // A failed plan check is not "not Pro" — never show a paying student the
  // upgrade paywall because of a transient billing outage.
  if (access === "unknown") {
    return (
      <main className="grid min-h-[calc(100vh-73px)] place-items-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            We couldn't check your UniMate plan
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground" role="alert">
            Your account and plan are unchanged — this is a temporary connection problem. Try again
            in a moment.
          </p>
          <button
            type="button"
            disabled={billing.isFetching}
            onClick={() => void billing.refetch()}
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:brightness-95"
          >
            {billing.isFetching ? "Checking your plan…" : "Try again"}
          </button>
        </div>
      </main>
    );
  }

  if (access === "free") return <AskProIntroduction />;
  return <Ask />;
}

function AskProIntroduction() {
  return (
    <main className="min-h-[calc(100vh-73px)] bg-background px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-4xl">
        <header className="text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary">
            <Sparkles className="h-6 w-6 text-primary-foreground" aria-hidden="true" />
          </div>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-primary">
            Meet Ask UniMate
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Big school day? Let’s figure it out together.
          </h1>
          <p className="mx-auto mt-3 max-w-2xl leading-7 text-muted-foreground">
            The concept that won’t click. The essay you can’t start. The week that feels like too
            much. Bring it here, and leave with a clearer next step.
          </p>
        </header>

        <section className="mt-8 grid overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-card)] md:grid-cols-[1fr_0.78fr]">
          <div className="p-6 sm:p-8">
            <h2 className="text-xl font-semibold">A little backup, across your school day</h2>
            <ol className="mt-6 space-y-5">
              <ProStep number="1" title="Make it make sense">
                Break down a concept, work through an example, or practice with questions at your
                pace.
              </ProStep>
              <ProStep number="2" title="Turn a busy week into a plan">
                Use your saved courses and deadlines to choose what comes next and build a realistic
                study session.
              </ProStep>
              <ProStep number="3" title="Find your words">
                Get thoughtful feedback on your draft, organize your argument, and keep your own
                voice.
              </ProStep>
            </ol>
          </div>

          <aside className="border-t border-border bg-secondary/45 p-6 sm:p-8 md:border-l md:border-t-0">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-background">
              <LockKeyhole className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h2 className="mt-4 font-semibold">Included with UniMate Pro</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {PRO_PLAN.textMonthly} AI messages each calendar month, shared across Ask and the
              Browser Companion. Your saved courses help keep the conversation relevant.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Link
                to="/upgrade"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                Get UniMate Pro · {PRO_PLAN.monthlyPrice}/month
              </Link>
              <Link
                to="/pricing"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-semibold"
              >
                Compare plans and allowances
              </Link>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Start right here. No extension needed. Cancel anytime.
            </p>
          </aside>
        </section>
      </div>
    </main>
  );
}

function ProStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {number}
      </span>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

interface Message {
  id: string;
  type: "user" | "ai";
  content: string;
  sources?: {
    title: string;
    link: string;
    snippet: string;
  }[];
  relatedConcepts?: string[];
  createdAt?: string;
  grounding?: { label: string; detail: string };
}

const starterPrompts = [
  {
    title: "Make it click",
    detail: "Explain a tricky concept",
    icon: BookOpen,
    prompt:
      "Help me understand a concept I'm stuck on. Ask me what topic I'm studying, then explain it with an example.",
  },
  {
    title: "Plan my time",
    detail: "Make room for the real world",
    icon: CalendarDays,
    prompt:
      "Help me plan a realistic 45-minute study session using my saved assignments. If you need more context, ask me.",
  },
  {
    title: "Quiz me",
    detail: "Practice, one question at a time",
    icon: GraduationCap,
    prompt:
      "Help me practice for an exam. Ask me the topic and level, then quiz me one question at a time with feedback.",
  },
  {
    title: "Read my draft",
    detail: "Feedback that keeps my voice",
    icon: PenLine,
    prompt:
      "I'd like feedback on a draft. Ask me to paste it and share the assignment requirements, then help me improve it without rewriting it for me.",
  },
  {
    title: "Find my next step",
    detail: "Sort through what's due",
    icon: ListChecks,
    prompt:
      "Help me decide what to work on next from my saved deadlines. Tell me what's urgent and suggest one manageable first step.",
  },
];

function Ask() {
  const search = Route.useSearch();
  const [question, setQuestion] = useState(search.prompt || "");
  const [selectedCourseId, setSelectedCourseId] = useState(search.course || "");
  const [sendError, setSendError] = useState<{
    message: string;
    question: string;
    mode: "normal" | "simpler" | "deeper";
    retryable: boolean;
  } | null>(null);
  const [usage, setUsage] = useState<{ used: number; limit: number; period: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyNotice, setHistoryNotice] = useState("");
  const [conversationNotice, setConversationNotice] = useState("");
  const [conversations, setConversations] = useState<CompanionConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [activeBrowserConversationId, setActiveBrowserConversationId] = useState<string | null>(
    null,
  );
  const [conversationBusy, setConversationBusy] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const questionInputRef = useRef<HTMLTextAreaElement>(null);
  const historyRequestRef = useRef(0);
  const activeUserIdRef = useRef<string | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const localMessageIdsRef = useRef(new Set<string>());
  const sendingRef = useRef(false);
  const { user } = useAuth();
  const { data: courses = [], isError: coursesError, isLoading: coursesLoading } = useCourses();
  const { data: assignments = [] } = useAssignments();
  const userId = user?.id ?? null;
  const selectedCourse = courses.find((course) => course.id === selectedCourseId);
  const upcomingCount = assignments.filter(
    (assignment) =>
      !assignment.completed && (!selectedCourse || assignment.course_id === selectedCourse.id),
  ).length;

  useEffect(() => {
    if (search.prompt) setQuestion(search.prompt);
    setSelectedCourseId(search.course || "");
    setSendError(null);
  }, [search.prompt, search.course]);

  activeUserIdRef.current = userId;
  selectedConversationIdRef.current = selectedConversationId;

  const refreshSharedHistory = useCallback(async () => {
    if (!userId || !selectedConversationId) return;
    const requestedUserId = userId;
    const requestNumber = ++historyRequestRef.current;
    setHistoryLoading(true);
    setHistoryNotice("");
    try {
      const rows = await loadCompanionChats(userId, selectedConversationId);
      if (
        requestNumber !== historyRequestRef.current ||
        activeUserIdRef.current !== requestedUserId ||
        selectedConversationIdRef.current !== selectedConversationId
      ) {
        return;
      }
      const sharedMessages = rows.map(
        (row) =>
          ({
            id: row.id,
            type: row.role === "user" ? "user" : "ai",
            content: row.message,
            createdAt: row.created_at,
          }) satisfies Message,
      );
      setMessages((current) => {
        const localMessages = current.filter((message) =>
          localMessageIdsRef.current.has(message.id),
        );
        return [...sharedMessages, ...localMessages];
      });
    } catch {
      if (
        requestNumber === historyRequestRef.current &&
        activeUserIdRef.current === requestedUserId
      ) {
        setHistoryNotice("Shared Companion history is temporarily unavailable.");
      }
    } finally {
      if (
        requestNumber === historyRequestRef.current &&
        activeUserIdRef.current === requestedUserId
      ) {
        setHistoryLoading(false);
      }
    }
  }, [selectedConversationId, userId]);

  const refreshConversationDashboard = useCallback(async () => {
    if (!userId) return;
    setConversationBusy(true);
    setHistoryNotice("");
    try {
      let dashboard = await loadConversationDashboard(userId);
      if (activeUserIdRef.current !== userId) return;
      if (dashboard.conversations.length === 0) {
        const firstConversation = await createCompanionConversation(userId, "My first chat");
        await setBrowserConversation(userId, firstConversation.id);
        dashboard = {
          conversations: [firstConversation],
          activeBrowserConversationId: firstConversation.id,
        };
      }
      if (activeUserIdRef.current !== userId) return;
      setConversations(dashboard.conversations);
      setActiveBrowserConversationId(dashboard.activeBrowserConversationId);
      setSelectedConversationId((current) =>
        current && dashboard.conversations.some((item) => item.id === current)
          ? current
          : dashboard.activeBrowserConversationId || dashboard.conversations[0]?.id || null,
      );
    } catch {
      setHistoryNotice("Your conversation dashboard is temporarily unavailable.");
      setHistoryLoading(false);
    } finally {
      setConversationBusy(false);
    }
  }, [userId]);

  // Ask UniMate and the Browser Companion share the same authenticated chat log.
  useEffect(() => {
    if (!userId) {
      historyRequestRef.current += 1;
      localMessageIdsRef.current.clear();
      setMessages([]);
      setConversations([]);
      setSelectedConversationId(null);
      setActiveBrowserConversationId(null);
      setHistoryLoading(false);
      return;
    }
    localMessageIdsRef.current.clear();
    void refreshConversationDashboard();
  }, [userId, refreshConversationDashboard]);

  useEffect(() => {
    historyRequestRef.current += 1;
    localMessageIdsRef.current.clear();
    setMessages([]);
    setSendError(null);
    if (selectedConversationId) void refreshSharedHistory();
  }, [selectedConversationId, refreshSharedHistory]);

  const handleCreateConversation = async () => {
    if (!userId || conversationBusy || loading) return;
    setConversationBusy(true);
    setConversationNotice("Creating a new chat…");
    setHistoryNotice("");
    try {
      const conversation = await createCompanionConversation(
        userId,
        `Chat ${new Date().toLocaleDateString([], { month: "short", day: "numeric" })} ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
      );
      setConversations((current) => [conversation, ...current]);
      setSelectedConversationId(conversation.id);
      if (!activeBrowserConversationId) {
        await setBrowserConversation(userId, conversation.id);
        setActiveBrowserConversationId(conversation.id);
      }
      setConversationNotice(
        activeBrowserConversationId
          ? "New chat created. Choose “Use in browser” to make it the extension’s active chat."
          : "New chat created and selected for the Browser Companion.",
      );
    } catch {
      setConversationNotice("");
      setHistoryNotice("A new conversation could not be created.");
    } finally {
      setConversationBusy(false);
    }
  };

  const handleDeleteConversation = async (conversation: CompanionConversation) => {
    if (!userId || conversationBusy || loading) return;
    if (!window.confirm(`Delete “${conversation.title}” and all of its messages?`)) return;
    setConversationBusy(true);
    setConversationNotice("Deleting chat…");
    try {
      await deleteCompanionConversation(userId, conversation.id);
      const remaining = conversations.filter((item) => item.id !== conversation.id);
      let next = remaining[0] || null;
      if (!next) {
        next = await createCompanionConversation(userId);
        remaining.push(next);
      }
      setConversations(remaining);
      if (selectedConversationId === conversation.id) setSelectedConversationId(next.id);
      if (activeBrowserConversationId === conversation.id) {
        await setBrowserConversation(userId, next.id);
        setActiveBrowserConversationId(next.id);
      }
      setConversationNotice(
        activeBrowserConversationId === conversation.id
          ? "Chat deleted. The extension was moved to the next available chat."
          : "Chat deleted.",
      );
    } catch {
      setConversationNotice("");
      setHistoryNotice("The conversation could not be deleted.");
      await refreshConversationDashboard();
    } finally {
      setConversationBusy(false);
    }
  };

  const handleUseInBrowser = async (conversationId: string) => {
    if (!userId || conversationBusy) return;
    setConversationBusy(true);
    setConversationNotice("Selecting this chat for the Companion…");
    try {
      await setBrowserConversation(userId, conversationId);
      setActiveBrowserConversationId(conversationId);
      setConversationNotice("Selected. The installed Companion will open this chat.");
    } catch {
      setConversationNotice("");
      setHistoryNotice("The browser conversation could not be changed.");
    } finally {
      setConversationBusy(false);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!conversationNotice) return;
    const timeout = window.setTimeout(() => setConversationNotice(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [conversationNotice]);

  const getConversationHistory = () => {
    return messages.map((msg) => ({
      role: msg.type === "user" ? ("user" as const) : ("assistant" as const),
      content: msg.content,
    }));
  };

  const handleSend = async (
    overrideQuestion?: string,
    mode: "normal" | "simpler" | "deeper" = "normal",
  ) => {
    const questionToSend = (overrideQuestion || question).trim();
    if (
      !questionToSend ||
      sendingRef.current ||
      historyLoading ||
      !selectedConversationId ||
      (selectedCourseId && !selectedCourse)
    )
      return;
    sendingRef.current = true;

    const requestUserId = userId;
    const requestConversationId = selectedConversationId;

    const userMessage: Message = {
      id: `local-user-${crypto.randomUUID()}`,
      type: "user",
      content: questionToSend,
    };
    localMessageIdsRef.current.add(userMessage.id);

    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setLoading(true);
    setSendError(null);

    try {
      const result = await askUniMate({
        question: questionToSend,
        conversationHistory: getConversationHistory(),
        mode,
        selectedCourseId: selectedCourse?.id,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (
        activeUserIdRef.current !== requestUserId ||
        selectedConversationIdRef.current !== requestConversationId
      )
        return;
      if (result.usage) setUsage(result.usage);
      const aiMessage: Message = {
        id: `local-ai-${crypto.randomUUID()}`,
        type: "ai",
        content: result.answer,
        sources: result.webResults,
        relatedConcepts: result.relatedConcepts || [],
        grounding: result.grounding,
      };
      localMessageIdsRef.current.add(aiMessage.id);
      setMessages((prev) => [...prev, aiMessage]);
      window.setTimeout(() => questionInputRef.current?.focus(), 0);

      if (requestUserId) {
        try {
          const savedRows = await saveCompanionExchange(
            requestUserId,
            requestConversationId,
            questionToSend,
            result.answer,
          );
          if (
            activeUserIdRef.current !== requestUserId ||
            selectedConversationIdRef.current !== requestConversationId
          )
            return;
          const savedUser = savedRows.find((row) => row.role === "user");
          const savedAssistant = savedRows.find((row) => row.role === "assistant");
          if (savedUser) localMessageIdsRef.current.delete(userMessage.id);
          if (savedAssistant) localMessageIdsRef.current.delete(aiMessage.id);
          setMessages((prev) =>
            prev.map((message) => {
              if (message.id === userMessage.id && savedUser) {
                return { ...message, id: savedUser.id, createdAt: savedUser.created_at };
              }
              if (message.id === aiMessage.id && savedAssistant) {
                return { ...message, id: savedAssistant.id, createdAt: savedAssistant.created_at };
              }
              return message;
            }),
          );
          setHistoryNotice("");
        } catch {
          if (activeUserIdRef.current === requestUserId) {
            setHistoryNotice(
              "Your answer is ready, but this exchange could not be added to shared history.",
            );
          }
        }
      }
    } catch (error) {
      if (
        activeUserIdRef.current !== requestUserId ||
        selectedConversationIdRef.current !== requestConversationId
      )
        return;
      localMessageIdsRef.current.delete(userMessage.id);
      setMessages((current) => current.filter((message) => message.id !== userMessage.id));
      setQuestion((current) => current || questionToSend);
      setSendError({
        question: questionToSend,
        mode,
        retryable: !(error instanceof UniMateApiError) || error.retryable,
        message:
          error instanceof Error
            ? error.message
            : "I couldn't finish that response. Your question is saved below — let's try again.",
      });
    } finally {
      sendingRef.current = false;
      if (activeUserIdRef.current === requestUserId) setLoading(false);
    }
  };

  const getQuestionForAnswer = (answerIndex: number) => {
    for (let index = answerIndex - 1; index >= 0; index -= 1) {
      if (messages[index].type === "user") return messages[index].content;
    }
    return "";
  };

  const handleConceptClick = (concept: string) => handleSend(concept, "normal");

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-10rem)] max-w-7xl flex-col px-3 py-5 sm:px-6 sm:py-7">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <LogoMark className="h-10 w-10" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Ask UniMate</h1>
            <p className="text-xs text-muted-foreground">Your school day, with a little backup.</p>
          </div>
        </div>
        <Link
          to="/upgrade"
          className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-foreground"
        >
          Pro ·{" "}
          {usage && usage.limit > 0
            ? `${Math.max(0, usage.limit - usage.used)} messages left this month`
            : `${PRO_PLAN.textMonthly} messages / month`}
        </Link>
      </header>
      <div className="flex min-h-[38rem] w-full flex-1 overflow-hidden rounded-3xl border border-border/60 bg-card/50 shadow-[var(--shadow-card)]">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-border/60 bg-card/50 md:flex">
          <div className="flex items-center justify-between border-b border-border/60 p-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Your chats</p>
              <p className="text-xs text-muted-foreground">Pick up where you left off</p>
            </div>
            <button
              type="button"
              onClick={handleCreateConversation}
              disabled={conversationBusy || loading}
              className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
              aria-label="Create a new conversation"
              title="New conversation"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {conversationNotice && (
              <p
                className="rounded-lg bg-primary/10 px-2.5 py-2 text-xs text-foreground"
                role="status"
                aria-live="polite"
              >
                {conversationNotice}
              </p>
            )}
            {conversations.map((conversation) => {
              const selected = conversation.id === selectedConversationId;
              const activeInBrowser = conversation.id === activeBrowserConversationId;
              return (
                <div
                  key={conversation.id}
                  className={`group rounded-xl border p-2 transition ${
                    selected
                      ? "border-primary/40 bg-primary/10"
                      : "border-transparent hover:border-border hover:bg-card"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedConversationId(conversation.id)}
                    disabled={loading}
                    className="w-full truncate rounded-md px-1 py-1 text-left text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                    aria-current={selected ? "true" : undefined}
                    title={conversation.title}
                  >
                    {conversation.title}
                  </button>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleUseInBrowser(conversation.id)}
                      disabled={conversationBusy || activeInBrowser}
                      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium ${
                        activeInBrowser
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:text-foreground"
                      }`}
                      aria-label={`${activeInBrowser ? "Currently selected" : "Select"} ${conversation.title} for Browser Companion`}
                    >
                      <MonitorCheck className="h-3 w-3" />
                      {activeInBrowser ? "In browser" : "Use in browser"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteConversation(conversation)}
                      disabled={conversationBusy || loading}
                      className="rounded-lg p-1.5 text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                      aria-label={`Delete ${conversation.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-border/60 p-4">
            <p className="text-xs leading-5 text-muted-foreground">
              Want help beside your coursework?
            </p>
            <Link
              to="/companion-setup"
              className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-foreground"
            >
              Set up Browser Companion <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 md:hidden">
            <select
              value={selectedConversationId || ""}
              disabled={loading}
              onChange={(event) => setSelectedConversationId(event.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm"
              aria-label="Choose conversation"
            >
              {conversations.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.title}
                  {conversation.id === activeBrowserConversationId ? " · In browser" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleCreateConversation}
              disabled={conversationBusy || loading}
              className="ml-2 grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground"
              aria-label="Create a new conversation"
            >
              <Plus className="h-4 w-4" />
            </button>
            {selectedConversationId && (
              <button
                type="button"
                onClick={() => handleUseInBrowser(selectedConversationId)}
                disabled={
                  conversationBusy || selectedConversationId === activeBrowserConversationId
                }
                className="ml-2 grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary disabled:opacity-50"
                aria-label="Use selected conversation in browser"
                title="Use in browser"
              >
                <MonitorCheck className="h-4 w-4" />
              </button>
            )}
          </div>
          {conversationNotice && (
            <p
              className="mx-4 mt-3 rounded-xl bg-primary/10 px-3 py-2 text-xs text-foreground md:hidden"
              role="status"
              aria-live="polite"
            >
              {conversationNotice}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-background/50 px-4 py-3 sm:px-6">
            <label htmlFor="ask-course" className="text-xs font-medium text-muted-foreground">
              Focus
            </label>
            <select
              id="ask-course"
              value={selectedCourseId}
              disabled={loading || coursesLoading}
              onChange={(event) => setSelectedCourseId(event.target.value)}
              className="min-h-9 max-w-full rounded-lg border border-border bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="">All my schoolwork</option>
              {selectedCourseId && !selectedCourse && (
                <option value={selectedCourseId}>Course unavailable — choose a focus</option>
              )}
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.course_code || course.name}
                  {course.course_code ? ` · ${course.name}` : ""}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              {coursesError
                ? "Course context couldn’t load. General help is still available."
                : coursesLoading
                  ? "Loading your courses…"
                  : selectedCourseId && !selectedCourse
                    ? "Choose an available course or all schoolwork."
                    : courses.length
                      ? `${selectedCourse ? selectedCourse.course_code || selectedCourse.name : `${courses.length} saved courses`} · ${upcomingCount} open assignments`
                      : "Add courses in your dashboard for more personal help."}
            </span>
          </div>
          {/* Conversation Area */}
          <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
            {selectedConversationId && (
              <div className="mx-auto mb-5 flex max-w-3xl items-center gap-2 text-sm">
                <span className="font-medium text-foreground">
                  {conversations.find((item) => item.id === selectedConversationId)?.title ||
                    "Chat"}
                </span>
                {selectedConversationId === activeBrowserConversationId && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                    In browser
                  </span>
                )}
              </div>
            )}
            {historyLoading ? (
              <div
                className="flex min-h-[22rem] flex-col items-center justify-center gap-3 text-sm text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <LoaderCircle className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
                Opening your conversation…
              </div>
            ) : messages.length === 0 ? (
              <div className="mx-auto flex min-h-[25rem] max-w-2xl flex-col items-center justify-center text-center">
                <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-primary/15">
                  <Sparkles className="h-7 w-7 text-primary" aria-hidden="true" />
                </div>
                <h2 className="font-serif-display mb-3 text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
                  What’s on your mind?
                </h2>
                <p className="max-w-md text-sm leading-6 text-muted-foreground">
                  Bring the messy question, the packed week, or the thing that just isn’t clicking.
                  We’ll find a place to start.
                </p>
                <div className="mt-7 grid w-full grid-cols-1 gap-2 text-left sm:grid-cols-2">
                  {starterPrompts.map((prompt) => (
                    <button
                      key={prompt.title}
                      type="button"
                      onClick={() => {
                        setQuestion(prompt.prompt);
                        questionInputRef.current?.focus();
                      }}
                      className="group flex min-h-20 items-center gap-3 rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-left transition hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <prompt.icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                      <span>
                        <span className="block text-sm font-semibold text-foreground">
                          {prompt.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {prompt.detail}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6" aria-live="polite" aria-busy={loading}>
                {messages.map((message, messageIndex) => {
                  const questionForAnswer =
                    message.type === "ai" ? getQuestionForAnswer(messageIndex) : "";
                  return (
                    <div
                      key={message.id}
                      className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
                    >
                      {message.type === "ai" && <LogoMark className="h-8 w-8 mr-3 flex-shrink-0" />}
                      <div
                        className={`max-w-[88%] sm:max-w-[75%] ${
                          message.type === "user"
                            ? "rounded-2xl rounded-tr-sm px-4 py-3"
                            : "rounded-2xl rounded-tl-sm border border-border/60 bg-card/60 px-4 py-3"
                        }`}
                        style={{
                          background:
                            message.type === "user" ? "var(--gradient-primary)" : undefined,
                          color: message.type === "user" ? "var(--primary-foreground)" : "inherit",
                        }}
                      >
                        <div className="prose prose-sm max-w-none text-sm prose-headings:mb-2 prose-headings:mt-3 prose-p:my-2 prose-li:my-0.5">
                          <ReactMarkdown>{message.content}</ReactMarkdown>
                        </div>
                        {message.grounding && (
                          <p className="mt-3 border-t border-border/60 pt-2 text-[11px] leading-5 text-muted-foreground">
                            <span className="font-semibold">{message.grounding.label}:</span>{" "}
                            {message.grounding.detail}
                          </p>
                        )}
                        {message.type === "ai" && (
                          <>
                            <div className="mt-3 flex gap-2">
                              <button
                                onClick={() => handleSend(questionForAnswer, "simpler")}
                                disabled={loading || !questionForAnswer}
                                className="text-xs px-3 py-1.5 rounded-lg transition-colors bg-primary/10 text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Explain simpler
                              </button>
                              <button
                                onClick={() => handleSend(questionForAnswer, "deeper")}
                                disabled={loading || !questionForAnswer}
                                className="text-xs px-3 py-1.5 rounded-lg transition-colors bg-primary/10 text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Go deeper
                              </button>
                            </div>
                            {message.relatedConcepts && message.relatedConcepts.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {message.relatedConcepts.map((concept) => (
                                  <button
                                    key={concept}
                                    onClick={() => handleConceptClick(concept)}
                                    disabled={loading}
                                    className="inline-flex items-center gap-1.5 text-xs rounded-full px-3 py-1 transition-colors bg-primary/10 text-primary hover:bg-primary/20"
                                  >
                                    <Sparkles className="h-3 w-3" />
                                    {concept}
                                  </button>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                        {message.sources && message.sources.length > 0 && (
                          <div className="mt-3">
                            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              Web references
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {message.sources.map((source, index) => (
                                <a
                                  key={`${source.link}-${index}`}
                                  href={source.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 text-xs rounded-full px-3 py-1 transition-colors bg-primary/10 text-primary hover:bg-primary/20"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  {source.title}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {loading && (
                  <div
                    className="flex justify-start"
                    role="status"
                    aria-label="UniMate is preparing a response"
                  >
                    <LogoMark className="h-8 w-8 mr-3 flex-shrink-0" />
                    <div
                      className={`rounded-2xl rounded-tl-sm px-4 py-3 ${"bg-card/60 border border-border/60"}`}
                    >
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>Let’s work through this…</span>
                        <span className="flex gap-1" aria-hidden="true">
                          <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" />
                          <div
                            className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce"
                            style={{ animationDelay: "0.1s" }}
                          />
                          <div
                            className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce"
                            style={{ animationDelay: "0.2s" }}
                          />
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input Bar */}
          <div className="border-t border-border/60 bg-background/80 p-3 pb-24 backdrop-blur sm:p-4 sm:pb-4">
            {historyNotice && (
              <div className="mx-auto mb-2 flex max-w-3xl items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                <span>{historyNotice}</span>
                <button
                  type="button"
                  onClick={() =>
                    void (selectedConversationId
                      ? refreshSharedHistory()
                      : refreshConversationDashboard())
                  }
                  disabled={loading || historyLoading || conversationBusy}
                  className="shrink-0 font-medium underline underline-offset-2"
                >
                  Refresh
                </button>
              </div>
            )}
            {sendError && (
              <div
                role="alert"
                className="mx-auto mb-3 flex max-w-3xl items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-3 text-sm"
              >
                <p>{sendError.message}</p>
                {sendError.retryable ? (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void handleSend(sendError.question, sendError.mode)}
                    className="shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold"
                  >
                    Try again
                  </button>
                ) : (
                  <Link
                    to="/support"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Get help (opens in a new tab; your draft stays here)"
                    className="shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold"
                  >
                    Get help
                  </Link>
                )}
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleSend();
              }}
              className="mx-auto max-w-3xl rounded-2xl border border-border bg-background p-2 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10"
            >
              <label htmlFor="ask-question" className="sr-only">
                Message Ask UniMate
              </label>
              <textarea
                id="ask-question"
                ref={questionInputRef}
                rows={3}
                maxLength={4000}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What are we working through today?"
                aria-label="Ask UniMate a question"
                aria-describedby="ask-composer-help"
                disabled={!selectedConversationId || historyLoading}
                className="block max-h-64 min-h-20 w-full resize-y rounded-xl bg-transparent px-3 py-2 text-sm leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
              />
              <div className="flex items-center justify-between gap-3 px-2 pb-1">
                <p id="ask-composer-help" className="text-[11px] text-muted-foreground">
                  Shift + Enter for a new line
                  {question.length > 3500 ? ` · ${4000 - question.length} characters left` : ""}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void refreshSharedHistory()}
                    disabled={!selectedConversationId || historyLoading || loading}
                    aria-label="Refresh shared Companion history"
                    title="Refresh shared Companion history"
                    className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
                  >
                    <History className="h-4 w-4" />
                  </button>
                  <button
                    type="submit"
                    disabled={
                      loading ||
                      historyLoading ||
                      !selectedConversationId ||
                      !question.trim() ||
                      Boolean(selectedCourseId && !selectedCourse)
                    }
                    aria-label="Send question"
                    title="Send question"
                    className="h-10 w-10 rounded-xl flex items-center justify-center transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed bg-primary text-primary-foreground"
                  >
                    {loading ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </form>
            <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] leading-5 text-muted-foreground">
              Uses your messages and saved course details. Paste readings or a draft when you want
              source-specific help. Check important requirements with your course materials.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
