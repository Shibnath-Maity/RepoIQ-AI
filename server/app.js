require("dotenv").config();

const express = require("express");
const cors = require("cors");

const connectDB = require("./config/db");

const repositoryRoutes = require("./routes/repository");
const repoRoutes = require("./routes/repo");
const aiRoutes = require("./routes/ai");
const assistantRoutes = require("./routes/assistant");
const qaRoutes = require("./routes/qa");
const debugRoutes = require("./routes/debug");
const contributorRoute = require("./routes/contributor");
const authRoutes = require("./routes/authRoutes");

const {
  getRepositoryInfo,
  getRepositoryIssues,
} = require("./services/githubService");

const app = express();

// ===============================
// Middleware
// ===============================

const allowedOrigins = [
  "http://localhost:5173",
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without an Origin header, such as server-to-server requests.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json());

// ===============================
// Database Connection
// ===============================

connectDB();

// ===============================
// API Routes
// ===============================

app.use("/auth", authRoutes);

app.use("/repository", repositoryRoutes);
app.use("/api", repoRoutes);
app.use("/ai", aiRoutes);
app.use("/assistant", assistantRoutes);
app.use("/repository", debugRoutes);
app.use("/api/qa", qaRoutes);
app.use("/api/contributor", contributorRoute);

// ===============================
// Health Check
// ===============================

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "RepoIQ AI API is running",
    status: "healthy",
  });
});

// ===============================
// Test GitHub Issues Endpoint
// ===============================

app.get("/test-issues", async (req, res) => {
  try {
    const repoUrl = "https://github.com/facebook/react";

    const repo = await getRepositoryInfo(repoUrl);

    const issues = await getRepositoryIssues(repo.owner, repo.repo);

    res.status(200).json({
      success: true,
      repository: repo.name,
      issueCount: issues.length,
      firstIssue: issues[0] || null,
    });
  } catch (err) {
    console.error("Test issues error:", err.message);

    res.status(500).json({
      success: false,
      error: "Failed to fetch repository issues",
    });
  }
});

// ===============================
// Server
// ===============================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`RepoIQ AI server running on port ${PORT}`);
});