// Delegation analysis — measures how much work the user delegates to the agent
// vs. how much they guide step-by-step. Tracks autonomy, productivity, and
// delegation style across sessions.

import { listSessions, getSessionTurns, getSessionFiles, getSessionRefs } from "./db.mjs";
import { matchPatterns } from "./patterns.mjs";

/**
 * Classify a user message by delegation style.
 */
export function classifyMessage(msg) {
  if (!msg) return null;

  const cleaned = msg
    .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .trim();
  if (cleaned.length < 3) return null;

  const lower = cleaned.toLowerCase();
  const len = cleaned.length;

  // Approval / green-light (very short, affirmative)
  if (len < 60 && /^(yes|yep|yeah|sure|ok|okay|go|do it|lgtm|looks good|perfect|awesome|great|nice|love it|ship it|approved|👍)\b/i.test(lower)) {
    return "approval";
  }

  // High-level delegation (gives goal, lets agent decide approach)
  if (/\b(build|create|implement|add|make|set up|write|generate|design|refactor)\b/i.test(lower) &&
      len < 500 && !(/\b(step\s*\d|first|then|after\s+that|next)\b/i.test(lower))) {
    return "delegation";
  }

  // Micro-management (step-by-step instructions, very detailed)
  if (/\b(step\s*\d|first.*then|1\.\s|2\.\s|3\.\s)\b/i.test(lower) ||
      (len > 500 && /\b(make sure|don't forget|be careful|specifically)\b/i.test(lower))) {
    return "guided";
  }

  // Correction / redirection (agent got it wrong, user steering back)
  const redirections = matchPatterns(cleaned);
  if (redirections.length > 0) {
    return "correction";
  }

  // Question (user asking for info rather than delegating work)
  if (/^(what|how|why|where|when|can|could|should|is|are|do|does|did|will|would)\b/i.test(lower) && len < 200) {
    return "question";
  }

  // Collaborative (medium-length, conversational)
  if (len < 300) return "collaborative";

  // Detailed spec (long, structured prompt)
  return "detailed_spec";
}

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
 * Analyze delegation patterns for a single session.
 */
function analyzeSessionDelegation(session, turns, files, refs) {
  const msgTypes = { approval: 0, delegation: 0, guided: 0, correction: 0, question: 0, collaborative: 0, detailed_spec: 0 };
  const exampleTurns = { guided: [], collaborative: [], delegation: [] };
  let totalUserChars = 0;
  let totalAgentChars = 0;

  for (const t of turns) {
    const type = classifyMessage(t.user_message);
    if (type) msgTypes[type]++;
    // Count only user-typed content, not system-injected XML
    const cleaned = cleanUserMessage(t.user_message);
    if (cleaned.length > 0) {
      totalUserChars += cleaned.length;
      if (exampleTurns[type] && exampleTurns[type].length < 2) {
        exampleTurns[type].push(cleaned);
      }
    }
    if (t.assistant_response) totalAgentChars += t.assistant_response.length;
  }

  // Only count turns with actual user-typed content
  const userTurns = turns.filter((t) => cleanUserMessage(t.user_message).length > 0).length;
  const filesCreated = files.filter((f) => f.tool_name === "create").length;
  const filesEdited = files.filter((f) => f.tool_name === "edit").length;
  const totalFileOps = filesCreated + filesEdited;
  const hasCommit = refs.some((r) => r.ref_type === "commit");
  const hasPR = refs.some((r) => r.ref_type === "pr");

  // Delegation ratio: high-autonomy turns / total turns
  const autonomyTurns = msgTypes.approval + msgTypes.delegation + msgTypes.detailed_spec;
  const guidedTurns = msgTypes.guided + msgTypes.correction;
  const delegationRatio = userTurns > 0 ? autonomyTurns / userTurns : 0;

  // Agent leverage: how much output per user input character
  const agentLeverage = totalUserChars > 0 ? totalAgentChars / totalUserChars : 0;

  // Productivity: file operations per user turn
  const productivity = userTurns > 0 ? totalFileOps / userTurns : 0;

  // Delegation style
  let style = "collaborative";
  if (delegationRatio > 0.6) style = "delegator";
  else if (guidedTurns > autonomyTurns) style = "hands-on";
  else if (msgTypes.correction > userTurns * 0.3) style = "corrective";
  else if (msgTypes.question > userTurns * 0.4) style = "exploratory";

  return {
    sessionId: session.id,
    repo: session.repository || "(no repo)",
    branch: session.branch,
    summary: session.summary,
    turnCount: userTurns,
    msgTypes,
    delegationRatio: Math.round(delegationRatio * 100),
    agentLeverage: Math.round(agentLeverage * 10) / 10,
    productivity: Math.round(productivity * 10) / 10,
    filesCreated,
    filesEdited,
    totalFileOps,
    totalUserChars,
    totalAgentChars,
    hasCommit,
    hasPR,
    style,
    exampleTurns,
  };
}

/**
 * Analyze delegation patterns across all sessions.
 */
export function analyzeDelegation({ repo, since, excludeIds } = {}) {
  const sessions = listSessions({ repo, since, excludeIds });
  const sessionResults = [];
  const styleCounts = {};
  const examples = { guided: [], collaborative: [], delegation: [] };
  let totalUserChars = 0;
  let totalAgentChars = 0;
  let totalFileOps = 0;
  let totalApprovals = 0;
  let totalDelegations = 0;
  let totalGuided = 0;
  let totalCorrections = 0;
  let totalQuestions = 0;
  let totalCollaborative = 0;
  let totalDetailedSpecs = 0;
  let totalUserTurns = 0;
  let sessionsWithFiles = 0;
  let sessionsWithCommits = 0;
  let sessionsWithPRs = 0;

  for (const s of sessions) {
    if (s.turn_count < 2) continue;
    const turns = getSessionTurns(s.id);
    const files = getSessionFiles(s.id);
    const refs = getSessionRefs(s.id);

    const result = analyzeSessionDelegation(s, turns, files, refs);
    sessionResults.push(result);

    styleCounts[result.style] = (styleCounts[result.style] || 0) + 1;
    for (const type of Object.keys(examples)) {
      for (const example of result.exampleTurns[type] || []) {
        if (examples[type].length < 4 && !examples[type].includes(example)) {
          examples[type].push(example);
        }
      }
    }
    totalUserChars += result.totalUserChars;
    totalAgentChars += result.totalAgentChars;
    totalFileOps += result.totalFileOps;
    totalApprovals += result.msgTypes.approval;
    totalDelegations += result.msgTypes.delegation;
    totalGuided += result.msgTypes.guided;
    totalCorrections += result.msgTypes.correction;
    totalQuestions += result.msgTypes.question;
    totalCollaborative += result.msgTypes.collaborative;
    totalDetailedSpecs += result.msgTypes.detailed_spec;
    totalUserTurns += result.turnCount;
    if (result.totalFileOps > 0) sessionsWithFiles++;
    if (result.hasCommit) sessionsWithCommits++;
    if (result.hasPR) sessionsWithPRs++;
  }

  // Overall delegation ratio
  const overallDelegationRatio = totalUserTurns > 0
    ? Math.round(((totalApprovals + totalDelegations + totalDetailedSpecs) / totalUserTurns) * 100)
    : 0;

  // Agent leverage (output/input ratio)
  const overallLeverage = totalUserChars > 0
    ? Math.round((totalAgentChars / totalUserChars) * 10) / 10
    : 0;

  // Turn type breakdown for chart
  const turnTypeBreakdown = [
    { type: "Delegation", count: totalDelegations, color: "#3fb950", description: "High-level task assignment" },
    { type: "Approval", count: totalApprovals, color: "#58a6ff", description: "Accepting agent's work" },
    { type: "Detailed Spec", count: totalDetailedSpecs, color: "#bc8cff", description: "Rich specs with constraints" },
    { type: "Collaborative", count: totalCollaborative, color: "#d29922", description: "Back-and-forth discussion" },
    { type: "Question", count: totalQuestions, color: "#8b949e", description: "Asking for information" },
    { type: "Guided", count: totalGuided, color: "#db6d28", description: "Step-by-step instructions" },
    { type: "Correction", count: totalCorrections, color: "#f85149", description: "Fixing agent mistakes" },
  ].filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);

  // Style distribution for chart
  const styleDistribution = Object.entries(styleCounts)
    .map(([style, count]) => ({ style, count }))
    .sort((a, b) => b.count - a.count);

  // Top delegated sessions (most files created with least turns)
  const topDelegated = [...sessionResults]
    .filter((s) => s.totalFileOps > 0)
    .sort((a, b) => b.productivity - a.productivity)
    .slice(0, 10);

  // Agent output volume
  const agentOutputKB = Math.round(totalAgentChars / 1024);
  const userInputKB = Math.round(totalUserChars / 1024);

  return {
    overallDelegationRatio,
    overallLeverage,
    totalUserTurns,
    totalFileOps,
    sessionsAnalyzed: sessionResults.length,
    sessionsWithFiles,
    sessionsWithCommits,
    sessionsWithPRs,
    agentOutputKB,
    userInputKB,
    turnTypeBreakdown,
    styleDistribution,
    topDelegated,
    styleCounts,
    examples,
  };
}
