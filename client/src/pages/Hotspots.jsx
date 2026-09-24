import React, { useEffect, useMemo, useState, useCallback } from "react";
import HotspotDetails from "../components/HotspotDetails";
import HotspotStats from "../components/Hotspots/HotspotStats";
import HotspotToolbar from "../components/Hotspots/HotspotToolbar";
import HotspotListItem from "../components/Hotspots/HotspotListItem";
import HotspotPagination, {
  getPageNumbers,
} from "../components/Hotspots/HotspotPagination";
import HotspotEmptyState from "../components/Hotspots/HotspotEmptyState";

import { useAnalysis } from "../context/AnalysisContext";
import { Flame, GitFork, Sparkles } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import ConstellationField from "../components/ui/constellation-field";

const ITEMS_PER_PAGE = 10;

const DEFAULT_AI_INSIGHT = {
  riskLevel: "Unknown",
  summary: "No AI insight was matched to this hotspot file.",
  recommendations: [],
  impact: "No impact analysis available.",
};

// Helper for consistent case-insensitive path comparisons
const normalizePath = (value) =>
  String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .trim()
    .toLowerCase();

function normalizeFileField(item) {
  const rawPath =
    item.file || item.path || item.filename || item.filePath || "Unknown file";
  const normalizedPath = String(rawPath)
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .trim();

  return {
    ...item,
    file: normalizedPath,
  };
}

export default function Hotspots() {
  const { analysis, repositoryId } = useAnalysis();

  const [searchTerm, setSearchTerm] = useState("");
  const [sortKey, setSortKey] = useState("score");
  const [selectedFile, setSelectedFile] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  // Mobile-only: controls whether the details inspector is expanded below the list
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);

  // Safely extract and normalize hotspots list
  const hotspots = useMemo(() => {
    const raw = analysis?.hotspots;
    if (Array.isArray(raw)) return raw.map(normalizeFileField);
    return (raw?.hotspots || []).map(normalizeFileField);
  }, [analysis]);

  // Extract and normalize AI insights, preserving object keys (filenames) if raw is a dictionary
  const hotspotInsights = useMemo(() => {
    const raw =
      analysis?.hotspotInsights ??
      analysis?.hotspotsInsight ??
      [];

    if (!raw) return [];

    let list = [];

    if (Array.isArray(raw)) {
      list = raw;
    } else if (typeof raw === "object") {
      // Handle key-value objects like { "index.html": { riskLevel: "High" } }
      list = Object.entries(raw).map(([key, value]) => {
        if (!value || typeof value !== "object") {
          return null;
        }

        return {
          ...value,
          file:
            value.file ||
            value.path ||
            value.filename ||
            value.filePath ||
            key,
        };
      });
    }

    return list
      .filter(Boolean)
      .map((item) => {
        const rawPath =
          item.file ||
          item.path ||
          item.filename ||
          item.filePath ||
          "";

        return {
          ...item,
          file: String(rawPath)
            .replace(/\\/g, "/")
            .replace(/^\.\/+/, "")
            .trim(),
        };
      })
      .filter((item) => item.file);
  }, [analysis]);

  // Fast O(1) insight lookup map indexed by both full path and filename fallback
  const insightMap = useMemo(() => {
    const map = new Map();

    hotspotInsights.forEach((item) => {
      const path = normalizePath(item.file);
      if (!path) return;

      map.set(path, item);

      // Index by filename alone for fallback matching (e.g. "src/index.html" -> "index.html")
      const filename = path.split("/").pop();
      if (filename) {
        map.set(filename, item);
      }
    });

    return map;
  }, [hotspotInsights]);

  // Calculate score fields
  const scoredHotspots = useMemo(
    () =>
      hotspots.map((item) => ({
        ...item,
        score: item.score ?? item.changes ?? 0,
      })),
    [hotspots]
  );

  const maxScore = useMemo(
    () =>
      scoredHotspots.reduce(
        (max, item) => Math.max(max, item.score || 0),
        0
      ),
    [scoredHotspots]
  );

  // Filter and secondary sort by file name to prevent re-order flickering
  const filteredHotspots = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const filtered = scoredHotspots.filter((item) =>
      (item.file || "").toLowerCase().includes(search)
    );
    return [...filtered].sort((a, b) => {
      const diff = (b[sortKey] || 0) - (a[sortKey] || 0);
      if (diff !== 0) return diff;
      return a.file.localeCompare(b.file);
    });
  }, [scoredHotspots, searchTerm, sortKey]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredHotspots.length / ITEMS_PER_PAGE)),
    [filteredHotspots]
  );

  // Clamp current page if total pages change due to search/filtering
  useEffect(() => {
    setCurrentPage((page) => Math.min(page, Math.max(1, totalPages)));
  }, [totalPages]);

  const pageNumbers = useMemo(
    () => getPageNumbers(currentPage, totalPages),
    [currentPage, totalPages]
  );

  const paginatedHotspots = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredHotspots.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredHotspots, currentPage]);

  // Aggregated totals
  const totals = useMemo(() => {
    return scoredHotspots.reduce(
      (acc, item) => {
        acc.additions += item.additions || 0;
        acc.deletions += item.deletions || 0;
        acc.changes += item.changes || 0;
        return acc;
      },
      { additions: 0, deletions: 0, changes: 0 }
    );
  }, [scoredHotspots]);

  // Handle file selection with exact and fallback match logging
  const handleSelectHotspot = useCallback(
    (item) => {
      if (!item) {
        setSelectedFile(null);
        return;
      }

      const normalizedFile = normalizePath(item.file);
      const filename = normalizedFile.split("/").pop();

      const insight =
        insightMap.get(normalizedFile) || insightMap.get(filename);

      setSelectedFile({
        ...item,
        file: item.file,
        aiInsight: insight || DEFAULT_AI_INSIGHT,
      });
      setMobileDetailsOpen(true);
    },
    [insightMap]
  );

  // Synchronize selection cleanly whenever filter set changes
  useEffect(() => {
    if (!filteredHotspots.length) {
      setSelectedFile(null);
      return;
    }

    const currentSelectedPath = selectedFile?.file;
    const isStillInList = filteredHotspots.some(
      (item) => item.file === currentSelectedPath
    );

    if (!isStillInList) {
      handleSelectHotspot(filteredHotspots[0]);
    }
  }, [filteredHotspots, handleSelectHotspot, selectedFile]);

  return (
    <div className="relative min-h-dvh font-sans text-slate-100 antialiased flex flex-col lg:h-dvh lg:overflow-hidden">
      {/* Animated constellation background */}
      <ConstellationField
        mode="dark"
        density={0.9}
        speed={0.8}
        className="fixed inset-0 z-0 h-full w-full pointer-events-none"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-[1700px] flex-1 flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-6 sm:py-4 lg:min-h-0">
        {/* Header Bar */}
        <header className="shrink-0 border-b border-slate-800 pb-3">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-orange-500/20 bg-orange-500/10 text-orange-400">
                <Flame size={16} strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-[15px] font-semibold leading-tight tracking-tight text-white">
                    Code Hotspots
                  </h1>
                  <span className="inline-flex items-center gap-1 rounded border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
                    <Sparkles size={10} strokeWidth={2} />
                    AI insights
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  High-churn files and architectural risk
                </p>
              </div>
            </div>

            {repositoryId && (
              <div className="flex min-w-0 items-center gap-1.5 self-start rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1 text-xs text-slate-400 sm:shrink-0 sm:self-auto">
                <GitFork size={12} strokeWidth={2} className="shrink-0 text-slate-500" />
                <span className="max-w-[220px] truncate font-mono text-[11px] text-slate-300 sm:max-w-[280px]">
                  {repositoryId}
                </span>
              </div>
            )}
          </div>
        </header>

        {!analysis ? (
          <div className="flex flex-1 items-center justify-center py-10">
            <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-800/60 text-slate-400">
                <FaGithub size={18} />
              </div>
              <h3 className="text-sm font-semibold text-slate-200">
                No repository selected
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                Connect a repository to inspect code churn, frequently
                modified files, and hotspot risk.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-3 sm:gap-4 lg:min-h-0">
            {/* Stats Overview */}
            {scoredHotspots.length > 0 && (
              <div className="shrink-0">
                <HotspotStats totals={totals} />
              </div>
            )}

            {/* Split Master-Detail Panel */}
            <div className="grid flex-1 grid-cols-1 gap-3 sm:gap-4 lg:min-h-0 lg:grid-cols-12">
              {/* Left Column: Explorer Panel */}
              <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40 lg:col-span-7">
                <HotspotToolbar
                  searchTerm={searchTerm}
                  setSearchTerm={setSearchTerm}
                  sortKey={sortKey}
                  setSortKey={setSortKey}
                />

                <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Most changed files
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {filteredHotspots.length} file
                    {filteredHotspots.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="divide-y divide-slate-800/70 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                  {filteredHotspots.length === 0 ? (
                    <HotspotEmptyState searchTerm={searchTerm} />
                  ) : (
                    paginatedHotspots.map((item, i) => {
                      const globalIndex =
                        (currentPage - 1) * ITEMS_PER_PAGE + i;
                      const isSelected = selectedFile?.file === item.file;

                      return (
                        <HotspotListItem
                          key={`${item.file}-${globalIndex}`}
                          item={item}
                          globalIndex={globalIndex}
                          maxScore={maxScore}
                          isSelected={isSelected}
                          onSelect={handleSelectHotspot}
                        />
                      );
                    })
                  )}
                </div>

                {filteredHotspots.length > 0 && (
                  <div className="shrink-0 border-t border-slate-800 bg-slate-900/60">
                    <HotspotPagination
                      currentPage={currentPage}
                      totalPages={totalPages}
                      totalItems={filteredHotspots.length}
                      itemsPerPage={ITEMS_PER_PAGE}
                      pageNumbers={pageNumbers}
                      onPageChange={setCurrentPage}
                    />
                  </div>
                )}
              </div>

              {/* Right Column: AI Risk & Details Inspector */}
              {/* Desktop/tablet: always visible. Mobile: expandable section below the list. */}
              <div
                className={`min-h-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40 lg:col-span-5 lg:flex ${
                  mobileDetailsOpen ? "flex" : "hidden lg:flex"
                }`}
              >
                {selectedFile ? (
                  <>
                    <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-2.5 lg:hidden">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Hotspot details
                      </span>
                      <button
                        type="button"
                        aria-label="Close details"
                        onClick={() => setMobileDetailsOpen(false)}
                        className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500/60"
                      >
                        Close
                      </button>
                    </div>
                    <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                      <HotspotDetails
                        selectedHotspot={selectedFile}
                        repositoryId={repositoryId}
                        onClose={() => {
                          setSelectedFile(null);
                          setMobileDetailsOpen(false);
                        }}
                        maxScore={maxScore}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center px-8 py-12 text-center">
                    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-800/60 text-slate-400">
                      <Sparkles size={16} strokeWidth={2} />
                    </div>
                    <p className="text-sm font-medium text-slate-300">
                      No hotspot selected
                    </p>
                    <p className="mt-1 max-w-[220px] text-xs leading-relaxed text-slate-500">
                      Select a file from the list to view its change history
                      and AI risk analysis.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}