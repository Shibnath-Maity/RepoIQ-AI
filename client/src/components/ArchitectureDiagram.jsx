import React, { useMemo, useState, useCallback, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  BackgroundVariant,
} from "@xyflow/react";
import {
  User,
  Layout,
  Server,
  DoorOpen,
  Globe,
  Shield,
  Target,
  Cpu,
  Database,
  Wrench,
  TestTube,
  Box,
  RotateCcw,
  X,
  AlertTriangle,
  Boxes,
} from "lucide-react";

import "@xyflow/react/dist/style.css";

/* ==========================================================
   THEME & CONFIGURATION

   Colors are used sparingly and only to carry meaning (icon,
   type label, left accent bar, selected border) — never as a
   full node fill. The base surface stays neutral and dark.
========================================================== */

const NODE_CONFIG = {
  actor: { icon: User, title: "User", color: "#60a5fa" },
  frontend: { icon: Layout, title: "Frontend", color: "#22d3ee" },
  backend: { icon: Server, title: "Backend", color: "#a78bfa" },
  entry: { icon: DoorOpen, title: "Entry Point", color: "#34d399" },
  api: { icon: Globe, title: "API Gateway", color: "#fbbf24" },
  middleware: { icon: Shield, title: "Middleware", color: "#f472b6" },
  controller: { icon: Target, title: "Controller", color: "#818cf8" },
  service: { icon: Cpu, title: "Service", color: "#2dd4bf" },
  database: { icon: Database, title: "Database", color: "#fb7185" },
  utility: { icon: Wrench, title: "Utility", color: "#94a3b8" },
  test: { icon: TestTube, title: "Tests", color: "#c084fc" },
  default: { icon: Box, title: "Module", color: "#94a3b8" },
};

const LEGEND_ORDER = [
  "frontend",
  "backend",
  "api",
  "middleware",
  "controller",
  "service",
  "database",
  "utility",
  "test",
];

function configFor(type) {
  return NODE_CONFIG[type] || NODE_CONFIG.default;
}

/* ==========================================================
   CUSTOM ARCHITECTURE NODE
========================================================== */

function ArchitectureNode({ data, selected }) {
  const config = configFor(data?.type);
  const Icon = config.icon;

  return (
    <div
      className={`relative w-[220px] rounded-lg border bg-[#12151b] transition-colors duration-150 ${
        selected
          ? "border-indigo-500/60 shadow-[0_0_0_1px_rgba(99,102,241,0.35)]"
          : "border-slate-800 hover:border-slate-700"
      }`}
    >
      {/* Left accent bar — the only large-scale use of the type color */}
      <div
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
        style={{ backgroundColor: config.color, opacity: selected ? 0.9 : 0.5 }}
      />

      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border !bg-slate-950"
        style={{ borderColor: config.color }}
      />

      <div className="py-2.5 pl-4 pr-3">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border"
            style={{
              backgroundColor: `${config.color}14`,
              borderColor: `${config.color}30`,
              color: config.color,
            }}
          >
            <Icon size={14} strokeWidth={2} />
          </div>

          <div className="min-w-0 flex-1">
            <h4 className="truncate text-[12.5px] font-medium leading-tight text-slate-100">
              {data?.label || config.title}
            </h4>
            <span
              className="mt-0.5 block font-mono text-[10px] font-medium leading-none"
              style={{ color: config.color }}
            >
              {data?.type || "module"}
            </span>
          </div>
        </div>

        {data?.description && (
          <p className="mt-2 line-clamp-2 border-t border-slate-800/70 pt-2 text-[11px] leading-relaxed text-slate-500">
            {data.description}
          </p>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border !bg-slate-950"
        style={{ borderColor: config.color }}
      />
    </div>
  );
}

const nodeTypes = {
  architecture: ArchitectureNode,
};

/* ==========================================================
   DATA VALIDATION
========================================================== */

function sanitizeArchitectureData(rawNodes, rawEdges) {
  const nodes = [];
  const seenNodeIds = new Set();

  for (const node of rawNodes || []) {
    if (!node || typeof node.id !== "string" || !node.id) continue;
    if (seenNodeIds.has(node.id)) continue;
    seenNodeIds.add(node.id);
    nodes.push(node);
  }

  const edges = [];
  const seenEdgeKeys = new Set();

  for (const edge of rawEdges || []) {
    if (!edge || typeof edge.source !== "string" || typeof edge.target !== "string") continue;
    if (!seenNodeIds.has(edge.source) || !seenNodeIds.has(edge.target)) continue;
    if (edge.source === edge.target) continue;

    const key = `${edge.source}->${edge.target}`;
    if (seenEdgeKeys.has(key)) continue;
    seenEdgeKeys.add(key);

    edges.push(edge);
  }

  return { nodes, edges };
}

/* ==========================================================
   AUTOMATIC NODE LAYOUT

   1. Rank nodes by longest path from any root (depth = column).
   2. Within each rank, order nodes by the average position of
      their already-placed predecessors (barycenter heuristic)
      so edges cross as little as possible.
   3. If there are more ranks than fit comfortably in one row,
      wrap into additional bands, alternating direction
      (serpentine) so the flow stays easy to trace by eye
      instead of visually resetting to the left every time.

   The result is deterministic: the same architecture data
   always produces the same layout.
========================================================== */

const MAX_COLUMNS_PER_ROW = 6;
const COLUMN_WIDTH = 268;
const ROW_HEIGHT = 122;
const BAND_GAP = 96;

function computeLayout(rawNodes, rawEdges) {
  if (!rawNodes || rawNodes.length === 0) return [];

  const ids = new Set(rawNodes.map((n) => n.id));
  const validEdges = (rawEdges || []).filter((e) => ids.has(e.source) && ids.has(e.target));

  // --- 1. Longest-path depth per node ---
  const depth = new Map(rawNodes.map((n) => [n.id, 0]));
  for (let i = 0; i < rawNodes.length; i++) {
    let changed = false;
    for (const edge of validEdges) {
      const candidate = depth.get(edge.source) + 1;
      if (candidate > depth.get(edge.target)) {
        depth.set(edge.target, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const distinctRanks = [...new Set(rawNodes.map((n) => depth.get(n.id) || 0))].sort((a, b) => a - b);
  const rankIndex = new Map(distinctRanks.map((rank, index) => [rank, index]));

  // Group nodes by their compact rank, preserving original order.
  const rankGroups = new Map();
  rawNodes.forEach((node, originalIndex) => {
    const rank = rankIndex.get(depth.get(node.id) || 0) ?? 0;
    if (!rankGroups.has(rank)) rankGroups.set(rank, []);
    rankGroups.get(rank).push({ node, originalIndex });
  });

  // --- 2. Barycenter ordering within each rank ---
  const rowPositionById = new Map();
  const sortedRanks = [...rankGroups.keys()].sort((a, b) => a - b);
  const incomingByTarget = new Map();
  for (const edge of validEdges) {
    if (!incomingByTarget.has(edge.target)) incomingByTarget.set(edge.target, []);
    incomingByTarget.get(edge.target).push(edge.source);
  }

  const orderedByRank = new Map();

  sortedRanks.forEach((rank) => {
    const entries = rankGroups.get(rank);

    const withKey = entries.map(({ node, originalIndex }) => {
      const predecessors = (incomingByTarget.get(node.id) || []).filter((sourceId) =>
        rowPositionById.has(sourceId)
      );
      const barycenter =
        predecessors.length > 0
          ? predecessors.reduce((sum, id) => sum + rowPositionById.get(id), 0) / predecessors.length
          : originalIndex + 1000; // no known predecessor: keep stable, push after placed ones
      return { node, originalIndex, barycenter };
    });

    withKey.sort((a, b) => a.barycenter - b.barycenter || a.originalIndex - b.originalIndex);
    withKey.forEach((entry, row) => rowPositionById.set(entry.node.id, row));

    orderedByRank.set(
      rank,
      withKey.map((entry) => entry.node)
    );
  });

  // --- 3. Assign each rank to a band/column, wrapping when there are too many ranks ---
  const bandOfRank = new Map();
  const columnOfRank = new Map();
  sortedRanks.forEach((rank) => {
    bandOfRank.set(rank, Math.floor(rank / MAX_COLUMNS_PER_ROW));
    columnOfRank.set(rank, rank % MAX_COLUMNS_PER_ROW);
  });

  const columnsInBand = new Map();
  sortedRanks.forEach((rank) => {
    const band = bandOfRank.get(rank);
    columnsInBand.set(band, Math.max(columnsInBand.get(band) || 0, columnOfRank.get(rank) + 1));
  });

  const bandHeights = new Map();
  sortedRanks.forEach((rank) => {
    const band = bandOfRank.get(rank);
    const count = orderedByRank.get(rank).length;
    bandHeights.set(band, Math.max(bandHeights.get(band) || 0, count));
  });

  const bandYOffset = new Map();
  let cumulativeY = 0;
  [...bandHeights.keys()].sort((a, b) => a - b).forEach((band) => {
    bandYOffset.set(band, cumulativeY);
    cumulativeY += bandHeights.get(band) * ROW_HEIGHT + BAND_GAP;
  });

  // --- 4. Final positions (serpentine: odd bands flow right-to-left) ---
  const positioned = [];

  sortedRanks.forEach((rank) => {
    const band = bandOfRank.get(rank);
    const column = columnOfRank.get(rank);
    const isReversedBand = band % 2 === 1;
    const bandColumnCount = columnsInBand.get(band);
    const displayColumn = isReversedBand ? bandColumnCount - 1 - column : column;

    const nodesInRank = orderedByRank.get(rank);
    const totalHeight = (nodesInRank.length - 1) * ROW_HEIGHT;
    const yBase = bandYOffset.get(band) || 0;

    nodesInRank.forEach((node, row) => {
      positioned.push({
        ...node,
        type: "architecture",
        width: 220,
        height: 84,
        position: {
          x: displayColumn * COLUMN_WIDTH,
          y: yBase + row * ROW_HEIGHT - totalHeight / 2,
        },
        data: {
          label: node.label,
          type: node.type,
          description: node.description,
          originalNode: node,
        },
      });
    });
  });

  return positioned;
}

/* ==========================================================
   MAIN COMPONENT
========================================================== */

export default function ArchitectureDiagram({ architecture, height = 650, error = null }) {
  const [selectedNode, setSelectedNode] = useState(null);
  const reactFlowInstanceRef = useRef(null);

  const rawNodes = architecture?.flow?.nodes || [];
  const rawEdges = architecture?.flow?.edges || [];

  const sanitized = useMemo(() => sanitizeArchitectureData(rawNodes, rawEdges), [rawNodes, rawEdges]);

  const edges = useMemo(() => {
    return sanitized.edges.map((edge, index) => ({
      id: edge.id || `${edge.source}-${edge.target}-${index}`,
      source: edge.source,
      target: edge.target,
      label: edge.label || "",
      type: "smoothstep",
      animated: true,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#475569",
        width: 12,
        height: 12,
      },
      style: {
        stroke: "#475569",
        strokeWidth: 1.25,
        opacity: 0.55,
      },
      labelStyle: {
        fill: "#94a3b8",
        fontSize: 10,
        fontWeight: 500,
      },
      labelBgStyle: {
        fill: "#0b0e13",
        fillOpacity: 0.92,
        rx: 3,
      },
    }));
  }, [sanitized.edges]);

  const nodes = useMemo(() => computeLayout(sanitized.nodes, sanitized.edges), [sanitized.nodes, sanitized.edges]);

  const legendTypes = useMemo(() => {
    const present = new Set(nodes.map((n) => n.data?.type));
    return LEGEND_ORDER.filter((t) => present.has(t));
  }, [nodes]);

  const riskLevel = useMemo(() => {
    if (architecture?.summary?.riskLevel) return architecture.summary.riskLevel;
    const risks = architecture?.risks || [];
    if (risks.some((r) => r.severity === "High")) return "High";
    if (risks.some((r) => r.severity === "Medium")) return "Medium";
    return "Low";
  }, [architecture]);

  // Config for the currently selected node, resolved once (with the same
  // default fallback ArchitectureNode uses) instead of indexing
  // NODE_CONFIG three separate times in the panel below.
  const selectedConfig = useMemo(
    () => (selectedNode ? configFor(selectedNode.data?.type) : null),
    [selectedNode]
  );

  const handleNodeClick = useCallback((_, node) => setSelectedNode(node), []);

  const handleInit = useCallback((instance) => {
    reactFlowInstanceRef.current = instance;
  }, []);

  const handleResetView = useCallback(() => {
    setSelectedNode(null);
    reactFlowInstanceRef.current?.fitView({ padding: 0.2, minZoom: 0.3, duration: 300 });
  }, []);

  // Stable references so MiniMap doesn't treat these as new props every render.
  const getMiniMapColor = useCallback((n) => configFor(n.data?.type).color, []);

  if (error) {
    return (
      <div
        style={{ height }}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-rose-900/40 bg-[#0b0e13] p-6 text-center"
      >
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg border border-rose-900/40 bg-rose-500/10 text-rose-400">
          <AlertTriangle size={20} />
        </div>
        <h3 className="text-sm font-semibold text-rose-400">Couldn't load architecture</h3>
        <p className="max-w-sm text-xs text-slate-500">
          {typeof error === "string" ? error : "Something went wrong while building the system architecture map."}
        </p>
      </div>
    );
  }

  if (!architecture || sanitized.nodes.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-slate-800 bg-[#0b0e13] p-6 text-center"
      >
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-500">
          <Boxes size={20} />
        </div>
        <h3 className="text-sm font-semibold text-slate-300">
          {!architecture ? "No architecture available" : "No architecture flow detected"}
        </h3>
        <p className="max-w-sm text-xs text-slate-500">
          Run a repository analysis to visualize backend services, pipelines, and component flows.
        </p>
      </div>
    );
  }

  const riskBadgeStyles =
    {
      High: "bg-rose-500/10 text-rose-400 border-rose-500/20",
      Medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      Low: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    }[riskLevel] || "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";

  return (
    <div
      style={{ height }}
      className="relative flex w-full flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#0b0e13]"
    >
      {/* Header */}
      <div className="z-10 shrink-0 border-b border-slate-800 bg-[#0f1218] px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-100">Repository Architecture</h3>
            <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
              {architecture?.framework?.name && `${architecture.framework.name} · `}
              {nodes.length} components · {edges.length} connections
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
            {typeof architecture?.score === "number" && (
              <span className="rounded-md border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-indigo-400">
                Score {architecture.score}
              </span>
            )}

            <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${riskBadgeStyles}`}>
              {riskLevel} risk
            </span>

            <button
              type="button"
              onClick={handleResetView}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100"
            >
              <RotateCcw size={11} />
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          onInit={handleInit}
          fitView
          fitViewOptions={{ padding: 0.2, minZoom: 0.3 }}
          minZoom={0.15}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1e2530" />

          <Controls
            showInteractive={false}
            className="!rounded-lg !border !border-slate-800 !bg-[#12151b] !shadow-none [&>button]:!h-7 [&>button]:!w-7 [&>button]:!border-slate-800 [&>button]:!bg-[#12151b] [&>button]:!fill-slate-400 [&>button]:!text-slate-400 hover:[&>button]:!bg-slate-800"
          />

          <MiniMap
            pannable
            zoomable
            style={{ width: 110, height: 70 }}
            nodeColor={getMiniMapColor}
            nodeStrokeColor={getMiniMapColor}
            nodeStrokeWidth={1.5}
            nodeBorderRadius={4}
            maskColor="rgba(2, 6, 13, 0.8)"
            className="!rounded-md !border !border-slate-800 !bg-[#0f1218]"
          />
        </ReactFlow>

        {/* Legend */}
        {legendTypes.length > 0 && (
          <div className="absolute left-3 top-3 z-10 flex max-w-[75%] flex-wrap gap-x-2.5 gap-y-1 rounded-md border border-slate-800 bg-[#0f1218] px-2 py-1.5 sm:left-4 sm:top-4 sm:max-w-md sm:gap-x-3 sm:px-2.5">
            {legendTypes.map((type) => {
              const cfg = configFor(type);
              const Icon = cfg.icon;
              return (
                <div key={type} className="flex items-center gap-1.5">
                  <Icon size={11} style={{ color: cfg.color }} />
                  <span className="text-[10px] text-slate-500 sm:text-[11px]">{type}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Selected node panel — bottom sheet on mobile, floating card from sm up */}
        {selectedNode && (
          <div className="fixed inset-x-0 bottom-0 z-20 space-y-2.5 rounded-t-xl border border-slate-800 bg-[#12151b] p-4 shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:w-64 sm:rounded-lg md:w-72">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="truncate text-sm font-semibold text-slate-100">{selectedNode.data?.label}</h4>
                <span
                  className="mt-1 inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium"
                  style={{
                    backgroundColor: `${selectedConfig.color}14`,
                    borderColor: `${selectedConfig.color}30`,
                    color: selectedConfig.color,
                  }}
                >
                  {selectedNode.data?.type}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                className="shrink-0 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
              >
                <X size={14} />
              </button>
            </div>

            {selectedNode.data?.description && (
              <p className="border-t border-slate-800 pt-2.5 text-xs leading-relaxed text-slate-400">
                {selectedNode.data.description}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}