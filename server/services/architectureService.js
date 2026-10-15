const fs = require("fs");
const path = require("path");

/* ==========================================================
   IGNORE
========================================================== */

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".vite",
  ".idea",
  ".vscode",
  "coverage",
  "__pycache__",
]);

/* ==========================================================
   LAYERS
========================================================== */

const LAYER_NAMES = [
  "components",
  "pages",
  "routes",
  "controllers",
  "services",
  "models",
  "hooks",
  "utils",
  "config",
  "assets",
  "middleware",
  "contexts",
  "store",
  "api",
  "tests",
];

// Folder names that mark an explicit frontend or backend "root" in a
// full-stack repo (client/ + server/ style layouts).
const FRONTEND_ROOT_NAMES = new Set(["client", "frontend", "web", "ui"]);
const BACKEND_ROOT_NAMES = new Set(["server", "backend"]);

// Layer names that unambiguously belong to one side, used to classify
// ambiguous folders (e.g. "services", "api") when no explicit root exists.
const FRONTEND_ONLY_LAYERS = new Set(["components", "pages", "hooks", "contexts", "store"]);
const BACKEND_ONLY_LAYERS = new Set(["routes", "controllers", "models", "middleware"]);

const CODE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

const DB_DEPENDENCY_MAP = {
  mongoose: "MongoDB",
  mongodb: "MongoDB",
  pg: "PostgreSQL",
  "pg-promise": "PostgreSQL",
  mysql2: "MySQL",
  mysql: "MySQL",
  sequelize: "SQL Database",
  prisma: "Prisma",
  "@prisma/client": "Prisma",
  typeorm: "TypeORM",
  knex: "SQL Database",
  sqlite3: "SQLite",
};

const ENTRY_FILE_CANDIDATES = ["index.js", "server.js", "app.js", "main.js", "index.ts", "server.ts", "app.ts"];

/* ==========================================================
   FRAMEWORK DETECTION

   `cache` is a per-buildArchitecture-call Map<absPath, parsedJsonOrNull>
   so the same package.json is never read/parsed more than once across
   detectFramework() and buildArchitectureFlow(), even though both need
   dependency info (and both may look at root + client/ + server/).
========================================================== */

function readJsonCached(filePath, cache) {
  if (cache.has(filePath)) return cache.get(filePath);
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    parsed = null;
  }
  cache.set(filePath, parsed);
  return parsed;
}

function getDependencies(rootPath, cache) {
  const pkg = readJsonCached(path.join(rootPath, "package.json"), cache);
  if (!pkg) return {};
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

/**
 * Merges dependencies from the repo root plus, when present, dedicated
 * client/ and server/ package.json files (common in split full-stack repos).
 */
function getAllDependencies(rootPath, cache) {
  let deps = getDependencies(rootPath, cache);

  for (const name of [...FRONTEND_ROOT_NAMES, ...BACKEND_ROOT_NAMES]) {
    const sub = path.join(rootPath, name);
    if (fs.existsSync(sub) && fs.statSync(sub).isDirectory()) {
      deps = { ...deps, ...getDependencies(sub, cache) };
    }
  }

  return deps;
}

function hasViteConfig(dirPath) {
  return (
    fs.existsSync(path.join(dirPath, "vite.config.js")) ||
    fs.existsSync(path.join(dirPath, "vite.config.ts")) ||
    fs.existsSync(path.join(dirPath, "vite.config.mjs"))
  );
}

function detectFramework(rootPath, cache) {
  const exists = (file) => fs.existsSync(path.join(rootPath, file));

  if (exists("next.config.js") || exists("next.config.mjs") || exists("next.config.ts")) {
    return { name: "Next.js", confidence: 99 };
  }

  if (exists("angular.json")) {
    return { name: "Angular", confidence: 99 };
  }

  if (exists("manage.py")) {
    return { name: "Django", confidence: 98 };
  }

  if (exists("pom.xml")) {
    return { name: "Spring Boot", confidence: 98 };
  }

  // Vite config can live at the repo root, or inside a client/frontend/ dir
  // in split full-stack repos.
  const viteRoot = hasViteConfig(rootPath)
    ? rootPath
    : [...FRONTEND_ROOT_NAMES]
        .map((name) => path.join(rootPath, name))
        .find((dir) => fs.existsSync(dir) && hasViteConfig(dir));

  const rootDeps = getDependencies(rootPath, cache);
  const feDeps = { ...rootDeps };
  const beDeps = { ...rootDeps };
  for (const name of FRONTEND_ROOT_NAMES) {
    const sub = path.join(rootPath, name);
    if (fs.existsSync(sub)) Object.assign(feDeps, getDependencies(sub, cache));
  }
  for (const name of BACKEND_ROOT_NAMES) {
    const sub = path.join(rootPath, name);
    if (fs.existsSync(sub)) Object.assign(beDeps, getDependencies(sub, cache));
  }

  let frontendName = null;
  if (feDeps.react) frontendName = viteRoot || feDeps.vite ? "React (Vite)" : "React";
  else if (feDeps.vue) frontendName = "Vue";

  let backendName = null;
  if (beDeps.express) backendName = "Express";

  if (frontendName && backendName) {
    return { name: `${frontendName} + ${backendName}`, confidence: 95, frontend: frontendName, backend: backendName };
  }
  if (frontendName) return { name: frontendName, confidence: 95, frontend: frontendName, backend: null };
  if (backendName) return { name: backendName, confidence: 95, frontend: null, backend: backendName };

  return { name: "Unknown", confidence: 50, frontend: null, backend: null };
}

/* ==========================================================
   FILE TYPE
========================================================== */

function getFileType(extension) {
  const frontend = [".jsx", ".tsx", ".css", ".scss", ".html"];
  const backend = [".js", ".ts", ".java", ".py", ".c", ".cpp", ".cs"];
  const config = [".json", ".yaml", ".yml", ".env"];
  const docs = [".md", ".txt"];

  if (frontend.includes(extension)) return "frontend";
  if (backend.includes(extension)) return "backend";
  if (config.includes(extension)) return "config";
  if (docs.includes(extension)) return "documentation";

  return "other";
}

/* ==========================================================
   METRICS (per-call, no shared mutable state)
========================================================== */

function createMetrics() {
  return {
    folderCount: 0,
    fileCount: 0,
    maxDepth: 0,
    largestFolder: { name: "", files: 0 },
    layers: {}, // layerName -> count
    layerPaths: {}, // layerName -> [relative paths]
    modules: [],
  };
}

/* ==========================================================
   SCAN DIRECTORY
========================================================== */

function scanDirectory(currentPath, rootPath, metrics, depth = 0) {
  metrics.folderCount++;
  metrics.maxDepth = Math.max(metrics.maxDepth, depth);

  const entries = fs.readdirSync(currentPath, { withFileTypes: true });

  const folders = [];
  const files = [];
  let localFiles = 0;

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(currentPath, entry.name);
    const relative = path.relative(rootPath, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      const lower = entry.name.toLowerCase();

      if (LAYER_NAMES.includes(lower)) {
        metrics.layers[lower] = (metrics.layers[lower] || 0) + 1;
        if (!metrics.layerPaths[lower]) metrics.layerPaths[lower] = [];
        metrics.layerPaths[lower].push(relative);
      }

      if (relative.startsWith("src/features/")) {
        metrics.modules.push(entry.name);
      }

      folders.push(scanDirectory(fullPath, rootPath, metrics, depth + 1));
    } else {
      metrics.fileCount++;
      localFiles++;

      files.push({
        name: entry.name,
        path: relative,
        extension: path.extname(entry.name),
        type: getFileType(path.extname(entry.name)),
      });
    }
  }

  if (localFiles > metrics.largestFolder.files) {
    metrics.largestFolder = {
      name: path.basename(currentPath),
      files: localFiles,
    };
  }

  return {
    name: path.basename(currentPath),
    path: path.relative(rootPath, currentPath).replace(/\\/g, "/"),
    folders,
    files,
  };
}

/* ==========================================================
   ARCHITECTURE SCORE
========================================================== */

function calculateArchitectureScore(metrics, signals = {}) {
  let score = 100;

  // Small/simple repos (a handful of files) shouldn't be punished for
  // lacking a full layered structure - that's expected at that size.
  const isSmallRepo = metrics.fileCount < 10;

  if (metrics.folderCount < 3) score -= isSmallRepo ? 5 : 15;
  else if (metrics.folderCount < 6) score -= isSmallRepo ? 3 : 8;

  if (!isSmallRepo) {
    if (!metrics.layers.components) score -= 5;
    if (!metrics.layers.services) score -= 8;
    if (!metrics.layers.utils) score -= 4;
    if (!metrics.layers.routes) score -= 4;
    if (!metrics.layers.models) score -= 4;
  }

  // Frontend and backend code mixed into the same folder tree is a real
  // separation-of-concerns issue once a repo actually has both sides -
  // small repos aren't punished, since a tiny project mixing a couple of
  // files together isn't a structural problem yet.
  if (!isSmallRepo && signals.hasFrontendSignal && signals.hasBackendSignal && !signals.isFullStackSplit) {
    score -= 6;
  }

  if (metrics.maxDepth > 8) score -= 15;
  else if (metrics.maxDepth > 6) score -= 8;

  if (metrics.largestFolder.files > 60) score -= 15;
  else if (metrics.largestFolder.files > 40) score -= 10;
  else if (metrics.largestFolder.files > 20) score -= 5;

  return Math.max(0, Math.min(100, score));
}

/* ==========================================================
   FOLDER RISK ANALYSIS
========================================================== */

function analyzeFolderRisks(tree) {
  const risks = [];

  function visit(folder, depth = 0) {
    if (folder.files.length > 30) {
      risks.push({
        folder: folder.path || "/",
        severity: folder.files.length > 60 ? "High" : "Medium",
        reason: `${folder.files.length} files inside one folder`,
        suggestion: "Split into feature-based folders",
      });
    }

    if (depth > 7) {
      risks.push({
        folder: folder.path,
        severity: "Medium",
        reason: "Folder nesting is too deep",
        suggestion: "Reduce directory depth",
      });
    }

    for (const child of folder.folders) {
      visit(child, depth + 1);
    }
  }

  visit(tree);
  return risks;
}

/**
 * Lightweight, structural-signal risks that don't require walking the
 * whole tree again - reuses facts already gathered while building the flow.
 */
function analyzeStructuralRisks({ hasFrontendSignal, hasBackendSignal, isFullStackSplit, entryFile }) {
  const risks = [];

  if (hasFrontendSignal && hasBackendSignal && !isFullStackSplit) {
    risks.push({
      folder: "/",
      severity: "Medium",
      reason: "Frontend and backend code are not separated into distinct folders",
      suggestion: "Move client code into client/ (or frontend/) and server code into server/ (or backend/)",
    });
  }

  if (entryFile && entryFile.lines > 300) {
    risks.push({
      folder: entryFile.path,
      severity: entryFile.lines > 600 ? "High" : "Medium",
      reason: `Entry file has grown to ${entryFile.lines} lines`,
      suggestion: "Extract routes, middleware, and business logic into dedicated files",
    });
  }

  return risks;
}

/* ==========================================================
   AI SUMMARY
========================================================== */

function buildArchitectureSummary(score, risks, framework, metrics, signals) {
  const strengths = [];
  const weaknesses = [];
  const isSmallRepo = metrics.fileCount < 10;

  if (metrics.layers.components) strengths.push("Component layer detected");
  if (metrics.layers.services) strengths.push("Service layer detected");
  if (metrics.layers.utils) strengths.push("Utility layer available");
  if (metrics.modules.length > 0) strengths.push("Feature modules detected");
  if (signals.isFullStackSplit) strengths.push("Frontend and backend are cleanly separated");
  // Only claim a database strength when a real dependency confirmed one;
  // a bare models/ folder gets its own, more honest, "model layer" strength.
  if (signals.hasDatabase) strengths.push(`${signals.dbLabel} database detected`);
  else if (signals.hasModelsLayer) strengths.push("Data model layer detected");
  if (isSmallRepo && strengths.length === 0) strengths.push("Small, focused codebase with a clear entry point");

  if (metrics.maxDepth > 6) weaknesses.push("Project has deep folder nesting");
  if (metrics.largestFolder.files > 30) weaknesses.push("Large folder should be split");

  // A missing services/models layer is only a real weakness once a project
  // has grown past the point where that structure would actually help.
  if (!isSmallRepo) {
    if (signals.hasBackendSignal && !metrics.layers.services) weaknesses.push("No dedicated service layer");
    if (signals.hasBackendSignal && !metrics.layers.models && !signals.hasDatabase) {
      weaknesses.push("No model/domain layer found");
    }
  }

  if (signals.hasFrontendSignal && signals.hasBackendSignal && !signals.isFullStackSplit) {
    weaknesses.push("Frontend and backend code live in the same folder tree");
  }

  const title =
    score >= 85
      ? `Well structured ${framework.name} architecture`
      : score >= 70
      ? `${framework.name} architecture is good but can improve`
      : `${framework.name} architecture needs refactoring`;

  const riskLevel = risks.some((r) => r.severity === "High")
    ? "High"
    : risks.some((r) => r.severity === "Medium")
    ? "Medium"
    : "Low";

  return {
    title,
    strengths,
    weaknesses,
    riskCount: risks.length,
    riskLevel,
  };
}

/* ==========================================================
   FILE / IMPORT HELPERS
========================================================== */

function readFileSafe(filePath, maxBytes = 200000) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function countLines(content) {
  if (!content) return 0;
  return content.split("\n").length;
}

function findEntryFile(rootPath) {
  // Check the repo root first, then dedicated backend roots (server/,
  // backend/) for split full-stack repos where the entry file lives there.
  const searchDirs = [rootPath, ...[...BACKEND_ROOT_NAMES].map((name) => path.join(rootPath, name))];

  for (const dir of searchDirs) {
    for (const file of ENTRY_FILE_CANDIDATES) {
      const full = path.join(dir, file);
      if (fs.existsSync(full)) {
        const content = readFileSafe(full);
        const relPath = path.relative(rootPath, full).replace(/\\/g, "/");
        return { file, path: relPath, fullPath: full, content, lines: countLines(content) };
      }
    }
  }
  return null;
}

const HTTP_METHOD_RE = /\b(?:app|router)\.(get|post|put|delete|patch|use)\s*\(/;

function detectInlineHttpEndpoints(entryFile) {
  if (!entryFile || !entryFile.content) return false;
  return HTTP_METHOD_RE.test(entryFile.content);
}

/**
 * Recursively collects code files under a directory, bounded so this stays
 * lightweight even on large repos (no full static-analysis engine).
 */
function collectCodeFiles(dirPath, { maxFiles = 60, maxDepth = 4 } = {}) {
  const results = [];

  function walk(current, depth) {
    if (results.length >= maxFiles || depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;

      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
        results.push(full);
      }
    }
  }

  walk(dirPath, 0);
  return results;
}

const IMPORT_SPECIFIER_RE = [
  /require\(\s*['"`](.+?)['"`]\s*\)/g,
  /import\s+(?:[\w*{}\s,]+from\s+)?['"`](.+?)['"`]/g,
];

function extractImportSpecifiers(content) {
  const specifiers = new Set();
  for (const re of IMPORT_SPECIFIER_RE) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(content))) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

/**
 * Resolves a relative import to an absolute file path (or null).
 * `statCache` is shared across an entire buildArchitectureFlow() call:
 * many files in a codebase import the same shared module (e.g. a logger
 * or a constants file), so caching by resolved base path avoids re-running
 * the same handful of fs.statSync probes over and over.
 */
function resolveRelativeImport(fromFile, specifier, statCache) {
  if (!specifier.startsWith(".")) return null;

  const base = path.resolve(path.dirname(fromFile), specifier);

  if (statCache.has(base)) return statCache.get(base);

  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.js"),
    path.join(base, "index.jsx"),
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];

  const resolved =
    candidates.find((candidate) => {
      try {
        return fs.statSync(candidate).isFile();
      } catch {
        return false;
      }
    }) || null;

  statCache.set(base, resolved);
  return resolved;
}

/** Walks up from a file's directory to find the nearest ancestor whose name is a known layer. */
function getLayerForPath(absPath, rootPath) {
  let dir = path.dirname(absPath);
  const normalizedRoot = path.resolve(rootPath);

  while (dir.startsWith(normalizedRoot) && dir !== normalizedRoot) {
    const base = path.basename(dir).toLowerCase();
    if (LAYER_NAMES.includes(base)) return base;
    dir = path.dirname(dir);
  }
  return null;
}

/* ==========================================================
   FRONTEND / BACKEND CONTEXT CLASSIFICATION
========================================================== */

/**
 * Decides whether a layer folder (e.g. "services") belongs to the frontend
 * or backend side of the repo, based on its path. Returns 'frontend',
 * 'backend', or null when it can't be determined from the path alone.
 */
function classifyPathContext(relPath) {
  const segments = relPath.toLowerCase().split("/");

  if (segments.some((s) => FRONTEND_ROOT_NAMES.has(s))) return "frontend";
  if (segments.some((s) => BACKEND_ROOT_NAMES.has(s))) return "backend";

  if (segments.some((s) => FRONTEND_ONLY_LAYERS.has(s))) return "frontend";
  if (segments.some((s) => BACKEND_ONLY_LAYERS.has(s))) return "backend";

  return null;
}

/**
 * Builds { frontend: {layerName: path}, backend: {layerName: path} } from
 * metrics.layerPaths, resolving ambiguous layers (services, api, utils,
 * tests) using overall repo signals when the path alone is inconclusive.
 */
function classifyLayers(metrics, fallbackLean) {
  const frontend = {};
  const backend = {};
  let sawFrontendRoot = false;
  let sawBackendRoot = false;

  for (const [layerName, paths] of Object.entries(metrics.layerPaths)) {
    for (const relPath of paths) {
      const segments = relPath.toLowerCase().split("/");
      if (segments.some((s) => FRONTEND_ROOT_NAMES.has(s))) sawFrontendRoot = true;
      if (segments.some((s) => BACKEND_ROOT_NAMES.has(s))) sawBackendRoot = true;

      let context = classifyPathContext(relPath);
      if (!context) context = fallbackLean;

      if (context === "frontend" && !frontend[layerName]) frontend[layerName] = relPath;
      if (context === "backend" && !backend[layerName]) backend[layerName] = relPath;
    }
  }

  return { frontend, backend, isFullStackSplit: sawFrontendRoot && sawBackendRoot };
}

/* ==========================================================
   NODE ID MAPPING
========================================================== */

function frontendNodeIdForLayer(layerName) {
  switch (layerName) {
    case "components":
      return "components";
    case "pages":
      return "pages";
    case "hooks":
    case "contexts":
    case "store":
      return "hooksState";
    case "api":
    case "services":
      return "apiClient";
    case "tests":
      return "tests";
    default:
      return null;
  }
}

function backendNodeIdForLayer(layerName) {
  switch (layerName) {
    case "routes":
    case "api":
      return "httpApi";
    case "middleware":
      return "middleware";
    case "controllers":
      return "controllers";
    case "services":
      return "services";
    case "models":
      return "database";
    case "utils":
      return "utils";
    case "tests":
      return "tests";
    default:
      return null;
  }
}

/* ==========================================================
   ARCHITECTURE FLOW (repository-specific, dynamic)
========================================================== */

function buildArchitectureFlow(framework, tree, rootPath, metrics, jsonCache) {
  const nodes = [];
  const edges = [];

  // O(1) membership checks instead of nodes.some()/edges.some() array scans,
  // which mattered once the import-detection pass below started calling
  // addNode/addEdge potentially hundreds of times on larger repos.
  const nodeIds = new Set();
  const edgeKeys = new Set();

  const addNode = (id, label, type, description) => {
    if (!nodeIds.has(id)) {
      nodeIds.add(id);
      nodes.push({ id, label, type, description });
    }
  };

  const addEdge = (source, target, label) => {
    if (source === target) return;
    if (!nodeIds.has(source) || !nodeIds.has(target)) return;
    const key = `${source}->${target}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source, target, label });
  };

  const nodeExists = (id) => nodeIds.has(id);

  /* ---------- Gather signals ---------- */

  const deps = getAllDependencies(rootPath, jsonCache);
  const entryFile = findEntryFile(rootPath);
  const hasInlineHttpEndpoints = detectInlineHttpEndpoints(entryFile);

  const looksFrontendFramework = /React|Vue|Angular|Next/.test(framework.name);
  const looksBackendFramework = /Express|Django|Spring Boot/.test(framework.name);

  // Best-effort default for ambiguous folders (e.g. a bare "services" dir)
  // when the path itself gives no frontend/backend clue.
  const fallbackLean = looksFrontendFramework && !looksBackendFramework ? "frontend" : "backend";

  const { frontend: feLayers, backend: beLayers, isFullStackSplit } = classifyLayers(metrics, fallbackLean);

  const hasFrontendSignal = looksFrontendFramework || Object.keys(feLayers).length > 0;
  const hasBackendSignal =
    looksBackendFramework || Object.keys(beLayers).length > 0 || hasInlineHttpEndpoints;

  // Database: only claim a specific technology when a matching dependency
  // is present; a bare "models" folder is evidence of *a* data layer, but
  // not proof of a real database, so it must not be labeled as one.
  let dbLabel = null;
  for (const [dep, label] of Object.entries(DB_DEPENDENCY_MAP)) {
    if (deps[dep]) {
      dbLabel = label;
      break;
    }
  }
  const hasConfirmedDatabase = Boolean(dbLabel);
  const hasModelsLayer = Boolean(beLayers.models);

  const publicDirCandidates = [
    path.join(rootPath, "public"),
    ...[...BACKEND_ROOT_NAMES].map((name) => path.join(rootPath, name, "public")),
  ];
  const hasPublicAssets = publicDirCandidates.some((p) => fs.existsSync(p));

  /* ---------- User node (shared entry point) ---------- */

  if (hasFrontendSignal || hasBackendSignal) {
    addNode("user", "User", "actor", "End user interacting with the application");
  }

  /* ---------- Frontend chain ---------- */

  let lastFrontendNode = null;

  if (hasFrontendSignal) {
    const frontendLabel = framework.frontend || framework.name;
    addNode("frontend", `${frontendLabel} Frontend`, "frontend", "User interface and client-side application");
    addEdge("user", "frontend", "Uses");
    lastFrontendNode = "frontend";

    if (feLayers.pages) {
      addNode("pages", "Pages", "frontend", "Top-level route views");
      addEdge(lastFrontendNode, "pages", "Renders");
      lastFrontendNode = "pages";
    }

    if (feLayers.components) {
      addNode("components", "Components", "frontend", "Reusable UI building blocks");
      addEdge(lastFrontendNode, "components", "Composed of");
      lastFrontendNode = "components";
    }

    if (feLayers.hooks || feLayers.contexts || feLayers.store) {
      addNode("hooksState", "Hooks / State", "frontend", "Client-side state and shared logic");
      addEdge(lastFrontendNode, "hooksState", "Uses");
      lastFrontendNode = "hooksState";
    }

    if (feLayers.api || feLayers.services) {
      addNode("apiClient", "API Client", "api", "Sends requests to the backend");
      addEdge(lastFrontendNode, "apiClient", "Calls");
      lastFrontendNode = "apiClient";
    }
  }

  /* ---------- Backend chain ---------- */

  let lastBackendEntry = null;

  if (hasBackendSignal) {
    const backendLabel = framework.backend || (looksBackendFramework ? framework.name : null);
    const serverLabel = backendLabel ? `${backendLabel} Server` : "Backend Server";
    addNode("backendServer", serverLabel, "backend", "Application server handling requests");

    if (!hasFrontendSignal) {
      addEdge("user", "backendServer", "Sends requests");
    }

    if (entryFile) {
      addNode("entry", entryFile.file, "entry", "Main application entry point");
      addEdge("entry", "backendServer", "Starts server");
      lastBackendEntry = "entry";
    }

    if (hasPublicAssets && !isFullStackSplit) {
      addNode("publicAssets", "Public Assets", "frontend", "Static assets served directly by the server");
      addEdge("backendServer", "publicAssets", "Serves static files");
    }

    if (beLayers.routes || beLayers.api || hasInlineHttpEndpoints) {
      addNode("httpApi", "API / Routes", "api", "Handles incoming HTTP requests");
      addEdge("backendServer", "httpApi", "Routes requests");
    }

    if (beLayers.middleware) {
      addNode("middleware", "Middleware", "middleware", "Authentication, validation and request processing");
      if (nodeExists("httpApi")) addEdge("httpApi", "middleware", "Passes through");
      else addEdge("backendServer", "middleware", "Passes through");
    }

    if (beLayers.controllers) {
      addNode("controllers", "Controllers", "controller", "Coordinates requests and application operations");
      if (nodeExists("middleware")) addEdge("middleware", "controllers", "Validated request");
      else if (nodeExists("httpApi")) addEdge("httpApi", "controllers", "Routes request");
      else addEdge("backendServer", "controllers", "Routes request");
    }

    if (beLayers.services) {
      addNode("services", "Services", "service", "Contains business and application logic");
      if (nodeExists("controllers")) addEdge("controllers", "services", "Business logic");
      else if (nodeExists("middleware")) addEdge("middleware", "services", "Business logic");
      else if (nodeExists("httpApi")) addEdge("httpApi", "services", "Calls service");
      else addEdge("backendServer", "services", "Application logic");
    }

    if (hasConfirmedDatabase) {
      addNode("database", dbLabel, "database", `${dbLabel} database`);
      if (nodeExists("services")) addEdge("services", "database", "Reads / writes");
      else if (nodeExists("controllers")) addEdge("controllers", "database", "Reads / writes");
      else addEdge("backendServer", "database", "Reads / writes");
    } else if (hasModelsLayer) {
      // Folder evidence only (no dependency confirms a real database) -
      // show a generic model layer instead of inventing a database
      // technology that isn't actually installed.
      addNode("database", "Models", "service", "Data model definitions (no specific database dependency detected)");
      if (nodeExists("services")) addEdge("services", "database", "Uses");
      else if (nodeExists("controllers")) addEdge("controllers", "database", "Uses");
      else addEdge("backendServer", "database", "Uses");
    }

    if (beLayers.utils) {
      addNode("utils", "Utilities", "utility", "Shared helper functions");
      if (nodeExists("services")) addEdge("services", "utils", "Uses helpers");
      else addEdge("backendServer", "utils", "Uses helpers");
    }

    // Very small/simple backends (just an entry file + maybe public/) still
    // get a meaningful HTTP layer instead of an empty diagram.
    if (!nodeExists("httpApi") && (looksBackendFramework || hasInlineHttpEndpoints)) {
      addNode("httpApi", "HTTP API", "api", "HTTP endpoints handled by the server");
      addEdge("backendServer", "httpApi", "Handles HTTP requests");
    }
  }

  /* ---------- Full-stack link ---------- */

  if (hasFrontendSignal && hasBackendSignal) {
    const from = lastFrontendNode || "frontend";
    const to = nodeExists("httpApi") ? "httpApi" : "backendServer";
    addEdge(from, to, "HTTP requests");
  }

  /* ---------- Import-based edge detection (lightweight) ---------- */

  const layerDirEntries = [
    ...Object.entries(feLayers).map(([layer, relPath]) => ({ layer, relPath, nodeIdFor: frontendNodeIdForLayer })),
    ...Object.entries(beLayers).map(([layer, relPath]) => ({ layer, relPath, nodeIdFor: backendNodeIdForLayer })),
  ];

  // Shared across every file/specifier processed below - see
  // resolveRelativeImport() for why this matters.
  const statCache = new Map();

  for (const { relPath, nodeIdFor } of layerDirEntries) {
    const absDir = path.join(rootPath, relPath);
    const files = collectCodeFiles(absDir);

    for (const filePath of files) {
      const content = readFileSafe(filePath);
      if (!content) continue;

      const specifiers = extractImportSpecifiers(content);
      const sourceLayer = getLayerForPath(filePath, rootPath);
      if (!sourceLayer) continue;

      for (const specifier of specifiers) {
        const resolved = resolveRelativeImport(filePath, specifier, statCache);
        if (!resolved) continue;

        const targetLayer = getLayerForPath(resolved, rootPath);
        if (!targetLayer || targetLayer === sourceLayer) continue;

        const sourceContext = feLayers[sourceLayer] ? "frontend" : "backend";
        const targetContext = feLayers[targetLayer] ? "frontend" : "backend";
        if (sourceContext !== targetContext) continue; // don't cross-wire fe/be by accident

        const idFn = sourceContext === "frontend" ? frontendNodeIdForLayer : backendNodeIdForLayer;
        const sourceId = idFn(sourceLayer);
        const targetId = idFn(targetLayer);
        if (sourceId && targetId) addEdge(sourceId, targetId, "imports");
      }
    }
  }

  /* ---------- Tests (shared, attach to whichever chain is most relevant) ---------- */

  if (metrics.layers.tests) {
    addNode("tests", "Tests", "test", "Automated tests");
    if (nodeExists("services")) addEdge("tests", "services", "Tests");
    else if (nodeExists("httpApi")) addEdge("tests", "httpApi", "Tests");
    else if (nodeExists("components")) addEdge("tests", "components", "Tests");
  }

  return {
    nodes,
    edges,
    signals: {
      hasFrontendSignal,
      hasBackendSignal,
      isFullStackSplit,
      hasDatabase: hasConfirmedDatabase,
      hasModelsLayer,
      dbLabel,
      entryFile,
    },
  };
}

/* ==========================================================
   DASHBOARD
========================================================== */

function buildDashboard(score, metrics) {
  return {
    architectureScore: score,
    totalFolders: metrics.folderCount,
    totalFiles: metrics.fileCount,
    maxDepth: metrics.maxDepth,
    largestFolder: metrics.largestFolder,
    detectedLayers: Object.keys(metrics.layers).length,
    detectedModules: metrics.modules.length,
  };
}

/* ==========================================================
   BUILD ARCHITECTURE
========================================================== */

function buildArchitecture(repoPath) {
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Repository path does not exist: ${repoPath}`);
  }

  // Fresh, call-local metrics object - safe for concurrent multi-user analysis.
  const metrics = createMetrics();

  // Fresh, call-local package.json cache - avoids re-reading/re-parsing the
  // same package.json files across detectFramework() and
  // buildArchitectureFlow() within a single build, while staying safe for
  // concurrent calls (no shared/module-level state).
  const jsonCache = new Map();

  console.log("🏗️ Building repository architecture...");

  const tree = scanDirectory(repoPath, repoPath, metrics, 0);
  const framework = detectFramework(repoPath, jsonCache);
  const { nodes, edges, signals } = buildArchitectureFlow(framework, tree, repoPath, metrics, jsonCache);
  const score = calculateArchitectureScore(metrics, signals);

  const risks = [
    ...analyzeFolderRisks(tree),
    ...analyzeStructuralRisks({
      hasFrontendSignal: signals.hasFrontendSignal,
      hasBackendSignal: signals.hasBackendSignal,
      isFullStackSplit: signals.isFullStackSplit,
      entryFile: signals.entryFile,
    }),
  ];

  const summary = buildArchitectureSummary(score, risks, framework, metrics, signals);
  const dashboard = buildDashboard(score, metrics);

  console.log(`✅ Architecture analysis completed - nodes: ${nodes.length}, edges: ${edges.length}, framework: ${framework.name}`);

  return {
    tree,
    framework,
    score,
    flow: { nodes, edges },
    metrics: {
      folderCount: metrics.folderCount,
      fileCount: metrics.fileCount,
      maxDepth: metrics.maxDepth,
      largestFolder: metrics.largestFolder,
      layers: metrics.layers,
      modules: metrics.modules,
    },
    risks,
    summary,
    dashboard,
  };
}

/* ==========================================================
   HELPERS
========================================================== */

function getArchitectureInsights(architecture) {
  return {
    framework: architecture.framework.name,
    architectureScore: architecture.score,
    strengths: architecture.summary.strengths,
    weaknesses: architecture.summary.weaknesses,
    risks: architecture.risks,
    modules: architecture.metrics.modules,
    layers: architecture.metrics.layers,
  };
}

/* ==========================================================
   EXPORTS
========================================================== */

module.exports = {
  buildArchitecture,
  getArchitectureInsights,
};