import { useState, useEffect, useMemo, useCallback } from "react";
import { useAnalysis } from "../context/AnalysisContext";
import API from "../services/api";
import Pagination from "../components/Pagination";
import CommitTypeChart from "../components/CommitTypeChart";
import CommitDetails from "../components/CommitDetails";
import CommitStatistics from "../components/CommitStatistics";
import ConstellationField from "../components/ui/constellation-field";
import {
  GitCommit,
  Search,
  User,
  Calendar,
  FileText,
  Plus,
  Minus,
  X,
  ArrowRight,
  FilterX,
} from "lucide-react";

const COMMITS_PER_PAGE = 10;

function Commits() {
  const { analysis, repositoryId } = useAnalysis();

  const commits = useMemo(() => analysis?.allCommits || [], [analysis]);
  const commitStatistics = analysis?.commitStatistics || null;

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [commitDiff, setCommitDiff] = useState("");
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedCommit(null);
    setCommitDiff("");
    setAiSummary(null);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
    closeModal();
  }, [repositoryId, closeModal]);

  useEffect(() => {
    if (isModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isModalOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isModalOpen) {
        closeModal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isModalOpen, closeModal]);

  const filteredCommits = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return commits.filter((commit) => {
      return (
        (commit.message || "").toLowerCase().includes(search) ||
        (commit.author_name || "").toLowerCase().includes(search) ||
        (commit.hash || "").toLowerCase().includes(search)
      );
    });
  }, [commits, searchTerm]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredCommits.length / COMMITS_PER_PAGE)
  );

  const startIndex = (currentPage - 1) * COMMITS_PER_PAGE;

  const paginatedCommits = useMemo(() => {
    return filteredCommits.slice(startIndex, startIndex + COMMITS_PER_PAGE);
  }, [filteredCommits, startIndex]);

  const handleCommitClick = useCallback(
    async (hash) => {
      if (!hash) return;

      setIsModalOpen(true);

      try {
        setLoadingDetails(true);
        setLoadingDiff(true);
        setLoadingSummary(true);

        const [detailsResponse, diffResponse, summaryResponse] =
          await Promise.all([
            API.get(`/repository/commit/${hash}`, {
              params: { repositoryId },
            }),
            API.get(`/repository/commit/${hash}/diff`, {
              params: { repositoryId },
            }),
            API.get(`/repository/commit/${hash}/summary`, {
              params: { repositoryId },
            }),
          ]);

        setSelectedCommit(detailsResponse.data.data);
        setCommitDiff(diffResponse.data.data);
        setAiSummary(summaryResponse.data.data);
      } catch (error) {
        console.error("Error fetching commit details:", error);
      } finally {
        setLoadingDetails(false);
        setLoadingDiff(false);
        setLoadingSummary(false);
      }
    },
    [repositoryId]
  );

  if (!analysis) {
    return (
      <div className="relative flex flex-col justify-center items-center min-h-screen text-slate-300 px-6 overflow-hidden">
        <ConstellationField
          mode="dark"
          density={0.9}
          speed={0.8}
          className="fixed inset-0 z-0 h-full w-full pointer-events-none"
        />
        <div className="relative z-10 flex flex-col items-center max-w-xs text-center">
          <GitCommit className="h-7 w-7 text-slate-600 mb-4" />
          <h2 className="text-base font-semibold text-slate-200">
            No repository analyzed
          </h2>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            Analyze a repository to explore its commit history.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen text-slate-100">
      {/* Animated constellation background */}
      <ConstellationField
        mode="dark"
        density={0.9}
        speed={0.8}
        className="fixed inset-0 z-0 h-full w-full pointer-events-none"
      />

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/70">
          <div className="flex items-center gap-2.5">
            <GitCommit size={18} className="text-slate-500" />
            <div>
              <h1 className="text-lg font-semibold text-slate-100 leading-tight">
                Commits
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Browse commit history and inspect code changes
              </p>
            </div>
          </div>
          <div className="text-xs font-mono text-slate-500 sm:text-right">
            {commits.length.toLocaleString()} commits
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="text"
            placeholder="Search commits, authors, hashes..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full bg-slate-900/70 backdrop-blur-sm border border-slate-800 focus:border-blue-600/70 rounded-md py-2 pl-9 pr-8 text-sm text-slate-200 placeholder-slate-500 outline-none transition-colors"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border border-slate-800/70 rounded-lg p-4 bg-slate-950/60 backdrop-blur-sm">
            <h3 className="text-xs font-medium text-slate-400 mb-3">
              Commit types
            </h3>
            <CommitTypeChart commits={commits} />
          </div>
          <div className="border border-slate-800/70 rounded-lg p-4 bg-slate-950/60 backdrop-blur-sm">
            <h3 className="text-xs font-medium text-slate-400 mb-3">
              Commit statistics
            </h3>
            <CommitStatistics stats={commitStatistics} />
          </div>
        </div>

        {/* Commit list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500 px-0.5">
            <span>
              Showing {filteredCommits.length > 0 ? startIndex + 1 : 0}–
              {Math.min(startIndex + COMMITS_PER_PAGE, filteredCommits.length)}{" "}
              of {filteredCommits.length}
              {searchTerm && <span className="text-slate-400"> (filtered)</span>}
            </span>
          </div>

          {filteredCommits.length === 0 ? (
            <div className="border border-slate-800/70 rounded-lg py-14 text-center bg-slate-950/60 backdrop-blur-sm">
              <FilterX size={22} className="mx-auto text-slate-600 mb-3" />
              <p className="text-sm font-medium text-slate-300">
                No matching commits found
              </p>
              <p className="text-xs text-slate-500 mt-1">
                No commit matches &quot;{searchTerm}&quot;.
              </p>
              <button
                onClick={() => setSearchTerm("")}
                className="text-xs text-blue-400 hover:text-blue-300 mt-3"
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="border border-slate-800/70 rounded-lg divide-y divide-slate-800/70 overflow-hidden bg-slate-950/60 backdrop-blur-sm">
              {paginatedCommits.map((commit) => (
                <button
                  key={commit.hash ?? `${commit.author_name}-${commit.date}`}
                  type="button"
                  onClick={() => commit.hash && handleCommitClick(commit.hash)}
                  className="w-full text-left px-4 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-2.5 hover:bg-slate-900/60 transition-colors group focus:outline-none focus-visible:bg-slate-900/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-100 truncate">
                      {commit.message}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <User size={11} />
                        {commit.author_name}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar size={11} />
                        {new Date(commit.date).toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <FileText size={11} />
                        {commit.files_changed || 0} files
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 text-xs font-mono">
                    <span className="text-slate-600">
                      {(commit.hash || "").substring(0, 7)}
                    </span>
                    <span className="flex items-center gap-0.5 text-emerald-400">
                      <Plus size={10} />
                      {commit.additions || 0}
                    </span>
                    <span className="flex items-center gap-0.5 text-rose-400">
                      <Minus size={10} />
                      {commit.deletions || 0}
                    </span>
                    <ArrowRight
                      size={13}
                      className="text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all hidden sm:block"
                    />
                  </div>
                </button>
              ))}
            </div>
          )}

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        </div>
      </div>

      {/* Commit inspection modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-6">
          <div
            className="fixed inset-0 bg-slate-950/85"
            onClick={closeModal}
          />

          <div className="relative w-full h-full sm:h-auto sm:max-h-[92vh] sm:max-w-5xl bg-slate-950 sm:border border-slate-800 sm:rounded-lg shadow-xl overflow-hidden flex flex-col z-10">
            <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-slate-800/70 shrink-0">
              <div className="min-w-0">
                <p className="text-xs font-mono text-slate-500 truncate">
                  Commit{" "}
                  {selectedCommit?.hash
                    ? selectedCommit.hash.substring(0, 10)
                    : "..."}
                </p>
              </div>
              <button
                onClick={closeModal}
                aria-label="Close commit details"
                className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-900 rounded-md transition-colors shrink-0"
              >
                <X size={17} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              <CommitDetails
                selectedCommit={selectedCommit}
                loadingDetails={loadingDetails}
                loadingDiff={loadingDiff}
                loadingSummary={loadingSummary}
                aiSummary={aiSummary}
                commitDiff={commitDiff}
                onClose={closeModal}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Commits;