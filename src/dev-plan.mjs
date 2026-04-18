// Development plan generator — analyzes all coaching data to produce
// personalized, prioritized improvement plans with weekly goals,
// quick wins, and curated learning resources.

import { analyzeDelegation } from "./delegation.mjs";
import { analyzeJudgment } from "./judgment.mjs";
import { analyzeFirstTurnClarity } from "./clarity.mjs";
import { analyzeEfficiencyBatch } from "./efficiency.mjs";
import { analyzeInstructionGaps } from "./instructions.mjs";
import { analyzeInstructionFailures } from "./instruction-failures.mjs";
import { listSessions, getSessionTurns, getSessionRefs } from "./db.mjs";

/**
 * Curated learning resources from major AI providers.
 */
const LEARNING_RESOURCES = {
  delegation: [
    {
      title: "Prompt Engineering Guide",
      provider: "Anthropic",
      url: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview",
      type: "guide",
      time: "30 min",
      description: "Master task decomposition and structured prompting for better delegation.",
    },
    {
      title: "Using Copilot Effectively",
      provider: "GitHub",
      url: "https://docs.github.com/en/copilot/using-github-copilot/best-practices-for-using-github-copilot",
      type: "guide",
      time: "15 min",
      description: "Best practices for delegating coding tasks to Copilot.",
    },
    {
      title: "AI Pair Programming Patterns",
      provider: "Microsoft",
      url: "https://learn.microsoft.com/en-us/training/modules/introduction-prompt-engineering-with-github-copilot/",
      type: "course",
      time: "45 min",
      description: "Learn delegation patterns for AI pair programming.",
    },
    {
      title: "Be Clear and Direct",
      provider: "Anthropic",
      url: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/be-clear-and-direct",
      type: "guide",
      time: "10 min",
      description: "How to give clear, unambiguous instructions the agent can execute autonomously.",
    },
  ],
  judgment: [
    {
      title: "AI-Assisted Code Review",
      provider: "Google",
      url: "https://google.github.io/eng-practices/review/reviewer/",
      type: "guide",
      time: "20 min",
      description: "Code review best practices — applies to reviewing agent output too.",
    },
    {
      title: "Evaluating AI Output",
      provider: "Microsoft",
      url: "https://learn.microsoft.com/en-us/ai/playbook/technology-guidance/generative-ai/working-with-llms/evaluation/",
      type: "guide",
      time: "25 min",
      description: "Framework for evaluating AI-generated content quality.",
    },
    {
      title: "Long Context Window Tips",
      provider: "Anthropic",
      url: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/long-context-tips",
      type: "guide",
      time: "15 min",
      description: "Understand how context affects output — helps judge when the agent might lose track.",
    },
  ],
  feedback: [
    {
      title: "Give Examples (Multishot)",
      provider: "Anthropic",
      url: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/multishot-prompting",
      type: "guide",
      time: "10 min",
      description: "Using examples to communicate expectations clearly — reduce ambiguity.",
    },
    {
      title: "Chain of Thought Prompting",
      provider: "Anthropic",
      url: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/chain-of-thought",
      type: "guide",
      time: "10 min",
      description: "Break complex tasks into reasoning steps for better outcomes.",
    },
    {
      title: "Prompt Engineering for GitHub Copilot",
      provider: "GitHub",
      url: "https://docs.github.com/en/copilot/using-github-copilot/prompt-engineering-for-github-copilot",
      type: "guide",
      time: "20 min",
      description: "Practical prompt writing for Copilot with real examples.",
    },
    {
      title: "Use XML Tags to Structure",
      provider: "Anthropic",
      url: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags",
      type: "guide",
      time: "10 min",
      description: "Structure your prompts with XML tags for clarity — separates instructions from data.",
    },
  ],
  instructions: [
    {
      title: "Customizing Copilot Instructions",
      provider: "GitHub",
      url: "https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot",
      type: "guide",
      time: "15 min",
      description: "How to write effective .copilot-instructions.md files for your repos.",
    },
    {
      title: "System Prompts",
      provider: "Anthropic",
      url: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/system-prompts",
      type: "guide",
      time: "15 min",
      description: "Principles of effective system prompts — applies to instruction files.",
    },
  ],
};

/**
 * Generate a personalized development plan.
 */
export function generateDevPlan({ repo, since } = {}) {
  // Gather all metrics
  const delegation = analyzeDelegation({ repo, since });
  const judgment = analyzeJudgment({ repo, since });

  const sessions = listSessions({ repo, since }).filter((s) => s.turn_count >= 2);
  const clarityResult = analyzeFirstTurnClarity(sessions, getSessionTurns);
  const effData = sessions.map((s) => ({
    session: s,
    turns: getSessionTurns(s.id),
    refs: getSessionRefs(s.id),
  }));
  const efficiency = analyzeEfficiencyBatch(effData);
  const gaps = analyzeInstructionGaps({ repo, since });
  const failures = analyzeInstructionFailures({ repo, since });

  // ── Score each pillar 0-100 ──────────────────────────────────
  const delegationScore = Math.min(100, Math.round(
    (delegation.overallDelegationRatio * 0.4) +
    (Math.min(delegation.overallLeverage, 3) / 3 * 30) +
    (delegation.sessionsWithFiles / Math.max(delegation.sessionsAnalyzed, 1) * 30)
  ));

  const judgmentScore = judgment.avgScore;

  const feedbackScore = Math.round(
    (clarityResult.avgScore * 0.5) +
    ((efficiency.aggregate?.avgEfficiency || 0) * 0.3) +
    (Math.max(0, 100 - (efficiency.aggregate?.totalDripFeeds || 0) * 5) * 0.2)
  );

  // ── Identify opportunities ──────────────────────────────────
  const opportunities = [];

  // Delegation opportunities
  if (delegation.overallDelegationRatio < 30) {
    opportunities.push({
      pillar: "delegation",
      type: "high_impact",
      title: "Delegate larger chunks of work",
      description: `You're only delegating ${delegation.overallDelegationRatio}% of turns. Try giving full feature specs instead of step-by-step instructions. "Build a login form with email/password validation" beats "create a file, add a form, add inputs..."`,
      impact: 9,
      effort: "medium",
      metric: `${delegation.overallDelegationRatio}% → target 50%+`,
    });
  }
  if (delegation.overallLeverage < 1) {
    opportunities.push({
      pillar: "delegation",
      type: "quick_win",
      title: "Increase agent leverage",
      description: `Agent output is only ${delegation.overallLeverage}x your input. You're typing almost as much as the agent produces. Give concise goals and let the agent write the code.`,
      impact: 7,
      effort: "low",
      metric: `${delegation.overallLeverage}x → target 2x+`,
    });
  }
  const guidedPct = delegation.totalUserTurns > 0
    ? Math.round(((delegation.styleCounts?.["hands-on"] || 0) / delegation.sessionsAnalyzed) * 100)
    : 0;
  if (guidedPct > 30) {
    opportunities.push({
      pillar: "delegation",
      type: "high_impact",
      title: "Reduce micro-management",
      description: `${guidedPct}% of sessions are hands-on/guided style. Trust the agent with bigger tasks — provide acceptance criteria instead of step-by-step instructions.`,
      impact: 8,
      effort: "medium",
      metric: `${guidedPct}% hands-on → target <15%`,
    });
  }

  // Judgment opportunities
  if (judgment.rubberStampRate > 15) {
    opportunities.push({
      pillar: "judgment",
      type: "quick_win",
      title: "Review before approving",
      description: `${judgment.rubberStampRate}% of your approvals are followed by corrections. Pause to read the agent's changes before saying "looks good."`,
      impact: 8,
      effort: "low",
      metric: `${judgment.rubberStampRate}% → target <5%`,
    });
  }
  if (judgment.totalLateCatches > 5) {
    opportunities.push({
      pillar: "judgment",
      type: "high_impact",
      title: "Catch issues earlier",
      description: `${judgment.totalLateCatches} late catches — you're going back to fix things that slipped past. Review each step as it happens instead of building on unchecked work.`,
      impact: 9,
      effort: "medium",
      metric: `${judgment.totalLateCatches} late catches → target 0`,
    });
  }
  if (judgment.avgScore < 60) {
    opportunities.push({
      pillar: "judgment",
      type: "high_impact",
      title: "Improve review quality",
      description: `Judgment score is ${judgment.avgScore}/100. Focus on reading agent output carefully, spot-checking edge cases, and validating before moving forward.`,
      impact: 8,
      effort: "medium",
      metric: `${judgment.avgScore}/100 → target 75+`,
    });
  }

  // Feedback opportunities
  if (clarityResult.avgScore < 50) {
    opportunities.push({
      pillar: "feedback",
      type: "high_impact",
      title: "Write clearer opening prompts",
      description: `Clarity score is ${clarityResult.avgScore}/100. Include file paths, constraints, expected behavior, and examples in your first message.`,
      impact: 9,
      effort: "low",
      metric: `${clarityResult.avgScore}/100 → target 70+`,
    });
  }
  if ((efficiency.aggregate?.totalDripFeeds || 0) > 5) {
    opportunities.push({
      pillar: "feedback",
      type: "quick_win",
      title: "Front-load context",
      description: `${efficiency.aggregate.totalDripFeeds} drip-feeds detected. Instead of "oh, and also..." add all requirements to your first message.`,
      impact: 7,
      effort: "low",
      metric: `${efficiency.aggregate.totalDripFeeds} drips → target 0`,
    });
  }
  if ((efficiency.aggregate?.avgRecoveryTurns || 0) > 2) {
    opportunities.push({
      pillar: "feedback",
      type: "high_impact",
      title: "Give more effective corrections",
      description: `Average ${efficiency.aggregate.avgRecoveryTurns} turns to recover after a redirect. When correcting, be specific: say what's wrong AND what you want instead.`,
      impact: 7,
      effort: "medium",
      metric: `${efficiency.aggregate.avgRecoveryTurns} turns → target <1.5`,
    });
  }

  // Instruction opportunities
  if (gaps.totalGaps > 3) {
    opportunities.push({
      pillar: "instructions",
      type: "quick_win",
      title: "Add conventions to instruction files",
      description: `${gaps.totalGaps} conventions you keep teaching manually. Add them to .copilot-instructions.md for each repo and never repeat yourself.`,
      impact: 8,
      effort: "low",
      metric: `${gaps.totalGaps} gaps → target 0`,
    });
  }
  if (failures.totalIntraRepetitions > 20) {
    opportunities.push({
      pillar: "instructions",
      type: "high_impact",
      title: "Keep sessions shorter",
      description: `${failures.totalIntraRepetitions} in-session repeats — the agent forgets instructions in long sessions. Break large tasks into focused 5-10 turn sessions.`,
      impact: 9,
      effort: "medium",
      metric: `${failures.totalIntraRepetitions} repeats → target <5`,
    });
  }

  // Sort by impact
  opportunities.sort((a, b) => b.impact - a.impact);

  // ── Weekly goals ────────────────────────────────────────────
  const weeklyGoals = buildWeeklyGoals(opportunities, {
    delegationScore, judgmentScore, feedbackScore,
    delegation, judgment, clarityResult, efficiency, gaps,
  });

  // ── Quick wins ──────────────────────────────────────────────
  const quickWins = opportunities
    .filter((o) => o.type === "quick_win")
    .slice(0, 5);

  // ── Learning path ───────────────────────────────────────────
  const weakestPillar = [
    { pillar: "delegation", score: delegationScore },
    { pillar: "judgment", score: judgmentScore },
    { pillar: "feedback", score: feedbackScore },
  ].sort((a, b) => a.score - b.score)[0].pillar;

  const learningPath = buildLearningPath(weakestPillar, opportunities);

  return {
    pillarScores: {
      delegation: delegationScore,
      judgment: judgmentScore,
      feedback: feedbackScore,
      overall: Math.round((delegationScore + judgmentScore + feedbackScore) / 3),
    },
    opportunities: opportunities.slice(0, 10),
    quickWins,
    weeklyGoals,
    learningPath,
    weakestPillar,
    sessionCount: sessions.length,
  };
}

/**
 * Build concrete weekly goals based on identified opportunities.
 */
function buildWeeklyGoals(opportunities, data) {
  const goals = [];

  // Always include one goal per pillar if there's room to improve
  if (data.delegationScore < 80) {
    goals.push({
      pillar: "delegation",
      emoji: "🤝",
      goal: "Delegate 3 sessions with single-prompt kickoffs",
      description: "Start 3 sessions by describing the full desired outcome in one message. Don't guide step-by-step.",
      target: "3 sessions with ≤5 turns and file changes",
      progress: Math.min(100, Math.round(data.delegationScore * 1.2)),
    });
  }

  if (data.judgmentScore < 80) {
    goals.push({
      pillar: "judgment",
      emoji: "🧠",
      goal: "Review every agent change before approving",
      description: "Before saying 'looks good' or 'yes', read through the actual code changes. Check edge cases.",
      target: "0% rubber-stamp rate this week",
      progress: Math.max(0, 100 - data.judgment.rubberStampRate),
    });
  }

  if (data.feedbackScore < 80) {
    goals.push({
      pillar: "feedback",
      emoji: "💬",
      goal: "Include context in every opening prompt",
      description: "Every new session should start with: what you want, where the files are, constraints, and an example of success.",
      target: "70+ clarity score on all new sessions",
      progress: Math.min(100, Math.round(data.clarityResult.avgScore * 1.3)),
    });
  }

  // Add instruction file goal if gaps exist
  if (data.gaps.totalGaps > 0) {
    goals.push({
      pillar: "instructions",
      emoji: "📝",
      goal: "Create or update instruction files",
      description: `Add the top ${Math.min(3, data.gaps.totalGaps)} repeated conventions to .copilot-instructions.md in your most-used repos.`,
      target: `${Math.min(3, data.gaps.totalGaps)} conventions codified`,
      progress: 0,
    });
  }

  // Stretch goal
  goals.push({
    pillar: "all",
    emoji: "🏆",
    goal: "Complete 5 clean sessions",
    description: "Aim for 5 sessions this week with zero redirections. Focus on quality over quantity.",
    target: "5 sessions with 0% redirection rate",
    progress: 0,
  });

  return goals.slice(0, 5);
}

/**
 * Build a curated learning path based on weakest pillar.
 */
function buildLearningPath(weakestPillar, opportunities) {
  const primary = LEARNING_RESOURCES[weakestPillar] || [];
  const hasInstructionIssues = opportunities.some((o) => o.pillar === "instructions");
  const instructionResources = hasInstructionIssues ? LEARNING_RESOURCES.instructions : [];
  const allPillars = ["delegation", "judgment", "feedback"];
  const secondary = allPillars
    .filter((p) => p !== weakestPillar)
    .flatMap((p) => (LEARNING_RESOURCES[p] || []).slice(0, 1));

  return {
    focus: weakestPillar,
    primary: primary.slice(0, 3),
    secondary,
    instructionResources,
    totalTime: [...primary.slice(0, 3), ...secondary, ...instructionResources]
      .reduce((sum, r) => sum + parseInt(r.time || "0"), 0),
  };
}

// ── Helper: compute pillar scores from raw data ─────────────────
function computePillarScores(delegation, judgment, clarityResult, efficiency) {
  const delegationScore = Math.min(100, Math.round(
    (delegation.overallDelegationRatio * 0.4) +
    (Math.min(delegation.overallLeverage, 3) / 3 * 30) +
    (delegation.sessionsWithFiles / Math.max(delegation.sessionsAnalyzed, 1) * 30)
  ));
  const judgmentScore = judgment.avgScore;
  const feedbackScore = Math.round(
    (clarityResult.avgScore * 0.5) +
    ((efficiency.aggregate?.avgEfficiency || 0) * 0.3) +
    (Math.max(0, 100 - (efficiency.aggregate?.totalDripFeeds || 0) * 5) * 0.2)
  );
  return { delegationScore, judgmentScore, feedbackScore };
}

// ── Helper: gather all metrics for a time range ─────────────────
function gatherMetrics({ repo, since } = {}) {
  const delegation = analyzeDelegation({ repo, since });
  const judgment = analyzeJudgment({ repo, since });
  const sessions = listSessions({ repo, since }).filter((s) => s.turn_count >= 2);
  const clarityResult = analyzeFirstTurnClarity(sessions, getSessionTurns);
  const effData = sessions.map((s) => ({
    session: s,
    turns: getSessionTurns(s.id),
    refs: getSessionRefs(s.id),
  }));
  const efficiency = analyzeEfficiencyBatch(effData);
  const scores = computePillarScores(delegation, judgment, clarityResult, efficiency);
  return { delegation, judgment, clarityResult, efficiency, sessions, ...scores };
}

/**
 * Daily progress check — compares today's sessions against overall baseline.
 */
export function generateProgressCheck({ repo, since } = {}) {
  // Overall baseline (all-time or from `since`)
  const baseline = gatherMetrics({ repo, since });

  // Today's sessions only
  const todayStr = new Date().toISOString().split("T")[0];
  const todaySessions = baseline.sessions.filter(
    (s) => s.created_at && s.created_at.startsWith(todayStr)
  );

  let today = null;
  if (todaySessions.length > 0) {
    const todayDelegation = analyzeDelegation({ repo, since: todayStr });
    const todayJudgment = analyzeJudgment({ repo, since: todayStr });
    const todayClarity = analyzeFirstTurnClarity(todaySessions, getSessionTurns);
    const todayEffData = todaySessions.map((s) => ({
      session: s,
      turns: getSessionTurns(s.id),
      refs: getSessionRefs(s.id),
    }));
    const todayEff = analyzeEfficiencyBatch(todayEffData);
    const todayScores = computePillarScores(todayDelegation, todayJudgment, todayClarity, todayEff);
    today = {
      sessionCount: todaySessions.length,
      totalTurns: todaySessions.reduce((s, x) => s + (x.turn_count || 0), 0),
      ...todayScores,
      delegationRatio: todayDelegation.overallDelegationRatio,
      leverage: todayDelegation.overallLeverage,
      rubberStampRate: todayJudgment.rubberStampRate,
      redirectionRate: todayEff.aggregate?.avgEfficiency
        ? Math.round(100 - todayEff.aggregate.avgEfficiency)
        : null,
    };
  }

  // Compute deltas
  const deltas = today ? {
    delegation: today.delegationScore - baseline.delegationScore,
    judgment: today.judgmentScore - baseline.judgmentScore,
    feedback: today.feedbackScore - baseline.feedbackScore,
  } : null;

  // Build momentum signals
  const momentum = [];
  if (deltas) {
    if (deltas.delegation > 5) momentum.push({ emoji: "📈", text: `Delegation up ${deltas.delegation}pts today` });
    if (deltas.delegation < -5) momentum.push({ emoji: "📉", text: `Delegation down ${Math.abs(deltas.delegation)}pts today` });
    if (deltas.judgment > 5) momentum.push({ emoji: "📈", text: `Judgment up ${deltas.judgment}pts today` });
    if (deltas.judgment < -5) momentum.push({ emoji: "📉", text: `Judgment down ${Math.abs(deltas.judgment)}pts today` });
    if (deltas.feedback > 5) momentum.push({ emoji: "📈", text: `Feedback up ${deltas.feedback}pts today` });
    if (deltas.feedback < -5) momentum.push({ emoji: "📉", text: `Feedback down ${Math.abs(deltas.feedback)}pts today` });
    if (today.sessionCount >= 5) momentum.push({ emoji: "🔥", text: `${today.sessionCount} sessions today — productive day!` });
    if (today.rubberStampRate === 0 && today.sessionCount >= 2) momentum.push({ emoji: "✅", text: "Zero rubber-stamps today!" });
  }

  // Today's tips (1-2 quick actionable tips)
  const tips = [];
  if (today && today.delegationScore < baseline.delegationScore) {
    tips.push("Try delegating your next task fully — describe the outcome, not the steps.");
  }
  if (today && today.rubberStampRate > 10) {
    tips.push("Pause before approving — read through the agent's changes before saying yes.");
  }
  if (!today || today.sessionCount === 0) {
    tips.push("No sessions yet today. Start one and practice your weakest pillar!");
  }
  if (tips.length === 0) {
    tips.push("Great work today! Keep the momentum going.");
  }

  return {
    date: todayStr,
    today,
    baseline: {
      delegationScore: baseline.delegationScore,
      judgmentScore: baseline.judgmentScore,
      feedbackScore: baseline.feedbackScore,
      sessionCount: baseline.sessions.length,
    },
    deltas,
    momentum,
    tips,
  };
}

/**
 * Generate a retro for the selected timeframe — wins, misses, trends, next focus.
 */
export function generateRetro({ repo, since } = {}) {
  const data = gatherMetrics({ repo, since });
  const { sessions, delegation, judgment, efficiency } = data;

  if (sessions.length === 0) {
    return { empty: true, message: "No sessions in this timeframe to review." };
  }

  // ── Wins ──────────────────────────────────────────────────────
  const wins = [];
  if (data.delegationScore >= 60) wins.push({ pillar: "delegation", emoji: "🤝", text: `Delegation score: ${data.delegationScore}/100 — solid trust in the agent.` });
  if (data.judgmentScore >= 70) wins.push({ pillar: "judgment", emoji: "🧠", text: `Judgment score: ${data.judgmentScore}/100 — good quality review.` });
  if (data.feedbackScore >= 70) wins.push({ pillar: "feedback", emoji: "💬", text: `Feedback score: ${data.feedbackScore}/100 — clear communication.` });
  if (delegation.overallLeverage >= 1.5) wins.push({ pillar: "delegation", emoji: "📐", text: `${delegation.overallLeverage}x leverage — the agent is doing more than you type.` });
  if (judgment.rubberStampRate < 5) wins.push({ pillar: "judgment", emoji: "🔍", text: `Only ${judgment.rubberStampRate}% rubber-stamp rate — careful reviewer.` });
  if ((efficiency.aggregate?.totalDripFeeds || 0) === 0) wins.push({ pillar: "feedback", emoji: "📋", text: "Zero drip-feeds — front-loading context well." });

  const cleanSessions = sessions.filter((s) => {
    const eff = efficiency.sessions?.find((e) => e.sessionId === s.id);
    return eff && eff.efficiency >= 95;
  }).length;
  if (cleanSessions > 0) wins.push({ pillar: "all", emoji: "✨", text: `${cleanSessions} clean sessions with minimal redirections.` });

  // ── Misses / areas that need work ─────────────────────────────
  const misses = [];
  if (data.delegationScore < 40) misses.push({ pillar: "delegation", emoji: "⚠️", text: `Delegation score ${data.delegationScore}/100 — too much hand-holding.` });
  if (data.judgmentScore < 50) misses.push({ pillar: "judgment", emoji: "⚠️", text: `Judgment score ${data.judgmentScore}/100 — review quality needs work.` });
  if (data.feedbackScore < 40) misses.push({ pillar: "feedback", emoji: "⚠️", text: `Feedback score ${data.feedbackScore}/100 — prompts could be clearer.` });
  if (judgment.rubberStampRate > 20) misses.push({ pillar: "judgment", emoji: "🔴", text: `${judgment.rubberStampRate}% rubber-stamp rate — approving without reviewing.` });
  if ((efficiency.aggregate?.totalDripFeeds || 0) > 10) misses.push({ pillar: "feedback", emoji: "🔴", text: `${efficiency.aggregate.totalDripFeeds} drip-feeds — context dribbled out over many turns.` });
  if (judgment.totalLateCatches > 10) misses.push({ pillar: "judgment", emoji: "⚠️", text: `${judgment.totalLateCatches} late catches — issues found too late in sessions.` });

  // ── Trends (compare first half vs second half of timeframe) ───
  const trends = [];
  if (sessions.length >= 6) {
    const mid = Math.floor(sessions.length / 2);
    const firstHalf = sessions.slice(0, mid);
    const secondHalf = sessions.slice(mid);

    const firstClarity = analyzeFirstTurnClarity(firstHalf, getSessionTurns);
    const secondClarity = analyzeFirstTurnClarity(secondHalf, getSessionTurns);

    if (secondClarity.avgScore > firstClarity.avgScore + 5) {
      trends.push({ direction: "up", text: `Clarity improved: ${firstClarity.avgScore} → ${secondClarity.avgScore}` });
    } else if (secondClarity.avgScore < firstClarity.avgScore - 5) {
      trends.push({ direction: "down", text: `Clarity declined: ${firstClarity.avgScore} → ${secondClarity.avgScore}` });
    }

    const firstAvgTurns = firstHalf.reduce((s, x) => s + (x.turn_count || 0), 0) / firstHalf.length;
    const secondAvgTurns = secondHalf.reduce((s, x) => s + (x.turn_count || 0), 0) / secondHalf.length;
    if (secondAvgTurns < firstAvgTurns * 0.8) {
      trends.push({ direction: "up", text: `Sessions getting shorter: ${firstAvgTurns.toFixed(0)} → ${secondAvgTurns.toFixed(0)} avg turns` });
    } else if (secondAvgTurns > firstAvgTurns * 1.2) {
      trends.push({ direction: "down", text: `Sessions getting longer: ${firstAvgTurns.toFixed(0)} → ${secondAvgTurns.toFixed(0)} avg turns` });
    }
  }

  // ── Next focus recommendation ─────────────────────────────────
  const weakest = [
    { pillar: "delegation", score: data.delegationScore },
    { pillar: "judgment", score: data.judgmentScore },
    { pillar: "feedback", score: data.feedbackScore },
  ].sort((a, b) => a.score - b.score)[0];

  const nextFocus = {
    pillar: weakest.pillar,
    score: weakest.score,
    recommendation: weakest.pillar === "delegation"
      ? "Next period: practice giving full feature specs in a single prompt. Trust the agent."
      : weakest.pillar === "judgment"
        ? "Next period: read every agent change before approving. Check edge cases."
        : "Next period: include file paths, constraints, and examples in every opening prompt.",
    resources: (LEARNING_RESOURCES[weakest.pillar] || []).slice(0, 2),
  };

  // ── Summary stats ─────────────────────────────────────────────
  const overallScore = Math.round((data.delegationScore + data.judgmentScore + data.feedbackScore) / 3);

  return {
    empty: false,
    period: {
      sessions: sessions.length,
      totalTurns: sessions.reduce((s, x) => s + (x.turn_count || 0), 0),
      since: since || sessions[sessions.length - 1]?.created_at || "all time",
    },
    pillarScores: {
      delegation: data.delegationScore,
      judgment: data.judgmentScore,
      feedback: data.feedbackScore,
      overall: overallScore,
    },
    grade: overallScore >= 80 ? "A" : overallScore >= 65 ? "B" : overallScore >= 50 ? "C" : "D",
    wins: wins.slice(0, 5),
    misses: misses.slice(0, 5),
    trends,
    nextFocus,
    cleanSessions,
  };
}
