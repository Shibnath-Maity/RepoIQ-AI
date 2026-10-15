import { useState, useEffect, useMemo, useRef } from "react";
import { useAnalysis } from "../context/AnalysisContext";

import TopContributors from "../components/TopContributors";
import ContributorStats from "../components/ContributorStats";
import ContributionDistribution from "../components/ContributionDistribution";
import ContributorAI from "../components/ContributorAI";
import ContributorSummaryBar from "../components/ContributorSummaryBar";
import {
  TechnicalFocusCard,
  TopLanguagesCard,
  MostModifiedFilesCard,
} from "../components/ContributorInsightCards";
import TimeRangeFilter from "../components/TimeRangeFilter";
import ConstellationField from "../components/ui/constellation-field";
import {
  Users,
  AlertCircle,
  UserCircle2,
  Info,
  ChevronRight,
  CalendarClock,
} from "lucide-react";

function normalizeContributorName(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .split("|")[0]
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatDate(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Contributors() {
  const { analysis } = useAnalysis();

  const [activeContributor, setActiveContributor] = useState(null);
  const [rangeDays, setRangeDays] = useState(90);

  // Tracks whether the user has deliberately picked a range themselves.
  // Once true, the auto-widen effect below backs off and leaves their
  // choice alone.
  const userChangedRangeRef = useRef(false);

  const showRecentCommits = false;

  const allCommits = useMemo(
    () => analysis?.allCommits ?? [],
    [analysis]
  );

  const fileAnalysis = useMemo(
    () => analysis?.fileAnalysis ?? {},
    [analysis]
  );

  // Reset filter on repository change
  useEffect(() => {
    setRangeDays(90);
    userChangedRangeRef.current = false;
  }, [analysis]);

  const cutoff = useMemo(() => {
    if (!rangeDays) return null;
    return Date.now() - rangeDays * 24 * 60 * 60 * 1000;
  }, [rangeDays]);

  // Time-range-filtered commits — this is the single source of truth
  // for everything on the page that should respect the filter.
  const statsCommits = useMemo(() => {
    if (!cutoff) return allCommits;

    return allCommits.filter(
      (c) => c.date && new Date(c.date).getTime() >= cutoff
    );
  }, [allCommits, cutoff]);

  // Most recent commit across the whole repo (independent of the active
  // range filter) — used to explain an empty range to the user instead of
  // just showing a wall of zeros.
  const mostRecentCommitDate = useMemo(() => {
    let latest = null;
    for (const c of allCommits) {
      if (!c?.date) continue;
      const t = new Date(c.date).getTime();
      if (Number.isNaN(t)) continue;
      if (!latest || t > new Date(latest).getTime()) latest = c.date;
    }
    return latest;
  }, [allCommits]);

  // True when the repo has commit history, but none of it falls inside the
  // currently selected range (e.g. an inactive repo + "Last 30 days").
  const isRangeEmpty = allCommits.length > 0 && statsCommits.length === 0;

  // If the default 90-day window has no commits but the repo does have
  // commit history (e.g. an inactive/older repo), auto-widen to "All time"
  // instead of silently showing an empty dashboard. Only runs until the
  // user deliberately picks a range themselves.
  useEffect(() => {
    if (userChangedRangeRef.current) return;
    if (!rangeDays) return; // already "All time"
    if (isRangeEmpty) {
      userChangedRangeRef.current = true;
      setRangeDays(null);
    }
  }, [isRangeEmpty, rangeDays]);

  const handleRangeChange = (value) => {
    userChangedRangeRef.current = true;
    setRangeDays(value);
  };

  const contributorList = useMemo(() => {
    const map = new Map();

    statsCommits.forEach((commit) => {
      if (!commit) return;

      const rawName =
        commit.author_name ||
        commit.author ||
        commit.name ||
        "";

      const name = String(rawName)
        .replace(/<[^>]+>/g, "")
        .split("|")[0]
        .replace(/\s+/g, " ")
        .trim();

      if (!name) return;

      const key = name.toLowerCase();

      if (!map.has(key)) {
        map.set(key, {
          name,
          commits: 0,
          additions: 0,
          deletions: 0,
        });
      }

      const contributor = map.get(key);

      contributor.commits += 1;
      contributor.additions += Number(commit.additions || 0);
      contributor.deletions += Number(commit.deletions || 0);
    });

    return Array.from(map.values()).sort(
      (a, b) => b.commits - a.commits
    );
  }, [statsCommits]);

  // Preserve active selection
  useEffect(() => {
    if (!contributorList.length) {
      setActiveContributor(null);
      return;
    }

    setActiveContributor((current) => {
      if (!current) {
        const first = contributorList[0];
        return first?.name || first?.author || first?.author_name || first?.login || null;
      }

      const exists = contributorList.some((c) => {
        const name = c.name || c.author || c.author_name || c.login || "";
        return normalizeContributorName(name) === normalizeContributorName(current);
      });

      if (exists) return current;

      const first = contributorList[0];
      return first?.name || first?.author || first?.author_name || first?.login || null;
    });
  }, [contributorList]);

  const aggregates = useMemo(() => {
    return statsCommits.reduce((map, commit) => {
      const author = commit.author_name || commit.author || commit.name;
      if (!author) return map;

      if (!map[author]) {
        map[author] = { additions: 0, deletions: 0, lastActive: null };
      }

      map[author].additions += commit.additions || 0;
      map[author].deletions += commit.deletions || 0;

      if (!map[author].lastActive || new Date(commit.date) > new Date(map[author].lastActive)) {
        map[author].lastActive = commit.date;
      }

      return map;
    }, {});
  }, [statsCommits]);

  // Insights calculation
  const contributorInsights = useMemo(() => {
    if (!activeContributor) {
      return { focus: [], languages: [], files: [] };
    }

    const selected = normalizeContributorName(activeContributor);

    const contributorCommits = statsCommits.filter((c) => {
      const author = normalizeContributorName(c.author_name || c.author || c.name);
      return author === selected;
    });

    const hasCommitFiles = contributorCommits.some(
      (c) => (c.files && c.files.length > 0) || (c.changedFiles && c.changedFiles.length > 0)
    );

    const allFiles = fileAnalysis?.allFiles || [];
    const hasFileContributors = allFiles.some((f) => Array.isArray(f.contributors));

    if (hasCommitFiles) {
      const languageMap = {};
      const fileMap = {};

      contributorCommits.forEach((commit) => {
        const files = commit.files || commit.changedFiles || [];
        files.forEach((file) => {
          const filePath = typeof file === "string" ? file : file.path;
          if (!filePath) return;

          const count = typeof file === "object" ? file.changes || 1 : 1;
          fileMap[filePath] = (fileMap[filePath] || 0) + count;

          const ext = filePath.split(".").pop()?.toLowerCase();
          if (ext) {
            languageMap[ext] = (languageMap[ext] || 0) + count;
          }
        });
      });

      const maxChanges = Math.max(0, ...Object.values(fileMap));
      const totalLang = Object.values(languageMap).reduce((a, b) => a + b, 0);

      const languages = Object.entries(languageMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([ext, count]) => ({
          name: ext.toUpperCase(),
          pct: totalLang ? Math.round((count / totalLang) * 100) : 0,
          count,
        }));

      const files = Object.entries(fileMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([path, changes]) => ({
          path,
          changes,
          pct: maxChanges ? Math.round((changes / maxChanges) * 100) : 0,
        }));

      const directoryMap = {};
      Object.entries(fileMap).forEach(([path, count]) => {
        const parts = path.split("/");
        const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : "Root";
        directoryMap[dir] = (directoryMap[dir] || 0) + count;
      });

      const totalDir = Object.values(directoryMap).reduce((a, b) => a + b, 0);
      const focus = Object.entries(directoryMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, count]) => ({
          label,
          pct: totalDir ? Math.round((count / totalDir) * 100) : 0,
        }));

      return { languages, files, focus };
    }

    if (hasFileContributors) {
      const contributorFiles = allFiles.filter((f) =>
        f.contributors?.some(
          (contribName) => normalizeContributorName(contribName) === selected
        )
      );

      if (!contributorFiles.length) {
        return { focus: [], languages: [], files: [] };
      }

      const languageMap = {};
      const focusMetrics = { Functions: 0, Classes: 0, Conditions: 0, Async: 0 };

      contributorFiles.forEach((file) => {
        const ext = file.path?.split(".").pop()?.toLowerCase();
        if (ext) {
          languageMap[ext] = (languageMap[ext] || 0) + (file.changes || 1);
        }

        const metrics = file.metrics || {};
        focusMetrics.Functions += Number(metrics.functions || 0);
        focusMetrics.Classes += Number(metrics.classes || 0);
        focusMetrics.Conditions += Number(metrics.conditions || 0);
        focusMetrics.Async += Number(metrics.asyncFunctions || 0);
      });

      const totalLang = Object.values(languageMap).reduce((a, b) => a + b, 0);
      const languages = Object.entries(languageMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([ext, count]) => ({
          name: ext.toUpperCase(),
          pct: totalLang ? Math.round((count / totalLang) * 100) : 0,
          count,
        }));

      const maxChanges = Math.max(0, ...contributorFiles.map((f) => Number(f.changes || 0)));

      const files = contributorFiles
        .sort((a, b) => (b.changes || 0) - (a.changes || 0))
        .slice(0, 5)
        .map((file) => ({
          path: file.path,
          changes: Number(file.changes || 0),
          pct: maxChanges
            ? Math.round((Number(file.changes || 0) / maxChanges) * 100)
            : 0,
        }));

      const totalFocus = Object.values(focusMetrics).reduce((a, b) => a + b, 0);
      const focus = Object.entries(focusMetrics)
        .map(([label, value]) => ({
          label,
          pct: totalFocus ? Math.round((value / totalFocus) * 100) : 0,
        }))
        .filter((item) => item.pct > 0)
        .sort((a, b) => b.pct - a.pct);

      return { languages, files, focus };
    }

    return { focus: [], languages: [], files: [] };
  }, [activeContributor, statsCommits, fileAnalysis]);

  const activeRank = useMemo(() => {
    const selected = normalizeContributorName(activeContributor);
    const index = contributorList.findIndex((c) => {
      const name = c.name || c.author || c.author_name || c.login || "";
      return normalizeContributorName(name) === selected;
    });
    return Math.max(0, index);
  }, [contributorList, activeContributor]);

  const handleSelectNext = () => {
    if (!contributorList.length) return;
    const nextIndex = (activeRank + 1) % contributorList.length;
    const nextContrib = contributorList[nextIndex];
    setActiveContributor(
      nextContrib.name || nextContrib.author || nextContrib.author_name || nextContrib.login || null
    );
  };

  return (
    <div className="relative min-h-screen text-[#E7EAEF] antialiased selection:bg-sky-500/20 selection:text-sky-100 [font-feature-settings:'cv11','ss01'] [font-variant-numeric:tabular-nums]">
      {/* Animated constellation background */}
      <ConstellationField
        mode="dark"
        density={0.9}
        speed={0.8}
        className="fixed inset-0 z-0 h-full w-full pointer-events-none"
      />

      <div className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-5 sm:space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-4 pb-5 border-b border-white/[0.08] sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <div className="shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-[10px] bg-gradient-to-b from-white/[0.06] to-transparent bg-[#10151C]/80 backdrop-blur-sm border border-white/[0.08] text-sky-400/90">
              <Users size={18} strokeWidth={1.75} />
            </div>

            <div className="min-w-0 pt-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[20px] sm:text-[22px] font-semibold tracking-[-0.01em] text-white leading-tight">
                  Contributors
                </h1>
                {contributorList.length > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium leading-none rounded-full bg-white/[0.05] text-[#8B94A5] border border-white/[0.08] tabular-nums">
                    {contributorList.length} contributor{contributorList.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <p className="text-[13px] text-[#7C8698] mt-1">
                Developer activity and contribution analytics
              </p>
            </div>
          </div>

          {analysis && (
            <div className="w-full sm:w-auto shrink-0">
              <TimeRangeFilter
                value={rangeDays}
                onChange={handleRangeChange}
              />
            </div>
          )}
        </header>

        {!analysis ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center text-center py-20 sm:py-24 px-6">
            <div className="bg-[#10151C]/80 backdrop-blur-sm text-[#7C8698] p-3 rounded-[12px] border border-white/[0.08] mb-4">
              <AlertCircle size={22} strokeWidth={1.75} />
            </div>
            <h3 className="text-base font-semibold text-white">
              No repository selected
            </h3>
            <p className="text-sm text-[#7C8698] mt-1.5 max-w-xs leading-relaxed">
              Analyze a repository to view contributor activity and code
              attribution.
            </p>
          </div>
        ) : (
          <>
            {/* Empty-range banner — the repo has history, just none inside
                the currently selected time window. Explains the zeros
                below instead of leaving them unexplained. */}
            {isRangeEmpty && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-[10px] border border-amber-400/20 bg-amber-400/[0.05] px-4 py-3">
                <div className="flex items-start gap-2.5">
                  <CalendarClock size={16} strokeWidth={1.75} className="text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[12.5px] text-[#C7CCD6] leading-snug">
                    No commits in this time range.
                    {mostRecentCommitDate && (
                      <>
                        {" "}
                        This repository's most recent activity was on{" "}
                        <span className="font-medium text-white">
                          {formatDate(mostRecentCommitDate)}
                        </span>
                        .
                      </>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRangeChange(null)}
                  className="self-start sm:self-auto shrink-0 text-[12px] font-medium text-amber-400 hover:text-amber-300 border border-amber-400/30 hover:border-amber-400/50 rounded-[8px] px-3 py-1.5 transition-colors duration-150"
                >
                  Switch to All time
                </button>
              </div>
            )}

            {/* Stats Overview */}
            <section>
              <ContributorStats
                contributors={contributorList}
                allCommits={statsCommits}
              />
            </section>

            {/* Info banner */}
            <div className="flex items-center gap-2.5 rounded-[10px] border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm px-3.5 py-2.5 text-[12.5px] text-[#7C8698]">
              <Info size={13} strokeWidth={2} className="text-[#4C5666] shrink-0" />
              <span className="leading-snug">
                Select a contributor below to inspect individual activity and
                contribution patterns.
              </span>
            </div>

            {/* Leaderboard & Distribution */}
            <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              <div className="xl:col-span-7 bg-[#10151C]/80 backdrop-blur-sm rounded-[14px] border border-white/[0.08] min-w-0 overflow-hidden">
                <TopContributors
                  contributors={contributorList}
                  aggregates={aggregates}
                  activeContributor={activeContributor}
                  onSelect={setActiveContributor}
                />
              </div>

              <div className="xl:col-span-5 bg-[#10151C]/80 backdrop-blur-sm rounded-[14px] border border-white/[0.08] min-w-0 overflow-hidden">
                <ContributionDistribution
                  contributors={contributorList}
                />
              </div>
            </section>

            {/* Selected Contributor Profile */}
            {activeContributor ? (
              <section className="space-y-4 pt-1">
                <div className="rounded-[14px] bg-[#10151C]/80 backdrop-blur-sm border border-sky-400/20 overflow-hidden">
                  {/* Profile header: identity + rank/navigation */}
                  <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 border-b border-white/[0.08]">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="shrink-0 flex items-center justify-center w-10 h-10 rounded-[10px] bg-sky-400/10 text-sky-400 border border-sky-400/20">
                        <UserCircle2 size={19} strokeWidth={1.75} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-[#7C8698]">
                          Contributor
                        </p>
                        <h2 className="text-lg sm:text-xl font-semibold text-white truncate">
                          {activeContributor}
                        </h2>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                      <span className="text-[12px] font-medium text-[#8B94A5] bg-white/[0.03] px-2.5 py-2 rounded-[8px] border border-white/[0.08] whitespace-nowrap tabular-nums">
                        Rank #{activeRank + 1} of {contributorList.length}
                      </span>

                      {contributorList.length > 1 && (
                        <button
                          onClick={handleSelectNext}
                          className="flex items-center gap-1.5 text-[12.5px] font-medium bg-white/[0.03] hover:bg-white/[0.07] active:bg-white/[0.1] text-[#E7EAEF] px-3 py-2 rounded-[8px] border border-white/[0.08] hover:border-white/[0.14] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 min-h-[40px]"
                          aria-label={`View next contributor after ${activeContributor}`}
                        >
                          <span>Next</span>
                          <ChevronRight size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Summary Metrics */}
                  <div className="px-4 py-4 sm:px-5 border-b border-white/[0.08]">
                    <ContributorSummaryBar
                      contributorName={activeContributor}
                      allCommits={statsCommits}
                      rank={activeRank}
                    />
                  </div>

                  {/* Analysis */}
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 px-4 py-4 sm:px-5">
                    <div className={showRecentCommits ? "xl:col-span-8 min-w-0" : "xl:col-span-12 min-w-0"}>
                      <div>
                        <div className="mb-3">
                          <h3 className="text-[13.5px] font-semibold text-white">
                            Contributor analysis
                          </h3>
                          <p className="text-[12px] text-[#7C8698] mt-0.5">
                            Automated analysis of development activity
                          </p>
                        </div>
                        <ContributorAI
                          key={activeContributor}
                          contributorName={activeContributor}
                          allCommits={statsCommits}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Technical Breakdown Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
                  <TechnicalFocusCard focus={contributorInsights.focus} />
                  <TopLanguagesCard languages={contributorInsights.languages} />
                  <MostModifiedFilesCard files={contributorInsights.files} />
                </div>
              </section>
            ) : (
              <div className="py-16 text-center bg-[#10151C]/60 backdrop-blur-sm rounded-[14px] border border-dashed border-white/[0.08]">
                <p className="text-sm text-[#7C8698]">
                  {isRangeEmpty
                    ? "No contributor to show \u2014 there are no commits in this time range."
                    : "Select a contributor above to load their developer profile."}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Contributors;