// Instruction failure analysis — detects when agent ignores or misapplies
// rules that are already established (in instruction files, or stated earlier
// in the same session). This is the complement to instruction *gaps*:
// gaps = missing rules; failures = rules that don't stick.

import { listSessions, getSessionTurns } from "./db.mjs";

/**
 * Patterns indicating the user is RE-STATING something the agent should
 * already know — either from an instruction file or from earlier in the session.
 */
const FAILURE_SIGNAL_PATTERNS = [
  // Explicit "you forgot" / "I already said"
  { pattern: /\b(i\s+already|i\s+just)\s+(told|said|mentioned|asked|explained)\b/i, label: "Agent forgot prior instruction", severity: "high" },
  { pattern: /\b(as\s+i\s+)(said|mentioned|stated|explained)\s+(before|earlier|above)\b/i, label: "Re-stating earlier instruction", severity: "high" },
  { pattern: /\b(i\s+said|i\s+told\s+you)\s+(to|not\s+to)\b/i, label: "Repeating explicit instruction", severity: "high" },
  { pattern: /\bdidn'?t\s+(i|we)\s+(just|already)\b/i, label: "Frustrated re-instruction", severity: "high" },
  { pattern: /\b(you'?re|you\s+are)\s+(still|again)\s+(doing|using|adding|making|creating)\b/i, label: "Agent repeating mistake", severity: "high" },
  { pattern: /\b(stop|quit|please\s+stop)\s+(doing|using|adding|changing)\b/i, label: "Agent persisting unwanted behavior", severity: "high" },

  // Instruction file references
  { pattern: /\b(check|read|look\s+at|see)\s+(the|my|our)\s+(instructions?|agent\.md|copilot-instructions)/i, label: "Directing to instruction file", severity: "medium" },
  { pattern: /\b(it'?s|that'?s|this\s+is)\s+(in|defined\s+in)\s+(the|my)\s+(instructions?|agent\.md)/i, label: "Rule exists in instruction file", severity: "high" },
  { pattern: /\bmy\s+(instructions?|agent\.md|config)\s+(say|says|specif)/i, label: "Citing instruction file", severity: "high" },
  { pattern: /\bcopilot-instructions/i, label: "Referencing .copilot-instructions.md", severity: "medium" },

  // Agent not following established pattern
  { pattern: /\b(like|the\s+way)\s+(i|we)\s+(showed|demonstrated|did\s+it)\s+(before|earlier|last\s+time)\b/i, label: "Agent deviating from shown pattern", severity: "medium" },
  { pattern: /\b(same|exact)\s+(way|pattern|style|format|approach)\s+(as|like)\s+(before|earlier|the\s+other)/i, label: "Agent not reusing pattern", severity: "medium" },
  { pattern: /\bagain,?\s+(please\s+)?(use|do|make|follow)\b/i, label: "Re-requesting approach", severity: "medium" },
  { pattern: /\bfor\s+the\s+(third|fourth|fifth|\d+th)\s+time\b/i, label: "Multi-repeat frustration", severity: "high" },

  // "I keep having to" / "every time"
  { pattern: /\bi\s+keep\s+(having\s+to|telling|asking|saying)\b/i, label: "Chronic agent failure", severity: "high" },
  { pattern: /\b(every|each)\s+time\s+(i|you|we|it)\b/i, label: "Recurring issue", severity: "medium" },
  { pattern: /\bwhy\s+(do|does|did)\s+(you|it)\s+(keep|always|still)\b/i, label: "Questioning persistent behavior", severity: "high" },
];

/**
 * Clean XML/system blocks from a user message before matching.
 */
function cleanMessage(msg) {
  if (!msg) return "";
  return msg
    .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .trim();
}

/**
 * Detect instruction failure signals in a single message.
 */
function detectFailureSignals(message) {
  const cleaned = cleanMessage(message);
  if (cleaned.length < 10) return [];

  const signals = [];
  for (const p of FAILURE_SIGNAL_PATTERNS) {
    const m = cleaned.match(p.pattern);
    if (m) {
      signals.push({
        label: p.label,
        severity: p.severity,
        matchedText: m[0],
        context: cleaned.substring(
          Math.max(0, m.index - 40),
          Math.min(cleaned.length, m.index + m[0].length + 80)
        ),
      });
    }
  }
  return signals;
}

/**
 * Detect intra-session repetition — when the user states the same instruction
 * multiple times within a single session, meaning the agent keeps forgetting.
 */
function detectIntraSessionRepetition(turns) {
  const userMsgs = turns
    .filter((t) => t.user_message && t.user_message.length > 20)
    .map((t) => ({
      idx: t.turn_index,
      text: cleanMessage(t.user_message).toLowerCase(),
    }))
    .filter((m) => m.text.length > 15);

  const repeats = [];

  for (let i = 0; i < userMsgs.length; i++) {
    const wordsI = new Set(
      userMsgs[i].text.split(/\s+/).filter((w) => w.length > 3)
    );
    if (wordsI.size < 4) continue;

    for (let j = i + 2; j < userMsgs.length; j++) {
      const wordsJ = new Set(
        userMsgs[j].text.split(/\s+/).filter((w) => w.length > 3)
      );
      if (wordsJ.size < 4) continue;

      const intersection = [...wordsI].filter((w) => wordsJ.has(w));
      const similarity = intersection.length / Math.max(wordsI.size, wordsJ.size);

      if (similarity > 0.5) {
        repeats.push({
          firstTurn: userMsgs[i].idx,
          repeatTurn: userMsgs[j].idx,
          similarity: Math.round(similarity * 100),
          snippet: userMsgs[i].text.substring(0, 100),
        });
      }
    }
  }

  return repeats;
}

/**
 * Detect correction-after-response — the user's message right after agent
 * output starts with a short correction ("no", "wrong", "not that").
 */
function detectImmediateCorrections(turns) {
  const corrections = [];

  for (let i = 1; i < turns.length; i++) {
    const msg = cleanMessage(turns[i].user_message);
    if (!msg || msg.length < 2) continue;

    const lower = msg.toLowerCase().trim();
    const isCorrection =
      /^no[,.\s!]/.test(lower) ||
      /^wrong/.test(lower) ||
      /^not (what|that|like)/.test(lower) ||
      /^that('s| is) (wrong|not|incorrect)/.test(lower) ||
      /^nope/.test(lower);

    if (isCorrection) {
      corrections.push({
        turn: turns[i].turn_index,
        message: msg.substring(0, 120),
      });
    }
  }

  return corrections;
}

/**
 * Analyze all sessions for instruction failures.
 */
export function analyzeInstructionFailures({ repo, since, excludeIds } = {}) {
  const sessions = listSessions({ repo, since, excludeIds });

  let totalFailureSignals = 0;
  let totalIntraRepetitions = 0;
  let totalImmediateCorrections = 0;
  let sessionsWithFailures = 0;

  const signalCounts = {};
  const severityCounts = { high: 0, medium: 0 };
  const repoFailures = {};
  const worstSessions = [];
  const allExamples = [];

  for (const s of sessions) {
    if (s.turn_count < 3) continue;
    const turns = getSessionTurns(s.id);
    const repoName = s.repository || "(no repo)";

    let sessionFailures = 0;

    // 1. Explicit failure signals
    for (const t of turns) {
      if (!t.user_message) continue;
      const signals = detectFailureSignals(t.user_message);
      for (const sig of signals) {
        sessionFailures++;
        totalFailureSignals++;
        severityCounts[sig.severity] = (severityCounts[sig.severity] || 0) + 1;
        signalCounts[sig.label] = (signalCounts[sig.label] || 0) + 1;

        if (allExamples.length < 50) {
          allExamples.push({
            sessionId: s.id,
            repo: repoName,
            turn: t.turn_index,
            label: sig.label,
            severity: sig.severity,
            context: sig.context,
          });
        }
      }
    }

    // 2. Intra-session repetitions
    const repeats = detectIntraSessionRepetition(turns);
    totalIntraRepetitions += repeats.length;
    sessionFailures += repeats.length;

    // 3. Immediate corrections
    const corrections = detectImmediateCorrections(turns);
    totalImmediateCorrections += corrections.length;
    sessionFailures += corrections.length;

    // Track per-repo
    if (!repoFailures[repoName]) {
      repoFailures[repoName] = { signals: 0, repetitions: 0, corrections: 0 };
    }
    const sessionSignals = turns.reduce((n, t) => n + detectFailureSignals(t.user_message).length, 0);
    repoFailures[repoName].signals += sessionSignals;
    repoFailures[repoName].repetitions += repeats.length;
    repoFailures[repoName].corrections += corrections.length;

    if (sessionFailures > 0) {
      sessionsWithFailures++;
      worstSessions.push({
        id: s.id,
        repo: repoName,
        branch: s.branch,
        summary: s.summary,
        failureCount: sessionFailures,
        signalCount: turns.reduce((n, t) => n + detectFailureSignals(t.user_message).length, 0),
        repetitionCount: repeats.length,
        correctionCount: corrections.length,
        turnCount: s.turn_count,
      });
    }
  }

  // Sort worst sessions
  worstSessions.sort((a, b) => b.failureCount - a.failureCount);

  // Top failure types
  const topSignals = Object.entries(signalCounts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  // Per-repo breakdown
  const repoBreakdown = Object.entries(repoFailures)
    .map(([repo, counts]) => ({
      repo,
      total: counts.signals + counts.repetitions + counts.corrections,
      ...counts,
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);

  // Generate suggestions
  const suggestions = generateFailureSuggestions({
    totalFailureSignals,
    totalIntraRepetitions,
    totalImmediateCorrections,
    topSignals,
    sessionsWithFailures,
    sessionCount: sessions.length,
  });

  return {
    totalFailureSignals,
    totalIntraRepetitions,
    totalImmediateCorrections,
    totalFailures: totalFailureSignals + totalIntraRepetitions + totalImmediateCorrections,
    sessionsWithFailures,
    sessionsAnalyzed: sessions.filter((s) => s.turn_count >= 3).length,
    severityCounts,
    topSignals: topSignals.slice(0, 15),
    worstSessions: worstSessions.slice(0, 10),
    repoBreakdown: repoBreakdown.slice(0, 10),
    examples: allExamples.slice(0, 20),
    suggestions,
  };
}

/**
 * Generate actionable suggestions for reducing instruction failures.
 */
function generateFailureSuggestions(data) {
  const suggestions = [];

  if (data.totalIntraRepetitions > 10) {
    suggestions.push({
      priority: "high",
      emoji: "🔁",
      title: "High In-Session Repetition",
      body: `You repeated the same instruction ${data.totalIntraRepetitions} times within sessions. The agent is forgetting mid-conversation. Try keeping sessions shorter and more focused — break large tasks into multiple sessions.`,
    });
  }

  if (data.totalFailureSignals > 5) {
    suggestions.push({
      priority: "high",
      emoji: "📋",
      title: "Rewrite Vague Instructions",
      body: `${data.totalFailureSignals} explicit failure signals detected. Your instruction file rules may be too vague. Make them specific and actionable — instead of "use good naming", try "use camelCase for variables and PascalCase for types".`,
    });
  }

  if (data.totalImmediateCorrections > 5) {
    suggestions.push({
      priority: "medium",
      emoji: "🎯",
      title: "Improve First-Turn Precision",
      body: `${data.totalImmediateCorrections} immediate corrections ("no", "wrong") after agent responses. Provide more context upfront — include examples, constraints, and expected output format in your prompt.`,
    });
  }

  const highSeverity = data.topSignals.filter((s) =>
    ["Agent forgot prior instruction", "Chronic agent failure", "Multi-repeat frustration", "Frustrated re-instruction"].includes(s.label)
  );
  if (highSeverity.length > 0) {
    suggestions.push({
      priority: "high",
      emoji: "⚠️",
      title: "Persistent Agent Failures",
      body: `Critical patterns detected: ${highSeverity.map((s) => s.label + " (" + s.count + "x)").join(", ")}. These suggest rules that need to be in your instruction file with explicit examples, not just stated as preferences.`,
    });
  }

  const failureRate = data.sessionsWithFailures / Math.max(data.sessionCount, 1);
  if (failureRate > 0.5) {
    suggestions.push({
      priority: "medium",
      emoji: "📊",
      title: "Widespread Failures",
      body: `${Math.round(failureRate * 100)}% of sessions have instruction failures. Consider auditing your instruction files — they may be outdated, contradictory, or too long for the agent to follow consistently.`,
    });
  }

  if (data.totalFailureSignals === 0 && data.totalIntraRepetitions === 0 && data.totalImmediateCorrections === 0) {
    suggestions.push({
      priority: "info",
      emoji: "✅",
      title: "No Failures Detected",
      body: "Your instructions appear to be working well. The agent is following your established rules without needing repeated corrections.",
    });
  }

  return suggestions;
}
