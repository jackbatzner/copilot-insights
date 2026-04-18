// Output formatting — turns analysis results into readable markdown.

import { REDIRECTION_CATEGORIES } from "./patterns.mjs";

/**
 * Format a single session analysis as markdown.
 */
export function formatSessionReport(report) {
  if (!report) return "❌ Session not found.";

  const { session, stats, categoryBreakdown, redirections, thrashedFiles } =
    report;

  const lines = [
    `## 🔄 Redirection Analysis`,
    "",
    `**Session:** \`${session.id.substring(0, 8)}…\``,
  ];

  if (session.repository) lines.push(`**Repo:** ${session.repository}`);
  if (session.branch) lines.push(`**Branch:** \`${session.branch}\``);
  if (session.summary) lines.push(`**Summary:** ${session.summary}`);
  lines.push(`**Turns:** ${session.turnCount} · **Created:** ${session.createdAt}`);

  lines.push("");
  lines.push(scoreBar(stats));
  lines.push("");

  // Category breakdown
  if (Object.keys(categoryBreakdown).length > 0) {
    lines.push("### By Category");
    lines.push("");
    lines.push("| Category | Count | Severity |");
    lines.push("|----------|------:|:--------:|");
    for (const [cat, data] of Object.entries(categoryBreakdown)) {
      const info = REDIRECTION_CATEGORIES[cat] || { emoji: "❓", label: cat };
      lines.push(
        `| ${info.emoji} ${info.label} | ${data.count} | ${weightBar(data.weight)} |`
      );
    }
  }

  // Individual redirections
  if (redirections.length > 0) {
    lines.push("");
    lines.push("### Redirection Timeline");
    lines.push("");
    for (const r of redirections) {
      const labels = r.matches.map((m) => {
        const info = REDIRECTION_CATEGORIES[m.category] || { emoji: "❓" };
        return `${info.emoji} ${m.label}`;
      });
      const msgPreview = cleanMessage(r.message);
      lines.push(
        `**Turn ${r.turnIndex}** ${labels.join(" · ")}`
      );
      lines.push(`> ${msgPreview}`);
      lines.push("");
    }
  }

  // File thrashing
  if (thrashedFiles.length > 0) {
    lines.push("### ⚠️ File Thrashing");
    lines.push(
      "*Files edited 3+ times — may indicate unclear requirements or repeated corrections:*"
    );
    lines.push("");
    for (const f of thrashedFiles) {
      lines.push(`- \`${f.file_path}\` — ${f.edit_count} edits`);
    }
  }

  return lines.join("\n");
}

/**
 * Format the multi-session summary report.
 */
export function formatSummaryReport({ aggregate, sessions }) {
  const lines = [
    `## 📊 Redirection Summary`,
    "",
    `**Sessions analyzed:** ${aggregate.sessionsAnalyzed}`,
    `**With redirections:** ${aggregate.sessionsWithRedirections}`,
    `**Total redirections:** ${aggregate.totalRedirections}`,
    `**Avg redirection rate:** ${(aggregate.avgRedirectionRate * 100).toFixed(1)}% of user turns`,
    "",
  ];

  // Category totals
  if (Object.keys(aggregate.categoryTotals).length > 0) {
    lines.push("### Category Breakdown");
    lines.push("");
    lines.push("| Category | Total | Weight |");
    lines.push("|----------|------:|-------:|");
    for (const [cat, data] of Object.entries(aggregate.categoryTotals)) {
      const info = REDIRECTION_CATEGORIES[cat] || { emoji: "❓", label: cat };
      lines.push(`| ${info.emoji} ${info.label} | ${data.count} | ${data.weight} |`);
    }
    lines.push("");
  }

  // Top sessions by redirection weight
  if (sessions.length > 0) {
    lines.push("### Sessions Ranked by Redirection Severity");
    lines.push("");
    lines.push("| Session | Repo | Redirections | Rate | Score |");
    lines.push("|---------|------|:------------:|:----:|:-----:|");
    for (const r of sessions.slice(0, 10)) {
      const id = r.session.id.substring(0, 8);
      const repo = r.session.repository || "—";
      const rate = `${(r.stats.redirectionRate * 100).toFixed(0)}%`;
      lines.push(
        `| \`${id}…\` | ${repo} | ${r.stats.totalRedirections} | ${rate} | ${weightBar(r.stats.totalWeight)} |`
      );
    }
    lines.push("");
    lines.push(
      "💡 Use `insights_session` with a session ID for a detailed breakdown."
    );
  }

  return lines.join("\n");
}

/**
 * Format top-patterns report.
 */
export function formatTopPatterns(patterns) {
  if (patterns.length === 0) {
    return "✅ No redirection patterns found in recent sessions.";
  }

  const lines = [
    `## 🏆 Top Redirection Patterns`,
    "",
    "| Pattern | Category | Occurrences | Example |",
    "|---------|----------|:-----------:|---------|",
  ];

  for (const p of patterns.slice(0, 15)) {
    const info = REDIRECTION_CATEGORIES[p.category] || {
      emoji: "❓",
      label: p.category,
    };
    const example =
      p.examples.length > 0
        ? cleanMessage(p.examples[0].message).substring(0, 60)
        : "—";
    lines.push(
      `| ${p.label} | ${info.emoji} ${info.label} | ${p.count} | ${example} |`
    );
  }

  lines.push("");
  lines.push(
    "💡 These are the patterns where the agent most often needed correction."
  );

  return lines.join("\n");
}

// ── Helpers ─────────────────────────────────────────────────────

function scoreBar(stats) {
  const { totalRedirections, redirectionRate, totalWeight } = stats;
  const ratePercent = (redirectionRate * 100).toFixed(1);

  let emoji, verdict;
  if (redirectionRate < 0.1) {
    emoji = "🟢";
    verdict = "Smooth sailing";
  } else if (redirectionRate < 0.25) {
    emoji = "🟡";
    verdict = "Some course corrections";
  } else if (redirectionRate < 0.4) {
    emoji = "🟠";
    verdict = "Frequent redirections";
  } else {
    emoji = "🔴";
    verdict = "Heavy redirection — consider refining approach";
  }

  return `${emoji} **${verdict}** — ${totalRedirections} redirection(s) in ${ratePercent}% of turns (severity: ${totalWeight})`;
}

function weightBar(weight) {
  if (weight <= 2) return "🟢";
  if (weight <= 5) return "🟡";
  if (weight <= 10) return "🟠";
  return "🔴";
}

function cleanMessage(msg) {
  return msg
    .replace(/<[^>]+>/g, "") // strip XML tags
    .replace(/\n+/g, " ") // collapse newlines
    .replace(/\s+/g, " ") // collapse whitespace
    .trim()
    .substring(0, 200);
}
