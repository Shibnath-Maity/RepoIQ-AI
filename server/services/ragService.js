const { CohereClientV2 } = require("cohere-ai");
const { ChromaClient } = require("chromadb");

// ==========================================
// RAG / EMBEDDING CONFIGURATION
// ==========================================

// IMPORTANT:
// Cohere embeddings must NOT be mixed with old
// Ollama / Gemini / Voyage embeddings.
//
// Use a separate collection and index version.
const COLLECTION_NAME = "repository_knowledge_cohere";

const DEFAULT_INDEX_VERSION = "v5-cohere-embed-v4";

// Cohere embedding model
const COHERE_EMBEDDING_MODEL = "embed-v4.0";

// 1024 is a good balance for RAG + ChromaDB.
const COHERE_EMBEDDING_DIMENSION = 1024;

// ==========================================
// Cohere AI
// ==========================================

if (!process.env.COHERE_API_KEY) {
  console.warn(
    "⚠️ WARNING: COHERE_API_KEY is not configured."
  );
}

const cohere = new CohereClientV2({
  token: process.env.COHERE_API_KEY,
});

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
// Create Cohere Embedding
// ==========================================

async function createEmbedding(
  text,
  taskType = TASK_TYPES.DOCUMENT
) {
  if (!text || !text.trim()) {
    throw new Error(
      "Cannot create embedding: empty text."
    );
  }

  if (!process.env.COHERE_API_KEY) {
    throw new Error(
      "COHERE_API_KEY is not configured."
    );
  }

  try {
    const inputType =
      taskType === TASK_TYPES.QUERY
        ? "search_query"
        : "search_document";

    const response =
      await cohere.embed({
        model: COHERE_EMBEDDING_MODEL,

        inputType,

        embeddingTypes: ["float"],

        outputDimension:
          COHERE_EMBEDDING_DIMENSION,

        texts: [text],
      });

    const embedding =
      response.embeddings?.float?.[0];

    if (
      !embedding ||
      embedding.length === 0
    ) {
      throw new Error(
        "Embedding not returned by Cohere."
      );
    }

    if (
      embedding.length !==
      COHERE_EMBEDDING_DIMENSION
    ) {
      throw new Error(
        `Unexpected embedding dimension: ${embedding.length}. ` +
        `Expected ${COHERE_EMBEDDING_DIMENSION}.`
      );
    }

    return embedding;
  } catch (error) {
    console.error(
      "❌ Cohere RAG Embedding Error:",
      error.message || error
    );

    throw error;
  }
}

// ==========================================
// Get / Create Chroma Collection
// ==========================================

async function getCollection() {
  return chroma.getOrCreateCollection({
    name: COLLECTION_NAME,
    embeddingFunction: null,
  });
}

// ==========================================
// Check Repository Indexed
// ==========================================

async function isRepositoryIndexed(
  userId,
  repositoryId,
  indexVersion = DEFAULT_INDEX_VERSION
) {
  try {
    if (!userId || !repositoryId) {
      return false;
    }

    const collection =
      await getCollection();

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

    return (
      (results.ids || []).length > 0
    );
  } catch (error) {
    console.error(
      "❌ Failed to check repository index status:",
      error.message
    );

    return false;
  }
}

// ==========================================
// Add / Upsert Document
// ==========================================

async function addDocument(
  id,
  text,
  metadata = {}
) {
  try {
    if (!metadata.repositoryId) {
      throw new Error(
        `addDocument(${id}): metadata.repositoryId is required.`
      );
    }

    const collection =
      await getCollection();

    // ==========================================
    // Create document embedding
    // ==========================================

    const embedding =
      await createEmbedding(
        text,
        TASK_TYPES.DOCUMENT
      );

    // ==========================================
    // Final metadata
    // ==========================================

    const finalMetadata = {
      indexVersion:
        DEFAULT_INDEX_VERSION,

      embeddingModel:
        COHERE_EMBEDDING_MODEL,

      embeddingDimension:
        COHERE_EMBEDDING_DIMENSION,

      embeddingProvider:
        "cohere",

      ...metadata,
    };

    // ==========================================
    // Store in ChromaDB
    // ==========================================

    await collection.upsert({
      ids: [id],

      documents: [text],

      embeddings: [embedding],

      metadatas: [finalMetadata],
    });

    console.log(
      `✓ Stored Cohere chunk in ChromaDB: ${id}`
    );
  } catch (error) {
    console.error(
      `ChromaDB Upsert Error [${id}]:`,
      error.message
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

    const collection =
      await getCollection();

    // ==========================================
    // Create QUERY embedding
    // ==========================================

    const queryEmbedding =
      await createEmbedding(
        query,
        TASK_TYPES.QUERY
      );

    // ==========================================
    // Build filters
    // ==========================================

    const baseFilterConditions = [
      {
        repositoryId:
          String(repositoryId),
      },
    ];

    if (userId) {
      baseFilterConditions.push({
        userId: String(userId),
      });
    }

    if (indexVersion) {
      baseFilterConditions.push({
        indexVersion:
          String(indexVersion),
      });
    }

    const buildWhere = (conditions) =>
      conditions.length === 1
        ? conditions[0]
        : { $and: conditions };

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
      "❌ ChromaDB Search Error:",
      error.message
    );

    throw error;
  }
}

// ==========================================
// Delete Collection
// ==========================================

async function deleteCollection() {
  try {
    await chroma.deleteCollection({
      name: COLLECTION_NAME,
    });

    console.log(
      "🗑️ Cohere RAG collection deleted:"
    );

    console.log(
      `   ${COLLECTION_NAME}`
    );
  } catch (error) {
    console.error(
      "Collection delete error:",
      error.message
    );
  }
}

// ==========================================
// Exports
// ==========================================

module.exports = {
  createEmbedding,
  getCollection,
  isRepositoryIndexed,
  addDocument,
  searchDocuments,
  deleteCollection,
  TASK_TYPES,
};