// Work-style analysis — classifies sessions as plan-first, vibe-coded, or iterative.
// Measures the plan → iterate → implement cycle to coach users toward
// more structured development vs jumping straight to code.
//
// ALL SIGNALS ARE USER-DRIVEN — we only look at what the user typed/decided,
// not what the agent chose to do.

import {
  listSessions,
  hasTable,
  batchGetSessionTurns,
  batchGetSessionFiles,
  batchGetCheckpointCounts,
} from "./db.mjs";
import { getDb } from "./db.mjs";

const PLAN_WORDS =
  /\b(plan|approach|design|architecture|strategy|think about|consider|before we|let's figure|what if|how should|options|tradeoff|proposal|requirements|spec|scope|outline|breakdown)\b/i;

const REVIEW_WORDS =
  /\b(looks good|lgtm|let me check|let me review|let me see|show me|what does it look like|test it|run the tests|does it work|try it|verify|check if|confirm|validate)\b/i;

const ITERATE_WORDS =
  /\b(tweak|adjust|refine|polish|improve|change .* to|update|modify|can you make|swap|switch|move|rename)\b/i;

function cleanMsg(msg) {
  if (!msg) return "";
  return msg
    .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .trim();
}

/**
 * Classify a single session's work style.
 */
function classifySession(sessionId, turns, files, checkpointCount = 0) {
  if (turns.length === 0) return null;

  const firstFileTurn = files.length > 0 ? Math.min(...files.map((f) => f.turn_index)) : turns.length;
  const totalTurns = turns.length;

  // Phase detection: which turns are planning, implementing, reviewing?
  const phases = turns.map((t) => {
    const cleaned = cleanMsg(t.user_message);
    if (!cleaned || cleaned.length < 3) return "other";

    const hasPlan = PLAN_WORDS.test(cleaned);
    const hasReview = REVIEW_WORDS.test(cleaned);
    const hasIterate = ITERATE_WORDS.test(cleaned);
    const hasFiles = files.some((f) => f.turn_index === t.turn_index);

    if (hasFiles) return "implement";
    if (hasPlan) return "plan";
    if (hasReview) return "review";
    if (hasIterate) return "iterate";
    return "other";
  });

  // Count phase turns
  const planTurns = phases.filter((p) => p === "plan").length;
  const implementTurns = phases.filter((p) => p === "implement").length;
  const reviewTurns = phases.filter((p) => p === "review").length;
  const iterateTurns = phases.filter((p) => p === "iterate").length;

  // Classify overall style
  let style, emoji, description;

  if (firstFileTurn >= 3 && planTurns >= 2) {
    style = "structured";
    emoji = "🎯";
    description = "Planned first, then implemented";
  } else if (firstFileTurn >= 2 && (reviewTurns >= 1 || iterateTurns >= 2)) {
    style = "iterative";
    emoji = "🔄";
    description = "Built incrementally with review cycles";
  } else if (firstFileTurn <= 1) {
    style = "vibe";
    emoji = "🌊";
    description = "Jumped straight to implementation";
  } else {
    style = "mixed";
    emoji = "⚡";
    description = "Some planning, mostly implementing";
  }

  return {
    sessionId,
    style,
    emoji,
    description,
    firstFileTurn,
    totalTurns,
    phases: { plan: planTurns, implement: implementTurns, review: reviewTurns, iterate: iterateTurns, other: phases.length - planTurns - implementTurns - reviewTurns - iterateTurns },
    hasCheckpoints: checkpointCount > 0,
    checkpointCount,
    fileOps: files.length,
  };
}

/**
 * Analyze work style across all sessions.
 */
export function analyzeWorkStyle({ repo, since, excludeIds } = {}) {
  const sessions = listSessions({ repo, since, excludeIds });
  const sessionIds = sessions.map((session) => session.id);
  const turnsBySession = batchGetSessionTurns(sessionIds);
  const filesBySession = batchGetSessionFiles(sessionIds);
  const checkpointCounts = hasTable("checkpoints")
    ? batchGetCheckpointCounts(sessionIds)
    : new Map(sessionIds.map((id) => [id, 0]));

  const results = sessions
    .map((session) => classifySession(
      session.id,
      turnsBySession.get(session.id) || [],
      filesBySession.get(session.id) || [],
      checkpointCounts.get(session.id) || 0
    ))
    .filter(Boolean);

  const styleCounts = { structured: 0, iterative: 0, vibe: 0, mixed: 0 };
  results.forEach((r) => { styleCounts[r.style]++; });

  const total = results.length || 1;
  const vibeRate = Math.round((styleCounts.vibe / total) * 100);
  const structuredRate = Math.round((styleCounts.structured / total) * 100);
  const iterativeRate = Math.round((styleCounts.iterative / total) * 100);

  // Dominant style
  const dominant = Object.entries(styleCounts).sort((a, b) => b[1] - a[1])[0];

  // Avg first-file-turn
  const avgFirstFile = results.length
    ? Math.round((results.reduce((s, r) => s + r.firstFileTurn, 0) / results.length) * 10) / 10
    : 0;

  // Sessions with checkpoints (structured indicator)
  const withCheckpoints = results.filter((r) => r.hasCheckpoints).length;

  // Coaching insight
  let coachingTip;
  if (vibeRate >= 70) {
    coachingTip = `You jump straight to code in ${vibeRate}% of sessions. Try spending 2-3 turns planning your approach before the first file edit — structured sessions have fewer redirections.`;
  } else if (vibeRate >= 40) {
    coachingTip = `You vibe-code ${vibeRate}% of the time. You're sometimes planning, sometimes not. Aim for consistency — plan first on complex tasks, vibe on quick fixes.`;
  } else if (structuredRate >= 50) {
    coachingTip = `Great discipline! ${structuredRate}% of your sessions start with planning. Keep it up — this reduces redirections and builds better outcomes.`;
  } else {
    coachingTip = `You have a balanced work style. Consider planning more on complex tasks (sessions with 10+ expected turns).`;
  }

  // Plan-vs-execution analysis for checkpoint-rich sessions
  const planExecution = analyzePlanExecution(results);

  return {
    summary: {
      total: results.length,
      styleCounts,
      vibeRate,
      structuredRate,
      iterativeRate,
      dominantStyle: dominant[0],
      dominantEmoji: { structured: "🎯", iterative: "🔄", vibe: "🌊", mixed: "⚡" }[dominant[0]],
      avgFirstFileTurn: avgFirstFile,
      sessionsWithCheckpoints: withCheckpoints,
    },
    coachingTip,
    planExecution,
    sessions: results.map((r) => ({
      sessionId: r.sessionId,
      style: r.style,
      emoji: r.emoji,
      description: r.description,
      firstFileTurn: r.firstFileTurn,
      totalTurns: r.totalTurns,
      fileOps: r.fileOps,
      checkpoints: r.checkpointCount,
    })),
  };
}

/**
 * Analyze plan-vs-execution for sessions with checkpoints.
 * Compares intent (summary) → plan (next_steps) → done (work_done).
 */
function analyzePlanExecution(classifiedSessions) {
  const db = getDb();
  const withCp = classifiedSessions.filter((s) => s.hasCheckpoints);

  if (withCp.length === 0) {
    return { sessionsAnalyzed: 0, insight: "No sessions with checkpoints yet — complex sessions generate plans to compare against." };
  }

  const analyzed = withCp.map((s) => {
    const session = db.prepare("SELECT summary FROM sessions WHERE id = ?").get(s.sessionId);
    const cps = db
      .prepare("SELECT checkpoint_number, title, overview, work_done, next_steps FROM checkpoints WHERE session_id = ? ORDER BY checkpoint_number")
      .all(s.sessionId);

    const intent = (session?.summary || "").substring(0, 200);
    const lastCp = cps[cps.length - 1];

    // Simple heuristic: did they complete what they set out to do?
    // Compare first checkpoint's overview (the goal) to last checkpoint's work_done
    const goalKeywords = extractKeywords(cps[0]?.overview || intent);
    const doneKeywords = extractKeywords(lastCp?.work_done || "");
    const overlap = goalKeywords.filter((k) => doneKeywords.includes(k));
    const completionRate = goalKeywords.length ? Math.round((overlap.length / goalKeywords.length) * 100) : 0;

    return {
      sessionId: s.sessionId,
      style: s.style,
      checkpoints: cps.length,
      totalTurns: s.totalTurns,
      intentPreview: intent.substring(0, 100),
      completionRate: Math.min(completionRate, 100),
      hadPlan: cps.some((c) => (c.next_steps || "").length > 50),
      goalKeywordCount: goalKeywords.length,
      doneKeywordCount: doneKeywords.length,
    };
  });

  const avgCompletion = Math.round(analyzed.reduce((s, a) => s + a.completionRate, 0) / analyzed.length);
  const withPlans = analyzed.filter((a) => a.hadPlan).length;

  let insight;
  if (avgCompletion >= 80) {
    insight = `Strong follow-through: ${avgCompletion}% avg goal completion across ${analyzed.length} complex sessions. You finish what you start.`;
  } else if (avgCompletion >= 50) {
    insight = `Moderate follow-through: ${avgCompletion}% avg completion. You sometimes drift from the original goal — try reviewing your plan mid-session.`;
  } else {
    insight = `Low follow-through: ${avgCompletion}% avg completion. Sessions often end somewhere different from where they started. Consider breaking big goals into smaller, focused sessions.`;
  }

  return {
    sessionsAnalyzed: analyzed.length,
    avgCompletionRate: avgCompletion,
    sessionsWithPlans: withPlans,
    insight,
    sessions: analyzed,
  };
}

/**
 * Extract meaningful keywords from text for comparison.
 */
function extractKeywords(text) {
  if (!text) return [];
  const stop = new Set(["the", "a", "an", "is", "was", "are", "to", "for", "of", "in", "on", "and", "or", "with", "that", "this", "it", "be", "as", "at", "by", "from", "has", "had", "not", "but", "its", "into", "will", "can", "all", "been", "have", "were", "they", "their", "which", "would", "there", "each", "make", "like", "use", "her", "him", "two", "how", "our", "also", "did", "may", "than", "about", "over", "such", "after"]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stop.has(w))
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 30);
}
