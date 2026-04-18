// First-turn clarity scoring and prompt quality analysis.
// Evaluates how well users set up their sessions with clear, actionable prompts.

/**
 * Clarity signals we look for in a first message.
 */
const CLARITY_SIGNALS = {
  // Positive signals (boost score)
  hasFilePath: { pattern: /(?:\/[\w.-]+){2,}|[\w.-]+\.[a-z]{1,4}\b/i, points: 15, label: "References specific files" },
  hasCodeBlock: { pattern: /```[\s\S]*?```/i, points: 10, label: "Includes code examples" },
  hasAcceptanceCriteria: { pattern: /\b(should|must|expect|ensure|verify|needs? to|make sure)\b/i, points: 10, label: "States requirements" },
  hasContext: { pattern: /\b(because|since|currently|right now|the problem is|the issue is|background)\b/i, points: 8, label: "Provides context" },
  hasSpecificAction: { pattern: /\b(add|create|remove|update|fix|refactor|implement|migrate|rename|move|delete|change|modify)\b/i, points: 5, label: "Clear action verb" },
  hasExamples: { pattern: /\b(for example|e\.g\.|such as|like this|here'?s an example)\b/i, points: 10, label: "Provides examples" },
  hasTechTerms: { pattern: /\b(api|endpoint|component|function|class|module|route|middleware|hook|state|props|query|schema|migration|test|spec)\b/i, points: 5, label: "Uses technical terms" },
  hasConstraints: { pattern: /\b(don'?t|without|avoid|keep|preserve|maintain|backward.?compat|no breaking)\b/i, points: 8, label: "States constraints" },

  // Negative signals (reduce score)
  tooVague: { pattern: /^(fix it|help|do it|make it work|can you help|please help|it'?s broken|not working)\s*[.!?]?$/i, points: -30, label: "Too vague" },
  tooShort: { minLength: 20, points: -20, label: "Very short prompt" },
  noVerb: { pattern: /^[^.!?]{0,30}[.!?]?$/, points: -10, label: "Missing action" },
};

/**
 * Analyze the clarity of a single message.
 * Returns a score (0-100) and breakdown of signals found.
 */
function scoreClarity(message) {
  if (!message || typeof message !== "string") {
    return { score: 0, signals: [], tips: ["Start with a clear, detailed prompt."] };
  }

  // Strip XML blocks
  const cleaned = message
    .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .trim();

  if (cleaned.length < 3) {
    return { score: 0, signals: [], tips: ["Your prompt was too short to analyze."] };
  }

  let score = 40; // base score
  const signals = [];

  // Check positive and negative patterns
  for (const [key, signal] of Object.entries(CLARITY_SIGNALS)) {
    if (signal.pattern && signal.pattern.test(cleaned)) {
      score += signal.points;
      signals.push({ key, label: signal.label, points: signal.points, positive: signal.points > 0 });
    }
    if (signal.minLength && cleaned.length < signal.minLength) {
      score += signal.points;
      signals.push({ key, label: signal.label, points: signal.points, positive: false });
    }
  }

  // Length bonus (longer = more detail, up to a point)
  if (cleaned.length > 200) {
    score += 10;
    signals.push({ key: "detailed", label: "Detailed description", points: 10, positive: true });
  } else if (cleaned.length > 100) {
    score += 5;
    signals.push({ key: "moderate_detail", label: "Reasonable detail", points: 5, positive: true });
  }

  score = Math.max(0, Math.min(100, score));

  // Generate tips based on missing signals
  const tips = [];
  const positiveKeys = new Set(signals.filter((s) => s.positive).map((s) => s.key));
  if (!positiveKeys.has("hasFilePath")) tips.push("Reference specific files or paths you want changed.");
  if (!positiveKeys.has("hasAcceptanceCriteria")) tips.push("State what \"done\" looks like — use 'should', 'must', 'ensure'.");
  if (!positiveKeys.has("hasContext")) tips.push("Add context — why is this change needed?");
  if (!positiveKeys.has("hasExamples")) tips.push("Include examples or code snippets when possible.");
  if (!positiveKeys.has("hasConstraints")) tips.push("Mention constraints — what should NOT change?");

  return { score, signals, tips: tips.slice(0, 3) };
}

/**
 * Analyze first-turn clarity across multiple sessions.
 */
export function analyzeFirstTurnClarity(sessions, getTurnsFn) {
  const results = [];

  for (const session of sessions) {
    const turns = getTurnsFn(session.id);
    const firstUserTurn = turns.find((t) => t.user_message);
    if (!firstUserTurn) continue;

    const clarity = scoreClarity(firstUserTurn.user_message);
    results.push({
      sessionId: session.id,
      repository: session.repository,
      branch: session.branch,
      summary: session.summary,
      createdAt: session.created_at,
      firstMessage: firstUserTurn.user_message.substring(0, 300),
      clarity,
    });
  }

  // Sort by clarity score ascending (worst first)
  results.sort((a, b) => a.clarity.score - b.clarity.score);

  // Aggregate stats
  const scores = results.map((r) => r.clarity.score);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const distribution = {
    excellent: scores.filter((s) => s >= 80).length,
    good: scores.filter((s) => s >= 60 && s < 80).length,
    fair: scores.filter((s) => s >= 40 && s < 60).length,
    poor: scores.filter((s) => s < 40).length,
  };

  // Most common missing signals across all sessions
  const tipCounts = {};
  for (const r of results) {
    for (const tip of r.clarity.tips) {
      tipCounts[tip] = (tipCounts[tip] || 0) + 1;
    }
  }
  const topTips = Object.entries(tipCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([tip, count]) => ({ tip, count, pct: Math.round((count / results.length) * 100) }));

  return {
    avgScore: Math.round(avgScore),
    distribution,
    topTips,
    sessions: results,
  };
}
