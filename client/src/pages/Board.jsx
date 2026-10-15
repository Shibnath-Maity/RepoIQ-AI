import { useMemo, useEffect } from "react";
import {
  GitCommit,
  Users,
  FileCode2,
  Flame,
  Code2,
  ArrowUpRight,
} from "lucide-react";

import FileAnalysis from "../components/FileAnalysis";
import RepositoryOverview from "../components/RepositoryOverview";
import StatCard from "../components/StatCard";
import LanguageDistribution from "../components/LanguageDistribution";
import ProjectHealthScore from "../components/ProjectHealthScore";
import DownloadRepositoryReport from "../components/DownloadRepositoryReport";
import RepositoryStructure from "../components/RepositoryStructure";
import ArchitectureDiagram from "../components/ArchitectureDiagram";
import { useAnalysis } from "../context/AnalysisContext";
import ConstellationField from "../components/ui/constellation-field";

// ---- helpers -------------------------------------------------------------

const emptyFileAnalysis = { totalFiles: 0, mostChangedFiles: [], allFiles: [] };
const emptyLanguageAnalysis = { totalFiles: 0, languages: [] };

// Shared constellation background — fixed behind every state of this page
// (loading, empty, and the populated dashboard) so it stays visible while
// scrolling and never competes with the foreground content, which is
// rendered in its own "relative z-10" stacking context above it.
function DashboardBackdrop() {
  return (
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
  );
}

function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = [
  "bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/25",
  "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25",
  "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/25",
  "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25",
  "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/25",
  "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/25",
];

function avatarColor(name = "") {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function SectionHeader({ title, subtitle, count, icon: Icon, action }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="flex items-center gap-2.5 min-w-0">
        {Icon && <Icon size={16} className="text-slate-500 shrink-0" />}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
        {count !== undefined && (
          <span className="text-[11px] font-medium text-slate-400 bg-slate-900 border border-slate-800 rounded-md px-1.5 py-0.5">
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

function Section({ children, className = "" }) {
  return (
    <section className={`pt-8 border-t border-slate-800/70 first:border-t-0 first:pt-0 ${className}`}>
      {children}
    </section>
  );
}

// ---- component ------------------------------------------------------------

function Board() {
  const { analysis, loading, repositoryId } = useAnalysis();

  // Destructure architecture from analysis context
  const {
    stats = {},
    contributors = {},
    fileAnalysis = emptyFileAnalysis,
    languageAnalysis = emptyLanguageAnalysis,
    architecture = null,
    recentCommits = [],
    allCommits = [],
    hotspots = [],
    codeEvolution = [],
    repoInfo = null,
    repoUrl = "",
  } = analysis || {};

  /*
   * TEMPORARY DIAGNOSTIC LOGGING - architecture data boundary.
   *
   * Fires whenever the `architecture` object coming out of
   * AnalysisContext changes (initial load, or a background-poll
   * update once architectureService finishes). Use this to confirm
   * whether an incorrect/generic diagram is caused by the backend
   * response itself or by something downstream in this component /
   * ArchitectureDiagram. Safe to remove once confirmed.
   */
  useEffect(() => {
    if (architecture) {
      console.log("ARCHITECTURE API RESPONSE:", architecture);
      console.log("ARCHITECTURE NODES:", architecture?.flow?.nodes);
      console.log("ARCHITECTURE EDGES:", architecture?.flow?.edges);
    }
  }, [architecture]);

  const contributorEntries = useMemo(
    () =>
      Object.entries(contributors || {}).sort(
        (a, b) => (b[1]?.commits || 0) - (a[1]?.commits || 0)
      ),
    [contributors]
  );

  if (loading) {
    return (
      <div className="relative min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 font-sans px-4">
        <DashboardBackdrop />
        <div className="relative z-10 text-center space-y-4">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-800 border-t-indigo-400" />
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Analyzing repository</h2>
            <p className="text-slate-500 text-xs mt-1">Parsing commits, file structure, and architecture</p>
          </div>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="relative min-h-screen flex items-center justify-center bg-slate-950 text-slate-100 font-sans px-4">
        <DashboardBackdrop />
        <div className="relative z-10 text-center max-w-sm space-y-3">
          <div className="inline-flex p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-500 mb-1">
            <Code2 size={20} />
          </div>
          <h2 className="text-base font-semibold text-slate-100">No repository selected</h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            Go to the Home page and analyze a GitHub repository to see commit history, architecture, and code health here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative bg-slate-950 text-slate-100 min-h-screen font-sans">
      <DashboardBackdrop />

      <div className="relative z-10 max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

        {/* Repository Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-6 border-b border-slate-800/70">
          <div className="min-w-0 space-y-1">
            <h1 className="text-lg sm:text-xl font-semibold text-white tracking-tight truncate">
              Repository Dashboard
            </h1>
            {repoUrl && (
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex items-center gap-1 text-xs font-mono text-slate-500 hover:text-indigo-400 transition-colors break-all"
              >
                <span className="break-all">{repoUrl}</span>
                <ArrowUpRight size={11} className="shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" />
              </a>
            )}
          </div>

          <div className="shrink-0">
            <DownloadRepositoryReport
              repoUrl={repoUrl}
              stats={stats}
              contributors={contributors}
              fileAnalysis={fileAnalysis}
              languageAnalysis={languageAnalysis}
              architecture={architecture}
              codeEvolution={codeEvolution}
              hotspots={hotspots}
              recentCommits={recentCommits}
            />
          </div>
        </div>

        <div className="space-y-8 py-8">

          {/* Repository Overview */}
          {repoInfo && (
            <Section className="!border-t-0 !pt-0">
              <RepositoryOverview repo={repoInfo} />
            </Section>
          )}

          {/* Stats Row */}
          <Section className={repoInfo ? undefined : "!border-t-0 !pt-0"}>
            <div className="grid grid-cols-2 lg:grid-cols-4 border border-slate-800/80 rounded-lg divide-y divide-x-0 sm:divide-y-0 sm:divide-x divide-slate-800/80 overflow-hidden">
              <StatCard
                title="Total Commits"
                value={stats?.totalCommits || 0}
                type="commits"
                icon={GitCommit}
                color="from-blue-600 to-indigo-600"
                trend="from last analysis"
              />

              <StatCard
                title="Contributors"
                value={contributorEntries.length}
                type="contributors"
                icon={Users}
                color="from-emerald-600 to-teal-600"
                trend="active authors"
              />

              <StatCard
                title="Total Files"
                value={fileAnalysis?.totalFiles || 0}
                type="files"
                icon={FileCode2}
                color="from-purple-600 to-fuchsia-600"
                trend="in codebase"
              />

              <StatCard
                title="Hotspots"
                value={hotspots?.length || 0}
                type="hotspots"
                icon={Flame}
                color="from-amber-600 to-rose-600"
                trend="high churn files"
              />
            </div>
          </Section>

          {/* Project Health Score */}
          <Section>
            <ProjectHealthScore
              stats={stats}
              fileAnalysis={fileAnalysis}
              codeEvolution={codeEvolution}
              architecture={architecture}
              languageAnalysis={languageAnalysis}
              commits={allCommits}
            />
          </Section>

          {/* Repository Structure */}
          <Section>
            <RepositoryStructure architecture={architecture} />
          </Section>

          {/* Interactive Architecture Flow Diagram */}
          <Section>
            <ArchitectureDiagram architecture={architecture} />
          </Section>

          {/* Language Distribution */}
          <Section>
            <LanguageDistribution languageAnalysis={languageAnalysis} />
          </Section>

          {/* Unified File Analysis with On-Demand AI */}
          <Section>
            <FileAnalysis fileAnalysis={fileAnalysis} repositoryId={repositoryId} />
          </Section>

          {/* Contributors List Section */}
          <Section>
            <SectionHeader
              title="Contributors"
              subtitle="Ranked by total commit contributions"
              count={contributorEntries.length}
              icon={Users}
            />

            {contributorEntries.length === 0 ? (
              <div className="text-slate-500 text-sm py-10 text-center border border-dashed border-slate-800 rounded-lg">
                No contributors detected in repository timeline.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {contributorEntries.map(([name, contributor]) => {
                  const displayName = contributor.name || name;
                  return (
                    <div
                      key={name}
                      className="flex items-center justify-between gap-3 p-2.5 border border-slate-800/80 rounded-lg hover:border-slate-700 transition-colors min-w-0"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`h-8 w-8 shrink-0 rounded-md flex items-center justify-center text-[11px] font-semibold ${avatarColor(
                            displayName
                          )}`}
                        >
                          {initials(displayName)}
                        </div>
                        <span className="font-medium text-sm text-slate-200 truncate">
                          {displayName}
                        </span>
                      </div>

                      <span className="text-slate-400 font-mono text-[11px] shrink-0 tabular-nums">
                        {contributor.commits || 0} commits
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

        </div>
      </div>
    </div>
  );
}

export default Board;