import { useState, useRef, useEffect } from "react";
import {
  Bug,
  Search,
  AlertTriangle,
  FileCode2,
  ShieldCheck,
  Wrench,
  Copy,
  Check,
  Loader2,
  X,
  Trash2,
  Zap,
  Download,
  RefreshCw,
  BookOpen,
  History,
  Layers,
  TrendingDown,
  Info,
  Code2,
  Activity,
  FileCheck2,
  HelpCircle,
  Terminal,
  Clock,
  Braces,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import API from "../services/api";
import IssueSolver from "../components/IssueSolver";
import { useAnalysis } from "../context/AnalysisContext";
import ConstellationField from "../components/ui/constellation-field";

const SEVERITY_STYLES = {
  Critical: "bg-[#251114] text-[#F87171] ring-[#F87171]/25",
  High: "bg-[#211608] text-[#FB923C] ring-[#FB923C]/25",
  Medium: "bg-[#211D09] text-[#FBBF24] ring-[#FBBF24]/25",
  Low: "bg-[#12161F] text-[#94A3B8] ring-[#94A3B8]/20",
};

const CATEGORY_ICONS = {
  "Runtime Error": {
    icon: AlertTriangle,
    color: "text-[#FBBF24] bg-[#211D09]",
  },
  "Null Pointer": {
    icon: Bug,
    color: "text-[#F87171] bg-[#251114]",
  },
  "Syntax Error": {
    icon: Code2,
    color: "text-[#C084FC] bg-[#1B1526]",
  },
  "Build Error": {
    icon: Wrench,
    color: "text-[#38BDF8] bg-[#0D1F2B]",
  },
  "Dependency Error": {
    icon: Layers,
    color: "text-[#60A5FA] bg-[#0E1A2B]",
  },
  "Memory Leak": {
    icon: Activity,
    color: "text-[#F87171] bg-[#251114]",
  },
  "Performance Issue": {
    icon: TrendingDown,
    color: "text-[#FB923C] bg-[#211608]",
  },
  "Security Issue": {
    icon: ShieldCheck,
    color: "text-[#34D399] bg-[#0C211A]",
  },
};

const LOADING_STEPS = [
  "Parsing call stack & stack trace...",
  "Categorizing exception pattern...",
  "Querying vector store for similar past bugs...",
  "Tracing repository git history...",
  "Evaluating affected files & symbol graphs...",
  "Calculating root cause probability...",
  "Synthesizing automated code fix...",
  "Generating unified diff patch...",
];

function PanelStyles() {
  return (
    <style>{`
      @keyframes dc-cursor {
        0%, 100% { opacity: 1; }
        50% { opacity: 0; }
      }

      .dc-cursor {
        animation: dc-cursor 1s step-end infinite;
      }

      @media (prefers-reduced-motion: reduce) {
        .dc-cursor {
          animation: none;
        }
      }

      .dc-scroll-x {
        -webkit-overflow-scrolling: touch;
      }

      .dc-scroll-x::-webkit-scrollbar {
        height: 6px;
      }

      .dc-scroll-x::-webkit-scrollbar-thumb {
        background: #232A36;
        border-radius: 3px;
      }
    `}</style>
  );
}

function SegmentedTab({ active, onClick, children }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8]/60 ${
        active
          ? "bg-[#38BDF8] text-[#0A0D12]"
          : "text-[#8A93A6] hover:text-[#D6DAE3] hover:bg-white/[0.04]"
      }`}
    >
      {children}
    </button>
  );
}

function ResultNavTab({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={active}
      role="tab"
      className={`pb-2.5 border-b-2 text-sm font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8]/60 rounded-t-sm ${
        active
          ? "border-[#38BDF8] text-[#38BDF8]"
          : "border-transparent text-[#7C879C] hover:text-[#D6DAE3]"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="bg-[#10141B] rounded-lg ring-1 ring-[#1E252F] p-6 sm:p-8">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-9 h-9 rounded-md bg-[#0D1F2B] flex items-center justify-center ring-1 ring-[#38BDF8]/20 shrink-0">
          <Terminal className="text-[#38BDF8]" size={17} />
        </div>

        <div>
          <p className="text-[#E6E9EF] text-sm font-medium mb-1">
            Ready when you are
          </p>

          <p className="text-[#8A93A6] text-sm leading-relaxed max-w-lg">
            Paste an exception, stack trace, or build error above to begin
            repository-aware diagnosis.
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {[
          "JavaScript",
          "TypeScript",
          "React",
          "Node.js",
          "Python",
          "Java",
          "Spring Boot",
          "C++",
          "Stack Traces",
          "Build Logs",
        ].map((tech) => (
          <span
            key={tech}
            className="bg-[#0C0F15] text-[#7C879C] text-[11px] px-2 py-1 rounded font-mono ring-1 ring-[#1E252F]"
          >
            {tech}
          </span>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-[#1E252F]">
        <div>
          <p className="text-xs font-semibold text-[#34D399] mb-2">
            Automated checks
          </p>

          <ul className="space-y-1.5 text-xs text-[#B7BECC]">
            <li className="flex items-start gap-2">
              <Check
                size={13}
                className="text-[#34D399] mt-0.5 shrink-0"
              />
              Root cause & call stack parsing
            </li>

            <li className="flex items-start gap-2">
              <Check
                size={13}
                className="text-[#34D399] mt-0.5 shrink-0"
              />
              Vector similarity against past bugs
            </li>

            <li className="flex items-start gap-2">
              <Check
                size={13}
                className="text-[#34D399] mt-0.5 shrink-0"
              />
              Historical git commit tracing
            </li>
          </ul>
        </div>

        <div>
          <p className="text-xs font-semibold text-[#38BDF8] mb-2">
            Fix deliverables
          </p>

          <ul className="space-y-1.5 text-xs text-[#B7BECC]">
            <li className="flex items-start gap-2">
              <Check
                size={13}
                className="text-[#34D399] mt-0.5 shrink-0"
              />
              Unified code diff (.diff download)
            </li>

            <li className="flex items-start gap-2">
              <Check
                size={13}
                className="text-[#34D399] mt-0.5 shrink-0"
              />
              Risk & impact assessment
            </li>

            <li className="flex items-start gap-2">
              <Check
                size={13}
                className="text-[#34D399] mt-0.5 shrink-0"
              />
              "Why this fix works" explainer
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtext,
  icon: Icon,
  colorClass,
  ledClass,
}) {
  return (
    <div className="bg-[#10141B] rounded-lg ring-1 ring-[#1E252F] p-3.5 sm:p-4 flex items-center justify-between gap-3 min-w-0">
      <div className="min-w-0">
        <p className="text-xs font-medium text-[#7C879C] mb-1.5 flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              ledClass || "bg-[#34D399]"
            }`}
          />
          {title}
        </p>

        <p
          className="text-lg font-semibold text-[#E6E9EF] truncate"
          title={typeof value === "string" ? value : undefined}
        >
          {value}
        </p>

        {subtext && (
          <p className="text-xs text-[#7C879C] mt-0.5 truncate">
            {subtext}
          </p>
        )}
      </div>

      <div className={`p-2.5 rounded-md shrink-0 ${colorClass}`}>
        <Icon size={18} />
      </div>
    </div>
  );
}

export default function DebugCenter() {
  const [activeTab, setActiveTab] = useState("bug");
  const [resultTab, setResultTab] = useState("overview");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStepIdx, setLoadingStepIdx] = useState(0);
  const [result, setResult] = useState(null);
  const [failMsg, setFailMsg] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [responseTime, setResponseTime] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [history, setHistory] = useState([]);
  const [showRawJson, setShowRawJson] = useState(false);

  const { repositoryId } = useAnalysis();

  const inputRef = useRef(null);
  const resultRef = useRef(null);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    if (activeTab === "bug") {
      inputRef.current?.focus();
    }
  }, [activeTab]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (!copyStatus) return;

    const timer = setTimeout(() => setCopyStatus(""), 2000);

    return () => clearTimeout(timer);
  }, [copyStatus]);

  useEffect(() => {
    if (!loading) {
      setLoadingStepIdx(0);
      return;
    }

    const interval = setInterval(() => {
      setLoadingStepIdx(
        (prev) => (prev + 1) % LOADING_STEPS.length
      );
    }, 600);

    return () => clearInterval(interval);
  }, [loading]);

  // Deployment-ready analysis request.
  // The shared API client handles the backend URL and JWT token.
  const handleAnalyze = async () => {
    if (loading) return;

    if (!error.trim()) {
      setFailMsg(
        "Please enter an error message or stack trace first."
      );
      return;
    }

    if (!repositoryId) {
      setFailMsg(
        "No repository selected. Please analyze a repository first."
      );
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setFailMsg("");
    setCopyStatus("");
    setResponseTime(null);
    setShowRawJson(false);
    setLoading(true);

    const startTime = performance.now();

    try {
      const response = await API.post(
        "/repository/bug-solver",
        {
          error: error.trim(),
          repositoryId,
        },
        {
          signal: controller.signal,
        }
      );

      if (!response.data?.data) {
        throw new Error(
          "Received invalid payload structure from server."
        );
      }

      const clientDuration = Math.round(
        performance.now() - startTime
      );

      const data = response.data.data;

      const duration =
        response.data.processingTimeMs ?? clientDuration;

      const analysisPayload = {
        id: Date.now(),
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        query: error.trim(),
        data,
        processingTimeMs: duration,
        model:
          response.data.model ||
          data.model ||
          "Unknown model",
      };

      setResponseTime(duration);
      setResult(analysisPayload);

      setHistory((prev) => [
        analysisPayload,
        ...prev.slice(0, 4),
      ]);

      setIsDirty(false);
      setResultTab("overview");

      setTimeout(() => {
        resultRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    } catch (err) {
      // Ignore intentional cancellations.
      if (
        err.code === "ERR_CANCELED" ||
        err.name === "CanceledError" ||
        controller.signal.aborted
      ) {
        return;
      }

      console.error("Bug analysis error:", err);

      let message = "Failed to analyze the bug.";

      if (err.code === "ERR_NETWORK") {
        message =
          "Cannot connect to the backend. Check the backend URL and your internet connection.";
      } else if (err.response?.status === 401) {
        message =
          "Access denied. Please log in again.";
      } else if (err.response?.status === 403) {
        message =
          "You do not have permission to perform this action.";
      } else if (err.response?.status === 404) {
        message =
          "The bug-solver endpoint was not found. Check the backend route configuration.";
      } else if (err.response?.status === 429) {
        message =
          "The service is receiving too many requests. Please try again later.";
      } else if (err.response?.status >= 500) {
        message =
          err.response.data?.message ||
          "The backend encountered an internal error.";
      } else if (err.response?.data?.message) {
        message = err.response.data.message;
      } else if (err.message) {
        message = err.message;
      }

      setFailMsg(message);
    } finally {
      // Only the request that owns this controller can reset loading.
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setLoading(false);
      }
    }
  };

  const handleKeyDown = (e) => {
    if (
      !loading &&
      (e.ctrlKey || e.metaKey) &&
      e.key === "Enter"
    ) {
      e.preventDefault();
      handleAnalyze();
    }
  };

  const handleInputChange = (e) => {
    setError(e.target.value);
    setIsDirty(true);

    if (failMsg) {
      setFailMsg("");
    }
  };

  const handleClearAll = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setError("");
    setResult(null);
    setFailMsg("");
    setResponseTime(null);
    setLoading(false);
    setIsDirty(false);
    setShowRawJson(false);

    inputRef.current?.focus();
  };

  const restoreFromHistory = (item) => {
    setError(item.query);
    setResult(item);
    setResponseTime(item.processingTimeMs);
    setIsDirty(false);
    setResultTab("overview");
    setShowRawJson(false);

    setTimeout(() => {
      resultRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);
  };

  const handleCopyToClipboard = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(label);
    } catch {
      setFailMsg(
        `Could not copy ${label}. Copy manually.`
      );
    }
  };

  const downloadPatchFile = () => {
    if (!result?.data?.patch) return;

    const patch = result.data.patch;
    const fileName = patch.file || "fix.diff";

    const oldLines = (patch.oldCode || "").split("\n");
    const newLines = (patch.newCode || "").split("\n");

    const diffContent = [
      `--- a/${fileName}`,
      `+++ b/${fileName}`,
      `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
      ...oldLines.map((line) => `- ${line}`),
      ...newLines.map((line) => `+ ${line}`),
    ].join("\n");

    const blob = new Blob([diffContent], {
      type: "text/plain;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `fix-${Date.now()}.diff`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  };

  const resData = result?.data;

  const categoryMeta = CATEGORY_ICONS[resData?.bugType] || {
    icon: AlertTriangle,
    color: "text-[#FBBF24] bg-[#211D09]",
  };

  const CategoryIcon = categoryMeta.icon;

  const confidenceReasons = Array.isArray(
    resData?.confidenceReasons
  )
    ? resData.confidenceReasons
    : [];

  const stackBreakdown = Array.isArray(
    resData?.stackBreakdown
  )
    ? resData.stackBreakdown
    : [];

  const patchStats = resData?.patchStats || {
    filesModified: resData?.patch?.file ? 1 : 0,
    linesAdded: resData?.patch?.newCode
      ? resData.patch.newCode.split("\n").length
      : 0,
    linesDeleted: resData?.patch?.oldCode
      ? resData.patch.oldCode.split("\n").length
      : 0,
    functionsChanged: 0,
  };

  const riskAssessment = resData?.riskAssessment || null;

  const learnExplanation =
    resData?.whyThisFixWorks ||
    resData?.explanation ||
    "";

  const learnTakeaway = resData?.learning || "";

  const generateFullReportMarkdown = () => {
    if (!resData) return "";

    return `
# Bug Analysis Report
**Timestamp:** ${result.timestamp}
**Bug Type:** ${resData.bugType || "Runtime Exception"}
**Severity:** ${resData.severity || "Medium"}
**Confidence:** ${resData.confidence}%

## Root Cause
${resData.rootCause}

## Affected Files
${(resData.affectedFiles || [resData.file])
  .map((f) => `- ${f}`)
  .join("\n")}

## Recommended Fix
${resData.fix}

\`\`\`diff
--- ${resData.patch?.file || "file"}
+++ ${resData.patch?.file || "file"}
${resData.patch?.oldCode
  ?.split("\n")
  .map((l) => `- ${l}`)
  .join("\n")}
${resData.patch?.newCode
  ?.split("\n")
  .map((l) => `+ ${l}`)
  .join("\n")}
\`\`\`

## Why This Fix Works
${learnExplanation || "Not available."}

## Learning
${learnTakeaway || "Not available."}
`.trim();
  };

  const severityLed =
    resData?.severity === "Critical" ||
    resData?.severity === "High"
      ? "bg-[#F87171]"
      : resData?.severity === "Low"
        ? "bg-[#7C879C]"
        : "bg-[#FBBF24]";

  const severityBadgeClass =
    SEVERITY_STYLES[resData?.severity] ||
    SEVERITY_STYLES.Medium;

  const resultNavItems = [
    { id: "overview", label: "Overview & Causes" },
    { id: "stack", label: "Stack Trace" },
    { id: "patch", label: "Code Patch & Stats" },
    { id: "impact", label: "Impact & Similarity" },
    { id: "learn", label: "AI Insights & Learn" },
  ];

  return (
    <div
      className="relative min-h-screen p-4 sm:p-6 font-sans"
      style={{
        fontFamily:
          "'Inter', ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <ConstellationField
        mode="dark"
        speed={0.45}
        size={0.75}
        length={0.75}
        density={0.65}
        strokeWidth={0.7}
        opacity={0.32}
        hue={-10}
        saturation={0.8}
        brightness={0.7}
        className="fixed inset-0 z-0 h-full w-full pointer-events-none"
      />

      <div className="relative z-10">
        <PanelStyles />

        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="p-1.5 rounded-md bg-[#251114] ring-1 ring-[#F87171]/20 shrink-0">
              <Bug className="text-[#F87171]" size={19} />
            </span>

            <h1 className="text-xl sm:text-2xl font-semibold text-[#E6E9EF]">
              Debug Center
            </h1>

            {repositoryId && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#7C879C] bg-[#10141B] ring-1 ring-[#1E252F] px-2 py-1 rounded">
                <Layers size={11} />
                {repositoryId}
              </span>
            )}
          </div>

          <p className="text-[#8A93A6] mt-1.5 text-sm max-w-2xl">
            Root-cause analysis, stack tracing, and patch generation for
            this repository.
          </p>

          <div className="border-t border-[#1E252F] mt-4" />
        </div>

        {/* Main Tabs */}
        <div
          role="tablist"
          aria-label="Debug Center mode"
          className="inline-flex gap-1 mb-6 p-1 rounded-lg bg-[#10141B] ring-1 ring-[#1E252F]"
        >
          <SegmentedTab
            active={activeTab === "bug"}
            onClick={() => setActiveTab("bug")}
          >
            Bug Solver
          </SegmentedTab>

          <SegmentedTab
            active={activeTab === "issue"}
            onClick={() => setActiveTab("issue")}
          >
            GitHub Issue Solver
          </SegmentedTab>
        </div>

        {activeTab === "bug" ? (
          <>
            {/* Main Input Box */}
            <div className="bg-[#10141B] rounded-lg ring-1 ring-[#1E252F] p-4 sm:p-5 mb-6">
              <label
                htmlFor="dc-error-input"
                className="block text-xs font-medium text-[#8A93A6] mb-2"
              >
                Error or stack trace
              </label>

              <div className="relative">
                <textarea
                  id="dc-error-input"
                  ref={inputRef}
                  rows={5}
                  value={error}
                  disabled={loading}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Paste a stack trace, exception message, runtime error, or build log..."
                  className="w-full bg-[#0A0D12] border border-[#1E252F] text-[#E6E9EF] placeholder:text-[#5B6472] rounded-md pl-3.5 pr-10 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8]/50 focus:border-[#38BDF8]/50 transition-colors font-mono text-[13px] leading-relaxed resize-y disabled:bg-[#0C0F15] disabled:text-[#5B6472]"
                />

                {error && !loading && (
                  <button
                    type="button"
                    onClick={handleClearAll}
                    aria-label="Clear input and reset view"
                    title="Clear input and reset view"
                    className="absolute top-3 right-3 text-[#5B6472] hover:text-[#D6DAE3] p-1 rounded transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8]/50"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-3">
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={loading || !error.trim()}
                  aria-label={
                    loading ? "Analyzing error" : "Analyze error"
                  }
                  className="w-full sm:w-auto bg-[#38BDF8] hover:bg-[#5FCBFA] disabled:bg-[#1A2029] disabled:text-[#5B6472] disabled:cursor-not-allowed text-[#0A0D12] px-5 py-2.5 rounded-md flex items-center justify-center gap-2 font-semibold text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#10141B]"
                >
                  {loading ? (
                    <>
                      <Loader2 className="animate-spin" size={16} />
                      Analyzing…
                    </>
                  ) : (
                    <>
                      <Search size={16} />
                      Analyze
                    </>
                  )}
                </button>

                <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono text-[#5B6472]">
                  <kbd className="px-1.5 py-0.5 rounded border border-[#1E252F] bg-[#0A0D12]">
                    Ctrl
                  </kbd>
                  +
                  <kbd className="px-1.5 py-0.5 rounded border border-[#1E252F] bg-[#0A0D12]">
                    Enter
                  </kbd>
                  <span className="ml-1">to analyze</span>
                </span>
              </div>

              {isDirty && result && !loading && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#FBBF24] bg-[#211D09] ring-1 ring-[#FBBF24]/20 rounded-md px-3 py-2">
                  <span>
                    Input changed since last run — re-analyze to refresh
                    diagnosis.
                  </span>

                  <button
                    type="button"
                    onClick={handleAnalyze}
                    className="font-semibold underline hover:text-[#FDE68A] flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FBBF24]/50 rounded"
                  >
                    <RefreshCw size={12} />
                    Refresh
                  </button>
                </div>
              )}

              {failMsg && (
                <div className="mt-3 flex items-start gap-2 text-sm text-[#F87171] bg-[#251114] ring-1 ring-[#F87171]/20 rounded-md px-3 py-2">
                  <AlertTriangle
                    size={15}
                    className="shrink-0 mt-0.5"
                  />

                  <span className="flex-1 leading-snug">
                    {failMsg}
                  </span>

                  <button
                    type="button"
                    onClick={() => setFailMsg("")}
                    aria-label="Dismiss error"
                    className="text-[#F87171] hover:text-[#FCA5A5] p-0.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F87171]/50 shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* Recent History */}
            {history.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-[#5B6472]">
                  <History size={13} />
                  Recent
                </div>

                <div className="flex items-center gap-2 overflow-x-auto dc-scroll-x pb-1">
                  {history.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => restoreFromHistory(item)}
                      className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border transition font-mono text-xs max-w-[220px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8]/50 ${
                        result?.id === item.id
                          ? "bg-[#0D1F2B] border-[#38BDF8]/40 text-[#38BDF8]"
                          : "bg-[#10141B] border-[#1E252F] text-[#8A93A6] hover:bg-[#161B24]"
                      }`}
                    >
                      <span className="truncate">
                        {item.data.bugType || "Exception"}
                      </span>

                      <span className="text-[#5B6472] shrink-0 flex items-center gap-0.5">
                        <Clock size={10} />
                        {item.timestamp}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!result && !loading && <EmptyState />}

            {/* Diagnostic Progress */}
            {loading && (
              <div className="bg-[#10141B] rounded-lg ring-1 ring-[#1E252F] p-5 sm:p-6 max-w-lg mx-auto">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#38BDF8] dc-cursor" />

                  <h3 className="text-xs font-medium text-[#B7BECC]">
                    Diagnostic pipeline
                  </h3>
                </div>

                <div className="flex gap-1 mb-5">
                  {LOADING_STEPS.map((_, idx) => (
                    <div
                      key={idx}
                      className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                        idx <= loadingStepIdx
                          ? "bg-[#38BDF8]"
                          : "bg-[#1E252F]"
                      }`}
                    />
                  ))}
                </div>

                <div className="space-y-2.5 font-mono">
                  {LOADING_STEPS.map((step, idx) => {
                    const isDone = idx < loadingStepIdx;
                    const isCurrent = idx === loadingStepIdx;

                    return (
                      <div
                        key={step}
                        className="flex items-center gap-2.5 text-xs"
                      >
                        {isDone ? (
                          <Check
                            size={13}
                            className="text-[#34D399] shrink-0"
                          />
                        ) : isCurrent ? (
                          <Loader2
                            size={13}
                            className="animate-spin text-[#38BDF8] shrink-0"
                          />
                        ) : (
                          <div className="w-3 h-3 rounded-full border border-[#1E252F] shrink-0" />
                        )}

                        <span
                          className={
                            isDone
                              ? "text-[#5B6472] line-through"
                              : isCurrent
                                ? "text-[#38BDF8]"
                                : "text-[#5B6472]"
                          }
                        >
                          {step}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Analysis Results */}
            {result && !loading && resData && (
              <div ref={resultRef} className="space-y-6">
                {/* Metrics */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  <MetricCard
                    title="Error class"
                    value={resData.bugType || "Runtime Exception"}
                    subtext={
                      resData.file
                        ? `In ${resData.file.split("/").pop()}`
                        : "Global scope"
                    }
                    icon={CategoryIcon}
                    colorClass={categoryMeta.color}
                    ledClass="bg-[#38BDF8]"
                  />

                  <MetricCard
                    title="Severity"
                    value={resData.severity || "Medium"}
                    subtext="Impact score"
                    icon={AlertTriangle}
                    colorClass={
                      resData.severity === "Critical" ||
                      resData.severity === "High"
                        ? "text-[#F87171] bg-[#251114]"
                        : "text-[#FBBF24] bg-[#211D09]"
                    }
                    ledClass={severityLed}
                  />

                  <MetricCard
                    title="AI confidence"
                    value={`${resData.confidence ?? 0}%`}
                    subtext="Certainty score"
                    icon={ShieldCheck}
                    colorClass="text-[#34D399] bg-[#0C211A]"
                    ledClass="bg-[#34D399]"
                  />

                  <MetricCard
                    title="Processing time"
                    value={
                      typeof responseTime === "number" &&
                      !Number.isNaN(responseTime)
                        ? `${(responseTime / 1000).toFixed(1)}s`
                        : "—"
                    }
                    subtext={`Model: ${result.model || "Unknown"}`}
                    icon={Zap}
                    colorClass="text-[#38BDF8] bg-[#0D1F2B]"
                    ledClass="bg-[#38BDF8]"
                  />
                </div>

                {/* Quick Actions */}
                <div className="bg-[#10141B] rounded-lg p-3.5 sm:p-4 ring-1 ring-[#1E252F] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[#B7BECC]">
                      Quick actions
                    </span>

                    {copyStatus && (
                      <span className="text-[11px] bg-[#0C211A] text-[#34D399] px-2 py-0.5 rounded font-medium">
                        Copied {copyStatus}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyToClipboard(
                          resData.fix || "",
                          "Fix Description"
                        )
                      }
                      className="px-3 py-1.5 bg-[#161B24] hover:bg-[#1D2431] text-[#C7CDDA] rounded-md font-medium text-xs flex items-center gap-1.5 transition ring-1 ring-[#1E252F] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8]/50"
                    >
                      <Copy size={13} />
                      Copy fix
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleCopyToClipboard(
                          resData.rootCause || "",
                          "Root Cause"
                        )
                      }
                      className="px-3 py-1.5 bg-[#161B24] hover:bg-[#1D2431] text-[#C7CDDA] rounded-md font-medium text-xs flex items-center gap-1.5 transition ring-1 ring-[#1E252F] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8]/50"
                    >
                      <Copy size={13} />
                      Copy root cause
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleCopyToClipboard(
                          generateFullReportMarkdown(),
                          "Full Report"
                        )
                      }
                      className="px-3 py-1.5 bg-[#0D1F2B] hover:bg-[#123049] text-[#38BDF8] rounded-md font-medium text-xs flex items-center gap-1.5 transition ring-1 ring-[#38BDF8]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8]/50"
                    >
                      <FileCheck2 size={13} />
                      Copy markdown report
                    </button>

                    <button
                      type="button"
                      onClick={downloadPatchFile}
                      disabled={
                        !resData.patch?.oldCode &&
                        !resData.patch?.newCode
                      }
                      className="px-3 py-1.5 bg-[#38BDF8] hover:bg-[#5FCBFA] disabled:bg-[#1A2029] disabled:text-[#5B6472] disabled:cursor-not-allowed text-[#0A0D12] rounded-md font-semibold text-xs flex items-center gap-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8]/60"
                    >
                      <Download size={13} />
                      Download patch
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setShowRawJson((value) => !value)
                      }
                      aria-expanded={showRawJson}
                      className="px-3 py-1.5 bg-[#161B24] hover:bg-[#1D2431] text-[#C7CDDA] rounded-md font-medium text-xs flex items-center gap-1.5 transition ring-1 ring-[#1E252F] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8]/50"
                    >
                      <Braces size={13} />
                      Raw JSON
                      {showRawJson ? (
                        <ChevronUp size={13} />
                      ) : (
                        <ChevronDown size={13} />
                      )}
                    </button>
                  </div>
                </div>

                {/* Raw JSON */}
                {showRawJson && (
                  <div className="bg-[#0A0D12] rounded-lg ring-1 ring-[#1E252F] overflow-hidden">
                    <div className="bg-[#10141B] px-3.5 sm:px-4 py-2 flex items-center justify-between border-b border-[#1E252F]">
                      <span className="text-xs font-medium text-[#7C879C]">
                        Raw response payload
                      </span>

                      <button
                        type="button"
                        onClick={() =>
                          handleCopyToClipboard(
                            JSON.stringify(resData, null, 2),
                            "Raw JSON"
                          )
                        }
                        className="text-[#7C879C] hover:text-[#38BDF8] flex items-center gap-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8]/50 rounded"
                      >
                        <Copy size={12} />
                        Copy
                      </button>
                    </div>

                    <pre className="p-4 text-[11px] leading-relaxed text-[#B7BECC] font-mono overflow-x-auto dc-scroll-x max-h-96">
                      {JSON.stringify(resData, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Result Navigation */}
                <div
                  role="tablist"
                  aria-label="Result sections"
                  className="border-b border-[#1E252F] flex gap-5 overflow-x-auto dc-scroll-x"
                >
                  {resultNavItems.map((tab) => (
                    <ResultNavTab
                      key={tab.id}
                      active={resultTab === tab.id}
                      onClick={() => setResultTab(tab.id)}
                    >
                      {tab.label}
                    </ResultNavTab>
                  ))}
                </div>

                {/* Overview */}
                {resultTab === "overview" && (
                  <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
                    <div className="lg:col-span-2 bg-[#10141B] rounded-lg ring-1 ring-[#1E252F] p-4 sm:p-6">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <h2 className="font-semibold text-base text-[#E6E9EF] flex items-center gap-2">
                          <ShieldCheck
                            className="text-[#34D399]"
                            size={18}
                          />
                          Root Cause Analysis
                        </h2>

                        <span
                          className={`text-[11px] font-medium px-2 py-0.5 rounded ring-1 ${severityBadgeClass}`}
                        >
                          {resData.severity || "Medium"} severity
                        </span>
                      </div>

                      <p className="text-[#C7CDDA] leading-relaxed text-sm whitespace-pre-line break-words">
                        {resData.rootCause ||
                          "No root cause details provided."}
                      </p>

                      <div className="mt-5 pt-5 border-t border-[#1E252F]">
                        <h3 className="font-medium text-sm text-[#E6E9EF] mb-2">
                          Recommended fix action
                        </h3>

                        <p className="text-[#8A93A6] text-sm leading-relaxed break-words">
                          {resData.fix}
                        </p>
                      </div>
                    </div>

                    {/* Confidence Breakdown */}
                    <div className="bg-[#10141B] rounded-lg ring-1 ring-[#1E252F] p-4 sm:p-6 space-y-5">
                      <div>
                        <h3 className="font-semibold text-sm text-[#E6E9EF] mb-3 flex items-center gap-1.5">
                          <Info
                            size={15}
                            className="text-[#38BDF8]"
                          />
                          Confidence breakdown
                        </h3>

                        {confidenceReasons.length > 0 ? (
                          <div className="space-y-2">
                            {confidenceReasons.map(
                              (reason, idx) => (
                                <div
                                  key={idx}
                                  className="flex items-start gap-2 text-xs text-[#8A93A6]"
                                >
                                  <Check
                                    size={13}
                                    className="text-[#34D399] shrink-0 mt-0.5"
                                  />
                                  <span className="break-words">
                                    {reason}
                                  </span>
                                </div>
                              )
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-[#5B6472]">
                            No additional confidence evidence was
                            returned.
                          </p>
                        )}
                      </div>

                      <div className="pt-4 border-t border-[#1E252F]">
                        <h3 className="font-semibold text-sm text-[#E6E9EF] mb-2">
                          Fix risk assessment
                        </h3>

                        {riskAssessment ? (
                          <div className="bg-[#0A0D12] p-3 rounded-md ring-1 ring-[#1E252F] text-xs space-y-1.5">
                            <div className="flex justify-between font-medium gap-2">
                              <span className="text-[#8A93A6]">
                                Risk level
                              </span>
                              <span className="text-[#E6E9EF] font-semibold font-mono text-right">
                                {riskAssessment.level || "Unknown"}
                              </span>
                            </div>

                            <div className="flex justify-between font-medium gap-2">
                              <span className="text-[#8A93A6]">
                                Rollback chance
                              </span>
                              <span className="text-[#E6E9EF] font-mono text-right">
                                {riskAssessment.rollbackChance ||
                                  "Unknown"}
                              </span>
                            </div>

                            <p className="text-[#7C879C] pt-1 leading-normal break-words">
                              {riskAssessment.reason ||
                                "No risk assessment available."}
                            </p>
                          </div>
                        ) : (
                          <p className="text-xs text-[#5B6472] bg-[#0A0D12] p-3 rounded-md ring-1 ring-[#1E252F]">
                            Risk assessment is not available from the
                            supplied repository evidence.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Stack Trace */}
                {resultTab === "stack" && (
                  <div className="bg-[#10141B] rounded-lg ring-1 ring-[#1E252F] p-4 sm:p-6 space-y-5">
                    <div>
                      <h2 className="font-semibold text-base text-[#E6E9EF] mb-1">
                        Parsed call stack
                      </h2>

                      <p className="text-[#7C879C] text-xs">
                        Execution flow leading to the exception frame.
                      </p>
                    </div>

                    {stackBreakdown.length > 0 ? (
                      <div className="space-y-2.5 relative before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-px before:bg-[#1E252F]">
                        {stackBreakdown.map((frame, idx) => {
                          const isErrorFrame =
                            idx === stackBreakdown.length - 1;

                          return (
                            <div
                              key={idx}
                              className="relative flex items-start gap-3 pl-8"
                            >
                              <div
                                className={`absolute left-2 top-2.5 w-3 h-3 rounded-full border-2 bg-[#10141B] ${
                                  isErrorFrame
                                    ? "border-[#F87171]"
                                    : "border-[#38BDF8]"
                                }`}
                              />

                              <div
                                className={`flex-1 min-w-0 p-3 rounded-md border text-xs font-mono flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 ${
                                  isErrorFrame
                                    ? "bg-[#251114]/60 border-[#3A181C] text-[#FCA5A5]"
                                    : "bg-[#0A0D12] border-[#1E252F] text-[#C7CDDA]"
                                }`}
                              >
                                <div className="flex items-baseline gap-2 min-w-0">
                                  <span className="font-semibold shrink-0">
                                    {frame.functionName || "anonymous"}
                                  </span>

                                  <span className="text-[#5B6472] shrink-0">
                                    in
                                  </span>

                                  <span
                                    className="underline decoration-dotted underline-offset-2 truncate"
                                    title={frame.file}
                                  >
                                    {frame.file}
                                  </span>
                                </div>

                                <span className="font-medium text-[#7C879C] shrink-0">
                                  Line {frame.line || "?"}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="bg-[#0A0D12] rounded-md p-4 text-sm text-[#7C879C] ring-1 ring-[#1E252F]">
                        Stack trace breakdown is not available — the
                        pasted input didn't contain any frames matching a
                        recognized stack trace format (Node/JS, Python,
                        or Java).
                      </div>
                    )}
                  </div>
                )}

                {/* Code Patch & Stats */}
                {resultTab === "patch" && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                      <div className="bg-[#10141B] p-3.5 rounded-lg ring-1 ring-[#1E252F] text-center">
                        <p className="text-xs text-[#7C879C] font-medium">
                          Files modified
                        </p>
                        <p className="text-lg font-semibold text-[#E6E9EF] font-mono mt-1">
                          {patchStats.filesModified}
                        </p>
                      </div>

                      <div className="bg-[#10141B] p-3.5 rounded-lg ring-1 ring-[#1E252F] text-center">
                        <p className="text-xs text-[#7C879C] font-medium">
                          Lines added
                        </p>
                        <p className="text-lg font-semibold text-[#34D399] font-mono mt-1">
                          +{patchStats.linesAdded}
                        </p>
                      </div>

                      <div className="bg-[#10141B] p-3.5 rounded-lg ring-1 ring-[#1E252F] text-center">
                        <p className="text-xs text-[#7C879C] font-medium">
                          Lines deleted
                        </p>
                        <p className="text-lg font-semibold text-[#F87171] font-mono mt-1">
                          -{patchStats.linesDeleted}
                        </p>
                      </div>

                      <div className="bg-[#10141B] p-3.5 rounded-lg ring-1 ring-[#1E252F] text-center">
                        <p className="text-xs text-[#7C879C] font-medium">
                          Functions impacted
                        </p>
                        <p className="text-lg font-semibold text-[#38BDF8] font-mono mt-1">
                          {patchStats.functionsChanged}
                        </p>
                      </div>
                    </div>

                    {resData.patch &&
                    (resData.patch.oldCode ||
                      resData.patch.newCode) ? (
                      <div className="bg-[#0A0D12] rounded-lg overflow-hidden ring-1 ring-[#1E252F] font-mono text-xs">
                        <div className="bg-[#10141B] px-3.5 sm:px-4 py-2.5 flex items-center justify-between gap-2 border-b border-[#1E252F] text-[#C7CDDA]">
                          <span className="font-medium flex items-center gap-2 min-w-0">
                            <FileCode2
                              size={14}
                              className="text-[#38BDF8] shrink-0"
                            />

                            <span className="truncate">
                              {resData.patch.file || "diff"}
                            </span>
                          </span>

                          <button
                            type="button"
                            onClick={downloadPatchFile}
                            className="hover:text-[#38BDF8] flex items-center gap-1 text-[#7C879C] font-sans text-xs transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8]/50 rounded"
                          >
                            <Download size={13} />
                            Save diff
                          </button>
                        </div>

                        <div className="overflow-x-auto dc-scroll-x">
                          <div className="min-w-full">
                            {resData.patch.oldCode &&
                              resData.patch.oldCode
                                .split("\n")
                                .map((line, idx) => (
                                  <div
                                    key={`old-${idx}`}
                                    className="flex bg-[#251114]/40 text-[#FCA5A5] whitespace-pre"
                                  >
                                    <span className="select-none text-[#5B6472] px-2.5 py-0.5 text-right w-10 shrink-0 border-r border-[#1E252F]/60">
                                      {idx + 1}
                                    </span>

                                    <span className="select-none text-[#F87171] px-2">
                                      -
                                    </span>

                                    <span className="pr-3 py-0.5">
                                      {line}
                                    </span>
                                  </div>
                                ))}

                            {resData.patch.newCode &&
                              resData.patch.newCode
                                .split("\n")
                                .map((line, idx) => (
                                  <div
                                    key={`new-${idx}`}
                                    className="flex bg-[#0C211A]/40 text-[#7EEAB8] whitespace-pre"
                                  >
                                    <span className="select-none text-[#5B6472] px-2.5 py-0.5 text-right w-10 shrink-0 border-r border-[#1E252F]/60">
                                      {idx + 1}
                                    </span>

                                    <span className="select-none text-[#34D399] px-2">
                                      +
                                    </span>

                                    <span className="pr-3 py-0.5">
                                      {line}
                                    </span>
                                  </div>
                                ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-[#0A0D12] rounded-md p-4 text-sm text-[#7C879C] ring-1 ring-[#1E252F]">
                        No verified code patch is available for this
                        diagnosis. This usually means the repository
                        index doesn't yet contain the file, or the
                        model's proposed snippet didn't match the file
                        on disk exactly and was discarded rather than
                        shown unverified.
                      </div>
                    )}
                  </div>
                )}

                {/* Impact & Similarity */}
                {resultTab === "impact" && (
                  <div className="bg-[#10141B] rounded-lg ring-1 ring-[#1E252F] p-4 sm:p-6 space-y-3">
                    <h2 className="font-semibold text-[#E6E9EF] text-sm">
                      Impacted files & dependencies
                    </h2>

                    <div className="divide-y divide-[#1E252F]">
                      {(
                        resData.affectedFiles || [
                          resData.file || "Unknown File",
                        ]
                      ).map((file, idx) => (
                        <div
                          key={idx}
                          className="py-2.5 flex items-center justify-between gap-3 text-sm"
                        >
                          <span className="font-mono text-[#C7CDDA] flex items-center gap-2 min-w-0">
                            <FileCode2
                              size={15}
                              className="text-[#38BDF8] shrink-0"
                            />

                            <span
                              className="truncate"
                              title={file}
                            >
                              {file}
                            </span>
                          </span>

                          <span className="text-[11px] bg-[#0A0D12] text-[#8A93A6] px-2 py-1 rounded ring-1 ring-[#1E252F] shrink-0">
                            Direct reference
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI Insights & Learn */}
                {resultTab === "learn" && (
                  <div className="bg-[#10141B] rounded-lg ring-1 ring-[#1E252F] p-4 sm:p-6 space-y-5">
                    <div>
                      <h2 className="font-semibold text-[#E6E9EF] text-sm flex items-center gap-2 mb-2">
                        <BookOpen
                          size={16}
                          className="text-[#38BDF8]"
                        />
                        Why this fix works
                      </h2>

                      <p className="text-[#8A93A6] text-sm leading-relaxed whitespace-pre-line break-words">
                        {learnExplanation ||
                          "No explanation available for this diagnostic patch."}
                      </p>
                    </div>

                    <div className="pt-4 border-t border-[#1E252F]">
                      <h2 className="font-semibold text-[#E6E9EF] text-sm flex items-center gap-2 mb-2">
                        <HelpCircle
                          size={16}
                          className="text-[#38BDF8]"
                        />
                        Key takeaway
                      </h2>

                      <p className="text-[#8A93A6] text-sm leading-relaxed whitespace-pre-line break-words">
                        {learnTakeaway ||
                          "No takeaway available for this diagnostic patch."}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <IssueSolver />
        )}
      </div>
    </div>
  );
}