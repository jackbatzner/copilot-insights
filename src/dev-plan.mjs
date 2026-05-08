// Development plan generator — analyzes all coaching data to produce
// personalized, prioritized improvement plans with weekly goals,
// quick wins, and curated learning resources.

import { analyzeDelegation } from "./delegation.mjs";
import { analyzeJudgment } from "./judgment.mjs";
import { analyzeFirstTurnClarity } from "./clarity.mjs";
import { analyzeEfficiencyBatch } from "./efficiency.mjs";
import { analyzeInstructionGaps } from "./instructions.mjs";
import { analyzeInstructionFailures } from "./instruction-failures.mjs";
import { computeTokenEfficiencyScore } from "./tokens.mjs";
import { listSessions, getSessionTurns, getSessionRefs } from "./db.mjs";

/**
 * Scoring weight profiles per session intent.
 * Each profile adjusts how pillar scores are weighted for the overall score.
 * redirect_penalty_factor: 0 = no penalty, 1 = full penalty for redirections/drip-feeds
 */
export const INTENT_WEIGHT_PROFILES = {
  build: {
    delegation: 1.0,
    judgment: 1.0,
    specification: 1.0,
    efficiency: 1.0,
    redirect_penalty_factor: 1.0,
    description: "Full scoring — clear deliverable expected",
  },
  explore: {
    delegation: 0.5,
    judgment: 1.0,
    specification: 0.6,
    efficiency: 0.4,
    redirect_penalty_factor: 0.3,
    description: "De-weighted efficiency — research and learning expected",
  },
  iterate: {
    delegation: 0.6,
    judgment: 1.0,
    specification: 0.7,
    efficiency: 0.3,
    redirect_penalty_factor: 0.0,
    description: "Brainstorm & Improve — iterative refinement is the goal",
  },
  debug: {
    delegation: 0.4,
    judgment: 1.2,
    specification: 0.5,
    efficiency: 0.7,
    redirect_penalty_factor: 0.5,
    description: "Emphasizes judgment — diagnostic accuracy is key",
  },
};

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
  specification: [
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
  efficiency: [
    {
      title: "Best Practices for Using Copilot",
      provider: "GitHub",
      url: "https://docs.github.com/en/copilot/using-github-copilot/best-practices-for-using-github-copilot",
      type: "guide",
      time: "15 min",
      description: "Optimize your workflow with Copilot — context, tool selection, and efficiency tips.",
    },
    {
      title: "Prompt Caching",
      provider: "Anthropic",
      url: "https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching",
      type: "guide",
      time: "15 min",
      description: "Understand token efficiency and how context affects cost.",
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

function stripUserMessage(msg) {
  if (!msg) return "";
  return msg
    .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .trim();
}

function flattenExamples(...groups) {
  return [...new Set(groups.flat().filter(Boolean))].slice(0, 3);
}

function getDominantStyle(styleCounts = {}) {
  return Object.entries(styleCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "collaborative";
}

function computeEfficiencyMetrics(delegation, efficiency, sessionsData = []) {
  const productiveTurnRatio = efficiency.aggregate?.avgEfficiency || 0;
  const sessionCompletionRate = delegation.sessionsAnalyzed > 0
    ? ((delegation.sessionsWithCommits + delegation.sessionsWithPRs) / delegation.sessionsAnalyzed) * 100
    : 0;
  const tokenEfficiencyScores = sessionsData
    .map(({ session }) => computeTokenEfficiencyScore(session.id))
    .filter((result) => result && typeof result.score === "number");
  const avgTokenEfficiency = tokenEfficiencyScores.length > 0
    ? tokenEfficiencyScores.reduce((sum, result) => sum + result.score, 0) / tokenEfficiencyScores.length
    : 50;

  let contextHygiene = 100;
  for (const { session, turns } of sessionsData) {
    const repository = (session.repository || "").trim();
    if (!repository || repository === "(no repo)") contextHygiene -= 5;

    const firstUserTurn = turns.find((t) => stripUserMessage(t.user_message).length > 0);
    const firstMessageLength = stripUserMessage(firstUserTurn?.user_message || "").length;
    if (firstMessageLength > 5000) contextHygiene -= 3;
  }

  contextHygiene = Math.max(0, contextHygiene);
  const efficiencyScore = Math.min(100, Math.max(0, Math.round(
    (productiveTurnRatio * 0.35) +
    (sessionCompletionRate * 0.25) +
    (contextHygiene * 0.2) +
    (avgTokenEfficiency * 0.2)
  )));

  return {
    productiveTurnRatio: Math.round(productiveTurnRatio),
    sessionCompletionRate: Math.round(sessionCompletionRate),
    contextHygiene,
    avgTokenEfficiency: Math.round(avgTokenEfficiency),
    efficiencyScore,
  };
}

/**
 * Generate a personalized development plan.
 */
export function generateDevPlan({ repo, since, excludeIds, sessionIntents } = {}) {
  const delegation = analyzeDelegation({ repo, since, excludeIds });
  const judgment = analyzeJudgment({ repo, since, excludeIds });
  const sessions = listSessions({ repo, since, excludeIds }).filter((s) => s.turn_count >= 2);
  const clarityResult = analyzeFirstTurnClarity(sessions, getSessionTurns);
  const effData = sessions.map((s) => ({
    session: s,
    turns: getSessionTurns(s.id),
    refs: getSessionRefs(s.id),
  }));
  const efficiency = analyzeEfficiencyBatch(effData);
  const gaps = analyzeInstructionGaps({ repo, since });
  const failures = analyzeInstructionFailures({ repo, since });

  const delegationScore = Math.min(100, Math.round(
    (delegation.overallDelegationRatio * 0.4) +
    (Math.min(delegation.overallLeverage, 3) / 3 * 30) +
    (delegation.sessionsWithFiles / Math.max(delegation.sessionsAnalyzed, 1) * 30)
  ));
  const judgmentScore = judgment.avgScore;
  const specificationScore = Math.round(
    (clarityResult.avgScore * 0.5) +
    ((efficiency.aggregate?.avgEfficiency || 0) * 0.3) +
    (Math.max(0, 100 - (efficiency.aggregate?.totalDripFeeds || 0) * 5) * 0.2)
  );
  const {
    productiveTurnRatio,
    contextHygiene,
    efficiencyScore,
  } = computeEfficiencyMetrics(delegation, efficiency, effData);

  const delegationExamples = flattenExamples(
    delegation.examples?.guided || [],
    delegation.examples?.collaborative || [],
    delegation.examples?.delegation || []
  );
  const judgmentExamples = flattenExamples(
    judgment.examples?.catches || [],
    judgment.examples?.lateCatches || [],
    judgment.examples?.approvals || []
  );
  const specificationExamples = flattenExamples(
    ...clarityResult.sessions.slice(0, 3).map((s) => [stripUserMessage(s.firstMessage || "")])
  );
  const contextHygieneExamples = effData.flatMap(({ session, turns }) => {
    const firstUserTurn = turns.find((t) => stripUserMessage(t.user_message).length > 0);
    const firstMessage = stripUserMessage(firstUserTurn?.user_message || "");
    const examples = [];
    const repository = (session.repository || "").trim();

    if (!repository || repository === "(no repo)") {
      examples.push(`Missing repo context in session "${session.summary || session.id}".`);
    }
    if (firstMessage.length > 5000) {
      examples.push(`Oversized opening prompt (${firstMessage.length} chars): "${firstMessage.substring(0, 120)}..."`);
    }
    return examples;
  }).slice(0, 3);

  const opportunities = [];

  if (delegation.overallDelegationRatio < 30) {
    const dominantStyle = getDominantStyle(delegation.styleCounts);
    let description;

    if ((delegation.styleCounts?.["hands-on"] || 0) > 0) {
      description = `You're only delegating ${delegation.overallDelegationRatio}% of turns. Try giving full feature specs instead of step-by-step instructions. "Build a login form with email/password validation" beats "create a file, add a form, add inputs..." For example, in one session you gave step-by-step instructions. Try describing the full outcome instead.`;
    } else {
      description = `You're only delegating ${delegation.overallDelegationRatio}% of turns. Most of your interactions are ${dominantStyle} — try starting sessions with a complete feature spec that describes the desired outcome. "Build a login form with email/password validation" is more effective than a series of questions and collaborative turns.`;
    }

    if (delegation.examples?.collaborative?.length > 0) {
      const example = delegation.examples.collaborative[0];
      description += `

Example from your session: "${example.substring(0, 120)}..." — this could have been a single spec.`;
    }

    opportunities.push({
      pillar: "delegation",
      type: "high_impact",
      title: "Delegate larger chunks of work",
      description,
      impact: 9,
      effort: "medium",
      metric: `${delegation.overallDelegationRatio}% → target 50%+`,
      examples: delegationExamples,
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
      examples: delegationExamples,
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
      examples: delegation.examples?.guided || delegationExamples,
    });
  }

  if (judgment.rubberStampRate > 15) {
    opportunities.push({
      pillar: "judgment",
      type: "quick_win",
      title: "Review before approving",
      description: `${judgment.rubberStampRate}% of your approvals are followed by corrections. Pause to read the agent's changes before saying "looks good."`,
      impact: 8,
      effort: "low",
      metric: `${judgment.rubberStampRate}% → target <5%`,
      examples: judgmentExamples,
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
      examples: judgmentExamples,
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
      examples: judgmentExamples,
    });
  }

  if (clarityResult.avgScore < 50) {
    opportunities.push({
      pillar: "specification",
      type: "high_impact",
      title: "Write clearer opening prompts",
      description: `Clarity score is ${clarityResult.avgScore}/100. Include file paths, constraints, expected behavior, and examples in your first message.`,
      impact: 9,
      effort: "low",
      metric: `${clarityResult.avgScore}/100 → target 70+`,
      examples: specificationExamples,
    });
  }
  if ((efficiency.aggregate?.totalDripFeeds || 0) > 5) {
    opportunities.push({
      pillar: "specification",
      type: "quick_win",
      title: "Front-load context",
      description: `${efficiency.aggregate.totalDripFeeds} drip-feeds detected. Instead of "oh, and also..." add all requirements to your first message.`,
      impact: 7,
      effort: "low",
      metric: `${efficiency.aggregate.totalDripFeeds} drips → target 0`,
      examples: specificationExamples,
    });
  }
  if ((efficiency.aggregate?.avgRecoveryTurns || 0) > 2) {
    opportunities.push({
      pillar: "specification",
      type: "high_impact",
      title: "Give more effective corrections",
      description: `Average ${efficiency.aggregate.avgRecoveryTurns} turns to recover after a redirect. When correcting, be specific: say what's wrong AND what you want instead.`,
      impact: 7,
      effort: "medium",
      metric: `${efficiency.aggregate.avgRecoveryTurns} turns → target <1.5`,
      examples: specificationExamples,
    });
  }

  if (productiveTurnRatio < 70) {
    opportunities.push({
      pillar: "efficiency",
      type: "high_impact",
      title: "Reduce wasted turns",
      description: `Only ${productiveTurnRatio}% of turns are productive. Front-load requirements, keep corrections specific, and split side questions into /ask sessions so the agent stays on track.`,
      impact: 8,
      effort: "medium",
      metric: `${productiveTurnRatio}% productive turns → target 85%+`,
      examples: [],
    });
  }
  if (contextHygiene < 70) {
    opportunities.push({
      pillar: "efficiency",
      type: "quick_win",
      title: "Improve session setup",
      description: `Context hygiene is ${contextHygiene}/100. Launch Copilot from inside repo directories, keep repository context attached, and move recurring conventions into instruction files instead of pasting oversized setup into chat.`,
      impact: 7,
      effort: "low",
      metric: `${contextHygiene}/100 → target 90+`,
      examples: contextHygieneExamples,
    });
  }

  if (gaps.totalGaps > 3) {
    opportunities.push({
      pillar: "instructions",
      type: "quick_win",
      title: "Add conventions to instruction files",
      description: `${gaps.totalGaps} conventions you keep teaching manually. Add them to .copilot-instructions.md for each repo and never repeat yourself.`,
      impact: 8,
      effort: "low",
      metric: `${gaps.totalGaps} gaps → target 0`,
      examples: [],
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
      examples: [],
    });
  }

  opportunities.sort((a, b) => b.impact - a.impact);

  const weeklyGoals = buildWeeklyGoals(opportunities, {
    delegationScore,
    judgmentScore,
    specificationScore,
    efficiencyScore,
    delegation,
    judgment,
    clarityResult,
    efficiency,
    gaps,
  });

  const quickWins = opportunities
    .filter((o) => o.type === "quick_win")
    .slice(0, 5);

  const weakestPillar = [
    { pillar: "delegation", score: delegationScore },
    { pillar: "judgment", score: judgmentScore },
    { pillar: "specification", score: specificationScore },
    { pillar: "efficiency", score: efficiencyScore },
  ].sort((a, b) => a.score - b.score)[0].pillar;

  const learningPath = buildLearningPath(weakestPillar, opportunities);
  const baseOverall = Math.round((delegationScore + judgmentScore + specificationScore + efficiencyScore) / 4);

  let intentAdjustedScores = null;
  let sessionIntentBreakdown = null;
  if (sessionIntents && Object.keys(sessionIntents).length > 0) {
    const intentCounts = { build: 0, explore: 0, iterate: 0, debug: 0 };
    const sessionsWithIntents = sessions.filter((s) => sessionIntents[s.id]);
    for (const s of sessionsWithIntents) {
      const intent = sessionIntents[s.id];
      if (intentCounts[intent] !== undefined) intentCounts[intent]++;
    }
    const totalIntented = sessionsWithIntents.length;
    sessionIntentBreakdown = {
      counts: intentCounts,
      totalTagged: totalIntented,
      totalSessions: sessions.length,
      profiles: Object.fromEntries(
        Object.entries(INTENT_WEIGHT_PROFILES).map(([intent, profile]) => [
          intent,
          {
            description: profile.description,
            redirect_penalty_factor: profile.redirect_penalty_factor,
          },
        ])
      ),
    };

    if (totalIntented > 0) {
      const clampScore = (score) => Math.max(0, Math.min(100, Math.round(score)));
      const adjustFactor = (pillarKey) => {
        let weightedSum = 0;
        let countSum = 0;
        for (const [intent, count] of Object.entries(intentCounts)) {
          if (count > 0 && INTENT_WEIGHT_PROFILES[intent]) {
            weightedSum += INTENT_WEIGHT_PROFILES[intent][pillarKey] * count;
            countSum += count;
          }
        }
        const nonIntented = sessions.length - totalIntented;
        return (weightedSum + nonIntented) / (countSum + nonIntented);
      };

      intentAdjustedScores = {
        delegation: clampScore(delegationScore * adjustFactor("delegation")),
        judgment: clampScore(judgmentScore * adjustFactor("judgment")),
        specification: clampScore(specificationScore * adjustFactor("specification")),
        efficiency: clampScore(efficiencyScore * adjustFactor("efficiency")),
      };
      intentAdjustedScores.overall = Math.round(
        (intentAdjustedScores.delegation + intentAdjustedScores.judgment +
         intentAdjustedScores.specification + intentAdjustedScores.efficiency) / 4
      );
    }
  }

  return {
    pillarScores: {
      delegation: delegationScore,
      judgment: judgmentScore,
      specification: specificationScore,
      efficiency: efficiencyScore,
      overall: baseOverall,
    },
    intentAdjustedScores,
    sessionIntentBreakdown,
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

  if (data.specificationScore < 80) {
    goals.push({
      pillar: "specification",
      emoji: "💬",
      goal: "Write clear specifications for every opening prompt",
      description: "Every new session should start with a clear specification: desired outcome, file paths, constraints, and an example of success.",
      target: "70+ clarity score on all new sessions",
      progress: Math.min(100, Math.round(data.clarityResult.avgScore * 1.3)),
    });
  }

  if (data.efficiencyScore < 80) {
    goals.push({
      pillar: "efficiency",
      emoji: "⚡",
      goal: "Complete 3 sessions from project directories",
      description: "Launch Copilot from inside your repo directory so it has full context. Use /ask for side questions.",
      target: "3 sessions with repo context and <10 turns each",
      progress: Math.min(100, Math.round(data.efficiencyScore * 1.2)),
    });
  }

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
  const allPillars = ["delegation", "judgment", "specification", "efficiency"];
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
function computePillarScores(delegation, judgment, clarityResult, efficiency, sessionsData = []) {
  const delegationScore = Math.min(100, Math.round(
    (delegation.overallDelegationRatio * 0.4) +
    (Math.min(delegation.overallLeverage, 3) / 3 * 30) +
    (delegation.sessionsWithFiles / Math.max(delegation.sessionsAnalyzed, 1) * 30)
  ));
  const judgmentScore = judgment.avgScore;
  const specificationScore = Math.round(
    (clarityResult.avgScore * 0.5) +
    ((efficiency.aggregate?.avgEfficiency || 0) * 0.3) +
    (Math.max(0, 100 - (efficiency.aggregate?.totalDripFeeds || 0) * 5) * 0.2)
  );
  const {
    productiveTurnRatio,
    sessionCompletionRate,
    contextHygiene,
    avgTokenEfficiency,
    efficiencyScore,
  } = computeEfficiencyMetrics(delegation, efficiency, sessionsData);
  return {
    delegationScore,
    judgmentScore,
    specificationScore,
    efficiencyScore,
    productiveTurnRatio,
    sessionCompletionRate,
    contextHygiene,
    avgTokenEfficiency,
  };
}

// ── Helper: gather all metrics for a time range ─────────────────
function gatherMetrics({ repo, since, excludeIds } = {}) {
  const delegation = analyzeDelegation({ repo, since, excludeIds });
  const judgment = analyzeJudgment({ repo, since, excludeIds });
  const sessions = listSessions({ repo, since, excludeIds }).filter((s) => s.turn_count >= 2);
  const clarityResult = analyzeFirstTurnClarity(sessions, getSessionTurns);
  const effData = sessions.map((s) => ({
    session: s,
    turns: getSessionTurns(s.id),
    refs: getSessionRefs(s.id),
  }));
  const efficiency = analyzeEfficiencyBatch(effData);
  const scores = computePillarScores(delegation, judgment, clarityResult, efficiency, effData);
  return { delegation, judgment, clarityResult, efficiency, sessions, ...scores };
}

/**
 * Daily progress check — compares today's sessions against overall baseline.
 */
export function generateProgressCheck({ repo, since, excludeIds } = {}) {
  const baseline = gatherMetrics({ repo, since, excludeIds });
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
    const todayScores = computePillarScores(todayDelegation, todayJudgment, todayClarity, todayEff, todayEffData);
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

  const deltas = today ? {
    delegation: today.delegationScore - baseline.delegationScore,
    judgment: today.judgmentScore - baseline.judgmentScore,
    specification: today.specificationScore - baseline.specificationScore,
    efficiency: today.efficiencyScore - baseline.efficiencyScore,
  } : null;

  const momentum = [];
  if (deltas) {
    if (deltas.delegation > 5) momentum.push({ emoji: "📈", text: `Delegation up ${deltas.delegation}pts today` });
    if (deltas.delegation < -5) momentum.push({ emoji: "📉", text: `Delegation down ${Math.abs(deltas.delegation)}pts today` });
    if (deltas.judgment > 5) momentum.push({ emoji: "📈", text: `Judgment up ${deltas.judgment}pts today` });
    if (deltas.judgment < -5) momentum.push({ emoji: "📉", text: `Judgment down ${Math.abs(deltas.judgment)}pts today` });
    if (deltas.specification > 5) momentum.push({ emoji: "📈", text: `Specification up ${deltas.specification}pts today` });
    if (deltas.specification < -5) momentum.push({ emoji: "📉", text: `Specification down ${Math.abs(deltas.specification)}pts today` });
    if (deltas.efficiency > 5) momentum.push({ emoji: "📈", text: `Efficiency up ${deltas.efficiency}pts today` });
    if (deltas.efficiency < -5) momentum.push({ emoji: "📉", text: `Efficiency down ${Math.abs(deltas.efficiency)}pts today` });
    if (today.sessionCount >= 5) momentum.push({ emoji: "🔥", text: `${today.sessionCount} sessions today — productive day!` });
    if (today.rubberStampRate === 0 && today.sessionCount >= 2) momentum.push({ emoji: "✅", text: "Zero rubber-stamps today!" });
  }

  const tips = [];
  if (today && today.delegationScore < baseline.delegationScore) {
    tips.push("Try delegating your next task fully — describe the outcome, not the steps.");
  }
  if (today && today.rubberStampRate > 10) {
    tips.push("Pause before approving — read through the agent's changes before saying yes.");
  }
  if (today && today.efficiencyScore < baseline.efficiencyScore) {
    tips.push("Tighten session setup — launch from the repo directory and front-load the full spec.");
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
      specificationScore: baseline.specificationScore,
      efficiencyScore: baseline.efficiencyScore,
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
export function generateRetro({ repo, since, excludeIds } = {}) {
  const data = gatherMetrics({ repo, since, excludeIds });
  const { sessions, delegation, judgment, efficiency } = data;

  if (sessions.length === 0) {
    return { empty: true, message: "No sessions in this timeframe to review." };
  }

  const wins = [];
  if (data.delegationScore >= 60) wins.push({ pillar: "delegation", emoji: "🤝", text: `Delegation score: ${data.delegationScore}/100 — solid trust in the agent.` });
  if (data.judgmentScore >= 70) wins.push({ pillar: "judgment", emoji: "🧠", text: `Judgment score: ${data.judgmentScore}/100 — good quality review.` });
  if (data.specificationScore >= 70) wins.push({ pillar: "specification", emoji: "💬", text: `Specification score: ${data.specificationScore}/100 — clear communication.` });
  if (data.efficiencyScore >= 70) wins.push({ pillar: "efficiency", emoji: "⚡", text: `Efficiency score: ${data.efficiencyScore}/100 — productive sessions with clean setup.` });
  if (delegation.overallLeverage >= 1.5) wins.push({ pillar: "delegation", emoji: "📐", text: `${delegation.overallLeverage}x leverage — the agent is doing more than you type.` });
  if (judgment.rubberStampRate < 5) wins.push({ pillar: "judgment", emoji: "🔍", text: `Only ${judgment.rubberStampRate}% rubber-stamp rate — careful reviewer.` });
  if ((efficiency.aggregate?.totalDripFeeds || 0) === 0) wins.push({ pillar: "specification", emoji: "��", text: "Zero drip-feeds — front-loading context well." });

  const cleanSessions = sessions.filter((s) => {
    const eff = efficiency.sessions?.find((e) => e.sessionId === s.id);
    return eff && eff.efficiency.efficiencyRatio >= 0.95;
  }).length;
  if (cleanSessions > 0) wins.push({ pillar: "all", emoji: "✨", text: `${cleanSessions} clean sessions with minimal redirections.` });

  const misses = [];
  if (data.delegationScore < 40) misses.push({ pillar: "delegation", emoji: "⚠️", text: `Delegation score ${data.delegationScore}/100 — too much hand-holding.` });
  if (data.judgmentScore < 50) misses.push({ pillar: "judgment", emoji: "⚠️", text: `Judgment score ${data.judgmentScore}/100 — review quality needs work.` });
  if (data.specificationScore < 40) misses.push({ pillar: "specification", emoji: "⚠️", text: `Specification score ${data.specificationScore}/100 — prompts could be clearer.` });
  if (data.efficiencyScore < 50) misses.push({ pillar: "efficiency", emoji: "⚠️", text: `Efficiency score ${data.efficiencyScore}/100 — too much setup friction or wasted motion.` });
  if (judgment.rubberStampRate > 20) misses.push({ pillar: "judgment", emoji: "🔴", text: `${judgment.rubberStampRate}% rubber-stamp rate — approving without reviewing.` });
  if ((efficiency.aggregate?.totalDripFeeds || 0) > 10) misses.push({ pillar: "specification", emoji: "🔴", text: `${efficiency.aggregate.totalDripFeeds} drip-feeds — context dribbled out over many turns.` });
  if (data.contextHygiene < 70) misses.push({ pillar: "efficiency", emoji: "🔴", text: `Context hygiene ${data.contextHygiene}/100 — launch from repo dirs and avoid oversized opening prompts.` });
  if (judgment.totalLateCatches > 10) misses.push({ pillar: "judgment", emoji: "⚠️", text: `${judgment.totalLateCatches} late catches — issues found too late in sessions.` });

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

  const weakest = [
    { pillar: "delegation", score: data.delegationScore },
    { pillar: "judgment", score: data.judgmentScore },
    { pillar: "specification", score: data.specificationScore },
    { pillar: "efficiency", score: data.efficiencyScore },
  ].sort((a, b) => a.score - b.score)[0];

  const nextFocus = {
    pillar: weakest.pillar,
    score: weakest.score,
    recommendation: weakest.pillar === "delegation"
      ? "Next period: practice giving full feature specs in a single prompt. Trust the agent."
      : weakest.pillar === "judgment"
        ? "Next period: read every agent change before approving. Check edge cases."
        : weakest.pillar === "specification"
          ? "Next period: include file paths, constraints, and examples in every opening prompt."
          : "Next period: launch from repo directories, keep sessions focused, and front-load the full task context.",
    resources: (LEARNING_RESOURCES[weakest.pillar] || []).slice(0, 2),
  };

  const overallScore = Math.round((data.delegationScore + data.judgmentScore + data.specificationScore + data.efficiencyScore) / 4);

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
      specification: data.specificationScore,
      efficiency: data.efficiencyScore,
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
