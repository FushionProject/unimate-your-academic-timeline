import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { askUniMate } from "../functions/ask-unimate";
import ReactMarkdown from "react-markdown";
import { LogoMark } from "../components/logo-mark";
import { useCourses, useAssignments, getAcademicContext } from "../lib/courses";
import { ProtectedRoute } from "../components/protected-route";
import { useAuth } from "../lib/auth-context";
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
  component: () => (
    <ProtectedRoute>
      <Ask />
    </ProtectedRoute>
  ),
});

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
}

const starterPrompts = [
  "What should I focus on today?",
  "Explain my next assignment in simpler terms",
  "Help me plan the next 45 minutes",
];

function Ask() {
  const [question, setQuestion] = useState("");
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
  const questionInputRef = useRef<HTMLInputElement>(null);
  const historyRequestRef = useRef(0);
  const activeUserIdRef = useRef<string | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const localMessageIdsRef = useRef(new Set<string>());
  const { user } = useAuth();
  const { data: courses = [] } = useCourses();
  const { data: assignments = [] } = useAssignments();
  const userId = user?.id ?? null;

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
        activeUserIdRef.current !== requestedUserId
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
      if (dashboard.conversations.length === 0) {
        const firstConversation = await createCompanionConversation(userId, "My first chat");
        await setBrowserConversation(userId, firstConversation.id);
        dashboard = {
          conversations: [firstConversation],
          activeBrowserConversationId: firstConversation.id,
        };
      }
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
    localMessageIdsRef.current.clear();
    setMessages([]);
    if (selectedConversationId) void refreshSharedHistory();
  }, [selectedConversationId, refreshSharedHistory]);

  const handleCreateConversation = async () => {
    if (!userId || conversationBusy) return;
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
          ? "New chat created. Choose “Use in Companion” to make it the extension’s active chat."
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
    if (!userId || conversationBusy) return;
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
      role: msg.type === "user" ? "user" : "assistant",
      content: msg.content,
    }));
  };

  const handleSend = async (
    overrideQuestion?: string,
    mode: "normal" | "simpler" | "deeper" = "normal",
  ) => {
    const questionToSend = overrideQuestion || question;
    if (!questionToSend.trim() || loading || !selectedConversationId) return;

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

    try {
      // Course/grade context is populated automatically from the planner.
      const combinedClassContext: string[] = [];
      let academicContextStr = "";

      if (courses.length > 0) {
        academicContextStr = getAcademicContext(courses, assignments, 12);
        if (academicContextStr) {
          combinedClassContext.push("Courses synced from planner");
        }
      }

      const result = await askUniMate({
        question: questionToSend,
        conversationHistory: getConversationHistory(),
        classContext: combinedClassContext,
        mode,
        canvasContext: academicContextStr,
      });
      if (activeUserIdRef.current !== requestUserId) return;
      const aiMessage: Message = {
        id: `local-ai-${crypto.randomUUID()}`,
        type: "ai",
        content: result.answer,
        sources: result.webResults,
        relatedConcepts: result.relatedConcepts || [],
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
      if (activeUserIdRef.current !== requestUserId) return;
      const errorMessage: Message = {
        id: `local-error-${crypto.randomUUID()}`,
        type: "ai",
        content:
          error instanceof Error
            ? error.message
            : "I couldn't finish that response. Please try again in a moment.",
      };
      localMessageIdsRef.current.add(errorMessage.id);
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
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
    <div className="min-h-[calc(100vh-12rem)] bg-background flex flex-col">
      <div className="mx-auto flex w-full max-w-7xl flex-1 overflow-hidden rounded-2xl border border-border/60 bg-card/20">
        <aside className="hidden w-72 shrink-0 flex-col border-r border-border/60 bg-card/50 md:flex">
          <div className="flex items-center justify-between border-b border-border/60 p-4">
            <div>
              <p className="text-sm font-semibold text-foreground">Your chats</p>
              <p className="text-xs text-muted-foreground">Choose what follows you</p>
            </div>
            <button
              type="button"
              onClick={handleCreateConversation}
              disabled={conversationBusy}
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
                      {activeInBrowser ? "Companion chat" : "Use in Companion"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteConversation(conversation)}
                      disabled={conversationBusy}
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
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 md:hidden">
            <select
              value={selectedConversationId || ""}
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
              disabled={conversationBusy}
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
              <div className="flex min-h-[22rem] flex-col items-center justify-center text-center">
                <LogoMark className="h-16 w-16 mb-5 sm:h-20 sm:w-20" />
                <h2 className="font-serif-display text-2xl font-medium text-foreground mb-2">
                  Ask UniMate
                </h2>
                <p className="max-w-md text-sm text-muted-foreground">
                  Ask here or from the Browser Companion. Your conversation follows your UniMate
                  account between both places.
                </p>
                <div className="mt-5 flex max-w-xl flex-wrap justify-center gap-2">
                  {starterPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => handleSend(prompt)}
                      className="rounded-full border border-border bg-card/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
                    >
                      {prompt}
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
                                {message.relatedConcepts.map((concept, index) => (
                                  <button
                                    key={concept}
                                    onClick={() => handleConceptClick(concept)}
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
                        <span>Thinking</span>
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
                  onClick={() => void refreshSharedHistory()}
                  className="shrink-0 font-medium underline underline-offset-2"
                >
                  Refresh
                </button>
              </div>
            )}
            <div className="mx-auto flex max-w-3xl gap-2 sm:gap-3">
              <input
                ref={questionInputRef}
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask UniMate anything…"
                aria-label="Ask UniMate a question"
                disabled={!selectedConversationId || historyLoading}
                className="flex-1 rounded-full border border-border/60 bg-background px-5 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) void handleSend();
                }}
              />
              <button
                onClick={() => handleSend()}
                disabled={loading || historyLoading || !selectedConversationId || !question.trim()}
                aria-label="Send question"
                title="Send question"
                className="h-12 w-12 rounded-full flex items-center justify-center transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed bg-primary text-primary-foreground"
              >
                <Send className="h-5 w-5" />
              </button>
              <button
                onClick={() => void refreshSharedHistory()}
                disabled={historyLoading || loading}
                aria-label="Refresh shared Companion history"
                title="Refresh shared Companion history"
                className="h-12 w-12 rounded-full flex items-center justify-center transition hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 bg-primary/10 text-primary"
              >
                <History className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
