import React, { useMemo, useState, useDeferredValue } from "react";
import { Search, Trophy, GitCommit, X, Clock } from "lucide-react";

const RANK_BADGES = [
  {
    chip: "bg-amber-400/10 text-amber-400 border-amber-400/20",
    medal: "bg-amber-400 text-amber-950",
    label: "1st",
  },
  {
    chip: "bg-slate-400/10 text-slate-300 border-slate-400/20",
    medal: "bg-slate-300 text-slate-900",
    label: "2nd",
  },
  {
    chip: "bg-orange-400/10 text-orange-400 border-orange-400/20",
    medal: "bg-orange-400 text-orange-950",
    label: "3rd",
  },
];

const numberFormatter = new Intl.NumberFormat("en-US");

function getInitial(name) {
  return (name || "U").trim().charAt(0).toUpperCase();
}

function relativeTime(date) {
  if (!date) return null;
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function TopContributors({
  contributors = [],
  aggregates = {},
  activeContributor,
  onSelect,
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const totalCommits = useMemo(
    () => contributors.reduce((sum, c) => sum + (c.commits || 0), 0),
    [contributors]
  );

  const filtered = useMemo(() => {
    if (!deferredQuery.trim()) return contributors;
    const q = deferredQuery.toLowerCase();
    return contributors.filter((c) =>
      (c.name || "").toLowerCase().includes(q)
    );
  }, [contributors, deferredQuery]);

  return (
    <div className="w-full bg-[#10151C]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 sm:p-5 border-b border-white/[0.08]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 p-2 rounded-[8px] bg-sky-400/10 text-sky-400 border border-sky-400/20">
            <Trophy size={16} strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[13.5px] font-semibold text-white">
              Top Contributors
            </h2>
            <p className="text-[12px] text-[#7C8698] tabular-nums">
              {numberFormatter.format(totalCommits)} total commits across team
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64 shrink-0">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7C8698] pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search team members..."
            aria-label="Search contributors"
            className="w-full text-[13px] border border-white/[0.08] rounded-[8px] pl-8 pr-8 py-2.5 sm:py-2 bg-[#0A0D12] text-[#E7EAEF] placeholder:text-[#5C6779] outline-none transition-colors focus:border-sky-400/50 focus:ring-2 focus:ring-sky-400/20 min-h-[40px] sm:min-h-0"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7C8698] hover:text-[#C7CCD6] p-0.5 rounded transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="p-2.5 sm:p-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center rounded-[10px] border border-dashed border-white/[0.08]">
            <div className="p-2.5 rounded-full bg-white/[0.05] text-[#7C8698] mb-2.5">
              <Search size={18} strokeWidth={1.75} />
            </div>
            {contributors.length === 0 ? (
              // No contributors at all — most likely the active time-range
              // filter has no commits in it, not a search-box problem.
              <>
                <p className="text-sm font-medium text-[#E7EAEF]">
                  No commit activity in this time range
                </p>
                <p className="text-xs text-[#7C8698] mt-0.5">
                  Try widening the time range filter above
                </p>
              </>
            ) : (
              // Contributors exist, but the search query matched none of them.
              <>
                <p className="text-sm font-medium text-[#E7EAEF]">
                  No contributors found
                </p>
                <p className="text-xs text-[#7C8698] mt-0.5">
                  Try adjusting your search terms
                </p>
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    className="mt-3 text-xs font-medium text-sky-400 hover:text-sky-300 transition-colors"
                  >
                    Clear search
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <ul
            className="space-y-2 max-h-[520px] overflow-y-auto pr-1 -mr-1
              [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.15)_transparent]
              [&::-webkit-scrollbar]:w-1.5
              [&::-webkit-scrollbar-track]:bg-transparent
              [&::-webkit-scrollbar-thumb]:bg-white/[0.12]
              [&::-webkit-scrollbar-thumb]:rounded-full
              [&::-webkit-scrollbar-thumb:hover]:bg-white/[0.2]"
          >
            {filtered.map((contributor, index) => {
              const commits = contributor.commits || 0;
              const pct =
                totalCommits > 0
                  ? ((commits / totalCommits) * 100).toFixed(1)
                  : "0.0";
              const agg = aggregates[contributor.name] || {};
              const isActive = activeContributor === contributor.name;
              const isTop3 = index < 3;
              const badgeStyle = RANK_BADGES[index];

              return (
                <li key={contributor.name || index}>
                  <button
                    type="button"
                    onClick={() => onSelect?.(contributor.name)}
                    aria-pressed={isActive}
                    aria-label={`${contributor.name || "Unknown contributor"}, rank ${index + 1}, ${commits} commits`}
                    className={`w-full text-left rounded-[10px] border p-3 sm:p-4 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40 ${
                      isActive
                        ? "border-sky-400/40 bg-sky-400/[0.06]"
                        : "border-white/[0.08] bg-white/[0.015] hover:border-white/[0.14] hover:bg-white/[0.03]"
                    }`}
                  >
                    {/* Top row: avatar/name + commits */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                        <div className="relative shrink-0">
                          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/[0.05] border border-white/[0.08] text-[#C7CCD6] font-semibold flex items-center justify-center text-xs sm:text-sm">
                            {getInitial(contributor.name)}
                          </div>
                          {isTop3 && (
                            <span
                              className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full ring-2 ring-[#10151C] font-bold text-[9px] flex items-center justify-center ${badgeStyle.medal}`}
                            >
                              {index + 1}
                            </span>
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="font-semibold text-[13.5px] sm:text-sm text-white truncate">
                            {contributor.name || "Unknown Contributor"}
                          </p>
                          {contributor.email && (
                            <p className="text-[11.5px] text-[#7C8698] truncate">
                              {contributor.email}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="font-semibold text-white text-[13.5px] sm:text-base flex items-center gap-1 justify-end tabular-nums">
                          <GitCommit size={12} className="text-[#7C8698]" />
                          {numberFormatter.format(commits)}
                        </div>
                        <p className="text-[10.5px] text-[#7C8698]">commits</p>
                      </div>
                    </div>

                    {/* Rank chip row */}
                    <div className="mt-2">
                      {isTop3 ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${badgeStyle.chip}`}
                        >
                          {badgeStyle.label} contributor
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#7C8698] tabular-nums">
                          Rank #{index + 1}
                        </span>
                      )}
                    </div>

                    {/* Progress bar */}
                    <div className="mt-3 h-1 w-full bg-white/[0.08] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-sky-400 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(Math.max(Number(pct), 2), 100)}%`,
                        }}
                      />
                    </div>

                    {/* Footer stats */}
                    <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5 mt-2.5 text-xs">
                      <span className="text-[#7C8698] tabular-nums">
                        {pct}% share
                      </span>

                      {typeof agg.additions === "number" && (
                        <span className="font-mono text-[11px] text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded px-1.5 py-0.5 tabular-nums">
                          +{numberFormatter.format(agg.additions)}
                        </span>
                      )}
                      {typeof agg.deletions === "number" && (
                        <span className="font-mono text-[11px] text-rose-400 bg-rose-400/10 border border-rose-400/20 rounded px-1.5 py-0.5 tabular-nums">
                          -{numberFormatter.format(agg.deletions)}
                        </span>
                      )}

                      {agg.lastActive && (
                        <span className="text-[#7C8698] flex items-center gap-1 ml-auto shrink-0">
                          <Clock size={11} />
                          Active {relativeTime(agg.lastActive)}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}