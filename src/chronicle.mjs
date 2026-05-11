// Chronicle-style session coaching — context hygiene, tool choice, personalized
// tips, and per-session improvement suggestions.

import { homedir } from "node:os";
import { listSessions, getSessionTurns, getSessionFiles, getSessionRefs } from "./db.mjs";
import { scoreClarity } from "./clarity.mjs";
import { matchPatterns } from "./patterns.mjs";
import { analyzeEfficiency } from "./efficiency.mjs";

const ANALYSIS_LIMIT = 10000;
const NO_REPO_VALUES = new Set(["", "(no repo)", "unknown"]);
const QUESTION_RE = /^(what|how|why|where|when|can|could|should)\b/i;
const LATE_CATCH_RE = /\b(go\s+back|earlier|before|undo|revert|rollback|we need to redo|should have|shouldn't have|wish (?:i|we) had|all (?:along|this time)|from the (?:start|beginning))\b/i;
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "could", "did", "do", "does", "for",
  "from", "had", "has", "have", "how", "i", "if", "in", "into", "is", "it", "its", "just", "make", "now", "of",
  "on", "or", "please", "should", "so", "that", "the", "their", "them", "then", "there", "this", "to", "up", "use",
  "using", "we", "what", "when", "where", "which", "why", "with", "would", "you", "your"
]);

/**
 * Remove system blocks and XML tags from a message.
 * Keeps user text while dropping Copilot-injected wrappers.
 */
// Exported for testability
export function cleanMessage(msg) {
  if (!msg) return "";
  return msg
    .replace(/<cross_session_message>[\s\S]*?<\/cross_session_message>/gi, " ")
    .replace(/<skill-context[^>]*>[\s\S]*?<\/skill-context>/gi, " ")
    .replace(/<system_notification>[\s\S]*?<\/system_notification>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a path so home-directory comparisons are stable.
 */
function normalizePath(value) {
  return (value || "")
    .replace(/[\\/]+/g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

/**
 * Return the user-authored turns for a session.
 */
function getHumanTurns(turns) {
  return turns
    .map((turn) => ({ ...turn, cleaned: cleanMessage(turn.user_message) }))
    .filter((turn) => turn.cleaned.length > 0);
}

/**
 * Test whether a session is missing useful repository context.
 */
function hasNoRepoContext(repository) {
  if (repository === null || repository === undefined) return true;
  return NO_REPO_VALUES.has(String(repository).trim().toLowerCase());
}

/**
 * Test whether a cwd points at the user's home directory.
 */
function isHomeDirectoryCwd(cwd) {
  const normalized = normalizePath(cwd);
  const home = normalizePath(homedir());
  return normalized === home || normalized === "~";
}

/**
 * Turn a raw ratio into an integer percentage.
 */
function toPct(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/**
 * Convert text into a keyword set for simple topic-shift detection.
 */
function tokenize(text) {
  return new Set(
    cleanMessage(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !STOPWORDS.has(token))
  );
}

/**
 * Jaccard similarity over keyword sets.
 */
function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Derive a Chronicle-style impact label from a severity score.
 */
function impactLabel(severity) {
  if (severity >= 25) return "high";
  if (severity >= 10) return "medium";
  return "low";
}

/**
 * Find a session by ID without requiring a dedicated DB getter.
 */
function findSession(sessionId) {
  return listSessions({ limit: ANALYSIS_LIMIT }).find((session) => session.id === sessionId) || null;
}

/**
 * Build a better opening prompt from the session's later details.
 */
function buildPromptRewrite(session, humanTurns, files) {
  const fileHint = files[0]?.file_path ? ` in ${files[0].file_path}` : "";
  const topicHints = [...tokenize(humanTurns.slice(1).map((turn) => turn.cleaned).join(" "))]
    .slice(0, 4)
    .join(", ");
  const action = session?.summary ? cleanMessage(session.summary).replace(/[.!?]+$/, "") : "complete this task";
  const requirements = topicHints ? ` Include specifics about ${topicHints}.` : " Include the target files, constraints, and success criteria.";
  return `Please ${action}${fileHint}. Keep the existing patterns, call out any constraints up front, and verify the result before finishing.${requirements}`;
}

/**
 * Analyze sessions for repo/cwd/prompt hygiene.
 */
export function analyzeContextHygiene({ repo, since, excludeIds } = {}) {
  const sessions = listSessions({ repo, since, excludeIds, limit: ANALYSIS_LIMIT });
  let noRepoCount = 0;
  let oversizedPromptCount = 0;
  let homeDirectoryCount = 0;

  for (const session of sessions) {
    if (hasNoRepoContext(session.repository)) noRepoCount++;
    if (isHomeDirectoryCwd(session.cwd)) homeDirectoryCount++;

    const firstTurn = getHumanTurns(getSessionTurns(session.id))[0];
    if (firstTurn && firstTurn.cleaned.length > 5000) {
      oversizedPromptCount++;
    }
  }

  const totalSessions = sessions.length;
  const issueRatio = totalSessions > 0
    ? (noRepoCount + oversizedPromptCount + homeDirectoryCount) / (totalSessions * 3)
    : 0;

  return {
    totalSessions,
    noRepoCount,
    noRepoPct: toPct(noRepoCount, totalSessions),
    oversizedPromptCount,
    oversizedPromptPct: toPct(oversizedPromptCount, totalSessions),
    homeDirectoryCount,
    homeDirectoryPct: toPct(homeDirectoryCount, totalSessions),
    score: Math.max(0, Math.round(100 * (1 - issueRatio))),
  };
}

/**
 * Analyze whether sessions look research-heavy or drift off-topic.
 */
export function analyzeToolSelection({ repo, since, excludeIds } = {}) {
  const sessions = listSessions({ repo, since, excludeIds, limit: ANALYSIS_LIMIT });
  const exploratorySessionIds = [];
  let tangentialTurnCount = 0;

  for (const session of sessions) {
    const humanTurns = getHumanTurns(getSessionTurns(session.id));
    if (humanTurns.length === 0) continue;

    const questionCount = humanTurns.filter((turn) => QUESTION_RE.test(turn.cleaned)).length;
    const isExploratory = humanTurns.length > 5 && (questionCount / humanTurns.length) > 0.5;
    if (isExploratory) {
      exploratorySessionIds.push(session.id);
      continue;
    }

    const baselineTokens = new Set([
      ...tokenize(humanTurns[0]?.cleaned || ""),
      ...tokenize(humanTurns[1]?.cleaned || ""),
    ]);
    if (baselineTokens.size < 2) continue;

    for (let i = 2; i < humanTurns.length; i++) {
      const turn = humanTurns[i];
      if (!QUESTION_RE.test(turn.cleaned)) continue;
      if (matchPatterns(turn.cleaned).length > 0) continue;

      const currentTokens = tokenize(turn.cleaned);
      if (currentTokens.size < 3) continue;

      const overlap = similarity(baselineTokens, currentTokens);
      const unseenTokens = [...currentTokens].filter((token) => !baselineTokens.has(token)).length;
      if (overlap < 0.12 && unseenTokens / currentTokens.size >= 0.8) {
        tangentialTurnCount++;
      }
    }
  }

  const suggestions = [];
  if (exploratorySessionIds.length > 0) {
    suggestions.push(`${exploratorySessionIds.length} sessions were research-heavy — try /research when most of the session is exploratory questioning.`);
  }
  if (tangentialTurnCount > 0) {
    suggestions.push(`${tangentialTurnCount} turns drifted away from the opening topic — split side questions into separate sessions.`);
  }

  return {
    exploratorySessionCount: exploratorySessionIds.length,
    exploratorySessionIds,
    tangentialTurnCount,
    suggestions,
  };
}

/**
 * Generate Chronicle-style coaching tips from aggregate session patterns.
 */
export function generateTips({ repo, since, excludeIds } = {}) {
  const sessions = listSessions({ repo, since, excludeIds, limit: ANALYSIS_LIMIT });
  if (sessions.length === 0) return [];

  const hygiene = analyzeContextHygiene({ repo, since, excludeIds });
  const tips = [];
  let totalTurns = 0;
  let totalClarities = 0;
  let analyzedClaritySessions = 0;
  let totalRedirectionTurns = 0;
  let totalUserTurns = 0;
  let sessionsWithCommits = 0;

  for (const session of sessions) {
    totalTurns += session.turn_count || 0;

    const turns = getSessionTurns(session.id);
    const refs = getSessionRefs(session.id);
    const humanTurns = getHumanTurns(turns);
    const firstTurn = humanTurns[0];

    if (firstTurn) {
      totalClarities += scoreClarity(firstTurn.cleaned).score;
      analyzedClaritySessions++;
    }

    const efficiency = analyzeEfficiency(turns, refs);
    if (efficiency) {
      totalRedirectionTurns += efficiency.redirectionTurns;
      totalUserTurns += efficiency.turnCount;
    } else {
      totalUserTurns += humanTurns.length;
    }

    if (refs.some((ref) => ref.ref_type === "commit")) {
      sessionsWithCommits++;
    }
  }

  const avgTurnCount = totalTurns / sessions.length;
  const avgClarity = analyzedClaritySessions > 0 ? Math.round(totalClarities / analyzedClaritySessions) : 0;
  const correctionRate = totalUserTurns > 0 ? Math.round((totalRedirectionTurns / totalUserTurns) * 100) : 0;
  const commitPct = toPct(sessionsWithCommits, sessions.length);

  if (hygiene.noRepoPct > 30) {
    const severity = hygiene.noRepoPct - 30;
    tips.push({
      id: "no-repo-context",
      title: "Launch Copilot from your repo directory, not ~",
      description: "Starting inside the project gives the agent immediate file-system and repo context.",
      pillar: "efficiency",
      impact: impactLabel(severity),
      evidence: `${hygiene.noRepoPct}% of sessions (${hygiene.noRepoCount}/${hygiene.totalSessions}) had no repo context.`,
      _severity: severity,
    });
  }

  if (hygiene.oversizedPromptPct > 20) {
    const severity = hygiene.oversizedPromptPct - 20;
    tips.push({
      id: "oversized-prompts",
      title: "Move system prompts to instruction files",
      description: "Keep the opening turn focused on the task and move reusable setup into instructions.",
      pillar: "efficiency",
      impact: impactLabel(severity),
      evidence: `${hygiene.oversizedPromptPct}% of sessions (${hygiene.oversizedPromptCount}/${hygiene.totalSessions}) opened with prompts over 5KB.`,
      _severity: severity,
    });
  }

  if (avgTurnCount > 15) {
    const severity = avgTurnCount - 15;
    tips.push({
      id: "too-many-turns",
      title: "Scope tasks to <15 turns",
      description: "Long sessions often mix planning, corrections, and unrelated follow-ups into one run.",
      pillar: "delegation",
      impact: impactLabel(severity),
      evidence: `Average session length was ${avgTurnCount.toFixed(1)} turns.`,
      _severity: severity,
    });
  }

  if (correctionRate > 30) {
    const severity = correctionRate - 30;
    tips.push({
      id: "high-correction-rate",
      title: "Review agent output before continuing",
      description: "Frequent mid-session corrections usually mean issues are being caught later than they need to be.",
      pillar: "judgment",
      impact: impactLabel(severity),
      evidence: `${correctionRate}% of user turns were corrections or redirects.`,
      _severity: severity,
    });
  }

  if (avgClarity < 50) {
    const severity = 50 - avgClarity;
    tips.push({
      id: "short-opening-prompts",
      title: "Write richer opening prompts",
      description: "Front-load the files, constraints, and success criteria so the agent starts with the full spec.",
      pillar: "specification",
      impact: impactLabel(severity),
      evidence: `Average first-turn clarity score was ${avgClarity}/100.`,
      _severity: severity,
    });
  }

  if (commitPct < 20) {
    const severity = 20 - commitPct;
    tips.push({
      id: "no-commits",
      title: "Aim for committed outcomes",
      description: "Try to end more sessions with a commit-sized result instead of a loose stopping point.",
      pillar: "efficiency",
      impact: impactLabel(severity),
      evidence: `Only ${commitPct}% of sessions ended with a commit reference.`,
      _severity: severity,
    });
  }

  return tips
    .sort((a, b) => b._severity - a._severity)
    .slice(0, 5)
    .map(({ _severity, ...tip }) => tip);
}

/**
 * Generate per-session improvement coaching in the style of /chronicle improve.
 */
export function generateImprove(sessionId) {
  const session = findSession(sessionId);
  if (!session) return null;

  const turns = getSessionTurns(sessionId);
  const files = getSessionFiles(sessionId);
  const refs = getSessionRefs(sessionId);
  const humanTurns = getHumanTurns(turns);
  const suggestions = [];

  if (humanTurns.length === 0) {
    return {
      sessionId,
      suggestions,
      overallAdvice: "This session has no user-authored turns to analyze.",
    };
  }

  const firstTurn = humanTurns[0];
  const clarity = scoreClarity(firstTurn.cleaned);
  const corrections = humanTurns.filter((turn) => matchPatterns(turn.cleaned).length > 0);
  const efficiency = analyzeEfficiency(turns, refs);
  const lateCatch = humanTurns.find((turn, index) => index >= 2 && LATE_CATCH_RE.test(turn.cleaned));
  const hasCommit = refs.some((ref) => ref.ref_type === "commit" || ref.ref_type === "pr");

  if (clarity.score < 50) {
    suggestions.push({
      pillar: "specification",
      issue: "Vague opening prompt",
      whatHappened: `You opened with "${firstTurn.cleaned.substring(0, 120)}" (clarity ${clarity.score}/100), which left key details implicit.`,
      whatWouldBeBetter: `Start with a fuller brief, for example: "${buildPromptRewrite(session, humanTurns, files)}"`,
    });
  }

  if (corrections.length >= 2) {
    suggestions.push({
      pillar: "judgment",
      issue: "Multiple corrections",
      whatHappened: `There were ${corrections.length} correction turns; the first was "${corrections[0].cleaned.substring(0, 120)}".`,
      whatWouldBeBetter: "Turn that first correction into an upfront constraint so the agent starts with the right approach instead of being steered back later.",
    });
  }

  if (efficiency?.dripFeeding.count > 0) {
    suggestions.push({
      pillar: "efficiency",
      issue: "Drip-feeding context",
      whatHappened: `You added missing context ${efficiency.dripFeeding.count} times after the start, beginning with "${efficiency.dripFeeding.instances[0].message}".`,
      whatWouldBeBetter: "Front-load those requirements in the first prompt so the agent can plan once and execute once.",
    });
  }

  if (lateCatch) {
    suggestions.push({
      pillar: "judgment",
      issue: "Late catch",
      whatHappened: `A late correction showed up after the work was already underway: "${lateCatch.cleaned.substring(0, 120)}".`,
      whatWouldBeBetter: "Pause earlier to review the first implementation pass before stacking more work on top of it.",
    });
  }

  if (!hasCommit && humanTurns.length > 15) {
    suggestions.push({
      pillar: "delegation",
      issue: "Long session without a commit",
      whatHappened: `This session ran for ${humanTurns.length} user turns and never reached a commit-sized outcome.`,
      whatWouldBeBetter: "Break work like this into smaller, self-contained tasks that each end with a commit, PR, or explicit checkpoint.",
    });
  }

  const overallAdvice = suggestions.length === 0
    ? "This session was already fairly well-scoped. Keep front-loading context and reviewing early outputs."
    : "Front-load more detail, catch mistakes earlier, and split long tasks into smaller committed sessions.";

  return {
    sessionId,
    suggestions,
    overallAdvice,
  };
}
