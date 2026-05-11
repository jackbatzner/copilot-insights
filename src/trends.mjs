// Weekly pillar-score trend computation.
// Uses the SAME analysis primitives as dev-plan.mjs so Coaching and Learn
// tabs always show consistent scores.

import { listSessions, getSessionTurns, getSessionFiles, getSessionRefs } from "./db.mjs";
import { classifyMessage } from "./delegation.mjs";
import { scoreClarity } from "./clarity.mjs";
import { analyzeEfficiency } from "./efficiency.mjs";
import { INTENT_WEIGHT_PROFILES } from "./dev-plan.mjs";

/** Strip XML/HTML system tags from a message before analysis. */
function stripTags(msg) {
  if (!msg) return "";
  return msg
    .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .trim();
}

/** Return ISO week string "YYYY-Www" and start/end dates for a given date. */
function isoWeekInfo(dateStr) {
  const d = new Date(dateStr);
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayOfWeek = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);

  const monday = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  monday.setUTCDate(monday.getUTCDate() - (dayOfWeek - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);

  const pad = (n) => String(n).padStart(2, "0");
  return {
    week: `${tmp.getUTCFullYear()}-W${pad(weekNo)}`,
    startDate: monday.toISOString().slice(0, 10),
    endDate: sunday.toISOString().slice(0, 10),
  };
}

// --- Per-session scoring (mirrors dev-plan.mjs formulas) ---

const APPROVAL_RE = /^(ok|sure|yes|go\s+ahead|lgtm|looks\s+good|proceed|👍|✅|do\s+it|ship\s+it|sounds\s+good|perfect|great|nice|awesome|exactly)/i;
const CATCH_RE = /\b(wait|hold\s+on|actually|that'?s\s+wrong|not\s+right|broken|fix|bug|issue|error|revert|undo|no[, ]|wrong|incorrect|stop|don't|shouldn't|remove\s+that)/i;

function scoreSessionDelegation(turns) {
  const msgTypes = { approval: 0, delegation: 0, guided: 0, correction: 0, question: 0, collaborative: 0, detailed_spec: 0 };
  let totalUserChars = 0;
  let totalAgentChars = 0;
  let userTurns = 0;

  for (const t of turns) {
    const cleaned = stripTags(t.user_message);
    if (cleaned.length === 0) continue;
    userTurns++;
    const type = classifyMessage(t.user_message);
    if (type && msgTypes[type] !== undefined) msgTypes[type]++;
    totalUserChars += cleaned.length;
    if (t.assistant_response) totalAgentChars += t.assistant_response.length;
  }

  const autonomyTurns = msgTypes.approval + msgTypes.delegation + msgTypes.detailed_spec;
  const delegationRatio = userTurns > 0 ? (autonomyTurns / userTurns) * 100 : 0;
  const agentLeverage = totalUserChars > 0 ? totalAgentChars / totalUserChars : 0;
  return { delegationRatio, agentLeverage };
}

function scoreSessionJudgment(turns) {
  let score = 70;
  let approvals = 0;
  let catches = 0;
  let lateCatches = 0;
  let approvalsBeforeCorrection = 0;
  let consecutiveApprovals = 0;
  let maxApprovalStreak = 0;
  let turnsToFirstCatch = -1;
  let turnIdx = 0;

  for (const t of turns) {
    const msg = stripTags(t.user_message);
    if (msg.length === 0) continue;
    turnIdx++;
    const isApproval = APPROVAL_RE.test(msg) && msg.length < 100;
    const isCatch = CATCH_RE.test(msg);

    if (isApproval) {
      approvals++;
      consecutiveApprovals++;
      maxApprovalStreak = Math.max(maxApprovalStreak, consecutiveApprovals);
    } else {
      if (isCatch && consecutiveApprovals > 0) approvalsBeforeCorrection += consecutiveApprovals;
      consecutiveApprovals = 0;
    }
    if (isCatch) {
      catches++;
      if (turnsToFirstCatch === -1) turnsToFirstCatch = turnIdx;
      if (turnIdx > 5) lateCatches++;
    }
  }

  if (catches > 0 && turnsToFirstCatch <= 2) score += 10;
  if (catches > 0 && turnsToFirstCatch > 5) score -= 10;
  const rubberStampRate = approvals > 0 ? approvalsBeforeCorrection / approvals : 0;
  if (rubberStampRate > 0.3) score -= 15;
  if (rubberStampRate === 0 && approvals > 0) score += 10;
  if (lateCatches > 0) score -= 10 * lateCatches;
  if (maxApprovalStreak > 5) score -= 5;
  return Math.max(0, Math.min(100, score));
}

function scoreSessionSpecification(turns, effResult) {
  const firstMsg = stripTags(turns[0]?.user_message);
  const clarity = scoreClarity(firstMsg);
  const avgEfficiency = (effResult?.efficiencyRatio ?? 0) * 100;
  const dripFeeds = effResult?.dripFeeding?.count ?? 0;
  return Math.round(
    (clarity.score * 0.5) +
    (avgEfficiency * 0.3) +
    (Math.max(0, 100 - dripFeeds * 5) * 0.2)
  );
}

function scoreSessionEfficiency(session, effResult, refs) {
  const productiveTurnRatio = (effResult?.efficiencyRatio ?? 0) * 100;
  const hasCommit = refs.some((r) => r.ref_type === "commit");
  const hasPR = refs.some((r) => r.ref_type === "pr");
  const completionRate = (hasCommit || hasPR) ? 100 : 0;

  let contextHygiene = 100;
  const repository = (session.repository || "").trim();
  if (!repository || repository === "(no repo)") contextHygiene -= 20;
  const firstMsg = stripTags(effResult?._firstMessage || "");
  if (firstMsg.length > 5000) contextHygiene -= 15;

  return Math.min(100, Math.max(0, Math.round(
    (productiveTurnRatio * 0.4) +
    (completionRate * 0.3) +
    (contextHygiene * 0.3)
  )));
}

/**
 * Compute weekly pillar score snapshots using the same formulas as dev-plan.mjs.
 * @param {{ repo?: string, since?: string, excludeIds?: Set<string>, sessionIntents?: Record<string, string> }} opts
 */
export function computePillarTrends({ repo, since, excludeIds, sessionIntents } = {}) {
  const sessions = listSessions({ repo, since, excludeIds, limit: 10000 });

  // Group sessions by ISO week
  const weekMap = new Map();
  for (const session of sessions) {
    const info = isoWeekInfo(session.created_at);
    if (!weekMap.has(info.week)) {
      weekMap.set(info.week, {
        week: info.week,
        startDate: info.startDate,
        endDate: info.endDate,
        sessions: [],
      });
    }
    weekMap.get(info.week).sessions.push(session);
  }

  const weeks = [];
  for (const [, entry] of [...weekMap.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    let delegationSum = 0;
    let judgmentSum = 0;
    let specificationSum = 0;
    let efficiencySum = 0;
    let scored = 0;
    const clampWeightedScore = (score) => Math.max(0, Math.min(100, Math.round(score)));

    for (const session of entry.sessions) {
      if (session.turn_count < 2) continue;
      const turns = getSessionTurns(session.id);
      if (turns.length === 0) continue;
      scored++;

      const refs = getSessionRefs(session.id);
      const files = getSessionFiles(session.id);

      // Delegation — same formula as dev-plan.mjs
      const del = scoreSessionDelegation(turns);
      const hasFileOps = files.length > 0;
      const delScore = Math.min(100, Math.round(
        (del.delegationRatio * 0.4) +
        (Math.min(del.agentLeverage, 3) / 3 * 30) +
        (hasFileOps ? 30 : 0)
      ));
      const judgmentScore = scoreSessionJudgment(turns);
      const effResult = analyzeEfficiency(turns, refs) || {};
      effResult._firstMessage = turns[0]?.user_message || "";
      const efficiencyScore = scoreSessionEfficiency(session, effResult, refs);
      const specificationScore = scoreSessionSpecification(turns, effResult);
      const intent = sessionIntents?.[session.id];
      const weights = intent ? INTENT_WEIGHT_PROFILES[intent] : null;

      delegationSum += weights ? clampWeightedScore(delScore * weights.delegation) : delScore;
      judgmentSum += weights ? clampWeightedScore(judgmentScore * weights.judgment) : judgmentScore;
      efficiencySum += weights ? clampWeightedScore(efficiencyScore * weights.efficiency) : efficiencyScore;
      specificationSum += weights ? clampWeightedScore(specificationScore * weights.specification) : specificationScore;
    }

    const delegation = scored ? Math.round(delegationSum / scored) : 0;
    const judgment = scored ? Math.round(judgmentSum / scored) : 0;
    const specification = scored ? Math.round(specificationSum / scored) : 0;
    const efficiency = scored ? Math.round(efficiencySum / scored) : 0;
    const overall = Math.round((delegation + judgment + specification + efficiency) / 4);

    weeks.push({
      week: entry.week,
      startDate: entry.startDate,
      endDate: entry.endDate,
      delegation,
      judgment,
      specification,
      efficiency,
      overall,
      sessionCount: entry.sessions.length,
      scoredSessionCount: scored,
    });
  }

  // Determine trends by comparing last two weeks
  function determineTrend(pillar) {
    if (weeks.length < 2) return "stable";
    const latest = weeks[weeks.length - 1][pillar];
    const previous = weeks[weeks.length - 2][pillar];
    if (latest - previous >= 5) return "improving";
    if (previous - latest >= 5) return "declining";
    return "stable";
  }

  return {
    weeks,
    trend: {
      delegation: determineTrend("delegation"),
      judgment: determineTrend("judgment"),
      specification: determineTrend("specification"),
      efficiency: determineTrend("efficiency"),
    },
  };
}
