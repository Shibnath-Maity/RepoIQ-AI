
import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import Prism from "prismjs";
import "prismjs/themes/prism-tomorrow.css";

import {
  Send,
  Loader2,
  Trash2,
  FolderGit2,
  Copy,
  Check,
  ArrowUp,
} from "lucide-react";

import API from "../services/api";

// ==========================================
// Logo Mark
// ==========================================
function LogoMark({ className }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Antenna */}
      <path
        d="M12 3v2.2"
        stroke="#e8a33d"
        strokeOpacity="0.55"
        strokeWidth="1.6"
        strokeLinecap="round"
      />

      <circle cx="12" cy="2.3" r="1" fill="#e8a33d" />

      {/* Head */}
      <rect
        x="5"
        y="6.7"
        width="14"
        height="11"
        rx="3.5"
        stroke="#e8a33d"
        strokeOpacity="0.55"
        strokeWidth="1.6"
      />

      {/* Ears */}
      <path
        d="M5 10.7H3.4"
        stroke="#e8a33d"
        strokeOpacity="0.55"
        strokeWidth="1.6"
        strokeLinecap="round"
      />

      <path
        d="M19 10.7h1.6"
        stroke="#e8a33d"
        strokeOpacity="0.55"
        strokeWidth="1.6"
        strokeLinecap="round"
      />

      {/* Eyes */}
      <circle cx="9.4" cy="12.2" r="1.3" fill="#e8a33d" />
      <circle cx="14.6" cy="12.2" r="1.3" fill="#e8a33d" />

      {/* Mouth */}
      <path
        d="M9.6 15.3h4.8"
        stroke="#e8a33d"
        strokeOpacity="0.55"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ==========================================
// Suggested Questions
// ==========================================
const SUGGESTED_QUESTIONS = [
  "Give me a repository overview.",
  "What technologies are used in this project?",
  "Explain the project architecture.",
  "Suggest improvements for this repository.",
];

// ==========================================
// Code Block with Syntax Highlighting
// ==========================================
function CodeBlock({ language, code }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Prism.highlightAll();
  }, [code, language]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);

      setCopied(true);

      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  return (
    <div className="relative rounded-lg overflow-hidden border border-[#232a37] bg-[#0b0e14] my-3">
      <div className="flex items-center justify-between bg-[#11151d] px-3 py-1.5 border-b border-[#232a37]">
        <span className="text-[11px] font-mono text-[#7c8496]">
          {language || "code"}
        </span>

        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-[11px] font-mono text-[#7c8496] hover:text-[#e6eaf0] transition-colors px-1.5 py-0.5 rounded"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-[#e8a33d]" />
              <span className="text-[#e8a33d]">copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>copy</span>
            </>
          )}
        </button>
      </div>

      <div className="p-3.5 overflow-x-auto text-[13px] font-mono leading-relaxed">
        <pre className="!m-0 !p-0 !bg-transparent">
          <code className={`language-${language || "javascript"}`}>
            {code}
          </code>
        </pre>
      </div>
    </div>
  );
}

// ==========================================
// Typing Indicator
// ==========================================
function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2.5 bg-[#151b23] border border-[#232a37] rounded-lg w-fit">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-[#e8a33d]"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{
            duration: 1,
            repeat: Infinity,
            delay: i * 0.18,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

// ==========================================
// Role Badge
// ==========================================
function RoleBadge({ role, isError }) {
  const isUser = role === "user";

  return (
    <div
      className={`h-7 w-7 shrink-0 rounded-md flex items-center justify-center font-mono text-[10px] font-semibold border ${
        isUser
          ? "bg-[#1c2530] border-[#313a4a] text-[#c3cad6]"
          : isError
          ? "bg-[#2a1614] border-[#4a2a26] text-[#f47067]"
          : "bg-[#241c0f] border-[#4a3a1c] text-[#e8a33d]"
      }`}
    >
      {isUser ? "you" : "ai"}
    </div>
  );
}

// ==========================================
// Main Repository Chatbot
// ==========================================
function RepositoryChatbot({ repositoryId: repositoryIdProp }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  const repositoryId =
    repositoryIdProp || localStorage.getItem("repositoryId");

  // Scroll to the latest message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, loading]);

  // ==========================================
  // Send Question to Backend
  // ==========================================
  async function sendQuestion(text) {
    const userQuestion = text.trim();

    if (!userQuestion || loading) return;

    if (!repositoryId) {
      setError("No repository connected — analyze a repository first.");
      return;
    }

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: userQuestion,
      },
    ]);

    setQuestion("");
    setError("");
    setLoading(true);

    try {
      // Shared API instance handles the base URL and JWT token.
      const response = await API.post("/assistant/ask", {
        question: userQuestion,
        repositoryId,
      });

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            response.data.answer || "I couldn't generate an answer.",
        },
      ]);
    } catch (err) {
      console.error("Assistant error:", err);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I couldn't answer that question.",
          isError: true,
        },
      ]);

      setError(
        err.response?.status === 401
          ? "Session expired or unauthorized. Please log in again."
          : "The assistant didn't respond. Please try again."
      );
    } finally {
      setLoading(false);

      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.focus();
        }
      }, 100);
    }
  }

  // ==========================================
  // Keyboard Handling
  // ==========================================
  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuestion(question);
    }
  }

  // ==========================================
  // Textarea Auto Resize
  // ==========================================
  function handleTextareaChange(e) {
    setQuestion(e.target.value);

    const el = e.target;

    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  // ==========================================
  // Clear Chat
  // ==========================================
  function clearChat() {
    setMessages([]);
    setError("");
  }

  // ==========================================
  // UI
  // ==========================================
  return (
    <div className="bg-[#0d1117] rounded-2xl p-6 border border-[#232a37] mt-6 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#232a37]">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-[#241c0f] border border-[#4a3a1c] flex items-center justify-center">
            <LogoMark className="h-5 w-5" />
          </div>

          <div>
            <h2 className="font-mono text-[13.5px] font-medium text-[#e6eaf0] tracking-tight">
              Repository Assistant
            </h2>

            <p className="text-xs text-[#7c8496] mt-0.5">
              Answers grounded in this codebase's structure and files
            </p>
          </div>
        </div>

        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearChat}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono text-[#7c8496] hover:text-[#f47067] hover:bg-[#2a1614] transition-colors"
            title="Clear conversation"
          >
            <Trash2 className="h-3.5 w-3.5" />
            clear
          </button>
        )}
      </div>

      {/* Main Content */}
      {!repositoryId ? (
        <div className="bg-[#0b0e14] border border-dashed border-[#313a4a] rounded-xl p-8 flex flex-col items-center text-center">
          <div className="h-11 w-11 rounded-lg bg-[#151b23] border border-[#232a37] flex items-center justify-center text-[#7c8496] mb-3">
            <FolderGit2 className="h-5 w-5" />
          </div>

          <p className="text-sm font-medium text-[#e6eaf0]">
            No repository connected
          </p>

          <p className="text-xs text-[#7c8496] mt-1 max-w-xs">
            Analyze a repository to start an interactive Q&A session.
          </p>
        </div>
      ) : (
        <>
          {/* Chat Messages */}
          <div
            ref={scrollRef}
            className="min-h-[200px] max-h-[440px] overflow-y-auto space-y-4 mb-4 pr-2"
          >
            {messages.length === 0 && (
              <div className="relative bg-[#0b0e14] border border-[#232a37] rounded-xl p-5 pl-6 overflow-hidden">
                <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#e8a33d]" />

                <p className="text-sm font-medium text-[#e6eaf0]">
                  How can I help with this project?
                </p>

                <p className="text-xs text-[#7c8496] mt-1 leading-relaxed">
                  I've read through this repository's structure,
                  dependencies, and code patterns — ask me anything about it.
                </p>

                <div className="flex flex-wrap gap-2 mt-4">
                  {SUGGESTED_QUESTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => sendQuestion(item)}
                      disabled={loading}
                      className="text-xs font-medium px-3 py-2 rounded-lg bg-[#151b23] border border-[#232a37] text-[#c3cad6] hover:border-[#e8a33d]/50 hover:text-[#e8a33d] disabled:opacity-50 transition-colors"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex gap-2.5 ${
                  message.role === "user"
                    ? "justify-end"
                    : "justify-start"
                }`}
              >
                {message.role === "assistant" && (
                  <RoleBadge
                    role="assistant"
                    isError={message.isError}
                  />
                )}

                <div
                  className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed border ${
                    message.role === "user"
                      ? "bg-[#1c2530] border-[#313a4a] text-[#e6eaf0] rounded-tr-sm"
                      : message.isError
                      ? "bg-[#1a1210] border-[#4a2a26] text-[#f47067] rounded-tl-sm"
                      : "bg-[#151b23] border-[#232a37] text-[#dde3ec] rounded-tl-sm"
                  }`}
                >
                  {message.role === "assistant" && !message.isError ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code({
                          inline,
                          className,
                          children,
                          ...props
                        }) {
                          const match =
                            /language-(\w+)/.exec(className || "");

                          return !inline && match ? (
                            <CodeBlock
                              language={match[1]}
                              code={String(children).replace(/\n$/, "")}
                            />
                          ) : (
                            <code
                              className="bg-[#241c0f] text-[#e8a33d] px-1.5 py-0.5 rounded text-[13px] font-mono"
                              {...props}
                            >
                              {children}
                            </code>
                          );
                        },

                        p: ({ children }) => (
                          <p className="mb-2 last:mb-0">{children}</p>
                        ),

                        ul: ({ children }) => (
                          <ul className="list-disc list-outside pl-4 space-y-1 mb-2">
                            {children}
                          </ul>
                        ),

                        ol: ({ children }) => (
                          <ol className="list-decimal list-outside pl-4 space-y-1 mb-2">
                            {children}
                          </ol>
                        ),

                        h1: ({ children }) => (
                          <h1 className="font-semibold text-base mt-2 mb-1">
                            {children}
                          </h1>
                        ),

                        h2: ({ children }) => (
                          <h2 className="font-semibold text-sm mt-2 mb-1">
                            {children}
                          </h2>
                        ),

                        h3: ({ children }) => (
                          <h3 className="font-medium text-sm mt-1 mb-1">
                            {children}
                          </h3>
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  ) : (
                    <span className="whitespace-pre-wrap">
                      {message.content}
                    </span>
                  )}
                </div>

                {message.role === "user" && (
                  <RoleBadge role="user" />
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2.5">
                <RoleBadge role="assistant" />
                <TypingIndicator />
              </div>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="relative bg-[#1a1210] border border-[#4a2a26] rounded-lg pl-4 pr-3 py-2 mb-3 overflow-hidden">
              <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#f47067]" />

              <p className="text-xs font-medium text-[#f47067]">
                {error}
              </p>
            </div>
          )}

          {/* Text Input */}
          <div className="relative flex items-end rounded-xl bg-[#0b0e14] border border-[#232a37] focus-within:border-[#e8a33d]/60 transition-colors">
            <textarea
              ref={textareaRef}
              value={question}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about this repository..."
              rows={1}
              className="w-full resize-none bg-transparent py-3.5 pl-4 pr-12 text-sm text-[#e6eaf0] placeholder-[#5b6270] outline-none max-h-36"
            />

            <button
              type="button"
              onClick={() => sendQuestion(question)}
              disabled={!question.trim() || loading}
              className="absolute right-2 bottom-2 h-8 w-8 rounded-lg bg-[#e8a33d] text-[#0d1117] flex items-center justify-center hover:bg-[#f0b25a] disabled:opacity-30 disabled:hover:bg-[#e8a33d] transition-colors"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4 stroke-[2.5]" />
              )}
            </button>
          </div>

          <div className="flex items-center justify-between mt-2 px-1 text-[11px] font-mono text-[#5b6270]">
            <span>enter to send · shift+enter for new line</span>
            <span>indexed from the connected repository</span>
          </div>
        </>
      )}
    </div>
  );
}

export default RepositoryChatbot;