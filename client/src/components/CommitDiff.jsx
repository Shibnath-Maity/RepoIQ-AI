
import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import API from "../services/api";

import {
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  Code2,
  Plus,
  Minus,
  Zap,
  Maximize2,
  Minimize2,
} from "lucide-react";

/**
 * Parses a unified diff string into per-file blocks with typed lines
 * and tracks addition/deletion metrics per file.
 */
function parseDiff(raw) {
  if (!raw) return [];

  const lines = raw.split("\n");
  const files = [];
  let current = null;

  lines.forEach((line) => {
    if (line.startsWith("diff --git")) {
      const pathMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);

      const path = pathMatch
        ? pathMatch[2] || pathMatch[1]
        : line.replace("diff --git a/", "").split(" b/")[0];

      current = {
        path,
        lines: [],
        additions: 0,
        deletions: 0,
      };

      files.push(current);
      return;
    }

    if (!current) {
      current = {
        path: "changes",
        lines: [],
        additions: 0,
        deletions: 0,
      };

      files.push(current);
    }

    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("index ")
    ) {
      return;
    }

    let type = "context";

    if (line.startsWith("@@")) {
      type = "hunk";
    } else if (line.startsWith("+")) {
      type = "add";
      current.additions++;
    } else if (line.startsWith("-")) {
      type = "del";
      current.deletions++;
    }

    current.lines.push({ type, text: line });
  });

  return files;
}

const lineStyles = {
  hunk: "bg-indigo-500/15 text-indigo-300 font-mono font-semibold py-1 my-1 border-y border-indigo-500/20",
  add: "bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15",
  del: "bg-rose-500/10 text-rose-300 hover:bg-rose-500/15",
  context: "text-slate-300 hover:bg-slate-800/30",
};

function CommitDiff({ hash }) {
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState("idle");
  const [openFiles, setOpenFiles] = useState({});
  const [copiedPath, setCopiedPath] = useState(null);

  useEffect(() => {
    if (!hash) return;

    const controller = new AbortController();

    async function fetchDiff() {
      setStatus("loading");

      try {
        const res = await API.get(
          `/repository/commit/${encodeURIComponent(hash)}/diff`,
          { signal: controller.signal }
        );

        const parsed = parseDiff(res.data.data);

        setFiles(parsed);

        setOpenFiles(
          Object.fromEntries(parsed.map((_, i) => [i, true]))
        );

        setStatus("done");
      } catch (err) {
        if (
          axios.isCancel(err) ||
          err.code === "ERR_CANCELED" ||
          controller.signal.aborted
        ) {
          return;
        }

        console.error("Failed to load commit diff:", err);
        setStatus("error");
      }
    }

    fetchDiff();

    return () => controller.abort();
  }, [hash]);

  const toggleFile = (i) => {
    setOpenFiles((prev) => ({
      ...prev,
      [i]: !prev[i],
    }));
  };

  const toggleAllFiles = (expand) => {
    setOpenFiles(
      Object.fromEntries(files.map((_, i) => [i, expand]))
    );
  };

  const allExpanded = useMemo(() => {
    return files.length > 0 && files.every((_, i) => openFiles[i]);
  }, [files, openFiles]);

  async function copyFile(path, i) {
    const text = files[i].lines.map((line) => line.text).join("\n");

    try {
      await navigator.clipboard.writeText(text);

      setCopiedPath(path);

      setTimeout(() => setCopiedPath(null), 1500);
    } catch (err) {
      console.error("Failed to copy diff:", err);
    }
  }

  return (
    <div className="space-y-4 font-sans text-slate-100">
      {/* Top Header Controls */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Zap size={18} className="text-indigo-400" />

          <h2 className="font-bold text-sm text-white tracking-wide">
            Unified Diff Viewer
          </h2>

          {status === "done" && (
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/60">
              {files.length} {files.length === 1 ? "file" : "files"}
            </span>
          )}
        </div>

        {status === "done" && files.length > 0 && (
          <button
            onClick={() => toggleAllFiles(!allExpanded)}
            className="flex items-center gap-1.5 text-xs font-mono text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg px-2.5 py-1 transition-all cursor-pointer"
          >
            {allExpanded ? (
              <>
                <Minimize2 size={12} /> Collapse All
              </>
            ) : (
              <>
                <Maximize2 size={12} /> Expand All
              </>
            )}
          </button>
        )}
      </div>

      {/* Loading State */}
      {status === "loading" && (
        <div className="flex flex-col items-center justify-center gap-3 py-12 bg-slate-900/40 border border-slate-800/80 rounded-2xl backdrop-blur-xl">
          <Loader2
            className="animate-spin text-indigo-400"
            size={22}
          />

          <p className="text-xs font-mono text-slate-400">
            Loading commit diffs...
          </p>
        </div>
      )}

      {/* Error State */}
      {status === "error" && (
        <div className="flex items-center gap-3 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-2xl px-4 py-3">
          <AlertCircle size={16} className="shrink-0" />

          <span>
            Could not load the code diff for this commit. Please try again.
          </span>
        </div>
      )}

      {/* Empty State */}
      {status === "done" && files.length === 0 && (
        <div className="text-xs font-mono text-slate-500 py-8 text-center bg-slate-900/40 border border-slate-800/80 rounded-2xl">
          No line changes found in this commit.
        </div>
      )}

      {/* Diff Files List */}
      {status === "done" &&
        files.map((file, i) => (
          <div
            key={file.path + i}
            className="rounded-2xl border border-slate-800/80 bg-slate-950 overflow-hidden shadow-xl"
          >
            {/* File Header */}
            <div
              onClick={() => toggleFile(i)}
              className="w-full flex items-center justify-between bg-slate-900/90 hover:bg-slate-900 px-4 py-2.5 border-b border-slate-800/80 cursor-pointer select-none transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                <Code2
                  size={15}
                  className="text-indigo-400 shrink-0"
                />

                <span className="text-xs font-mono font-medium text-slate-200 truncate">
                  {file.path}
                </span>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {/* Addition / Deletion Stats */}
                <div className="flex items-center gap-1.5 text-[11px] font-mono">
                  {file.additions > 0 && (
                    <span className="flex items-center text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                      <Plus size={10} />
                      {file.additions}
                    </span>
                  )}

                  {file.deletions > 0 && (
                    <span className="flex items-center text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                      <Minus size={10} />
                      {file.deletions}
                    </span>
                  )}
                </div>

                {/* Copy Code Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyFile(file.path, i);
                  }}
                  className="flex items-center gap-1 text-[11px] font-mono text-slate-400 hover:text-white border border-slate-700/60 hover:border-slate-600 rounded-lg px-2 py-1 bg-slate-800/60 hover:bg-slate-800 transition-all cursor-pointer"
                >
                  {copiedPath === file.path ? (
                    <Check
                      size={12}
                      className="text-emerald-400"
                    />
                  ) : (
                    <Copy size={12} />
                  )}

                  <span>
                    {copiedPath === file.path ? "Copied" : "Copy"}
                  </span>
                </button>

                {/* Expand / Collapse Icon */}
                <div className="text-slate-400">
                  {openFiles[i] ? (
                    <ChevronUp size={16} />
                  ) : (
                    <ChevronDown size={16} />
                  )}
                </div>
              </div>
            </div>

            {/* Expandable Code Content */}
            {openFiles[i] && (
              <pre className="font-mono text-xs leading-6 bg-slate-950 p-2 m-0 overflow-x-auto custom-scrollbar">
                {file.lines.map((line, idx) => (
                  <div
                    key={idx}
                    className={`px-3 transition-colors rounded-sm flex ${lineStyles[line.type]}`}
                  >
                    <span className="whitespace-pre flex-1">
                      {line.text.length > 0 ? line.text : "\u00A0"}
                    </span>
                  </div>
                ))}
              </pre>
            )}
          </div>
        ))}
    </div>
  );
}

export default CommitDiff;
