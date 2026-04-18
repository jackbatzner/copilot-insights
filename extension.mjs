// Copilot Insights — Copilot CLI Extension
//
// Reads session logs from ~/.copilot/session-store.db and surfaces
// patterns where users corrected, reversed, or redirected the agent.
//
// Tools registered:
//   insights_dashboard — Launch the web dashboard (Express + React)
//   insights_analyze   — Scan recent sessions for redirection patterns (chat)
//   insights_session   — Deep-dive into a single session's redirections (chat)
//   insights_patterns  — Show the most common redirection patterns (chat)
//   insights_summary  — Quick tier + pillar scores + coaching tip
//   insights_compare   — Compare two sessions side-by-side
//   insights_coach     — Real-time prompting coach (immediate/periodic/progress)
//   insights_stop      — Stop the dashboard server

import { createExtensionApi } from "@github/copilot-sdk";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeSession,
  analyzeRecent,
  findTopPatterns,
} from "./src/analyzer.mjs";
import {
  formatSessionReport,
  formatSummaryReport,
  formatTopPatterns,
} from "./src/formatter.mjs";
import { computePillarTrends } from "./src/trends.mjs";
import { getTier } from "./src/tiers.mjs";
import { analyzePrompt } from "./src/practice.mjs";
import { listSessions, getSessionTurns } from "./src/db.mjs";
import { REDIRECTION_CATEGORIES } from "./src/patterns.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = resolve(__dirname, "server");

const PORT = 3002;
let serverProcess = null;
let dashboardRunning = false;

const api = await createExtensionApi();

// ── Tool: insights_dashboard — Launch the web dashboard ───────────────

api.registerTool({
  name: "insights_dashboard",
  description:
    "Launch the Copilot Insights web dashboard. Shows visual charts of your redirection patterns, session rankings, turn-by-turn timelines, and actionable prompting tips.",
  permission: "required",
  input: {
    type: "object",
    properties: {
      port: {
        type: "number",
        description: "Dashboard server port (default: 3002)",
        default: 3002,
      },
    },
  },
  output: {
    type: "object",
    properties: {
      content: { type: "string" },
    },
  },
  run: async ({ port = PORT }) => {
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) {
      return { content: "❌ Invalid port. Must be an integer between 1024 and 65535." };
    }
    port = p;

    if (dashboardRunning) {
      return {
        content: `## 💡 Copilot Insights (already running)\n**Dashboard:** http://localhost:${port}\n\n💡 Open in your browser to see your redirection patterns, or use \`insights_analyze\` for a quick chat summary.`,
      };
    }

    try {
      serverProcess = spawn("node", ["index.mjs"], {
        cwd: SERVER_DIR,
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      });

      serverProcess.stderr?.on("data", (chunk) => {
        const text = chunk.toString().trim();
        if (text) console.error(`[rd:server] ${text}`);
      });

      serverProcess.on("exit", () => {
        dashboardRunning = false;
        serverProcess = null;
      });

      await waitForServer(`http://localhost:${port}/api/summary`, 10_000);
      dashboardRunning = true;

      const statsText = await fetchQuickStats(port);

      return {
        content: [
          `## 💡 Copilot Insights launched`,
          `**Dashboard:** http://localhost:${port}`,
          "",
          statsText,
          "",
          "💡 Open in your browser for visual charts and drill-downs.",
          "💡 Use `insights_analyze` or `insights_patterns` for quick chat-based analysis.",
          "💡 Use `insights_stop` to shut down the dashboard.",
        ].join("\n"),
      };
    } catch (err) {
      return {
        content: `❌ Failed to start dashboard: ${err.message}\n\nMake sure you've run \`cd ui && npm run build\` first to build the frontend.`,
      };
    }
  },
});

// ── Tool: insights_stop — Stop the dashboard ──────────────────────────

api.registerTool({
  name: "insights_stop",
  description: "Stop the Copilot Insights dashboard server.",
  permission: "required",
  input: { type: "object", properties: {} },
  output: {
    type: "object",
    properties: {
      content: { type: "string" },
    },
  },
  run: async () => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      serverProcess = null;
    }
    dashboardRunning = false;
    return { content: "🛑 Copilot Insights dashboard stopped." };
  },
});

// ── Tool: insights_analyze — Scan recent sessions ─────────────────────

api.registerTool({
  name: "insights_analyze",
  description:
    "Scan recent Copilot sessions for redirection patterns — places where the user corrected, reversed, or redirected the agent. Shows which sessions had the most friction and what types of corrections were needed.",
  permission: "readonly",
  input: {
    type: "object",
    properties: {
      repo: {
        type: "string",
        description:
          "Filter to a specific repository (partial match). Leave empty for all repos.",
      },
      limit: {
        type: "number",
        description: "Number of recent sessions to scan (default: 15)",
        default: 15,
      },
    },
  },
  output: {
    type: "object",
    properties: {
      content: { type: "string" },
    },
  },
  run: async ({ repo, limit = 15 }) => {
    try {
      const result = analyzeRecent({ repo, limit });
      const content = formatSummaryReport(result);
      return { content };
    } catch (err) {
      return {
        content: `❌ Failed to analyze sessions: ${err.message}\n\nMake sure Copilot CLI has been used and \`~/.copilot/session-store.db\` exists.`,
      };
    }
  },
});

// ── Tool: insights_session — Deep-dive into a single session ──────────

api.registerTool({
  name: "insights_session",
  description:
    "Analyze a specific session for redirection patterns. Shows a timeline of every correction, course change, and frustration signal, plus file thrashing detection.",
  permission: "readonly",
  input: {
    type: "object",
    properties: {
      session_id: {
        type: "string",
        description: "The session ID to analyze (full UUID or prefix)",
      },
    },
    required: ["session_id"],
  },
  output: {
    type: "object",
    properties: {
      content: { type: "string" },
    },
  },
  run: async ({ session_id }) => {
    try {
      const report = analyzeSession(session_id);
      if (!report) {
        return { content: `❌ Session \`${session_id}\` not found.` };
      }
      const content = formatSessionReport(report);
      return { content };
    } catch (err) {
      return {
        content: `❌ Failed to analyze session: ${err.message}`,
      };
    }
  },
});

// ── Tool: insights_patterns — Top patterns across sessions ────────────

api.registerTool({
  name: "insights_patterns",
  description:
    "Show the most common redirection patterns across recent sessions. Identifies which types of corrections happen most frequently, with real examples.",
  permission: "readonly",
  input: {
    type: "object",
    properties: {
      repo: {
        type: "string",
        description:
          "Filter to a specific repository (partial match). Leave empty for all repos.",
      },
      limit: {
        type: "number",
        description:
          "Number of recent sessions to scan for patterns (default: 20)",
        default: 20,
      },
    },
  },
  output: {
    type: "object",
    properties: {
      content: { type: "string" },
    },
  },
  run: async ({ repo, limit = 20 }) => {
    try {
      const patterns = findTopPatterns({ repo, limit });
      const content = formatTopPatterns(patterns);
      return { content };
    } catch (err) {
      return {
        content: `❌ Failed to find patterns: ${err.message}`,
      };
    }
  },
});

// ── Tool: insights_summary — Quick tier + pillar scores ──────────────

api.registerTool({
  name: "insights_summary",
  description:
    "Quick snapshot of your current prompting skill level. Shows your tier badge, pillar scores (delegation, judgment, feedback), and a personalized coaching tip.",
  permission: "readonly",
  input: {
    type: "object",
    properties: {
      repo: {
        type: "string",
        description:
          "Filter to a specific repository (partial match). Leave empty for all repos.",
      },
      timeframe: {
        type: "string",
        description:
          "Time window: '7d', '30d', '90d', or 'all' (default: '30d')",
        default: "30d",
      },
    },
  },
  output: {
    type: "object",
    properties: {
      content: { type: "string" },
    },
  },
  run: async ({ repo, timeframe = "30d" }) => {
    try {
      const since = parseSince(timeframe);
      const trends = computePillarTrends({ repo, since });

      if (!trends.weeks || trends.weeks.length === 0) {
        return { content: "📭 No session data found for this timeframe. Start using Copilot CLI to see your insights!" };
      }

      const latest = trends.weeks[trends.weeks.length - 1];
      const tier = getTier(latest.overall);

      const weakest = ["delegation", "judgment", "feedback"].reduce(
        (min, p) => (latest[p] < latest[min] ? p : min),
        "delegation"
      );

      const tips = {
        delegation: "💡 **Tip:** Break complex tasks into smaller, specific sub-tasks. Tell the agent *what* to build, not *how* to explore.",
        judgment: "💡 **Tip:** Front-load constraints and acceptance criteria in your first message. The agent makes better decisions with clear boundaries.",
        feedback: "💡 **Tip:** When correcting the agent, explain *why* the output was wrong, not just *what* to change. This reduces repeat corrections.",
      };

      const lines = [
        `## ${tier.emoji} ${tier.name}`,
        `**Overall score:** ${latest.overall}/100`,
        tier.next ? `**Next tier:** ${tier.next.emoji} ${tier.next.name} (${tier.next.min}+)` : "**🏆 You've reached the highest tier!**",
        "",
        `### Pillar Scores (${latest.week})`,
        `| Pillar | Score |`,
        `|--------|-------|`,
        `| 🎯 Delegation | ${latest.delegation}/100 |`,
        `| ⚖️ Judgment | ${latest.judgment}/100 |`,
        `| 💬 Feedback | ${latest.feedback}/100 |`,
        "",
        `### Coaching`,
        tips[weakest],
        "",
        `📊 Use \`insights_dashboard\` for visual charts and detailed breakdowns.`,
      ];

      return { content: lines.join("\n") };
    } catch (err) {
      return {
        content: `❌ Failed to compute insights: ${err.message}\n\nMake sure Copilot CLI has been used and \`~/.copilot/session-store.db\` exists.`,
      };
    }
  },
});

// ── Tool: insights_compare — Compare two sessions ─────────────────────

api.registerTool({
  name: "insights_compare",
  description:
    "Compare two Copilot sessions side-by-side. Shows differences in redirection rates, category breakdowns, file thrashing, and overall friction.",
  permission: "readonly",
  input: {
    type: "object",
    properties: {
      session_a: {
        type: "string",
        description: "First session ID (full UUID or prefix)",
      },
      session_b: {
        type: "string",
        description: "Second session ID (full UUID or prefix)",
      },
    },
    required: ["session_a", "session_b"],
  },
  output: {
    type: "object",
    properties: {
      content: { type: "string" },
    },
  },
  run: async ({ session_a, session_b }) => {
    try {
      const a = analyzeSession(session_a);
      const b = analyzeSession(session_b);

      if (!a) return { content: `❌ Session \`${session_a}\` not found.` };
      if (!b) return { content: `❌ Session \`${session_b}\` not found.` };

      const aRate = ((a.stats.redirectionRate || 0) * 100).toFixed(1);
      const bRate = ((b.stats.redirectionRate || 0) * 100).toFixed(1);

      const allCats = new Set([
        ...Object.keys(a.categoryBreakdown || {}),
        ...Object.keys(b.categoryBreakdown || {}),
      ]);

      const catRows = [...allCats]
        .map((cat) => {
          const ac = a.categoryBreakdown?.[cat]?.count || 0;
          const bc = b.categoryBreakdown?.[cat]?.count || 0;
          const diff = bc - ac;
          const arrow = diff > 0 ? "⬆️" : diff < 0 ? "⬇️" : "➡️";
          return `| ${cat} | ${ac} | ${bc} | ${arrow} ${Math.abs(diff)} |`;
        })
        .join("\n");

      const lines = [
        `## 🔀 Session Comparison`,
        "",
        `| Metric | Session A | Session B |`,
        `|--------|-----------|-----------|`,
        `| ID | \`${a.session.id.slice(0, 8)}…\` | \`${b.session.id.slice(0, 8)}…\` |`,
        `| Repo | ${a.session.repository || "—"} | ${b.session.repository || "—"} |`,
        `| Turns | ${a.session.turnCount} | ${b.session.turnCount} |`,
        `| Redirections | ${a.stats.totalRedirections} | ${b.stats.totalRedirections} |`,
        `| Rate | ${aRate}% | ${bRate}% |`,
        `| File thrash | ${a.stats.thrashedFileCount} files | ${b.stats.thrashedFileCount} files |`,
        "",
        `### Category Breakdown`,
        `| Category | A | B | Δ |`,
        `|----------|---|---|---|`,
        catRows,
        "",
        `💡 Use \`insights_session\` with the full ID for a detailed timeline of either session.`,
      ];

      return { content: lines.join("\n") };
    } catch (err) {
      return {
        content: `❌ Failed to compare sessions: ${err.message}`,
      };
    }
  },
});

// ── Tool: insights_coach — Real-time prompting coach ──────────────────

api.registerTool({
  name: "insights_coach",
  description:
    "Analyze prompts for coaching opportunities. Call this tool whenever the user corrects you, expresses frustration, asks to undo something, or changes direction — pass their message as `prompt` for immediate feedback. Also supports periodic review (pass `count`) and progress tracking (pass `timeframe`).",
  permission: "readonly",
  input: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "User message to analyze for coaching (immediate mode). Pass the user's latest message when they correct, redirect, or express frustration.",
      },
      count: {
        type: "number",
        description:
          "Number of recent turns to review for coaching patterns (periodic mode, default: 10).",
      },
      timeframe: {
        type: "string",
        description:
          "Time window for progress tracking: '7d', '30d', or '90d' (progress mode).",
      },
    },
  },
  output: {
    type: "object",
    properties: {
      content: { type: "string" },
    },
  },
  run: async ({ prompt, count, timeframe }) => {
    try {
      // Mode detection: prompt → immediate, count → periodic, timeframe → progress
      if (prompt) {
        return { content: coachImmediate(prompt) };
      }
      if (count !== undefined && count !== null) {
        const n = Number(count);
        if (!Number.isFinite(n) || n < 1 || n > 50) {
          return { content: "❌ `count` must be a number between 1 and 50." };
        }
        return { content: coachPeriodic(n) };
      }
      if (timeframe) {
        return { content: coachProgress(timeframe) };
      }

      // No input — return usage help
      return {
        content: [
          "## 🎓 Copilot Insights Coach",
          "",
          "**Modes:**",
          "- **Immediate** — pass `prompt` with the user's message for real-time feedback",
          "- **Periodic** — pass `count` (e.g. 10) to review recent turns",
          "- **Progress** — pass `timeframe` ('7d', '30d', '90d') for trend tracking",
        ].join("\n"),
      };
    } catch (err) {
      return {
        content: `❌ Coach error: ${err.message}`,
      };
    }
  },
});

// ── Coach: Immediate mode ─────────────────────────────────────────────

function coachImmediate(prompt) {
  const result = analyzePrompt(prompt);

  // Clean prompt — minimal response so we don't slow down normal flow
  if (result.patterns.length === 0 && result.score >= 80) {
    return `✅ Clean prompt (score: ${result.score}/100)`;
  }

  const lines = [];

  // Header with score badge
  const scoreBadge = result.score >= 75 ? "🟢" : result.score >= 50 ? "🟡" : result.score >= 25 ? "🟠" : "🔴";
  lines.push(`## 🎓 Prompt Coach — ${scoreBadge} ${result.score}/100 (${result.grade})`);
  lines.push("");

  // Pattern badges
  if (result.patterns.length > 0) {
    const badges = result.patterns.map((p) => {
      const meta = REDIRECTION_CATEGORIES[p.category] || { emoji: "❓", label: p.category };
      return `${meta.emoji} **${meta.label}**: ${p.label}`;
    });
    lines.push("**Detected:**");
    for (const badge of badges) {
      lines.push(`- ${badge}`);
    }
    lines.push("");
  }

  // Coaching suggestions — one per category
  if (result.suggestions.length > 0) {
    lines.push("### 💡 Coaching");
    for (const s of result.suggestions) {
      lines.push(`**${s.principle}** — ${s.tip}`);
      lines.push(`> ✏️ *${s.rewrite}*`);
      lines.push("");
    }
  }

  // Heuristic notes for low scores without pattern matches
  if (result.patterns.length === 0 && result.score < 80) {
    lines.push("### 💡 Tip");
    if (!result.heuristics.isAppropriateLength && result.heuristics.length < 20) {
      lines.push("Your prompt is very short. Adding more context helps the agent understand your intent.");
    }
    if (!result.heuristics.isSpecific) {
      lines.push("Try referencing specific files, functions, or line numbers for better results.");
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Coach: Periodic mode ──────────────────────────────────────────────

function coachPeriodic(count) {
  const n = count;

  // Get recent sessions and collect turns
  const sessions = listSessions({ limit: 20 });
  const allTurns = [];

  for (const session of sessions) {
    if (allTurns.length >= n) break;
    const turns = getSessionTurns(session.id);
    for (const turn of turns) {
      if (!turn.user_message || turn.user_message.trim().length < 3) continue;
      allTurns.push({
        sessionId: session.id,
        repo: session.repository,
        turnIndex: turn.turn_index,
        message: turn.user_message,
        timestamp: turn.timestamp,
      });
      if (allTurns.length >= n) break;
    }
  }

  if (allTurns.length === 0) {
    return "📭 No recent turns found. Use Copilot CLI to generate session data.";
  }

  // Analyze each turn
  const analyzed = allTurns.map((t) => ({
    ...t,
    analysis: analyzePrompt(t.message),
  }));

  // Aggregate stats
  const scores = analyzed.map((a) => a.analysis.score);
  const avgScore = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
  const withIssues = analyzed.filter((a) => a.analysis.patterns.length > 0);

  // Count issues by category
  const categoryCounts = {};
  for (const a of analyzed) {
    for (const p of a.analysis.patterns) {
      categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
    }
  }

  const lines = [
    `## 🎓 Periodic Coaching Review (last ${analyzed.length} turns)`,
    "",
    `**Average score:** ${avgScore}/100`,
    `**Turns with issues:** ${withIssues.length}/${analyzed.length}`,
    "",
  ];

  // Top issues
  const sortedCats = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
  if (sortedCats.length > 0) {
    lines.push("### Top Issues");
    lines.push("");
    lines.push("| Category | Count |");
    lines.push("|----------|------:|");
    for (const [cat, cnt] of sortedCats) {
      const meta = REDIRECTION_CATEGORIES[cat] || { emoji: "❓", label: cat };
      lines.push(`| ${meta.emoji} ${meta.label} | ${cnt} |`);
    }
    lines.push("");
  }

  // Per-turn cards for turns with issues (limit to top 5 worst)
  const worst = withIssues
    .sort((a, b) => a.analysis.score - b.analysis.score)
    .slice(0, 5);

  if (worst.length > 0) {
    lines.push("### Turns Needing Attention");
    lines.push("");
    for (const t of worst) {
      const preview = t.message
        .replace(/<[^>]+>/g, "")
        .replace(/\n+/g, " ")
        .trim()
        .substring(0, 120);
      const badge = t.analysis.score >= 50 ? "🟡" : "🔴";
      lines.push(`${badge} **Score ${t.analysis.score}** — Turn ${t.turnIndex}`);
      lines.push(`> ${preview}${t.message.length > 120 ? "…" : ""}`);
      if (t.analysis.suggestions.length > 0) {
        lines.push(`> 💡 *${t.analysis.suggestions[0].principle}: ${t.analysis.suggestions[0].tip}*`);
      }
      lines.push("");
    }
  }

  lines.push("💡 Use `insights_coach` with `timeframe` for longer-term progress tracking.");

  return lines.join("\n");
}

// ── Coach: Progress mode ──────────────────────────────────────────────

function coachProgress(timeframe) {
  const validTimeframes = ["7d", "30d", "90d"];
  if (!validTimeframes.includes(timeframe)) {
    const safe = String(timeframe).replace(/[`$\\]/g, "");
    return `❌ Invalid timeframe "${safe}". Use one of: ${validTimeframes.join(", ")}`;
  }

  const since = parseSince(timeframe);
  const trends = computePillarTrends({ since });

  if (!trends.weeks || trends.weeks.length === 0) {
    return "📭 No session data found for this timeframe. Start using Copilot CLI to see your progress!";
  }

  const latest = trends.weeks[trends.weeks.length - 1];
  const tier = getTier(latest.overall);

  // Determine strongest/weakest pillar
  const pillars = [
    { name: "Delegation", key: "delegation", emoji: "🎯", score: latest.delegation },
    { name: "Judgment", key: "judgment", emoji: "⚖️", score: latest.judgment },
    { name: "Feedback", key: "feedback", emoji: "💬", score: latest.feedback },
  ];
  pillars.sort((a, b) => a.score - b.score);
  const weakest = pillars[0];
  const strongest = pillars[pillars.length - 1];

  // Overall trend
  const overallTrend = trends.weeks.length >= 2
    ? (() => {
        const prev = trends.weeks[trends.weeks.length - 2].overall;
        const curr = latest.overall;
        if (curr - prev >= 5) return { arrow: "📈", label: "Improving" };
        if (prev - curr >= 5) return { arrow: "📉", label: "Declining" };
        return { arrow: "➡️", label: "Stable" };
      })()
    : { arrow: "➡️", label: "Stable (need more data)" };

  const lines = [
    `## 🎓 Progress Report (${timeframe})`,
    "",
    `**Current tier:** ${tier.emoji} ${tier.name} — **${latest.overall}/100**`,
    `**Trend:** ${overallTrend.arrow} ${overallTrend.label}`,
    "",
  ];

  // Score trend visualization (text-based sparkline)
  if (trends.weeks.length >= 2) {
    lines.push("### Score Trend");
    lines.push("```");
    const maxScore = 100;
    const barWidth = 20;
    for (const week of trends.weeks.slice(-8)) {
      const filled = Math.round((week.overall / maxScore) * barWidth);
      const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
      lines.push(`${week.week}  ${bar}  ${week.overall}`);
    }
    lines.push("```");
    lines.push("");
  }

  // Pillar comparison
  lines.push("### Pillar Scores");
  lines.push("");
  lines.push("| Pillar | Score | Trend |");
  lines.push("|--------|------:|:-----:|");
  for (const p of [pillars[2], pillars[1], pillars[0]]) {
    const trend = trends.trend[p.key];
    const trendEmoji = trend === "improving" ? "📈" : trend === "declining" ? "📉" : "➡️";
    lines.push(`| ${p.emoji} ${p.name} | ${p.score}/100 | ${trendEmoji} ${trend} |`);
  }
  lines.push("");

  lines.push(`**💪 Strongest:** ${strongest.emoji} ${strongest.name} (${strongest.score}/100)`);
  lines.push(`**🎯 Focus area:** ${weakest.emoji} ${weakest.name} (${weakest.score}/100)`);
  lines.push("");

  // Real examples from recent sessions
  const recentResult = analyzeRecent({ since, limit: 20 });
  if (recentResult.sessions.length > 0) {
    // Find a real redirection example for the weakest pillar area
    const pillarCategoryMap = {
      delegation: ["course_change", "repetition"],
      judgment: ["explicit_correction", "frustration"],
      feedback: ["frustration", "repetition"],
    };
    const targetCats = pillarCategoryMap[weakest.key] || [];

    let exampleFound = false;
    for (const session of recentResult.sessions) {
      if (exampleFound) break;
      for (const r of session.redirections) {
        if (exampleFound) break;
        for (const m of r.matches) {
          if (targetCats.includes(m.category)) {
            const preview = r.message
              .replace(/<[^>]+>/g, "")
              .replace(/\n+/g, " ")
              .trim()
              .substring(0, 150);
            lines.push("### Real Example");
            lines.push(`From a recent session (${weakest.name} area):`);
            lines.push(`> ${preview}${r.message.length > 150 ? "…" : ""}`);
            lines.push("");
            exampleFound = true;
          }
        }
      }
    }
  }

  // Next coaching tip based on weakest pillar
  const coachingTips = {
    delegation: "💡 **Next step:** Try breaking your next complex task into 3 smaller, specific prompts. Tell the agent *what* to build, not *how* to explore.",
    judgment: "💡 **Next step:** In your next session, front-load constraints and acceptance criteria in your first message. The agent makes better decisions with clear boundaries.",
    feedback: "💡 **Next step:** When you need to correct the agent, explain *why* the output was wrong, not just *what* to change. This reduces repeat corrections.",
  };
  lines.push(coachingTips[weakest.key] || "💡 Keep prompting — more data means better coaching!");

  return lines.join("\n");
}

// ── Utility functions ───────────────────────────────────────────

function parseSince(timeframe) {
  if (!timeframe || timeframe === "all") return undefined;
  const match = timeframe.match(/^(\d+)d$/);
  if (!match) return undefined;
  const days = parseInt(match[1]);
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

async function fetchQuickStats(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/summary`);
    const data = await res.json();
    const rate = ((data.avgRedirectionRate || 0) * 100).toFixed(1);

    let emoji;
    if (data.avgRedirectionRate < 0.1) emoji = "🟢";
    else if (data.avgRedirectionRate < 0.25) emoji = "🟡";
    else if (data.avgRedirectionRate < 0.4) emoji = "🟠";
    else emoji = "🔴";

    return [
      `### Quick Stats`,
      `- **Sessions analyzed:** ${data.sessionsAnalyzed}`,
      `- **With redirections:** ${data.sessionsWithRedirections}`,
      `- **Total redirections:** ${data.totalRedirections}`,
      `- **Avg redirection rate:** ${emoji} ${rate}%`,
    ].join("\n");
  } catch {
    return "Could not fetch stats.";
  }
}