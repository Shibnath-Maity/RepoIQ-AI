const { CohereClientV2 } = require("cohere-ai");
const { ChromaClient } = require("chromadb");

// ==========================================
// RAG / EMBEDDING CONFIGURATION
// ==========================================
//
// Embedding provider priority (fallback order):
//   1. RAG_COHERE_API_KEY_1   (primary)
//   2. RAG_COHERE_API_KEY_2   (secondary)
//   3. RAG_GEMINI_API_KEY     (final fallback)
//
// Optional env vars:
//   RAG_GEMINI_EMBEDDING_MODEL        (default: gemini-embedding-001)
//   RAG_GEMINI_OUTPUT_DIMENSIONALITY  (optional; if unset, the dimension
//                                      actually returned by Gemini is used)
//   RAG_EMBED_TIMEOUT_MS              (default: 20000)
//   RAG_RATE_LIMIT_COOLDOWN_MS        (default: 60000)
//   RAG_ACTIVE_PROVIDER_CACHE_MS      (default: 60000)
//   RAG_EMBED_VERBOSE=true            (log every successful embedding)
//
// For backward compatibility, the legacy COHERE_API_KEY is used as
// Cohere key 1 when RAG_COHERE_API_KEY_1 is not set.
//
// IMPORTANT:
// Embeddings from different providers (Cohere vs Gemini) live in
// DIFFERENT vector spaces / dimensions and are NEVER mixed in the same
// ChromaDB collection. Each provider family has its own collection.
// Cohere key 1 and key 2 use the same model, so they share one collection.

const COLLECTION_NAME = "repository_knowledge_cohere";

const COLLECTION_NAMES = {
  cohere: COLLECTION_NAME,
  gemini: "repository_knowledge_gemini",
};

// Provider families, in priority order.
const PROVIDER_FAMILIES = {
  COHERE: "cohere",
  GEMINI: "gemini",
};

const PROVIDER_FAMILY_ORDER = [
  PROVIDER_FAMILIES.COHERE,
  PROVIDER_FAMILIES.GEMINI,
];

// New index version: older "v5-cohere-embed-v4" indexes were created before
// provider-aware indexing and are NOT treated as current. Nothing is deleted
// automatically; old data simply stops matching and the repository is
// re-indexed on demand.
const DEFAULT_INDEX_VERSION = "v6-multi-provider-embed";

// Older Cohere indexes (same embed-v4.0 model, 1024 dims) that are still
// compatible and are used for search when no current-version index exists.
const LEGACY_COHERE_INDEX_VERSIONS = ["v5-cohere-embed-v4"];

// Cohere embedding model
const COHERE_EMBEDDING_MODEL = "embed-v4.0";

// 1024 is a good balance for RAG + ChromaDB.
const COHERE_EMBEDDING_DIMENSION = 1024;

// Gemini embedding model (dimension is verified from real responses).
const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";

// Native output size of gemini-embedding-001. Vectors truncated below this
// via outputDimensionality must be L2-normalized (per Google's guidance).
const GEMINI_NATIVE_DIMENSION = 3072;

// Bounded retries / timeouts
const EMBED_TIMEOUT_MS =
  Number(process.env.RAG_EMBED_TIMEOUT_MS) || 20000;

// Total attempts per provider for transient (5xx / network) errors.
const MAX_ATTEMPTS_PER_PROVIDER = 2;

const RETRY_BACKOFF_MS = 300;

const RATE_LIMIT_COOLDOWN_MS =
  Number(process.env.RAG_RATE_LIMIT_COOLDOWN_MS) || 60000;

const ACTIVE_PROVIDER_CACHE_MS =
  Number(process.env.RAG_ACTIVE_PROVIDER_CACHE_MS) || 60000;

// ==========================================
// Provider slots (priority order)
// ==========================================

const PROVIDER_SLOTS = [
  {
    id: "cohere-1",
    label: "Cohere provider 1",
    family: PROVIDER_FAMILIES.COHERE,
    envName: "RAG_COHERE_API_KEY_1",
    legacyEnvName: "COHERE_API_KEY",
  },
  {
    id: "cohere-2",
    label: "Cohere provider 2",
    family: PROVIDER_FAMILIES.COHERE,
    envName: "RAG_COHERE_API_KEY_2",
  },
  {
    id: "gemini",
    label: "Gemini",
    family: PROVIDER_FAMILIES.GEMINI,
    envName: "RAG_GEMINI_API_KEY",
  },
];

function getSlotKey(slot) {
  let key = process.env[slot.envName];

  if (!key && slot.legacyEnvName) {
    key = process.env[slot.legacyEnvName];
  }

  key = key ? String(key).trim() : "";

  return key || null;
}

// NOTE: returned slot objects contain the API key.
// They must never be logged or attached to errors.
function getConfiguredSlots() {
  const seen = new Set();
  const slots = [];

  for (const slot of PROVIDER_SLOTS) {
    const key = getSlotKey(slot);

    if (!key) {
      continue;
    }

    // Skip duplicate keys inside the same family.
    const dedupeId = `${slot.family}:${key}`;

    if (seen.has(dedupeId)) {
      continue;
    }

    seen.add(dedupeId);

    slots.push({ ...slot, key });
  }

  return slots;
}

if (getConfiguredSlots().length === 0) {
  console.warn(
    "⚠️ WARNING: No embedding provider key is configured " +
      "(RAG_COHERE_API_KEY_1 / RAG_COHERE_API_KEY_2 / RAG_GEMINI_API_KEY)."
  );
}

// ==========================================
// Logging helpers (never log secrets)
// ==========================================

function ragLog(message) {
  console.log(`RAG: ${message}`);
}

function redact(message) {
  let safe = String(message || "");

  for (const slot of PROVIDER_SLOTS) {
    const key = getSlotKey(slot);

    if (key && key.length >= 8) {
      safe = safe.split(key).join("[redacted]");
    }
  }

  // Generic token-ish strings and auth headers.
  safe = safe.replace(
    /(bearer\s+)[A-Za-z0-9._\-]+/gi,
    "$1[redacted]"
  );

  safe = safe.replace(
    /([?&]key=)[^&\s]+/gi,
    "$1[redacted]"
  );

  return safe.length > 200
    ? safe.slice(0, 200) + "…"
    : safe;
}

// ==========================================
// ChromaDB
// ==========================================

const chroma = new ChromaClient({
  host: process.env.CHROMA_HOST || "127.0.0.1",
  port: Number(process.env.CHROMA_PORT) || 8000,
  ssl: false,
});

// ==========================================
// Config: manifest files
// ==========================================

const MANIFEST_FILES = new Set([
  "package.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "requirements.txt",
  "pyproject.toml",
  "cargo.toml",
  "go.mod",
]);

// ==========================================
// Code extensions
// ==========================================

const CODE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".java",
  ".py",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
]);

// ==========================================
// Config extensions
// ==========================================

const CONFIG_EXTENSIONS = new Set([
  ".json",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".properties",
]);

// ==========================================
// Candidate pool
// ==========================================

const CANDIDATE_POOL_SIZE =
  Number(process.env.RAG_CANDIDATE_POOL_SIZE) || 30;

// Minimum candidates to fetch even when we're targeting one specific
// file — 3 was too tight and starved the ranker of chunks whenever a
// larger file had been split into more than 3 pieces at index time.
const MIN_TARGET_FILE_POOL = 8;

// ==========================================
// Embedding input types
// ==========================================
//
// Cohere embed-v4.0 supports:
// search_document -> documents being indexed
// search_query    -> user's search query
//
// Gemini maps these to RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY.
//
// ==========================================

const TASK_TYPES = {
  DOCUMENT: "search_document",
  QUERY: "search_query",
};

// ==========================================
// Ranking weights
// ==========================================

const WEIGHTS = {
  semantic: 5,

  keywordInText: 1,
  keywordInFile: 4,
  keywordInFileName: 5,
  keywordInDirectory: 3,

  exactFileNameMatch: 100,
  fileEndsWithName: 80,
  exactPathMentioned: 80,
  fileNameMentioned: 50,

  summaryOverview: 40,
  summaryTechnology: 35,
  summaryFileQuestion: 30,
  summaryArchitecture: 30,
  summaryGeneric: 5,

  readmeCore: 15,
  readmeDependency: 8,

  techSummaryBoost: 25,
  techManifestBoost: 30,
  techConfigExtBoost: 5,

  dependencyManifestBoost: 50,
  dependencyReadmeBoost: 10,

  apiPathMatch: 15,
  apiFileNameMatch: 15,
  apiExtensionMatch: 5,

  architectureSummary: 30,
  architectureCorePath: 10,
  architectureReadme: 15,

  fileQuestionSummary: 30,
  fileQuestionHasFileName: 3,

  sourceCodeGeneric: 3,

  codeReviewSource: 30,
  codeReviewExtension: 20,
  codeReviewSummaryBoost: 35,
};

// ==========================================
// Provider clients (cached per key)
// ==========================================

const cohereClients = new Map();
const geminiClients = new Map();

function getCohereClient(key) {
  if (!cohereClients.has(key)) {
    cohereClients.set(
      key,
      new CohereClientV2({ token: key })
    );
  }

  return cohereClients.get(key);
}

// Gemini SDK is loaded lazily so a missing package only disables the
// Gemini fallback instead of crashing the whole RAG module.
function loadGeminiSdk() {
  try {
    return require("@google/generative-ai");
  } catch (error) {
    const err = new Error(
      "@google/generative-ai is not installed."
    );

    err.rag_kind = "config";

    throw err;
  }
}

function getGeminiClient(key) {
  if (!geminiClients.has(key)) {
    const { GoogleGenerativeAI } = loadGeminiSdk();

    geminiClients.set(
      key,
      new GoogleGenerativeAI(key)
    );
  }

  return geminiClients.get(key);
}

function getGeminiModelName() {
  return (
    process.env.RAG_GEMINI_EMBEDDING_MODEL ||
    DEFAULT_GEMINI_EMBEDDING_MODEL
  );
}

function getGeminiConfiguredDimension() {
  const value = Number(
    process.env.RAG_GEMINI_OUTPUT_DIMENSIONALITY
  );

  return Number.isInteger(value) && value > 0
    ? value
    : null;
}

// Learned from the first real Gemini response (never assumed).
let geminiObservedDimension = null;

// ==========================================
// Provider health state
// ==========================================
// - auth failure  -> provider disabled until the process restarts
//                    (or the key value changes). Never retried.
// - rate limit    -> short cooldown, then tried again.

const providerState = new Map();

function getState(slot) {
  if (!providerState.has(slot.id)) {
    providerState.set(slot.id, {
      authFailedKey: null,
      cooldownUntil: 0,
    });
  }

  return providerState.get(slot.id);
}

function isAuthDisabled(slot) {
  return getState(slot).authFailedKey === slot.key;
}

function isCoolingDown(slot) {
  return getState(slot).cooldownUntil > Date.now();
}

function resetProviderState() {
  providerState.clear();
  geminiObservedDimension = null;
  activeProviderCache = null;
}

// ==========================================
// Error classification
// ==========================================

const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

function getErrorStatus(error) {
  const status =
    error?.statusCode ??
    error?.status ??
    error?.response?.status ??
    error?.cause?.statusCode ??
    error?.cause?.status ??
    null;

  return typeof status === "number" ? status : null;
}

// Returns one of:
// auth | rate_limit | server | network | bad_request | config | other
function classifyProviderError(error) {
  if (error?.rag_kind) {
    return error.rag_kind;
  }

  const status = getErrorStatus(error);

  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 408) return "network";
  if (status !== null && status >= 500 && status < 600) {
    return "server";
  }
  if (status === 404) return "config";
  if (status === 400 || status === 422) return "bad_request";

  const code = error?.code || error?.cause?.code;

  if (code && NETWORK_ERROR_CODES.has(code)) {
    return "network";
  }

  const name = error?.name || "";
  const message = String(error?.message || "").toLowerCase();

  if (
    name === "TimeoutError" ||
    name === "AbortError" ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("socket hang up")
  ) {
    return "network";
  }

  return "other";
}

function describeFailure(kind, error) {
  const status = getErrorStatus(error);

  return status !== null
    ? `${kind}, HTTP ${status}`
    : kind;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tagError(error, source, code) {
  if (error && typeof error === "object") {
    if (!error.source) error.source = source;
    if (code && !error.code) error.code = code;
  }

  return error;
}

// ==========================================
// Single-provider embedding calls
// ==========================================

function invalidResponse(message) {
  const err = new Error(message);

  err.rag_kind = "other";

  return err;
}

async function embedWithCohere(slot, text, taskType) {
  const client = getCohereClient(slot.key);

  const inputType =
    taskType === TASK_TYPES.QUERY
      ? "search_query"
      : "search_document";

  const response = await client.embed(
    {
      model: COHERE_EMBEDDING_MODEL,

      inputType,

      embeddingTypes: ["float"],

      outputDimension: COHERE_EMBEDDING_DIMENSION,

      texts: [text],
    },
    {
      timeoutInSeconds: Math.max(
        1,
        Math.ceil(EMBED_TIMEOUT_MS / 1000)
      ),
      maxRetries: 0,
    }
  );

  const embedding = response?.embeddings?.float?.[0];

  if (!embedding || embedding.length === 0) {
    throw invalidResponse(
      "Embedding not returned by Cohere."
    );
  }

  if (embedding.length !== COHERE_EMBEDDING_DIMENSION) {
    throw invalidResponse(
      `Unexpected embedding dimension: ${embedding.length}. ` +
        `Expected ${COHERE_EMBEDDING_DIMENSION}.`
    );
  }

  return {
    embedding,
    model: COHERE_EMBEDDING_MODEL,
    dimension: embedding.length,
  };
}

function l2Normalize(values) {
  let sum = 0;

  for (const v of values) {
    sum += v * v;
  }

  const norm = Math.sqrt(sum);

  if (!norm) {
    return values;
  }

  return values.map((v) => v / norm);
}

async function embedWithGemini(slot, text, taskType) {
  const { TaskType: GeminiTaskType } = loadGeminiSdk();

  const client = getGeminiClient(slot.key);

  const modelName = getGeminiModelName();

  const model = client.getGenerativeModel(
    { model: modelName },
    { timeout: EMBED_TIMEOUT_MS }
  );

  const request = {
    content: {
      role: "user",
      parts: [{ text }],
    },

    taskType:
      taskType === TASK_TYPES.QUERY
        ? GeminiTaskType.RETRIEVAL_QUERY
        : GeminiTaskType.RETRIEVAL_DOCUMENT,
  };

  const configuredDimension = getGeminiConfiguredDimension();

  if (configuredDimension) {
    request.outputDimensionality = configuredDimension;
  }

  const result = await model.embedContent(request);

  let values = result?.embedding?.values;

  if (!Array.isArray(values) || values.length === 0) {
    throw invalidResponse(
      "Embedding not returned by Gemini."
    );
  }

  if (
    configuredDimension &&
    values.length !== configuredDimension
  ) {
    throw invalidResponse(
      `Unexpected Gemini embedding dimension: ${values.length}. ` +
        `Expected ${configuredDimension}.`
    );
  }

  if (
    !configuredDimension &&
    geminiObservedDimension &&
    values.length !== geminiObservedDimension
  ) {
    throw invalidResponse(
      `Gemini embedding dimension changed: ${values.length}. ` +
        `Previously ${geminiObservedDimension}.`
    );
  }

  if (!geminiObservedDimension) {
    geminiObservedDimension = values.length;
  }

  // Truncated (non-native) Gemini vectors are not unit length.
  if (values.length !== GEMINI_NATIVE_DIMENSION) {
    values = l2Normalize(values);
  }

  return {
    embedding: values,
    model: modelName,
    dimension: values.length,
  };
}

async function embedWithSlot(slot, text, taskType) {
  return slot.family === PROVIDER_FAMILIES.GEMINI
    ? embedWithGemini(slot, text, taskType)
    : embedWithCohere(slot, text, taskType);
}

// ==========================================
// Create Embedding (Cohere 1 -> Cohere 2 -> Gemini)
// ==========================================
//
// Returns:
// {
//   embedding,        // number[]
//   provider,         // "cohere" | "gemini"  (collection family)
//   providerId,       // "cohere-1" | "cohere-2" | "gemini"
//   model,
//   dimension,
//   collectionName,
// }
//
// options.family   -> restrict to one provider family
// options.families -> restrict to several families
//
// Errors thrown from here carry `error.source === "embedding"`.
// ==========================================

function normalizeAllowedFamilies(options = {}) {
  if (Array.isArray(options.families) && options.families.length) {
    return options.families;
  }

  if (options.family) {
    return [options.family];
  }

  return PROVIDER_FAMILY_ORDER;
}

async function createEmbedding(
  text,
  taskType = TASK_TYPES.DOCUMENT,
  options = {}
) {
  if (!text || !text.trim()) {
    throw tagError(
      new Error("Cannot create embedding: empty text."),
      "embedding",
      "RAG_EMPTY_TEXT"
    );
  }

  const allowedFamilies = normalizeAllowedFamilies(options);

  const configured = getConfiguredSlots().filter((slot) =>
    allowedFamilies.includes(slot.family)
  );

  if (configured.length === 0) {
    throw tagError(
      new Error(
        "No embedding provider is configured for " +
          `[${allowedFamilies.join(", ")}]. Set ` +
          "RAG_COHERE_API_KEY_1, RAG_COHERE_API_KEY_2 " +
          "and/or RAG_GEMINI_API_KEY."
      ),
      "embedding",
      "RAG_NO_PROVIDER"
    );
  }

  const failures = [];

  // Providers disabled by an auth failure are never retried.
  const usable = [];

  for (const slot of configured) {
    if (isAuthDisabled(slot)) {
      failures.push({
        provider: slot.id,
        reason: "auth (disabled for this process)",
      });
    } else {
      usable.push(slot);
    }
  }

  // Prefer providers that are not rate-limit cooling down; if every
  // usable provider is cooling down, try them anyway (in order).
  const ready = usable.filter((slot) => !isCoolingDown(slot));

  const order = ready.length > 0 ? ready : usable;

  let attemptedCount = 0;

  for (let i = 0; i < order.length; i++) {
    const slot = order[i];

    ragLog(`Trying ${slot.label}`);

    let lastKind = "other";
    let succeeded = null;

    for (
      let attempt = 1;
      attempt <= MAX_ATTEMPTS_PER_PROVIDER;
      attempt++
    ) {
      try {
        succeeded = await embedWithSlot(slot, text, taskType);

        break;
      } catch (error) {
        const kind = classifyProviderError(error);

        lastKind = kind;

        const reason = describeFailure(kind, error);

        if (kind === "bad_request") {
          // The input itself was rejected; another provider would not
          // be a safe, consistent substitute. Surface the error.
          console.error(
            `RAG: ${slot.label} rejected the request (${reason}): ` +
              redact(error.message)
          );

          throw tagError(error, "embedding", "RAG_BAD_EMBED_INPUT");
        }

        if (kind === "auth") {
          getState(slot).authFailedKey = slot.key;

          console.error(
            `RAG: ${slot.label} authentication failed (${reason}); ` +
              "provider disabled until restart."
          );

          failures.push({ provider: slot.id, reason });

          break;
        }

        if (kind === "rate_limit") {
          getState(slot).cooldownUntil =
            Date.now() + RATE_LIMIT_COOLDOWN_MS;

          console.warn(
            `RAG: ${slot.label} rate limited (${reason}).`
          );

          failures.push({ provider: slot.id, reason });

          break;
        }

        const transient =
          kind === "server" || kind === "network";

        if (transient && attempt < MAX_ATTEMPTS_PER_PROVIDER) {
          console.warn(
            `RAG: ${slot.label} transient error (${reason}); ` +
              `retrying (${attempt}/${MAX_ATTEMPTS_PER_PROVIDER - 1}).`
          );

          await sleep(RETRY_BACKOFF_MS * attempt);

          continue;
        }

        console.warn(
          `RAG: ${slot.label} failed (${reason}): ` +
            redact(error.message)
        );

        failures.push({ provider: slot.id, reason });

        break;
      }
    }

    attemptedCount++;

    if (succeeded) {
      if (
        attemptedCount > 1 ||
        process.env.RAG_EMBED_VERBOSE === "true"
      ) {
        ragLog(
          `Embedding generated successfully ` +
            `(${slot.label}, model=${succeeded.model}, ` +
            `dimension=${succeeded.dimension})`
        );
      }

      return {
        embedding: succeeded.embedding,
        provider: slot.family,
        providerId: slot.id,
        model: succeeded.model,
        dimension: succeeded.dimension,
        collectionName: COLLECTION_NAMES[slot.family],
      };
    }

    // Provider failed; announce what happens next.
    const next = order[i + 1];

    if (next) {
      if (
        slot.family === PROVIDER_FAMILIES.COHERE &&
        next.family === PROVIDER_FAMILIES.COHERE
      ) {
        ragLog("Cohere provider 1 failed; trying provider 2");
      } else if (
        slot.family === PROVIDER_FAMILIES.COHERE &&
        next.family === PROVIDER_FAMILIES.GEMINI
      ) {
        ragLog(
          order.some(
            (s) =>
              s.family === PROVIDER_FAMILIES.COHERE &&
              s.id !== slot.id
          ) && slot.id !== "cohere-2"
            ? `${slot.label} failed; trying ${next.label}`
            : "Both Cohere providers failed; trying Gemini"
        );
      } else {
        ragLog(`${slot.label} failed; trying ${next.label}`);
      }
    }
  }

  const summary = failures
    .map((f) => `${f.provider}: ${f.reason}`)
    .join("; ");

  const error = new Error(
    "All embedding providers failed" +
      (summary ? ` (${summary})` : "") +
      "."
  );

  error.failures = failures;

  throw tagError(error, "embedding", "RAG_ALL_PROVIDERS_FAILED");
}

// Backward-compatible helper: returns just the vector, like the
// original createEmbedding() did.
async function createEmbeddingVector(
  text,
  taskType = TASK_TYPES.DOCUMENT,
  options = {}
) {
  const result = await createEmbedding(text, taskType, options);

  return result.embedding;
}

// ==========================================
// Active provider detection
// ==========================================
// The "active" provider family is whichever family can currently
// produce embeddings (cached briefly to avoid an API call per request).

let activeProviderCache = null;

async function resolveActiveEmbeddingProvider({
  forceRefresh = false,
} = {}) {
  if (
    !forceRefresh &&
    activeProviderCache &&
    activeProviderCache.expiresAt > Date.now()
  ) {
    return activeProviderCache.value;
  }

  const result = await createEmbedding(
    "provider health check",
    TASK_TYPES.QUERY
  );

  const value = {
    family: result.provider,
    providerId: result.providerId,
    model: result.model,
    dimension: result.dimension,
    collectionName: result.collectionName,
  };

  activeProviderCache = {
    value,
    expiresAt: Date.now() + ACTIVE_PROVIDER_CACHE_MS,
  };

  return value;
}

// ==========================================
// Get / Create Chroma Collection
// ==========================================
// `provider` is a family: "cohere" (default, original behaviour) or "gemini".

function getCollectionName(provider = PROVIDER_FAMILIES.COHERE) {
  const name = COLLECTION_NAMES[provider];

  if (!name) {
    throw new Error(
      `Unknown embedding provider family: ${provider}`
    );
  }

  return name;
}

async function getCollection(
  provider = PROVIDER_FAMILIES.COHERE
) {
  return chroma.getOrCreateCollection({
    name: getCollectionName(provider),
    embeddingFunction: null,
  });
}

// ==========================================
// Check Repository Indexed
// ==========================================
// provider = null  -> true if the repository is completely indexed in ANY
//                     provider collection (backward compatible).
// provider = "..." -> only that provider's collection is checked.

async function isRepositoryIndexed(
  userId,
  repositoryId,
  indexVersion = DEFAULT_INDEX_VERSION,
  provider = null
) {
  try {
    if (!userId || !repositoryId) {
      return false;
    }

    const families = provider
      ? [provider]
      : PROVIDER_FAMILY_ORDER;

    for (const family of families) {
      const collection =
        await getCollection(family);

      const results =
        await collection.get({
          where: {
            $and: [
              {
                userId: String(userId),
              },
              {
                repositoryId:
                  String(repositoryId),
              },
              {
                embeddingProvider:
                  String(family),
              },
              {
                indexVersion:
                  String(indexVersion),
              },
              {
                type:
                  "repository_summary",
              },
              {
                indexStatus:
                  "complete",
              },
            ],
          },

          limit: 1,

          include: ["metadatas"],
        });

      if ((results.ids || []).length > 0) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error(
      "❌ Failed to check repository index status:",
      error.message
    );

    return false;
  }
}

// Which provider families hold a COMPLETE index for this repository.
async function getIndexedProviders(
  userId,
  repositoryId,
  indexVersion = DEFAULT_INDEX_VERSION
) {
  const indexed = [];

  for (const family of PROVIDER_FAMILY_ORDER) {
    if (
      await isRepositoryIndexed(
        userId,
        repositoryId,
        indexVersion,
        family
      )
    ) {
      indexed.push(family);
    }
  }

  return indexed;
}

// ==========================================
// Indexing coordination
// ==========================================
// Serializes indexing per (user, repository) inside this process so
// concurrent requests cannot interleave writes or both start a reindex.
// (Multi-instance deployments need a shared lock, e.g. Redis.)

const indexingLocks = new Map();

async function withIndexingLock(
  userId,
  repositoryId,
  task
) {
  const key = `${userId}:${repositoryId}`;

  const previous =
    indexingLocks.get(key) || Promise.resolve();

  let release;

  const current = new Promise((resolve) => {
    release = resolve;
  });

  const tail = previous.then(() => current);

  indexingLocks.set(key, tail);

  await previous.catch(() => {});

  try {
    return await task();
  } finally {
    release();

    if (indexingLocks.get(key) === tail) {
      indexingLocks.delete(key);
    }
  }
}

// Ensures a repository is indexed with the CURRENTLY ACTIVE provider.
//
// indexFn({ provider, indexVersion }) must index the whole repository,
// passing `{ provider }` as the 4th argument of every addDocument() call
// and storing the repository_summary document (indexStatus: "complete")
// LAST, so a partially-indexed repository is never marked complete.
//
// Re-running after a failure is safe: chunk ids upsert in place.
async function ensureRepositoryIndexed({
  userId,
  repositoryId,
  indexVersion = DEFAULT_INDEX_VERSION,
  indexFn,
}) {
  if (typeof indexFn !== "function") {
    throw new Error(
      "ensureRepositoryIndexed requires an indexFn."
    );
  }

  return withIndexingLock(userId, repositoryId, async () => {
    const active = await resolveActiveEmbeddingProvider();

    const alreadyIndexed = await isRepositoryIndexed(
      userId,
      repositoryId,
      indexVersion,
      active.family
    );

    if (alreadyIndexed) {
      return {
        reindexed: false,
        provider: active.family,
      };
    }

    ragLog("Repository requires reindexing");

    await indexFn({
      provider: active.family,
      indexVersion,
    });

    const nowIndexed = await isRepositoryIndexed(
      userId,
      repositoryId,
      indexVersion,
      active.family
    );

    if (!nowIndexed) {
      throw new Error(
        "Indexing finished but the repository is not marked " +
          `complete for provider "${active.family}". ` +
          "It can be retried safely."
      );
    }

    return {
      reindexed: true,
      provider: active.family,
    };
  });
}

// ==========================================
// Add / Upsert Document
// ==========================================
// options.provider -> force a provider family (use the SAME family for
//                     every chunk of one indexing run). If that family
//                     cannot embed, this throws instead of silently
//                     writing a different provider's vectors.

async function addDocument(
  id,
  text,
  metadata = {},
  options = {}
) {
  try {
    if (!metadata.repositoryId) {
      throw new Error(
        `addDocument(${id}): metadata.repositoryId is required.`
      );
    }

    // ==========================================
    // Create document embedding (provider errors)
    // ==========================================

    const embeddingResult =
      await createEmbedding(
        text,
        TASK_TYPES.DOCUMENT,
        options.provider
          ? { family: options.provider }
          : {}
      );

    // ==========================================
    // Final metadata
    // ==========================================
    // Embedding fields are written AFTER the caller's metadata so they
    // always reflect the provider that actually produced the vector.

    const finalMetadata = {
      indexVersion:
        DEFAULT_INDEX_VERSION,

      ...metadata,

      embeddingModel:
        embeddingResult.model,

      embeddingDimension:
        embeddingResult.dimension,

      embeddingProvider:
        embeddingResult.provider,
    };

    // ==========================================
    // Store in provider-specific ChromaDB collection
    // (ChromaDB errors are NOT provider failures)
    // ==========================================

    try {
      const collection =
        await getCollection(
          embeddingResult.provider
        );

      await collection.upsert({
        ids: [id],

        documents: [text],

        embeddings: [embeddingResult.embedding],

        metadatas: [finalMetadata],
      });
    } catch (chromaError) {
      throw tagError(
        chromaError,
        "chromadb",
        "RAG_CHROMA_ERROR"
      );
    }

    console.log(
      `✓ Stored ${embeddingResult.provider} chunk in ChromaDB: ${id}`
    );
  } catch (error) {
    console.error(
      error.source === "embedding"
        ? `Embedding Error [${id}]:`
        : `ChromaDB Upsert Error [${id}]:`,
      redact(error.message)
    );

    throw error;
  }
}

// ==========================================
// Normalize Query
// ==========================================

function normalizeQuery(query) {
  return query
    .toLowerCase()
    .replace(/\\/g, "/")
    .trim();
}

// ==========================================
// Includes Any
// ==========================================

function includesAny(text, phrases) {
  return phrases.some((phrase) =>
    text.includes(phrase)
  );
}

// ==========================================
// Question Classification
// ==========================================

function classifyQuestion(q) {
  const isOverview =
    includesAny(q, [
      "overview",
      "repository overview",
      "project overview",
      "repository structure",
      "project structure",
      "main components",
      "main parts",
      "what does this repo contain",
      "what does this repository contain",
      "what does this project contain",
      "how is this repository organized",
      "how is this project organized",
    ]);

  const isTechnology =
    includesAny(q, [
      "technology",
      "technologies",
      "framework",
      "frameworks",
      "library",
      "libraries",
      "database",
      "databases",
      "language",
      "languages",
      "tech stack",
      "stack",
    ]);

  const isDependency =
    includesAny(q, [
      "dependency",
      "dependencies",
      "package",
      "packages",
      "external library",
      "external libraries",
    ]);

  const isApi =
    includesAny(q, [
      "api",
      "endpoint",
      "endpoints",
      "route",
      "routes",
      "controller",
      "controllers",
    ]);

  const isArchitecture =
    includesAny(q, [
      "architecture",
      "flow",
      "components interact",
      "how does the project work",
      "how does this project work",
      "how do the components interact",
    ]);

  const isFileQuestion =
    includesAny(q, [
      "file",
      "files",
      "folder",
      "directory",
      "directories",
    ]);

  const isCodeReview =
    includesAny(q, [
      "improvement",
      "improve",
      "refactor",
      "review",
      "code quality",
      "best practice",
      "bug",
      "optimize",
      "suggest",
      "issue",
      "issues",
      "problem",
      "problems",
      "security",
      "performance",
      "maintainability",
      "readability",
      "clean code",
    ]);

  return {
    isOverview,
    isTechnology,
    isDependency,
    isApi,
    isArchitecture,
    isFileQuestion,
    isCodeReview,
  };
}

// ==========================================
// Extract Query Words
// ==========================================

function extractQueryWords(q) {
  return q
    .split(/[^a-zA-Z0-9_.-]+/)
    .filter(
      (word) => word.length > 2
    );
}

// ==========================================
// File Name Detection
// ==========================================

const FILE_EXTENSION_PATTERN =
  /\.(js|jsx|ts|tsx|java|py|c|cpp|h|hpp|html|css|scss|json|md|xml|yml|yaml|sql|gradle|toml|ini|properties)$/i;

function findMentionedFileName(
  queryWords
) {
  return queryWords.find((word) =>
    FILE_EXTENSION_PATTERN.test(word)
  );
}

// ==========================================
// Candidate Scoring
// ==========================================

function scoreCandidate({
  document,
  metadata,
  distance,
  queryWords,
  q,
  signals,
  possibleFileName,
}) {
  const text =
    document.toLowerCase();

  const file =
    (metadata.file || "")
      .toLowerCase()
      .replace(/\\/g, "/");

  const fileName =
    (metadata.fileName || "")
      .toLowerCase();

  const directory =
    (metadata.directory || "")
      .toLowerCase()
      .replace(/\\/g, "/");

  const extension =
    (metadata.extension || "")
      .toLowerCase();

  const type =
    (metadata.type || "")
      .toLowerCase();

  const {
    isOverview,
    isTechnology,
    isDependency,
    isApi,
    isArchitecture,
    isFileQuestion,
    isCodeReview,
    isSpecificFileQuestion,
  } = signals;

  let score = 0;

  // ==========================================
  // Semantic similarity
  // ==========================================

  const semanticSimilarity =
    Math.max(0, 1 - distance);

  score +=
    semanticSimilarity *
    WEIGHTS.semantic;

  // ==========================================
  // Keyword matching
  // ==========================================

  for (const word of queryWords) {
    if (text.includes(word)) {
      score +=
        WEIGHTS.keywordInText;
    }

    if (file.includes(word)) {
      score +=
        WEIGHTS.keywordInFile;
    }

    if (
      fileName.includes(word)
    ) {
      score +=
        WEIGHTS.keywordInFileName;
    }

    if (
      directory.includes(word)
    ) {
      score +=
        WEIGHTS.keywordInDirectory;
    }
  }

  // ==========================================
  // Exact file targeting
  // ==========================================

  if (
    possibleFileName &&
    fileName === possibleFileName
  ) {
    score +=
      isSpecificFileQuestion
        ? WEIGHTS.exactFileNameMatch
        : WEIGHTS.exactFileNameMatch *
          0.6;
  } else if (
    isSpecificFileQuestion &&
    possibleFileName &&
    file.endsWith(
      "/" + possibleFileName
    )
  ) {
    score +=
      WEIGHTS.fileEndsWithName;
  }

  if (
    file &&
    q.includes(file)
  ) {
    score +=
      WEIGHTS.exactPathMentioned;
  }

  if (
    fileName &&
    q.includes(fileName)
  ) {
    score +=
      WEIGHTS.fileNameMentioned;
  }

  // ==========================================
  // Repository summary
  // ==========================================

  if (
    type === "repository_summary"
  ) {
    if (isOverview) {
      score +=
        WEIGHTS.summaryOverview;
    }

    if (isTechnology) {
      score +=
        WEIGHTS.summaryTechnology;
    }

    if (isFileQuestion) {
      score +=
        WEIGHTS.summaryFileQuestion;
    }

    if (isArchitecture) {
      score +=
        WEIGHTS.summaryArchitecture;
    }

    if (
      !isOverview &&
      !isTechnology &&
      !isFileQuestion &&
      !isArchitecture
    ) {
      score +=
        WEIGHTS.summaryGeneric;
    }
  }

  // ==========================================
  // README
  // ==========================================

  if (
    fileName === "readme.md"
  ) {
    if (
      isOverview ||
      isTechnology ||
      isArchitecture
    ) {
      score +=
        WEIGHTS.readmeCore;
    }

    if (isDependency) {
      score +=
        WEIGHTS.readmeDependency;
    }
  }

  // ==========================================
  // Technology
  // ==========================================

  if (isTechnology) {
    if (
      type === "repository_summary"
    ) {
      score +=
        WEIGHTS.techSummaryBoost;
    }

    if (
      MANIFEST_FILES.has(fileName)
    ) {
      score +=
        WEIGHTS.techManifestBoost;
    }

    if (
      CONFIG_EXTENSIONS.has(
        extension
      )
    ) {
      score +=
        WEIGHTS.techConfigExtBoost;
    }
  }

  // ==========================================
  // Dependencies
  // ==========================================

  if (isDependency) {
    if (
      MANIFEST_FILES.has(fileName)
    ) {
      score +=
        WEIGHTS.dependencyManifestBoost;
    }

    if (
      fileName === "readme.md"
    ) {
      score +=
        WEIGHTS.dependencyReadmeBoost;
    }
  }

  // ==========================================
  // API
  // ==========================================

  if (isApi) {
    const pathHints = [
      "route",
      "routes",
      "controller",
      "controllers",
      "api",
      "server",
      "app",
    ];

    if (
      pathHints.some((hint) =>
        file.includes(hint)
      )
    ) {
      score +=
        WEIGHTS.apiPathMatch;
    }

    const nameHints = [
      "route",
      "controller",
      "server",
      "app",
    ];

    if (
      nameHints.some((hint) =>
        fileName.includes(hint)
      )
    ) {
      score +=
        WEIGHTS.apiFileNameMatch;
    }

    if (
      CODE_EXTENSIONS.has(extension)
    ) {
      score +=
        WEIGHTS.apiExtensionMatch;
    }
  }

  // ==========================================
  // Architecture
  // ==========================================

  if (isArchitecture) {
    if (
      type === "repository_summary"
    ) {
      score +=
        WEIGHTS.architectureSummary;
    }

    const corePaths = [
      "server",
      "app",
      "src",
      "controller",
      "controllers",
      "service",
      "services",
      "route",
      "routes",
    ];

    if (
      corePaths.some((hint) =>
        file.includes(hint)
      )
    ) {
      score +=
        WEIGHTS.architectureCorePath;
    }

    if (
      fileName === "readme.md"
    ) {
      score +=
        WEIGHTS.architectureReadme;
    }
  }

  // ==========================================
  // File / directory question
  // ==========================================

  if (isFileQuestion) {
    if (
      type === "repository_summary"
    ) {
      score +=
        WEIGHTS.fileQuestionSummary;
    }

    if (fileName) {
      score +=
        WEIGHTS.fileQuestionHasFileName;
    }
  }

  // ==========================================
  // Generic source code
  // ==========================================

  if (
    type === "source" &&
    !isOverview &&
    !isTechnology &&
    !isDependency &&
    !isArchitecture &&
    !isFileQuestion
  ) {
    score +=
      WEIGHTS.sourceCodeGeneric;
  }

  // ==========================================
  // Code review
  // ==========================================

  if (isCodeReview) {
    if (type === "source") {
      score +=
        WEIGHTS.codeReviewSource;
    }

    if (
      CODE_EXTENSIONS.has(extension)
    ) {
      score +=
        WEIGHTS.codeReviewExtension;
    }

    if (
      type === "repository_summary"
    ) {
      score +=
        WEIGHTS.codeReviewSummaryBoost;
    }
  }

  return score;
}

// ==========================================
// Log Ranking
// ==========================================

function logRanking(finalResults) {
  console.log(
    "\n🎯 Top Ranked RAG Candidates:"
  );

  finalResults
    .slice(0, 5)
    .forEach((item, index) => {
      const displayName =
        item.metadata?.type ===
        "repository_summary"
          ? "REPOSITORY_SUMMARY"
          : item.metadata?.file ||
            "unknown";

      console.log(
        ` ${index + 1}. ${displayName} | ` +
        `Score: ${item.score.toFixed(2)} | ` +
        `Distance: ${
          item.distance?.toFixed(4) ??
          "N/A"
        } | ` +
        `Type: ${
          item.metadata?.type ||
          "unknown"
        }`
      );
    });
}

// ==========================================
// Run a Chroma vector query for a given where-clause
// ==========================================

async function runChromaQuery(collection, queryEmbedding, nResults, where) {
  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults,
    where,
  });

  return {
    documents: results.documents?.[0] || [],
    metadatas: results.metadatas?.[0] || [],
    distances: results.distances?.[0] || [],
  };
}

// ==========================================
// Find which provider collections hold this repository
// ==========================================
// Returns families that contain documents matching the filters,
// complete indexes first, then partial ones, each in priority order.
// This guarantees a query is only ever embedded for (and run against)
// a collection that actually contains the repository.

async function findSearchFamilies(where, buildWhere, baseFilterConditions) {
  const found = [];

  for (const family of PROVIDER_FAMILY_ORDER) {
    try {
      const collection = await getCollection(family);

      const any = await collection.get({
        where,
        limit: 1,
        include: ["metadatas"],
      });

      if ((any.ids || []).length === 0) {
        continue;
      }

      const complete = await collection.get({
        where: buildWhere([
          ...baseFilterConditions,
          { type: "repository_summary" },
          { indexStatus: "complete" },
        ]),
        limit: 1,
        include: ["metadatas"],
      });

      found.push({
        family,
        complete: (complete.ids || []).length > 0,
      });
    } catch (chromaError) {
      throw tagError(
        chromaError,
        "chromadb",
        "RAG_CHROMA_ERROR"
      );
    }
  }

  // Array.prototype.sort is stable: priority order is kept within groups.
  found.sort(
    (a, b) => Number(b.complete) - Number(a.complete)
  );

  return found;
}

// ==========================================
// Search Repository Knowledge
// ==========================================

async function searchDocuments(
  query,
  repositoryId,
  limit = 8,
  targetFile = null,
  userId = null,
  indexVersion =
    DEFAULT_INDEX_VERSION
) {
  try {
    if (!repositoryId) {
      throw new Error(
        "repositoryId is required for RAG search."
      );
    }

    // ==========================================
    // Build filters
    // ==========================================

    const makeBaseFilters = (version) => {
      const conditions = [
        {
          repositoryId:
            String(repositoryId),
        },
      ];

      if (userId) {
        conditions.push({
          userId: String(userId),
        });
      }

      if (version) {
        conditions.push({
          indexVersion:
            String(version),
        });
      }

      return conditions;
    };

    let baseFilterConditions =
      makeBaseFilters(indexVersion);

    const buildWhere = (conditions) =>
      conditions.length === 1
        ? conditions[0]
        : { $and: conditions };

    // ==========================================
    // Pick a compatible collection + create QUERY embedding
    // ==========================================
    // The query is embedded ONLY with a provider family whose collection
    // contains this repository, so vectors are always compatible.

    let families = await findSearchFamilies(
      buildWhere(baseFilterConditions),
      buildWhere,
      baseFilterConditions
    );

    // Existing repositories indexed before the multi-provider upgrade
    // used the same Cohere model/dimension, so their vectors are still
    // compatible. Fall back to them (Cohere collection only) when nothing
    // exists under the current version.
    if (
      families.length === 0 &&
      indexVersion === DEFAULT_INDEX_VERSION
    ) {
      for (const legacyVersion of LEGACY_COHERE_INDEX_VERSIONS) {
        const legacyConditions =
          makeBaseFilters(legacyVersion);

        const legacyFound = (
          await findSearchFamilies(
            buildWhere(legacyConditions),
            buildWhere,
            legacyConditions
          )
        ).filter(
          (f) => f.family === PROVIDER_FAMILIES.COHERE
        );

        if (legacyFound.length > 0) {
          ragLog(
            `Using legacy index version ${legacyVersion} (Cohere)`
          );

          baseFilterConditions = legacyConditions;

          families = legacyFound;

          break;
        }
      }
    }

    if (families.length === 0) {
      ragLog("Repository requires reindexing");

      console.log(
        `⚠️ No RAG documents found for repository ${repositoryId}`
      );

      return {
        documents: [[]],
        metadatas: [[]],
        distances: [[]],
      };
    }

    let collection = null;
    let queryEmbedding = null;
    let lastEmbeddingError = null;

    for (const { family } of families) {
      try {
        const embeddingResult =
          await createEmbedding(
            query,
            TASK_TYPES.QUERY,
            { family }
          );

        queryEmbedding = embeddingResult.embedding;

        collection = await getCollection(family);

        break;
      } catch (error) {
        if (error.source !== "embedding") {
          throw tagError(
            error,
            "chromadb",
            "RAG_CHROMA_ERROR"
          );
        }

        lastEmbeddingError = error;

        ragLog(
          `Cannot embed query for the ${family} index; ` +
            "checking other indexed providers"
        );
      }
    }

    if (!collection || !queryEmbedding) {
      ragLog("Repository requires reindexing");

      const error = new Error(
        "Could not embed the query with any provider that holds " +
          "this repository's index (" +
          families.map((f) => f.family).join(", ") +
          "). Reindex the repository with an available provider. " +
          (lastEmbeddingError
            ? redact(lastEmbeddingError.message)
            : "")
      );

      error.source = "embedding";
      error.code = "RAG_REINDEX_REQUIRED";

      throw error;
    }

    // ==========================================
    // Chroma Vector Search
    // ==========================================
    // A `targetFile` used to hard-limit nResults to 3 AND filter on an
    // exact `fileName` match. If the indexed metadata's fileName doesn't
    // match byte-for-byte (different casing, a stale index, etc.) that
    // filter silently returns zero documents and the whole pipeline reports
    // "Insufficient repository context" even though the repo is indexed
    // fine. We now (a) fetch a real pool of candidates instead of just 3,
    // and (b) fall back to an un-filtered semantic search if the exact
    // filename filter comes back empty, instead of giving up.
    // ==========================================

    let documents = [];
    let metadatas = [];
    let distances = [];

    try {
      if (targetFile) {
        const exactWhere = buildWhere([
          ...baseFilterConditions,
          { fileName: String(targetFile) },
        ]);

        const exactPool = Math.max(limit, MIN_TARGET_FILE_POOL);

        ({ documents, metadatas, distances } = await runChromaQuery(
          collection,
          queryEmbedding,
          exactPool,
          exactWhere
        ));

        if (documents.length === 0) {
          console.log(
            `⚠️ No chunks matched fileName="${targetFile}" exactly — retrying with a broader semantic search.`
          );

          const broadWhere = buildWhere(baseFilterConditions);

          ({ documents, metadatas, distances } = await runChromaQuery(
            collection,
            queryEmbedding,
            CANDIDATE_POOL_SIZE,
            broadWhere
          ));
        }
      } else {
        const where = buildWhere(baseFilterConditions);

        ({ documents, metadatas, distances } = await runChromaQuery(
          collection,
          queryEmbedding,
          CANDIDATE_POOL_SIZE,
          where
        ));
      }
    } catch (chromaError) {
      throw tagError(
        chromaError,
        "chromadb",
        "RAG_CHROMA_ERROR"
      );
    }

    // ==========================================
    // No results
    // ==========================================

    if (
      documents.length === 0
    ) {
      console.log(
        `⚠️ No RAG documents found for repository ${repositoryId}`
      );

      return {
        documents: [[]],
        metadatas: [[]],
        distances: [[]],
      };
    }

    // ==========================================
    // Query analysis
    // ==========================================

    const q =
      normalizeQuery(query);

    const questionType =
      classifyQuestion(q);

    const queryWords =
      extractQueryWords(q);

    const possibleFileName =
      findMentionedFileName(
        queryWords
      );

    const signals = {
      ...questionType,

      isSpecificFileQuestion:
        !!possibleFileName ||
        q.includes(
          "implementation of"
        ) ||
        q.includes("code in") ||
        q.includes(
          "explain the code"
        ) ||
        q.includes(
          "explain this file"
        ),
    };

    // ==========================================
    // Rank candidates
    // ==========================================

    const ranked =
      documents
        .map(
          (
            document,
            index
          ) => {
            const metadata =
              metadatas[index] ||
              {};

            const distance =
              distances[index] ??
              1;

            const score =
              scoreCandidate({
                document,
                metadata,
                distance,
                queryWords,
                q,
                signals,
                possibleFileName,
              });

            return {
              document,
              metadata,
              distance,
              score,
            };
          }
        )
        .sort(
          (a, b) =>
            b.score - a.score
        );

    // ==========================================
    // Prioritize repository summary
    // ==========================================

    if (
      signals.isOverview ||
      signals.isArchitecture ||
      signals.isTechnology ||
      signals.isCodeReview
    ) {
      const summaryIndex =
        ranked.findIndex(
          (item) =>
            item.metadata?.type ===
            "repository_summary"
        );

      if (summaryIndex > 0) {
        const [summary] =
          ranked.splice(
            summaryIndex,
            1
          );

        ranked.unshift(summary);
      }
    }

    // ==========================================
    // Dynamic result limit
    // ==========================================

    let finalLimit = limit;

    if (signals.isOverview) {
      finalLimit = 12;
    }

    if (signals.isCodeReview) {
      finalLimit = 15;
    }

    if (signals.isArchitecture) {
      finalLimit = 12;
    }

    const finalResults =
      ranked.slice(
        0,
        finalLimit
      );

    // ==========================================
    // Log ranking
    // ==========================================

    logRanking(
      finalResults
    );

    // ==========================================
    // Return
    // ==========================================

    return {
      documents: [
        finalResults.map(
          (item) =>
            item.document
        ),
      ],

      metadatas: [
        finalResults.map(
          (item) =>
            item.metadata
        ),
      ],

      distances: [
        finalResults.map(
          (item) =>
            item.distance
        ),
      ],
    };
  } catch (error) {
    console.error(
      error.source === "embedding"
        ? "❌ RAG Embedding Error:"
        : "❌ ChromaDB Search Error:",
      redact(error.message)
    );

    throw error;
  }
}

// ==========================================
// Delete Collection
// ==========================================
// deleteCollection()          -> deletes the Cohere collection (original behaviour)
// deleteCollection("gemini")  -> deletes only the Gemini collection
// deleteCollection("all")     -> deletes both
//
// This drops a WHOLE collection (all users / repositories), exactly like
// the original function. It is never called automatically.

async function deleteCollection(
  provider = PROVIDER_FAMILIES.COHERE
) {
  const families =
    provider === "all"
      ? PROVIDER_FAMILY_ORDER
      : [provider];

  for (const family of families) {
    try {
      const name = getCollectionName(family);

      await chroma.deleteCollection({
        name,
      });

      console.log(
        `🗑️ ${family} RAG collection deleted:`
      );

      console.log(
        `   ${name}`
      );
    } catch (error) {
      console.error(
        "Collection delete error:",
        error.message
      );
    }
  }
}

// ==========================================
// Exports
// ==========================================

module.exports = {
  // Original API (signatures backward compatible, see notes above)
  createEmbedding,
  getCollection,
  isRepositoryIndexed,
  addDocument,
  searchDocuments,
  deleteCollection,
  TASK_TYPES,

  // New helpers
  createEmbeddingVector,
  resolveActiveEmbeddingProvider,
  getIndexedProviders,
  ensureRepositoryIndexed,
  withIndexingLock,
  getCollectionName,
  PROVIDER_FAMILIES,
  COLLECTION_NAMES,
  DEFAULT_INDEX_VERSION,

  // Exposed for tests only
  __testing: {
    resetProviderState,
    classifyProviderError,
    redact,
    chroma,
  },
};