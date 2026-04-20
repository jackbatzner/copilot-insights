// Weekly pillar-score trend computation.
// All metrics reflect USER behavior only — things the user typed/decided.

import { listSessions, getSessionTurns } from "./db.mjs";

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
  // ISO week: Monday-based, week 1 contains Jan 4
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayOfWeek = tmp.getUTCDay() || 7; // Mon=1 … Sun=7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayOfWeek); // nearest Thursday
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

const HIGH_LEVEL_VERB_RE = /\b(build|create|implement|add|make|write)\b/i;
const STEP_BY_STEP_RE = /\b(step\s+1|first[,.]|then[,.]|after\s+that)\b/i;
const CATCH_RE =
  /\b(wait|hold\s+on|actually|that'?s\s+wrong|not\s+right|broken|fix|bug|issue|error)\b/i;
const SPECIFIC_RE = /(\b\w+\.\w{1,5}\b|function\s+\w|\/[\w/]+\.\w+|line\s+\d)/i;

function scoreDelegation(userMessages) {
  if (userMessages.length === 0) return 0;
  const highLevel = userMessages.filter(
    (m) =>
      HIGH_LEVEL_VERB_RE.test(m) && m.length < 500 && !STEP_BY_STEP_RE.test(m)
  ).length;
  return (highLevel / userMessages.length) * 100;
}

function scoreJudgment(userMessages) {
  if (userMessages.length === 0) return 0;
  const catches = userMessages.filter((m) => CATCH_RE.test(m)).length;
  return Math.min((catches / userMessages.length) * 200, 100);
}

function scoreFeedback(firstMessage) {
  if (!firstMessage) return 0;
  const long = firstMessage.length > 50;
  const specific = SPECIFIC_RE.test(firstMessage);
  return long && specific ? 100 : long || specific ? 50 : 0;
}

/**
 * Compute weekly pillar score snapshots.
 * @param {{ repo?: string, since?: string }} opts
 */
export function computePillarTrends({ repo, since, excludeIds } = {}) {
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
    let feedbackSum = 0;
    const sessionCount = entry.sessions.length;

    for (const session of entry.sessions) {
      const turns = getSessionTurns(session.id);
      const userMessages = turns
        .map((t) => stripTags(t.user_message))
        .filter((m) => m.length > 0);

      delegationSum += scoreDelegation(userMessages);
      judgmentSum += scoreJudgment(userMessages);
      feedbackSum += scoreFeedback(userMessages[0]);
    }

    const delegation = sessionCount
      ? Math.round(delegationSum / sessionCount)
      : 0;
    const judgment = sessionCount
      ? Math.round(judgmentSum / sessionCount)
      : 0;
    const feedback = sessionCount
      ? Math.round(feedbackSum / sessionCount)
      : 0;
    const overall = Math.round((delegation + judgment + feedback) / 3);

    weeks.push({
      week: entry.week,
      startDate: entry.startDate,
      endDate: entry.endDate,
      delegation,
      judgment,
      feedback,
      overall,
      sessionCount,
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
      feedback: determineTrend("feedback"),
    },
  };
}
