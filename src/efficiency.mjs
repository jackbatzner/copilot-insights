// Session efficiency analysis — turn efficiency, recovery speed,
// context drip-feeding, response skimming, and session completion.

import { matchPatterns } from "./patterns.mjs";

/**
 * Strip system-injected XML from a user message to isolate user-typed content.
 */
function cleanUserMessage(msg) {
  if (!msg) return "";
  return msg
    .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .trim();
}

/**
 * Analyze turn-by-turn efficiency of a session.
 */
export function analyzeEfficiency(turns, sessionRefs = []) {
  // Only count turns with actual user-typed content (not system injections)
  const userTurns = turns.filter((t) => cleanUserMessage(t.user_message).length > 0);
  if (userTurns.length < 2) return null;

  // ── 1. Turn efficiency ratio ───────────────────────────────
  let productiveTurns = 0;
  let redirectionTurns = 0;
  const turnDetails = [];

  for (const turn of userTurns) {
    const cleaned = cleanUserMessage(turn.user_message);
    const matches = matchPatterns(cleaned);
    const isRedirection = matches.length > 0;
    if (isRedirection) redirectionTurns++;
    else productiveTurns++;

    turnDetails.push({
      turnIndex: turn.turn_index,
      isRedirection,
      matchCount: matches.length,
    });
  }

  const efficiencyRatio = userTurns.length > 0
    ? productiveTurns / userTurns.length
    : 1;

  // ── 2. Recovery speed ──────────────────────────────────────
  // After a redirection, how many turns until the next non-redirection?
  const recoveries = [];
  let inRecovery = false;
  let recoveryStart = -1;

  for (let i = 0; i < turnDetails.length; i++) {
    if (turnDetails[i].isRedirection && !inRecovery) {
      inRecovery = true;
      recoveryStart = i;
    } else if (!turnDetails[i].isRedirection && inRecovery) {
      recoveries.push(i - recoveryStart);
      inRecovery = false;
    }
  }
  // If still in recovery at end, count remaining turns
  if (inRecovery) {
    recoveries.push(turnDetails.length - recoveryStart);
  }

  const avgRecovery = recoveries.length > 0
    ? recoveries.reduce((a, b) => a + b, 0) / recoveries.length
    : 0;

  // ── 3. Context drip-feeding ────────────────────────────────
  // Short messages that add info piecemeal after the first turn
  const DRIP_PATTERNS = [
    /\boh and\b/i,
    /\bI forgot to mention\b/i,
    /\balso[,.]?\s+(the|it|make|add|use)\b/i,
    /\bI should have said\b/i,
    /\bone more thing\b/i,
    /\bby the way\b/i,
    /\bbtw\b/i,
    /\boh wait\b/i,
    /\bactually[,.]?\s+(the|it)\b/i,
  ];

  const dripFeeds = [];
  for (let i = 1; i < userTurns.length; i++) {
    const msg = userTurns[i].user_message || "";
    const cleaned = msg
      .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .trim();

    for (const p of DRIP_PATTERNS) {
      if (p.test(cleaned)) {
        dripFeeds.push({
          turnIndex: userTurns[i].turn_index,
          message: cleaned.substring(0, 150),
          pattern: p.source,
        });
        break;
      }
    }
  }

  // ── 4. Response skimming ───────────────────────────────────
  // User sends a very short message right after a long assistant response
  const skimSignals = [];
  for (let i = 0; i < turns.length - 1; i++) {
    const current = turns[i];
    const next = turns[i + 1];

    if (current.assistant_response && next.user_message) {
      const responseLen = current.assistant_response.length;
      const userMsg = (next.user_message || "")
        .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .trim();
      const userLen = userMsg.length;

      // Long response (500+) followed by very short user message (<30 chars)
      // that contains a redirection
      if (responseLen > 500 && userLen < 50 && userLen > 0) {
        const matches = matchPatterns(userMsg);
        if (matches.length > 0) {
          skimSignals.push({
            turnIndex: next.turn_index,
            responseLength: responseLen,
            userMessageLength: userLen,
            message: userMsg.substring(0, 100),
          });
        }
      }
    }
  }

  // ── 5. Session completion ──────────────────────────────────
  const hasCommit = sessionRefs.some((r) => r.ref_type === "commit");
  const hasPR = sessionRefs.some((r) => r.ref_type === "pr");
  const lastTurn = turns[turns.length - 1];
  const hasAssistantEnd = lastTurn && lastTurn.assistant_response && !lastTurn.user_message;

  let completionStatus;
  if (hasPR) completionStatus = { label: "PR Created", emoji: "🎉", level: "excellent" };
  else if (hasCommit) completionStatus = { label: "Committed", emoji: "✅", level: "good" };
  else if (hasAssistantEnd && userTurns.length > 3) completionStatus = { label: "Completed", emoji: "👍", level: "fair" };
  else if (userTurns.length <= 2) completionStatus = { label: "Brief", emoji: "💨", level: "neutral" };
  else completionStatus = { label: "Abandoned", emoji: "🚪", level: "poor" };

  // ── 6. Overall efficiency grade ────────────────────────────
  let grade;
  if (efficiencyRatio >= 0.9) grade = { label: "Excellent", emoji: "🌟", color: "#3fb950" };
  else if (efficiencyRatio >= 0.75) grade = { label: "Good", emoji: "👍", color: "#58a6ff" };
  else if (efficiencyRatio >= 0.6) grade = { label: "Fair", emoji: "📐", color: "#d29922" };
  else grade = { label: "Needs Work", emoji: "🔧", color: "#f85149" };

  return {
    grade,
    turnCount: userTurns.length,
    productiveTurns,
    redirectionTurns,
    efficiencyRatio: Math.round(efficiencyRatio * 100) / 100,
    recoverySpeed: {
      avgTurns: Math.round(avgRecovery * 10) / 10,
      incidents: recoveries.length,
      recoveries,
    },
    dripFeeding: {
      count: dripFeeds.length,
      instances: dripFeeds,
    },
    responseSkimming: {
      count: skimSignals.length,
      instances: skimSignals,
    },
    completion: completionStatus,
  };
}

/**
 * Analyze efficiency across multiple sessions.
 */
export function analyzeEfficiencyBatch(sessionsData) {
  const results = [];
  let totalEfficiency = 0;
  let totalRecovery = 0;
  let recoveryCount = 0;
  let dripTotal = 0;
  let skimTotal = 0;
  const completionCounts = {};

  for (const { session, turns, refs } of sessionsData) {
    const eff = analyzeEfficiency(turns, refs);
    if (!eff) continue;

    results.push({
      sessionId: session.id,
      repository: session.repository,
      branch: session.branch,
      summary: session.summary,
      createdAt: session.created_at,
      efficiency: eff,
    });

    totalEfficiency += eff.efficiencyRatio;
    if (eff.recoverySpeed.incidents > 0) {
      totalRecovery += eff.recoverySpeed.avgTurns;
      recoveryCount++;
    }
    dripTotal += eff.dripFeeding.count;
    skimTotal += eff.responseSkimming.count;

    const status = eff.completion.label;
    completionCounts[status] = (completionCounts[status] || 0) + 1;
  }

  const count = results.length;
  return {
    aggregate: {
      sessionsAnalyzed: count,
      avgEfficiency: count > 0 ? Math.round((totalEfficiency / count) * 100) : 0,
      avgRecoveryTurns: recoveryCount > 0 ? Math.round((totalRecovery / recoveryCount) * 10) / 10 : 0,
      totalDripFeeds: dripTotal,
      totalSkimSignals: skimTotal,
      completionBreakdown: completionCounts,
    },
    sessions: results.sort((a, b) => a.efficiency.efficiencyRatio - b.efficiency.efficiencyRatio),
  };
}
