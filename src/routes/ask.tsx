import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import {
  Send,
  ExternalLink,
  X,
  Plus,
  History,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { askUniMate } from "../functions/ask-unimate";
import ReactMarkdown from "react-markdown";
import { LogoMark } from "../components/logo-mark";
import { useCourses, useAssignments, getAcademicContext } from "../lib/courses";

export const Route = createFileRoute("/ask")({
  component: Ask,
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
}

interface QuestionHistory {
  id: string;
  question: string;
  answer: string;
  timestamp: string;
}

function Ask() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [classContext, setClassContext] = useState<string[]>([]);
  const [showClassSetup, setShowClassSetup] = useState(false);
  const [classInput, setClassInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [questionHistory, setQuestionHistory] = useState<QuestionHistory[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { data: courses = [] } = useCourses();
  const { data: assignments = [] } = useAssignments();

  // Load class context and question history from localStorage
  useEffect(() => {
    const savedClasses = localStorage.getItem("unimateClasses");
    if (savedClasses) {
      setClassContext(JSON.parse(savedClasses));
    } else {
      setShowClassSetup(true);
    }

    const savedHistory = localStorage.getItem("unimateQuestionHistory");
    if (savedHistory) {
      setQuestionHistory(JSON.parse(savedHistory));
    }
  }, []);

  // Save class context to localStorage
  useEffect(() => {
    localStorage.setItem("unimateClasses", JSON.stringify(classContext));
  }, [classContext]);

  // Save question history to localStorage
  useEffect(() => {
    localStorage.setItem("unimateQuestionHistory", JSON.stringify(questionHistory));
  }, [questionHistory]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleAddClass = () => {
    if (classInput.trim() && !classContext.includes(classInput.trim())) {
      setClassContext([...classContext, classInput.trim()]);
      setClassInput("");
    }
  };

  const handleRemoveClass = (classToRemove: string) => {
    setClassContext(classContext.filter((c) => c !== classToRemove));
  };

  const handleSaveClasses = () => {
    setShowClassSetup(false);
  };

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
    if (!questionToSend.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: "user",
      content: questionToSend,
    };

    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setLoading(true);

    try {
      // Combine manually-entered class tags with course/grade context added in the planner
      const combinedClassContext = [...classContext];
      let academicContextStr = "";

      if (courses.length > 0) {
        academicContextStr = getAcademicContext(courses, assignments);
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
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "ai",
        content: result.answer,
        sources: result.webResults,
        relatedConcepts: result.relatedConcepts || [],
      };
      setMessages((prev) => [...prev, aiMessage]);

      // Save to question history if it's a normal mode (not simpler/deeper)
      if (mode === "normal") {
        const historyItem: QuestionHistory = {
          id: Date.now().toString(),
          question: questionToSend,
          answer: result.answer,
          timestamp: new Date().toISOString(),
        };
        setQuestionHistory((prev) => [historyItem, ...prev].slice(0, 50));
      }
    } catch (error) {
      console.error("Error in AskUniMate:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: "ai",
        content: "An error occurred while processing your question. Please try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleExplainSimpler = () => {
    handleSend(undefined, "simpler");
  };

  const handleGoDeeper = () => {
    handleSend(undefined, "deeper");
  };

  const handleConceptClick = (concept: string) => {
    setQuestion(concept);
    handleSend(concept, "normal");
  };

  const handleHistoryItemClick = (item: QuestionHistory) => {
    setMessages([
      {
        id: item.id,
        type: "user",
        content: item.question,
      },
      {
        id: item.id + "-answer",
        type: "ai",
        content: item.answer,
      },
    ]);
    setShowHistory(false);
  };

  return (
    <div className="h-screen bg-background flex flex-col">
      <div className="flex-1 overflow-hidden flex flex-col max-w-4xl mx-auto w-full">
        {/* Conversation Area */}
        <div className="flex-1 overflow-y-auto px-6 py-8">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <LogoMark className="h-20 w-20 mb-6" />
              <h2 className="font-serif-display text-2xl font-medium text-foreground mb-2">
                Ask UniMate
              </h2>
              <p className="text-muted-foreground">Ask anything from your class</p>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
                >
                  {message.type === "ai" && <LogoMark className="h-8 w-8 mr-3 flex-shrink-0" />}
                  <div
                    className={`max-w-[70%] ${
                      message.type === "user"
                        ? "rounded-2xl rounded-tr-sm px-4 py-3"
                        : "rounded-2xl rounded-tl-sm px-4 py-3"
                    }`}
                    style={{
                      background:
                        message.type === "user"
                          ? "var(--gradient-primary)"
                          : "bg-card/60 border border-border/60",
                      color: message.type === "user" ? "var(--primary-foreground)" : "inherit",
                    }}
                  >
                    <div className="text-sm prose prose-sm max-w-none">
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
                    {message.type === "ai" && (
                      <>
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={handleExplainSimpler}
                            className="text-xs px-3 py-1.5 rounded-lg transition-colors bg-primary/10 text-primary hover:bg-primary/20"
                          >
                            Explain simpler
                          </button>
                          <button
                            onClick={handleGoDeeper}
                            className="text-xs px-3 py-1.5 rounded-lg transition-colors bg-primary/10 text-primary hover:bg-primary/20"
                          >
                            Go deeper
                          </button>
                        </div>
                        {message.relatedConcepts && message.relatedConcepts.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {message.relatedConcepts.map((concept, index) => (
                              <button
                                key={index}
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
                      <div className="mt-3 flex flex-wrap gap-2">
                        {message.sources.map((source, index) => (
                          <a
                            key={index}
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
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <LogoMark className="h-8 w-8 mr-3 flex-shrink-0" />
                  <div
                    className={`rounded-2xl rounded-tl-sm px-4 py-3 ${"bg-card/60 border border-border/60"}`}
                  >
                    <div className="flex gap-1">
                      <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" />
                      <div
                        className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce"
                        style={{ animationDelay: "0.1s" }}
                      />
                      <div
                        className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="border-t border-border/60 p-4 bg-background/80 backdrop-blur">
          <div className="flex gap-3 max-w-3xl mx-auto">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask any question from your class..."
              className="flex-1 rounded-full border border-border/60 bg-background px-5 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
            />
            <button
              onClick={() => handleSend()}
              disabled={loading || !question.trim()}
              className="h-12 w-12 rounded-full flex items-center justify-center transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 bg-primary text-primary-foreground"
            >
              <Send className="h-5 w-5" />
            </button>
            <button
              onClick={() => setShowHistory(true)}
              className="h-12 w-12 rounded-full flex items-center justify-center transition-all hover:scale-105 bg-primary/10 text-primary"
            >
              <History className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Class Setup Modal */}
      {showClassSetup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-2xl p-6 w-full max-w-md bg-card border border-border/60">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-foreground">Setup Your Classes</h3>
              <button
                onClick={() => setShowClassSetup(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Add your current courses so I can tailor answers to your coursework.
            </p>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={classInput}
                onChange={(e) => setClassInput(e.target.value)}
                placeholder="e.g. Bio 101, Calc 2"
                onKeyDown={(e) => e.key === "Enter" && handleAddClass()}
                className="flex-1 rounded-lg border border-border/60 bg-background px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                onClick={handleAddClass}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-primary text-primary-foreground"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {classContext.map((cls) => (
                <span
                  key={cls}
                  className="inline-flex items-center gap-1 text-xs px-3 py-1 rounded-full bg-primary/10 text-primary"
                >
                  {cls}
                  <button onClick={() => handleRemoveClass(cls)} className="hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <button
              onClick={handleSaveClasses}
              className="w-full py-2 rounded-lg text-sm font-medium transition-colors bg-primary text-primary-foreground"
            >
              Save & Continue
            </button>
          </div>
        </div>
      )}

      {/* Recent Questions Panel */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="rounded-2xl p-6 w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col bg-card border border-border/60">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-foreground">Recent Questions</h3>
              <button
                onClick={() => setShowHistory(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2">
              {questionHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No questions yet</p>
              ) : (
                questionHistory.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleHistoryItemClick(item)}
                    className="w-full text-left p-3 rounded-lg transition-colors hover:bg-card/60"
                  >
                    <p className="text-sm font-medium text-foreground truncate">{item.question}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(item.timestamp).toLocaleDateString()}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
