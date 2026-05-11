// Judgment analysis — measures how well the user evaluates agent output.
// Good judgment = catching issues early, not approving bad work, knowing
// when to stop and redirect vs. when to let the agent run.

import { listSessions, getSessionTurns, getSessionFiles } from "./db.mjs";
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
 * Detect if a message is an approval/acceptance of agent work.
 */
function isApproval(msg) {
  if (!msg) return false;
  const cleaned = cleanUserMessage(msg);
  if (cleaned.length === 0 || cleaned.length > 200) return false;
  const lower = cleaned.toLowerCase();
  return /^(yes|yep|yeah|sure|ok|okay|go|do it|lgtm|looks good|perfect|awesome|great|nice|love it|ship it|approved|sounds good|that works|👍)\b/i.test(lower);
}

/**
 * Detect if a message indicates the user caught a problem.
 */
function isCatch(msg) {
  if (!msg) return false;
  const cleaned = msg
    .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .trim();
  const lower = cleaned.toLowerCase();

  // User spotted an issue before it became a bigger problem
  return (
    /\b(wait|hold on|actually|hmm|that('s| is) (wrong|not right|incorrect|broken|off))\b/i.test(lower) ||
    /\b(this (won't|doesn't|isn't)|that (won't|doesn't|isn't))\s+(work|right|correct)/i.test(lower) ||
    /\b(bug|issue|problem|error|mistake|typo|missing|forgot|broke)\b/i.test(lower) ||
    /\b(you (missed|forgot|skipped|dropped|left out|overlooked))\b/i.test(lower) ||
    /\b(what about|don't forget|you need to also|also need)\b/i.test(lower)
  );
}

/**
 * Detect late catches — corrections that come many turns after the mistake.
 * A late catch means the user didn't review carefully enough earlier.
 */
function isLateCatch(msg) {
  if (!msg) return false;
  const cleaned = msg
    .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .trim()
    .toLowerCase();
  return (
    /\b(go back|earlier|before|undo|revert|rollback|we need to redo)\b/i.test(cleaned) ||
    /\b(should have|shouldn't have|wish (i|we) had)\b/i.test(cleaned) ||
    /\b(all (along|this time)|from the (start|beginning))\b/i.test(cleaned)
  );
}

/**
 * Analyze judgment quality for a single session.
 */
function analyzeSessionJudgment(session, turns, files) {
  let approvals = 0;
  let catches = 0;
  let lateCatches = 0;
  let approvalsBeforeCorrection = 0;
  const catchTurns = [];
  const examples = { approvals: [], catches: [], lateCatches: [] };
  let approvalStreak = 0;
  let maxApprovalStreak = 0;
  let turnsToFirstCatch = null;

  // File thrashing: same file edited many times = missed something
  const fileEditCounts = {};
  for (const f of files) {
    if (f.tool_name === "edit") {
      fileEditCounts[f.file_path] = (fileEditCounts[f.file_path] || 0) + 1;
    }
  }
  const thrashedFiles = Object.entries(fileEditCounts)
    .filter(([, count]) => count >= 3)
    .map(([path, count]) => ({ path, editCount: count }))
    .sort((a, b) => b.editCount - a.editCount);

  let lastWasApproval = false;
  for (let i = 0; i < turns.length; i++) {
    const msg = turns[i].user_message;
    if (!msg) continue;

    // Clean system XML so we only analyze user-typed content
    const cleaned = cleanUserMessage(msg);
    if (cleaned.length === 0) continue;

    const isAppr = isApproval(cleaned);
    const isCat = isCatch(cleaned);
    const isLate = isLateCatch(cleaned);
    const redirections = matchPatterns(cleaned);
    const isRedirect = redirections.length > 0;

    if (isAppr) {
      approvals++;
      if (examples.approvals.length < 2) examples.approvals.push(cleaned);
      approvalStreak++;
      maxApprovalStreak = Math.max(maxApprovalStreak, approvalStreak);
      lastWasApproval = true;
    } else {
      approvalStreak = 0;
    }

    if (isCat || isRedirect) {
      catches++;
      if (examples.catches.length < 2) examples.catches.push(cleaned);
      catchTurns.push(i);
      if (turnsToFirstCatch === null) turnsToFirstCatch = i;

      // Did user approve just before catching a problem?
      if (lastWasApproval) {
        approvalsBeforeCorrection++;
      }
    }

    if (isLate) {
      lateCatches++;
      if (examples.lateCatches.length < 2) examples.lateCatches.push(cleaned);
    }

    if (!isAppr) lastWasApproval = false;
  }

  // Only count turns with actual user-typed content
  const userTurns = turns.filter((t) => cleanUserMessage(t.user_message).length > 0).length;

  // Judgment score components:
  // - Early catch rate (catching issues quickly = good)
  // - Low approval-before-correction rate (not rubber-stamping = good)
  // - Low file thrashing (getting it right first time = good review)
  // - Low late catches (reviewing carefully = good)
  const _catchRate = userTurns > 0 ? catches / userTurns : 0;
  const rubberStampRate = approvals > 0 ? approvalsBeforeCorrection / approvals : 0;
  const thrashScore = thrashedFiles.length;

  // Score 0-100: higher = better judgment
  let score = 70; // baseline
  if (catches > 0 && turnsToFirstCatch <= 2) score += 10; // early detection
  if (catches > 0 && turnsToFirstCatch > 5) score -= 10; // slow detection
  if (rubberStampRate > 0.3) score -= 15; // approving bad work
  if (rubberStampRate === 0 && approvals > 0) score += 10; // careful review
  if (lateCatches > 0) score -= 10 * lateCatches; // late catches are costly
  if (thrashScore > 2) score -= 5 * (thrashScore - 2); // file thrashing
  if (maxApprovalStreak > 5) score -= 5; // long rubber-stamp streaks
  score = Math.max(0, Math.min(100, score));

  return {
    sessionId: session.id,
    repo: session.repository || "(no repo)",
    summary: session.summary,
    turnCount: userTurns,
    approvals,
    catches,
    lateCatches,
    approvalsBeforeCorrection,
    maxApprovalStreak,
    turnsToFirstCatch,
    thrashedFiles: thrashedFiles.slice(0, 5),
    thrashCount: thrashedFiles.length,
    rubberStampRate: Math.round(rubberStampRate * 100),
    score,
    examples,
  };
}

/**
 * Analyze judgment quality across all sessions.
 */
export function analyzeJudgment({ repo, since, excludeIds } = {}) {
  const sessions = listSessions({ repo, since, excludeIds });

  const sessionResults = [];
  const examples = { approvals: [], catches: [], lateCatches: [] };
  let totalApprovals = 0;
  let totalCatches = 0;
  let totalLateCatches = 0;
  let totalApprovalsBeforeCorrection = 0;
  let totalThrashedFiles = 0;
  let scoreSum = 0;

  for (const s of sessions) {
    if (s.turn_count < 3) continue;
    const turns = getSessionTurns(s.id);
    const files = getSessionFiles(s.id);

    const result = analyzeSessionJudgment(s, turns, files);
    sessionResults.push(result);

    for (const type of Object.keys(examples)) {
      for (const example of result.examples[type] || []) {
        if (examples[type].length < 4 && !examples[type].includes(example)) {
          examples[type].push(example);
        }
      }
    }
    totalApprovals += result.approvals;
    totalCatches += result.catches;
    totalLateCatches += result.lateCatches;
    totalApprovalsBeforeCorrection += result.approvalsBeforeCorrection;
    totalThrashedFiles += result.thrashCount;
    scoreSum += result.score;
  }

  const avgScore = sessionResults.length > 0
    ? Math.round(scoreSum / sessionResults.length)
    : 0;

  const rubberStampRate = totalApprovals > 0
    ? Math.round((totalApprovalsBeforeCorrection / totalApprovals) * 100)
    : 0;

  // Score distribution buckets
  const scoreBuckets = [
    { label: "Excellent (80-100)", min: 80, max: 100, count: 0, color: "#3fb950" },
    { label: "Good (60-79)", min: 60, max: 79, count: 0, color: "#58a6ff" },
    { label: "Needs Work (40-59)", min: 40, max: 59, count: 0, color: "#d29922" },
    { label: "Poor (0-39)", min: 0, max: 39, count: 0, color: "#f85149" },
  ];
  for (const r of sessionResults) {
    const bucket = scoreBuckets.find((b) => r.score >= b.min && r.score <= b.max);
    if (bucket) bucket.count++;
  }

  // Sessions sorted by worst judgment
  const worstJudgment = [...sessionResults]
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);

  // Most thrashed files across all sessions
  const allThrashed = sessionResults
    .flatMap((r) => r.thrashedFiles.map((f) => ({ ...f, repo: r.repo, sessionId: r.sessionId })))
    .sort((a, b) => b.editCount - a.editCount)
    .slice(0, 10);

  // Suggestions
  const suggestions = [];

  if (rubberStampRate > 20) {
    suggestions.push({
      priority: "high",
      emoji: "🔍",
      title: "Review Before Approving",
      body: `${rubberStampRate}% of your approvals were followed by corrections — you're rubber-stamping agent work without checking it. Take a moment to review changes before saying "looks good".\n\n💡 Example: Instead of immediately saying "looks good" after the agent generates 200 lines, try "Let me check the error handling — does the catch block in processOrder() log the error before rethrowing?"`,
    });
  }

  if (totalLateCatches > 3) {
    suggestions.push({
      priority: "high",
      emoji: "⏰",
      title: "Catch Issues Earlier",
      body: `${totalLateCatches} late catches detected (going back to fix earlier mistakes). Review each step as it happens rather than building on top of unchecked work.\n\n💡 Example: Instead of letting the agent build 5 components then realizing the data model is wrong, try reviewing after step 1: "Before you continue — does this schema handle the case where a user has multiple roles?"`,
    });
  }

  if (totalThrashedFiles > 5) {
    suggestions.push({
      priority: "medium",
      emoji: "📝",
      title: "Get It Right First Time",
      body: `${totalThrashedFiles} files were edited 3+ times in single sessions. Give clearer requirements upfront so the agent doesn't have to keep revising the same file.\n\n💡 Example: Instead of "Add a user table" → "Actually add an email column" → "Make email unique" → "Add created_at too", try "Create a users table with: id (uuid, pk), email (unique, not null), name, created_at (default now)."`,
    });
  }

  const streakSessions = sessionResults.filter((r) => r.maxApprovalStreak >= 5);
  if (streakSessions.length > 0) {
    suggestions.push({
      priority: "medium",
      emoji: "🤖",
      title: "Don't Auto-Pilot",
      body: `${streakSessions.length} sessions had 5+ consecutive approvals without review. Long approval streaks suggest you're trusting the agent blindly — spot-check intermediate results.\n\n💡 Example: After 3 approvals in a row, pause and ask: "Show me the test coverage for the changes so far" or "Run the existing tests to make sure nothing broke."`,
    });
  }

  if (avgScore >= 75 && sessionResults.length > 3) {
    suggestions.push({
      priority: "info",
      emoji: "✅",
      title: "Strong Judgment",
      body: `Average judgment score of ${avgScore}/100. You're catching issues early and reviewing agent output carefully.`,
    });
  }

  return {
    avgScore,
    sessionsAnalyzed: sessionResults.length,
    totalApprovals,
    totalCatches,
    totalLateCatches,
    totalApprovalsBeforeCorrection,
    rubberStampRate,
    totalThrashedFiles,
    scoreBuckets,
    worstJudgment,
    allThrashed,
    suggestions,
    examples,
  };
}
