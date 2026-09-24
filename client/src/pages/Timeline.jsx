import { useMemo, useState, useEffect, memo } from "react";
import {
  GitCommit,
  GitPullRequest,
  Clock,
  Copy,
  Check,
  History,
  ChevronDown,
  Loader2,
} from "lucide-react";
import CommitActivityGraph from "../components/CommitActivityGraph";
import CommitCalendar from "../components/CommitCalendar";
import PullRequestCard from "../components/PullRequestCard";
import { TYPE_DOT } from "../constants/commitTypes";
import { useAnalysis } from "../context/AnalysisContext";
import API from "../services/api";
import ConstellationField from "../components/ui/constellation-field";

const PAGE_SIZE = 10;

function relativeTime(date) {
  if (!date) return "Unknown date";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function dayLabel(date) {
  if (!date) return "Unknown date";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isSameDay = (a, b) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();

  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

function getInitials(name) {
  return (name || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

const CommitHash = memo(function CommitHash({ hash }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!hash) return null;

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
    } catch {
      // ignore copy failures
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-400 hover:text-slate-200 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 px-2 py-1 rounded-md transition-all mt-2.5 active:scale-95 select-none"
      title="Copy full hash"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
      <span>{hash.substring(0, 7)}</span>
    </button>
  );
});

export default function Timeline() {
  const { analysis } = useAnalysis();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [pullRequests, setPullRequests] = useState([]);
  const [prLoading, setPrLoading] = useState(false);

  const rawCommits = useMemo(() => analysis?.timeline ?? [], [analysis]);

  // Extract owner and repository from analysis object
  const repoUrl =
    analysis?.repoUrl ||
    analysis?.repository?.htmlUrl ||
    analysis?.repository?.url ||
    "";

  const repoInfo = useMemo(() => {
    if (!repoUrl) return null;
    try {
      const cleanUrl = repoUrl.replace(/\.git$/, "").replace(/\/$/, "");
      const parts = new URL(cleanUrl).pathname.split("/").filter(Boolean);
      if (parts.length < 2) return null;
      return { owner: parts[0], repo: parts[1] };
    } catch {
      return null;
    }
  }, [repoUrl]);

  // Fetch pull requests when repository changes
  useEffect(() => {
    if (!repoInfo?.owner || !repoInfo?.repo) {
      setPullRequests([]);
      return;
    }

    const fetchPullRequests = async () => {
      try {
        setPrLoading(true);
        const response = await API.get("/repository/pull-requests", {
          params: {
            owner: repoInfo.owner,
            repo: repoInfo.repo,
          },
        });
        setPullRequests(response.data?.pullRequests || []);
      } catch (error) {
        console.error("Failed to fetch pull requests:", error);
        setPullRequests([]);
      } finally {
        setPrLoading(false);
      }
    };

    fetchPullRequests();
  }, [repoInfo?.owner, repoInfo?.repo]);

  // Reset pagination on repository change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [analysis?.repositoryId ?? analysis?.repoUrl]);

  // Activity Graph mapping (commits by date)
  const graphTimeline = useMemo(
    () =>
      rawCommits.reduce((acc, commit) => {
        const date = commit.date?.slice(0, 10);
        if (!date) return acc;
        acc[date] = (acc[date] || 0) + 1;
        return acc;
      }, {}),
    [rawCommits]
  );

  // Commit-only timeline formatted & sorted chronologically
  const commitTimeline = useMemo(() => {
    return rawCommits
      .map((commit) => ({
        ...commit,
        _date: commit.date ? new Date(commit.date) : null,
        initials: getInitials(commit.author),
      }))
      .sort((a, b) => {
        const dateA = a._date?.getTime() || 0;
        const dateB = b._date?.getTime() || 0;
        return dateB - dateA;
      });
  }, [rawCommits]);

  // Group commits by day
  const groupedCommits = useMemo(() => {
    const visible = commitTimeline.slice(0, visibleCount);
    const groups = [];
    let currentKey = null;

    for (const commit of visible) {
      const key = commit._date ? commit._date.toDateString() : "unknown";
      if (key !== currentKey) {
        groups.push({ key, label: dayLabel(commit._date), commits: [commit] });
        currentKey = key;
      } else {
        groups[groups.length - 1].commits.push(commit);
      }
    }
    return groups;
  }, [commitTimeline, visibleCount]);

  if (!rawCommits.length && !pullRequests.length && !prLoading) {
    return (
      <div className="relative min-h-screen">
        {/* Animated constellation background */}
        <ConstellationField
          mode="dark"
          density={0.9}
          speed={0.8}
          className="fixed inset-0 z-0 h-full w-full pointer-events-none"
        />

        <div className="relative z-10 bg-slate-900/60 backdrop-blur-md rounded-2xl border border-slate-800 p-8 text-center max-w-md mx-auto my-12 shadow-xl">
          <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-slate-700/60 text-slate-400 flex items-center justify-center mx-auto mb-4">
            <History size={24} />
          </div>
          <h2 className="text-lg font-bold text-white">No Activity Found</h2>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            This repository doesn't contain any timeline activity yet, or the repository analysis is currently processing.
          </p>
        </div>
      </div>
    );
  }

  const hasMoreCommits = visibleCount < commitTimeline.length;

  return (
    <div className="relative min-h-screen">
      {/* Animated constellation background */}
      <ConstellationField
        mode="dark"
        density={0.9}
        speed={0.8}
        className="fixed inset-0 z-0 h-full w-full pointer-events-none"
      />

      <div className="relative z-10 space-y-6">
        {/* Activity Overview Header Visualizations */}
        <CommitCalendar timeline={rawCommits} />
        <CommitActivityGraph timeline={graphTimeline} />

        {/* SECTION 1: Commit Timeline */}
        <div className="bg-slate-900/60 backdrop-blur-md rounded-2xl shadow-lg border border-slate-800/80 p-6">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-orange-500/10 text-orange-400 rounded-xl border border-orange-500/20">
                <GitCommit size={20} />
              </div>
              <h2 className="text-lg font-bold text-white tracking-tight">Commit Timeline</h2>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-800/80 text-slate-400 border border-slate-700/50">
              {commitTimeline.length} commits
            </span>
          </div>

          <div>
            {groupedCommits.map((group) => (
              <div key={group.key} className="mb-8 last:mb-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                  {group.label}
                </p>

                <div className="relative border-l-2 border-slate-800/80 ml-3.5 space-y-6">
                  {group.commits.map((commit) => {
                    const dotColor = TYPE_DOT[commit.type] || "bg-indigo-500";

                    return (
                      <div
                        key={commit.hash}
                        className="ml-6 relative group"
                      >
                        {/* Timeline Dot */}
                        <span
                          className={`absolute -left-[31px] top-2 w-3.5 h-3.5 ${dotColor} rounded-full ring-4 ring-slate-900 shadow-sm transition-transform duration-200 group-hover:scale-125`}
                        />

                        <div className="rounded-xl p-4 -mx-2 transition-all duration-200 border border-transparent hover:border-slate-800 hover:bg-slate-800/40">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <p
                              className="text-xs text-slate-400 font-medium flex items-center gap-1.5"
                              title={commit._date ? commit._date.toLocaleString() : undefined}
                            >
                              <Clock size={12} className="text-slate-500" />
                              {relativeTime(commit._date)}
                            </p>

                            {commit.type && (
                              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700/50">
                                {commit.type}
                              </span>
                            )}
                          </div>

                          <h3 className="font-bold text-slate-100 text-sm mt-2 flex items-center gap-2 group-hover:text-orange-400 transition-colors">
                            <GitCommit size={15} className="text-slate-500 shrink-0" />
                            {commit.message || "No commit message"}
                          </h3>

                          <div className="flex items-center gap-2 mt-2.5">
                            <span className="w-5 h-5 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 text-white text-[10px] font-extrabold flex items-center justify-center shrink-0 shadow-xs">
                              {commit.initials}
                            </span>

                            <p className="text-xs text-slate-400 font-medium">
                              {commit.author || "Unknown author"}
                            </p>
                          </div>

                          <CommitHash hash={commit.hash} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {hasMoreCommits && (
            <button
              onClick={() =>
                setVisibleCount((v) => Math.min(v + PAGE_SIZE, commitTimeline.length))
              }
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-800 bg-slate-900/80 text-xs font-bold text-slate-300 hover:bg-slate-800 hover:border-slate-700 hover:text-white transition-all duration-200 mt-6 shadow-sm active:scale-[0.99]"
            >
              <span>Show more commits</span>
              <ChevronDown size={14} />
            </button>
          )}
        </div>

        {/* SECTION 2: Standalone Pull Requests */}
        <div className="bg-slate-900/60 backdrop-blur-md rounded-2xl shadow-lg border border-slate-800/80 p-6">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-purple-500/10 text-purple-400 rounded-xl border border-purple-500/20">
                <GitPullRequest size={20} />
              </div>
              <h2 className="text-lg font-bold text-white tracking-tight">Pull Requests</h2>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-800/80 text-slate-400 border border-slate-700/50">
              {pullRequests.length} PRs
            </span>
          </div>

          {prLoading ? (
            <div className="flex items-center justify-center py-12 text-xs text-slate-400 font-medium">
              <Loader2 size={16} className="mr-2 animate-spin text-purple-400" />
              Loading pull requests...
            </div>
          ) : pullRequests.length === 0 ? (
            <div className="text-center py-10 rounded-xl bg-slate-900/40 border border-slate-800/50">
              <GitPullRequest size={28} className="mx-auto text-slate-600 mb-2.5" />
              <p className="text-xs font-bold text-slate-300">No pull requests found</p>
              <p className="text-[11px] text-slate-500 mt-1">
                This repository doesn't have any open or closed pull requests available.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {pullRequests.map((pr) => (
                <PullRequestCard key={pr.id || pr.number} pullRequest={pr} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}