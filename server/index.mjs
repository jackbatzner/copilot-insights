// Express API server for the Copilot Insights dashboard.
// Wraps the shared analysis modules and serves data to the React frontend.

import express from "express";
import cors from "cors";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeSession,
  analyzeRecent,
  findTopPatterns,
} from "../src/analyzer.mjs";
import { generateSuggestions } from "../src/suggestions.mjs";
import { analyzeSprawl } from "../src/sprawl.mjs";
import { analyzeFirstTurnClarity } from "../src/clarity.mjs";
import { analyzeEfficiency, analyzeEfficiencyBatch } from "../src/efficiency.mjs";
import {
  hourlyProductivity,
  promptLengthAnalysis,
  repoHealth,
  hotFiles,
  sessionDepth,
  toolUsage,
} from "../src/analytics.mjs";
import { analyzeInstructionGaps } from "../src/instructions.mjs";
import { analyzeInstructionFailures } from "../src/instruction-failures.mjs";
import { analyzeDelegation } from "../src/delegation.mjs";
import { analyzeJudgment } from "../src/judgment.mjs";
import { generateDevPlan, generateProgressCheck, generateRetro } from "../src/dev-plan.mjs";
import { computePillarTrends } from "../src/trends.mjs";
import { annotateSession } from "../src/replay.mjs";
import { analyzeWorkStyle } from "../src/work-style.mjs";
import { computeSessionComplexity, computeCreateEditRatio, computeFileTypeDiversity } from "../src/session-insights.mjs";

import { listSessions, getSession, getSessionTurns, getSessionRefs } from "../src/db.mjs";

import { analyzePrompt } from "../src/practice.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors({ origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/ }));
app.use(express.json({ limit: "50kb" }));

// Serve static UI build in production
const uiDist = resolve(__dirname, "..", "ui", "dist");
app.use(express.static(uiDist));

// ── API Routes ──────────────────────────────────────────────────

/**
 * Convert a timeframe string (7d, 30d, 90d, all) to an ISO date.
 */
function parseSince(timeframe) {
  if (!timeframe || timeframe === "all") return undefined;
  const match = timeframe.match(/^(\d+)d$/);
  if (!match) return undefined;
  const days = parseInt(match[1]);
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/**
 * GET /api/summary
 * Aggregate redirection stats across recent sessions.
 */
app.get("/api/summary", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    const result = analyzeRecent({ repo, since });
    res.json(result.aggregate);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/sessions
 * List sessions with redirection scores, ranked by severity.
 */
app.get("/api/sessions", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    const result = analyzeRecent({ repo, since });

    const sessions = result.sessions.map((s) => ({
      id: s.session.id,
      repository: s.session.repository,
      branch: s.session.branch,
      summary: s.session.summary,
      createdAt: s.session.createdAt,
      turnCount: s.session.turnCount,
      redirectionCount: s.stats.totalRedirections,
      redirectionRate: s.stats.redirectionRate,
      totalWeight: s.stats.totalWeight,
      thrashedFileCount: s.stats.thrashedFileCount,
      categoryBreakdown: s.categoryBreakdown,
    }));

    res.json({ sessions, aggregate: result.aggregate });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/sessions/:id
 * Detailed analysis of a single session.
 */
app.get("/api/sessions/:id", (req, res) => {
  try {
    const report = analyzeSession(req.params.id);
    if (!report) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/patterns
 * Top redirection patterns across sessions.
 */
app.get("/api/patterns", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    const patterns = findTopPatterns({ repo, since });
    res.json({ patterns });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/trends
 * Redirection rates bucketed by date for trend charting.
 */
app.get("/api/trends", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    const result = analyzeRecent({ repo, since });

    // Bucket sessions by date
    const buckets = {};
    for (const s of result.sessions) {
      const date = s.session.createdAt?.split("T")[0] || "unknown";
      if (!buckets[date]) {
        buckets[date] = {
          date,
          sessionCount: 0,
          totalRedirections: 0,
          totalTurns: 0,
          totalWeight: 0,
        };
      }
      buckets[date].sessionCount++;
      buckets[date].totalRedirections += s.stats.totalRedirections;
      buckets[date].totalTurns += s.stats.userTurnCount;
      buckets[date].totalWeight += s.stats.totalWeight;
    }

    const trends = Object.values(buckets)
      .map((b) => ({
        ...b,
        redirectionRate:
          b.totalTurns > 0 ? b.totalRedirections / b.totalTurns : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({ trends });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/insights
 * Actionable prompting tips derived from redirection data.
 */
app.get("/api/insights", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    const result = analyzeRecent({ repo, since });
    const patterns = findTopPatterns({ repo, since });

    const insights = generateInsights(result, patterns);
    res.json({ insights });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/suggestions
 * Prompt rewrite suggestions based on actual redirections.
 */
app.get("/api/suggestions", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    const data = generateSuggestions({ repo, since });
    res.json({ suggestions: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Insight Generation ──────────────────────────────────────────

/**
 * GET /api/sessions/:id/sprawl
 * Sprawl analysis for a single session.
 */
app.get("/api/sessions/:id/sprawl", (req, res) => {
  try {
    const result = analyzeSprawl(req.params.id);
    if (!result) return res.json({ sprawl: null, message: "Session too short to analyze" });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/sessions/:id/efficiency
 * Efficiency analysis for a single session.
 */
app.get("/api/sessions/:id/efficiency", (req, res) => {
  try {
    const turns = getSessionTurns(req.params.id);
    const refs = getSessionRefs(req.params.id);
    const result = analyzeEfficiency(turns, refs);
    if (!result) return res.json({ efficiency: null, message: "Session too short to analyze" });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/clarity
 * First-turn clarity analysis across sessions.
 */
app.get("/api/clarity", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    const sessions = listSessions({ repo, since });
    const result = analyzeFirstTurnClarity(
      sessions.filter((s) => s.turn_count >= 2),
      getSessionTurns
    );
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/efficiency
 * Turn efficiency analysis across sessions.
 */
app.get("/api/efficiency", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    const sessions = listSessions({ repo, since });
    const sessionsData = sessions
      .filter((s) => s.turn_count >= 2)
      .map((s) => ({
        session: s,
        turns: getSessionTurns(s.id),
        refs: getSessionRefs(s.id),
      }));
    const result = analyzeEfficiencyBatch(sessionsData);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Analytics endpoints ──────────────────────────────────────────

/**
 * GET /api/analytics/hourly
 * Turns and redirection rate by hour of day.
 */
app.get("/api/analytics/hourly", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(hourlyProductivity({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/analytics/prompt-length
 * Redirection rate by prompt length bucket.
 */
app.get("/api/analytics/prompt-length", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(promptLengthAnalysis({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/analytics/repos
 * Per-repo session counts and redirection rates.
 */
app.get("/api/analytics/repos", (req, res) => {
  try {
    const since = parseSince(req.query.timeframe);
    res.json(repoHealth({ since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/analytics/hot-files
 * Most-touched files across sessions.
 */
app.get("/api/analytics/hot-files", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(hotFiles({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/analytics/depth
 * Session depth distribution.
 */
app.get("/api/analytics/depth", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(sessionDepth({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/analytics/tools
 * Tool usage breakdown (create vs edit).
 */
app.get("/api/analytics/tools", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(toolUsage({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/instruction-gaps
 * Instruction file gap analysis — repeated conventions that should be codified.
 */
app.get("/api/instruction-gaps", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(analyzeInstructionGaps({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/instruction-failures
 * Instruction failure analysis — rules that exist but agent ignores/forgets.
 */
app.get("/api/instruction-failures", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(analyzeInstructionFailures({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/delegation
 * Delegation analysis — how work is divided between user and agent.
 */
app.get("/api/delegation", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(analyzeDelegation({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/judgment
 * Judgment analysis — how well the user evaluates agent output.
 */
app.get("/api/judgment", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(analyzeJudgment({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/dev-plan
 * Personalized development plan with goals, quick wins, learning resources.
 */
app.get("/api/dev-plan", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(generateDevPlan({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/progress-check
 * Daily progress check — today vs baseline.
 */
app.get("/api/progress-check", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(generateProgressCheck({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/retro
 * End-of-period retrospective — wins, misses, trends, next focus.
 */
app.get("/api/retro", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(generateRetro({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});


/**
 * GET /api/pillar-trends
 * Weekly pillar score history for trend charts.
 */
app.get("/api/pillar-trends", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(computePillarTrends({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/sessions/:id/replay
 * Turn-by-turn annotated session replay with coaching signals.
 */
app.get("/api/sessions/:id/replay", (req, res) => {
  try {
    res.json(annotateSession(req.params.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/sessions/:id/complexity
 * Session complexity score.
 */
app.get("/api/sessions/:id/complexity", (req, res) => {
  try {
    res.json(computeSessionComplexity(req.params.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/work-style
 * Work style analysis: plan vs vibe vs iterative.
 */
app.get("/api/work-style", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(analyzeWorkStyle({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/analytics/create-edit-ratio
 * Create vs edit file operation ratio.
 */
app.get("/api/analytics/create-edit-ratio", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(computeCreateEditRatio({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/analytics/file-types
 * File type diversity / polyglot score.
 */
app.get("/api/analytics/file-types", (req, res) => {
  try {
    const repo = req.query.repo || undefined;
    const since = parseSince(req.query.timeframe);
    res.json(computeFileTypeDiversity({ repo, since }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// ── Practice Lab endpoints ───────────────────────────────────────

/**
 * POST /api/practice/analyze
 * Analyze a prompt text for quality and redirection patterns.
 * No DB access — pure pattern matching + heuristics.
 */
app.post("/api/practice/analyze", (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Missing 'text' in request body" });
    }
    if (text.length > 10000) {
      return res.status(400).json({ error: "Text too long (max 10,000 characters)" });
    }
    const result = analyzePrompt(text);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/practice/challenge
 * Fetch a random past prompt that scored poorly for the rewrite challenge.
 */
app.get("/api/practice/challenge", (req, res) => {
  try {
    const since = parseSince(req.query.timeframe || "90d");
    const result = analyzeRecent({ since, limit: 200 });

    // Collect user turns that had redirection patterns
    const candidates = [];
    for (const s of result.sessions) {
      for (const r of s.redirections) {
        if (r.weight >= 2 && r.message && r.message.length >= 20) {
          const analysis = analyzePrompt(r.message);
          if (analysis.score < 70) {
            candidates.push({
              originalPrompt: r.message,
              score: analysis.score,
              grade: analysis.grade,
              patterns: analysis.patterns,
              categories: analysis.categories,
              suggestions: analysis.suggestions,
              sessionId: s.session.id,
              turnIndex: r.turnIndex,
            });
          }
        }
      }
    }

    if (candidates.length === 0) {
      return res.json({
        challenge: null,
        message: "No low-scoring prompts found — your prompting is already strong! Try the sandbox instead.",
      });
    }

    // Pick a random candidate
    const challenge = candidates[Math.floor(Math.random() * candidates.length)];
    res.json({ challenge });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// ── Insight generation helper ───────────────────────────────────

function generateInsights(analysisResult, topPatterns) {
  const { aggregate } = analysisResult;
  const insights = [];

  // High correction rate
  if (aggregate.avgRedirectionRate > 0.3) {
    insights.push({
      type: "warning",
      title: "High Correction Rate",
      body: `${(aggregate.avgRedirectionRate * 100).toFixed(0)}% of your turns are corrections. Try providing more upfront context — include file paths, expected behavior, and constraints in your initial prompt.`,
      category: "general",
    });
  }

  // Explicit corrections dominate
  const corrections = aggregate.categoryTotals.explicit_correction;
  if (corrections && corrections.count > 3) {
    insights.push({
      type: "tip",
      title: "Frequent Explicit Corrections",
      body: `You're correcting the agent ${corrections.count} times across sessions. Be more specific about what you want — include examples of the desired output or reference existing patterns in the codebase.`,
      category: "explicit_correction",
    });
  }

  // Frustration signals
  const frustration = aggregate.categoryTotals.frustration;
  if (frustration && frustration.count > 2) {
    insights.push({
      type: "warning",
      title: "Frustration Detected",
      body: `${frustration.count} frustration signals found. When the agent isn't understanding you, try breaking the task into smaller steps rather than repeating the same instruction.`,
      category: "frustration",
    });
  }

  // Course changes
  const courseChanges = aggregate.categoryTotals.course_change;
  if (courseChanges && courseChanges.count > 3) {
    insights.push({
      type: "tip",
      title: "Frequent Course Changes",
      body: `${courseChanges.count} mid-task pivots detected. Consider spending more time planning before starting — outline the approach first, then implement. Use plan mode.`,
      category: "course_change",
    });
  }

  // Rollbacks
  const rollbacks = aggregate.categoryTotals.rollback;
  if (rollbacks && rollbacks.count > 2) {
    insights.push({
      type: "warning",
      title: "Frequent Rollback Requests",
      body: `${rollbacks.count} rollback requests across sessions. Try reviewing changes incrementally — ask the agent to make one change at a time so you can validate before proceeding.`,
      category: "rollback",
    });
  }

  // Top pattern insight
  if (topPatterns.length > 0) {
    const top = topPatterns[0];
    insights.push({
      type: "info",
      title: `Most Common Pattern: "${top.label}"`,
      body: `This pattern appeared ${top.count} times. Example: "${top.examples[0]?.message || "N/A"}"`,
      category: top.category,
    });
  }

  // Positive feedback
  if (aggregate.avgRedirectionRate < 0.1 && aggregate.sessionsAnalyzed > 3) {
    insights.push({
      type: "success",
      title: "Great Prompting!",
      body: `Only ${(aggregate.avgRedirectionRate * 100).toFixed(0)}% redirection rate — you're communicating clearly with the agent. Keep it up!`,
      category: "general",
    });
  }

  return insights;
}

// ── Global error handler ────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// ── SPA fallback ────────────────────────────────────────────────

app.get("/{*path}", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile("index.html", { root: uiDist });
});

// ── Start ───────────────────────────────────────────────────────

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`💡 Copilot Insights dashboard: http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} is already in use. Set PORT env variable or stop the other process.`);
    process.exit(1);
  }
  throw err;
});
