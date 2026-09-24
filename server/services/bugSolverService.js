const path = require("path");
const fs = require("fs/promises");

const { searchDocuments } = require("./ragService");
const { getCommits, getCommitDiff } = require("./gitService");
const { generateJSON } = require("./llmService");

// If your llmService exports the model name it's actually calling
// (recommended), we use it. Otherwise we fall back to this label —
// update it to match whatever model llmService.generateJSON uses.
let LLM_MODEL_NAME = "Gemini 3.1 Flash";
try {
  // Optional: llmService.js can `module.exports.MODEL_NAME = "..."`.
  // eslint-disable-next-line global-require
  const llmMeta = require("./llmService");
  if (typeof llmMeta.MODEL_NAME === "string") {
    LLM_MODEL_NAME = llmMeta.MODEL_NAME;
  }
} catch {
  // ignore — keep default label
}

const BUG_KEYWORDS = [
  "fix",
  "bug",
  "hotfix",
  "resolve",
  "error",
  "crash",
  "null",
  "undefined",
  "exception",
  "issue",
];

const BUG_KEYWORD_PATTERNS = BUG_KEYWORDS.map(
  (keyword) => new RegExp(`\\b${keyword}\\b`, "i")
);

const MAX_RELATED_COMMITS = 3;
const MAX_DOC_CHARS = 1200;
const MAX_DIFF_COMMITS = 1;
const MAX_DIFF_CHARS = 2500;

const ALLOWED_SEVERITIES = ["Low", "Medium", "High", "Critical"];

const PATCH_TYPES = ["modify", "insert", "delete"];

const RETRIEVAL_LIMIT_RULES = [
  { limit: 5, pattern: /\.(jsx?|tsx?)\b|\breact\b/i, label: "js/ts/react" },
  { limit: 5, pattern: /\.java\b|nullpointerexception|\bspring\b/i, label: "java" },
  { limit: 5, pattern: /\.py\b|traceback|modulenotfounderror|attributeerror/i, label: "python" },
  { limit: 5, pattern: /\.(c|cpp|h|hpp)\b|segmentation fault|undefined reference/i, label: "c/cpp" },
  { limit: 4, pattern: /\.(html|css)\b/i, label: "html/css" },
  { limit: 4, pattern: /\.json\b|unexpected token/i, label: "json" },
  { limit: 2, pattern: /\.md\b/i, label: "markdown" },
];

const DEFAULT_RETRIEVAL_LIMIT = 3;

const FILE_REGEX =
  /[A-Za-z0-9_.\-/\\]+?\.(jsx?|tsx?|java|kt|py|cpp|c|cc|h|hpp|go|rs|php|cs|swift|html|css|scss|json|xml|yml|yaml|sql|md)\b/i;

// Common stack-frame shapes: Node/JS, Python tracebacks, Java.
const STACK_FRAME_PATTERNS = [
  // "at functionName (file:line:col)"
  /at\s+(?<fn>[\w$.<>[\]\s]+?)\s+\((?<file>[^():]+):(?<line>\d+):\d+\)/,
  // "at file:line:col" (anonymous frame)
  /at\s+(?<file>[^():\s]+):(?<line>\d+):\d+/,
  // Python: File "path", line N, in func
  /File\s+"(?<file>[^"]+)",\s+line\s+(?<line>\d+),\s+in\s+(?<fn>\S+)/,
  // Java: at package.Class.method(File.java:N)
  /at\s+(?<fn>[\w.$]+)\((?<file>[\w.]+):(?<line>\d+)\)/,
];

// ==========================================================
// Whitespace-tolerant text comparison
// ==========================================================
// The LLM is asked to copy `oldCode` verbatim from the repository
// context, but small formatting differences (trailing spaces,
// CRLF vs LF, a stray blank line) used to make `String.includes`
// fail and silently strip a perfectly valid patch. Normalize both
// sides the same way before comparing so real matches aren't lost.

function normalizeForCompare(text) {
  return (text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

function containsNormalized(haystack, needle) {
  if (!needle || !needle.trim()) return false;
  const h = normalizeForCompare(haystack);
  const n = normalizeForCompare(needle);
  if (!n) return false;
  return h.includes(n);
}

// ==========================================================
// Helpers
// ==========================================================

function determineRetrievalLimit(error) {
  const normalized = error.toLowerCase();
  const fileMatch = normalized.match(FILE_REGEX);

  if (fileMatch) {
    return { limit: 3, reason: `exact file: ${fileMatch[0]}` };
  }

  for (const rule of RETRIEVAL_LIMIT_RULES) {
    if (rule.pattern.test(normalized)) {
      return { limit: rule.limit, reason: rule.label };
    }
  }

  return { limit: DEFAULT_RETRIEVAL_LIMIT, reason: "default" };
}

// ==========================================================
// Read the actual file from the repository on disk
// (used to validate generated patches against ground truth,
// since the RAG context is truncated to MAX_DOC_CHARS)
// ==========================================================

async function readRepositoryFile(repoPath, filePath) {
  if (!repoPath || !filePath) return "";

  const safePath = filePath.replace(/\\/g, "/");
  const fullPath = path.resolve(repoPath, safePath);
  const rootPath = path.resolve(repoPath);

  if (!fullPath.startsWith(rootPath)) {
    return "";
  }

  try {
    return await fs.readFile(fullPath, "utf8");
  } catch (err) {
    console.error("Repository file read error:", err.message);
    return "";
  }
}

// ==========================================================
// Build repository context
// ==========================================================

function buildRepositoryContext(documents, metadatas) {
  if (!documents?.length) {
    return "";
  }

  return documents
    .map((doc, index) => {
      const metadata = metadatas?.[index] || {};
      const file = metadata.file || metadata.fileName || "unknown";
      const language = metadata.language || "unknown";

      return `
----------------------------------------
Repository File
----------------------------------------

File: ${file}
File Name: ${metadata.fileName || path.basename(file)}
Language: ${language}
Chunk: ${metadata.chunk ?? 0}/${metadata.totalChunks ?? 1}

Code:
${(doc || "").substring(0, MAX_DOC_CHARS)}
`;
    })
    .join("\n");
}

// ==========================================================
// Find commits related to bug/fix
// ==========================================================

function findRelatedCommits(commits) {
  return commits.filter((commit) => {
    const message = commit.message || "";
    return BUG_KEYWORD_PATTERNS.some((pattern) => pattern.test(message));
  });
}

// ==========================================================
// Load only a very small number of diffs
// ==========================================================

async function loadCommitDiffs(repoPath, commits) {
  const diffs = [];

  for (const commit of commits.slice(0, MAX_DIFF_COMMITS)) {
    try {
      const diff = await getCommitDiff(repoPath, commit.hash);
      diffs.push({
        hash: commit.hash,
        message: commit.message,
        diff: (diff || "").substring(0, MAX_DIFF_CHARS),
      });
    } catch (err) {
      console.error("Diff Error:", err.message);
    }
  }

  return diffs;
}

// ==========================================================
// Extract file mentioned in error
// ==========================================================

function extractMentionedFile(error) {
  const match = error.match(FILE_REGEX);
  if (!match) return null;
  return path.basename(match[0].replace(/\\/g, "/"));
}

// ==========================================================
// Extract line number from common error formats
// ==========================================================

function extractLineNumber(error) {
  if (!error) return 0;

  const patterns = [
    /:(\d+):\d+/, // file.js:44:12
    /\((\d+):\d+\)/, // (file.js:44:12)
    /\bline\s+(\d+)\b/i, // Line 44
  ];

  for (const pattern of patterns) {
    const match = error.match(pattern);
    if (match) return Number(match[1]);
  }

  return 0;
}

// ==========================================================
// Parse a real, evidence-based stack trace breakdown straight
// from the user's pasted error text. This used to be a field the
// frontend expected but the backend never sent — the Stack Trace
// tab was always empty. We only ever report frames we can
// actually regex-match out of the input, never invented ones.
// ==========================================================

function parseStackBreakdown(error) {
  if (!error) return [];

  const frames = [];

  for (const rawLine of error.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    for (const pattern of STACK_FRAME_PATTERNS) {
      const match = line.match(pattern);
      if (match?.groups) {
        frames.push({
          functionName: (match.groups.fn || "anonymous").trim(),
          file: (match.groups.file || "unknown").trim(),
          line: match.groups.line ? Number(match.groups.line) : 0,
        });
        break;
      }
    }
  }

  return frames.slice(0, 12);
}

// ==========================================================
// Build confidence reasons from what actually happened during
// retrieval/validation — never fabricated, always tied to a real
// step that succeeded.
// ==========================================================

function buildConfidenceReasons({
  mentionedFile,
  mentionedLine,
  documentCount,
  relatedCommitCount,
  diffCount,
  patchValidated,
}) {
  const reasons = [];

  if (mentionedFile) {
    reasons.push(`Exact file "${mentionedFile}" was identified directly from the error text.`);
  }
  if (mentionedLine) {
    reasons.push(`Line number ${mentionedLine} was extracted directly from the error text.`);
  }
  if (documentCount > 0) {
    reasons.push(`${documentCount} relevant code chunk(s) retrieved from the repository index.`);
  }
  if (relatedCommitCount > 0) {
    reasons.push(`${relatedCommitCount} related commit(s) matched bug-fix keywords in their message.`);
  }
  if (diffCount > 0) {
    reasons.push("A recent commit diff was loaded as supporting historical evidence.");
  }
  if (patchValidated) {
    reasons.push("The generated patch's old code was verified against the actual file on disk.");
  }

  return reasons;
}

// ==========================================================
// Heuristic, clearly-labeled risk assessment based on patch size
// and severity. Not a guarantee — just a transparent estimate so
// the UI has real data instead of a silently empty panel.
// ==========================================================

function buildRiskAssessment(patch, severity) {
  if (!patch?.oldCode || !patch?.newCode) return null;

  const oldLines = patch.oldCode.split("\n").length;
  const newLines = patch.newCode.split("\n").length;
  const changedLines = Math.max(oldLines, newLines);

  let level = "Low";
  if (changedLines > 20 || severity === "Critical") {
    level = "High";
  } else if (changedLines > 8 || severity === "High") {
    level = "Medium";
  }

  const rollbackChance =
    level === "High" ? "Moderate" : level === "Medium" ? "Low" : "Very low";

  return {
    level,
    rollbackChance,
    reason: `Heuristic estimate based on ${changedLines} changed line(s) and "${severity}" severity — not a guarantee, review the diff before merging.`,
  };
}

function countFunctionSignatures(code) {
  if (!code) return 0;
  const matches = code.match(
    /\b(function\s|def\s|class\s|=>|public\s+\w+\s+\w+\(|private\s+\w+\s+\w+\()/g
  );
  return matches ? matches.length : 0;
}

// ==========================================================
// Prompt
// ==========================================================

function buildPrompt(error, repositoryContext, commits, diffs, mentionedFile, mentionedLine) {
  return `
You are a Senior Software Debugging Engineer.

Analyze the following bug using ONLY the repository evidence provided.

==================================================
ERROR
==================================================

${error}

==================================================
EXACT FILE MENTIONED BY USER
==================================================

${mentionedFile || "None"}

==================================================
LINE MENTIONED BY USER
==================================================

${mentionedLine || 0}

==================================================
REPOSITORY CONTEXT
==================================================

${repositoryContext || "(no repository context found)"}

==================================================
RELATED COMMITS
==================================================

${
  commits.length
    ? commits.map((c) => `${c.hash.substring(0, 7)} | ${c.message} | ${c.date || ""}`).join("\n")
    : "(no related commits found)"
}

==================================================
COMMIT DIFF
==================================================

${
  diffs.length
    ? diffs.map((d) => `# ${d.hash} — ${d.message}\n${d.diff}`).join("\n\n")
    : "(no commit diff loaded)"
}

==================================================
STRICT GROUNDING RULES
==================================================

1. Use ONLY the repository context above.

2. NEVER invent:
   - files
   - functions
   - variables
   - code
   - line numbers
   - commits

3. If an exact file is mentioned, prefer that file.

4. The "file" field MUST be a file that actually appears
   in the repository context.

5. The "patch.file" MUST be the same file as "file".

6. "patch.oldCode" MUST be copied from the repository
   context, character-for-character, preserving original
   indentation and line breaks exactly.

7. Never create an oldCode snippet that is not present.

8. The patch must be the smallest possible change.

9. Modify only ONE file.

10. LEARNING & EXPLANATION RULES:
    - "whyThisFixWorks" MUST concisely explain why the proposed fix resolves the bug whenever a fix is provided.
    - "learning" MUST explain the root technical takeaway so the developer can avoid similar issues in the future.
    - Do NOT return empty strings for "whyThisFixWorks" or "learning" when confidence > 0.
    - Explain the concept in clear, professional developer language based strictly on the evidence.

11. If evidence is insufficient, return:

file: ""
line: 0
rootCause: "Insufficient repository context."
affectedFiles: []
relatedCommits: []
fix: "Not enough evidence."
whyThisFixWorks: ""
learning: ""
patch.oldCode: ""
patch.newCode: ""

12. Confidence must represent evidence strength.
Do not use high confidence when repository evidence is weak.

13. Return ONLY valid JSON.

==================================================
OUTPUT
==================================================

Return EXACTLY:

{
  "bugType": "",
  "severity": "Low",
  "confidence": 0,
  "file": "",
  "line": 0,
  "rootCause": "",
  "affectedFiles": [],
  "relatedCommits": [],
  "fix": "",
  "whyThisFixWorks": "",
  "learning": "",
  "patch": {
    "type": "modify",
    "file": "",
    "oldCode": "",
    "newCode": ""
  }
}
`;
}

// ==========================================================
// Normalize confidence
// ==========================================================

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ==========================================================
// Normalize severity
// ==========================================================

function normalizeSeverity(value) {
  const match = ALLOWED_SEVERITIES.find(
    (severity) => severity.toLowerCase() === String(value).toLowerCase()
  );
  return match || "Medium";
}

// ==========================================================
// Normalize patch
// ==========================================================

function normalizePatch(patch) {
  if (!patch || typeof patch !== "object") {
    return { type: "modify", file: "", oldCode: "", newCode: "" };
  }

  return {
    type: PATCH_TYPES.includes(patch.type) ? patch.type : "modify",
    file: typeof patch.file === "string" ? patch.file : "",
    oldCode: typeof patch.oldCode === "string" ? patch.oldCode : "",
    newCode: typeof patch.newCode === "string" ? patch.newCode : "",
  };
}

// ==========================================================
// Normalize bug report
// ==========================================================

function normalizeBugReport(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("LLM returned a non-object bug report");
  }

  return {
    bugType: typeof raw.bugType === "string" ? raw.bugType : "Unknown",
    severity: normalizeSeverity(raw.severity),
    confidence: clampConfidence(raw.confidence),
    file: typeof raw.file === "string" ? raw.file : "",
    line: Number.isFinite(Number(raw.line)) ? Math.max(0, Math.trunc(Number(raw.line))) : 0,
    rootCause: typeof raw.rootCause === "string" ? raw.rootCause : "",
    affectedFiles: Array.isArray(raw.affectedFiles)
      ? raw.affectedFiles.filter((file) => typeof file === "string")
      : [],
    relatedCommits: Array.isArray(raw.relatedCommits) ? raw.relatedCommits : [],
    fix: typeof raw.fix === "string" ? raw.fix : "",
    whyThisFixWorks: typeof raw.whyThisFixWorks === "string" ? raw.whyThisFixWorks : "",
    learning: typeof raw.learning === "string" ? raw.learning : "",
    patch: normalizePatch(raw.patch),
  };
}

// ==========================================================
// Validate result against repository evidence
// ==========================================================

function validateBugReport(result, repositoryContext, mentionedFile, mentionedLine) {
  const context = repositoryContext || "";

  // No evidence at all.
  if (!context.trim()) {
    return {
      bugType: result.bugType || "Unknown",
      severity: result.severity,
      confidence: 0,
      file: "",
      line: 0,
      rootCause: "Insufficient repository context.",
      affectedFiles: [],
      relatedCommits: [],
      fix: "Not enough evidence.",
      whyThisFixWorks: "",
      learning: "",
      patch: { type: "modify", file: "", oldCode: "", newCode: "" },
    };
  }

  // Validate file.
  if (result.file) {
    const resultFileName = path.basename(result.file.replace(/\\/g, "/"));
    const contextHasFile = context.toLowerCase().includes(resultFileName.toLowerCase());

    if (!contextHasFile) {
      result.file = "";
      result.line = 0;
      result.rootCause = "Insufficient repository context.";
      result.affectedFiles = [];
      result.fix = "Not enough evidence.";
      result.whyThisFixWorks = "";
      result.learning = "";
      result.patch = normalizePatch(null);
      result.confidence = 0;
      return result;
    }
  }

  // If user explicitly mentioned a file, don't allow the LLM to switch files.
  if (
    mentionedFile &&
    result.file &&
    path.basename(result.file.replace(/\\/g, "/")).toLowerCase() !== mentionedFile.toLowerCase()
  ) {
    result.file = "";
    result.line = 0;
    result.rootCause = "Insufficient repository context.";
    result.affectedFiles = [];
    result.fix = "Not enough evidence.";
    result.whyThisFixWorks = "";
    result.learning = "";
    result.patch = normalizePatch(null);
    result.confidence = 0;
    return result;
  }

  // Use line from user's error when available.
  if (mentionedLine > 0) {
    result.line = mentionedLine;
  }

  // Validate patch file.
  if (result.patch.file) {
    const patchFileName = path.basename(result.patch.file.replace(/\\/g, "/"));
    const resultFileName = result.file ? path.basename(result.file.replace(/\\/g, "/")) : "";

    if (resultFileName && patchFileName.toLowerCase() !== resultFileName.toLowerCase()) {
      result.patch = normalizePatch(null);
    }
  }

  // CRITICAL: oldCode MUST exist in repository context.
  // (Whitespace-tolerant now — see containsNormalized.)
  if (result.patch.oldCode && !containsNormalized(context, result.patch.oldCode)) {
    console.log("⚠️ Patch oldCode was not found in repository context.");
    result.patch = normalizePatch(null);
  }

  // Never allow patch without oldCode.
  if (result.patch.newCode && !result.patch.oldCode) {
    result.patch = normalizePatch(null);
  }

  // If patch exists, make sure patch.file exists.
  if (result.patch.oldCode && !result.patch.file) {
    result.patch = normalizePatch(null);
  }

  return result;
}

// ==========================================================
// Main Bug Solver
// ==========================================================

async function solveBug({ error, repoPath, repositoryId }) {
  const startedAt = Date.now();

  try {
    console.log("\n========== BUG SOLVER ==========");

    if (typeof error !== "string" || !error.trim()) {
      throw new Error("A non-empty error description is required.");
    }

    if (!repositoryId) {
      throw new Error("repositoryId is required.");
    }

    if (!repoPath) {
      throw new Error("repoPath is required for the specified repository.");
    }

    console.log("Repository ID:", repositoryId);
    console.log("Repository Path:", repoPath);

    // Extract exact file + line from error.
    const mentionedFile = extractMentionedFile(error);
    const mentionedLine = extractLineNumber(error);

    console.log("🎯 Mentioned File:", mentionedFile || "none");
    console.log("📍 Mentioned Line:", mentionedLine || "none");

    // Parse the stack trace directly from the user's input — always
    // available, doesn't depend on the LLM or retrieval succeeding.
    const stackBreakdown = parseStackBreakdown(error);

    // RAG retrieval.
    const { limit, reason } = determineRetrievalLimit(error);
    console.log(`📚 Searching ChromaDB (top ${limit} documents, reason: ${reason})...`);

    const rag = await searchDocuments(error, repositoryId, limit, mentionedFile);
    const documents = rag.documents?.[0] || [];
    const metadatas = rag.metadatas?.[0] || [];

    console.log("Retrieved Documents:", documents.length);

    const repositoryContext = buildRepositoryContext(documents, metadatas);

    // Load commits.
    console.log("Loading commits...");
    const commits = await getCommits(repoPath);
    const relatedCommits = findRelatedCommits(commits);
    const topRelatedCommits = relatedCommits.slice(0, MAX_RELATED_COMMITS);
    console.log("Related commits:", topRelatedCommits.length);

    // Load ONE commit diff.
    console.log("Loading commit diffs...");
    const commitDiffs = await loadCommitDiffs(repoPath, topRelatedCommits);

    // Build prompt.
    const prompt = buildPrompt(
      error,
      repositoryContext,
      topRelatedCommits,
      commitDiffs,
      mentionedFile,
      mentionedLine
    );

    // LLM.
    console.log("🤖 Calling LLM...");
    const rawResult = await generateJSON(prompt);

    let result = normalizeBugReport(rawResult);

    // Ground truth validation (against retrieved RAG context).
    result = validateBugReport(result, repositoryContext, mentionedFile, mentionedLine);

    // Validate patch against the ACTUAL repository file on disk (the
    // RAG context is truncated, so this catches patches that pass the
    // check above but don't actually exist in the real file).
    let patchValidatedOnDisk = false;
    if (result.patch.oldCode && result.patch.file) {
      const actualFile = await readRepositoryFile(repoPath, result.patch.file);

      if (!containsNormalized(actualFile, result.patch.oldCode)) {
        console.log("⚠️ Patch oldCode does not exist in actual repository file.");
        result.patch = normalizePatch(null);
      } else {
        patchValidatedOnDisk = true;
      }
    }

    // If the LLM didn't return related commits, use only commits we
    // actually found.
    if (!Array.isArray(result.relatedCommits) || result.relatedCommits.length === 0) {
      result.relatedCommits = topRelatedCommits.map((commit) => ({
        hash: commit.hash,
        message: commit.message,
        date: commit.date,
      }));
    }

    // Make sure affected files are grounded.
    result.affectedFiles = result.affectedFiles.filter((file) =>
      repositoryContext.toLowerCase().includes(path.basename(file.replace(/\\/g, "/")).toLowerCase())
    );

    // If exact file exists, include it.
    if (
      result.file &&
      !result.affectedFiles.some(
        (file) =>
          path.basename(file.replace(/\\/g, "/")).toLowerCase() ===
          path.basename(result.file.replace(/\\/g, "/")).toLowerCase()
      )
    ) {
      result.affectedFiles.unshift(result.file);
    }

    // Evidence-based extras the frontend needs — previously missing,
    // which left the Stack Trace / Confidence / Risk panels empty.
    result.stackBreakdown = stackBreakdown;

    result.confidenceReasons = buildConfidenceReasons({
      mentionedFile,
      mentionedLine,
      documentCount: documents.length,
      relatedCommitCount: topRelatedCommits.length,
      diffCount: commitDiffs.length,
      patchValidated: patchValidatedOnDisk,
    });

    result.riskAssessment = buildRiskAssessment(result.patch, result.severity);

    result.patchStats = {
      filesModified: result.patch.file ? 1 : 0,
      linesAdded: result.patch.newCode ? result.patch.newCode.split("\n").length : 0,
      linesDeleted: result.patch.oldCode ? result.patch.oldCode.split("\n").length : 0,
      functionsChanged: Math.abs(
        countFunctionSignatures(result.patch.newCode) - countFunctionSignatures(result.patch.oldCode)
      ),
    };

    // Metadata the route/frontend need — previously never set, so the
    // UI always showed a hardcoded model name and null processing time.
    result.processingTimeMs = Date.now() - startedAt;
    result.model = LLM_MODEL_NAME;

    console.log("\n========== BUG SOLVER RESULT ==========");
    console.log("File:", result.file);
    console.log("Line:", result.line);
    console.log("Severity:", result.severity);
    console.log("Confidence:", result.confidence);
    console.log("Patch available:", Boolean(result.patch.oldCode && result.patch.newCode));
    console.log("Processing time (ms):", result.processingTimeMs);

    return result;
  } catch (err) {
    console.error("\n❌ BUG SOLVER FAILED");
    console.error(err);
    throw err;
  }
}

module.exports = {
  solveBug,
};