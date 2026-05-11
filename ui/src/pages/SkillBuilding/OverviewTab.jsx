import { MetricHelp } from "../../components/MetricHelp.jsx";
import { MiniStat, SuggestionsStack, buildDelegationSuggestions } from "./shared.jsx";

export function OverviewTab({ clarity, efficiency, delegation, judgment, tips }) {
  const allSuggestions = [
    ...((judgment?.suggestions || []).map((suggestion) => ({
      ...suggestion,
      pillar: suggestion.pillar || "qualityControl",
      source: suggestion.source || "coaching-suggestion",
      baselineScore: suggestion.baselineScore ?? judgment?.avgScore,
    }))),
    ...(delegation ? buildDelegationSuggestions(delegation).map((suggestion) => ({
      ...suggestion,
      pillar: suggestion.pillar || "workDesign",
      source: suggestion.source || "coaching-suggestion",
      baselineScore: suggestion.baselineScore ?? delegation?.overallDelegationRatio,
    })) : []),
    ...(efficiency?.aggregate?.totalDripFeeds > 5 ? [{
      priority: "medium", emoji: "💧", title: "Reduce Drip-Feeding",
      body: `${efficiency.aggregate.totalDripFeeds} times you added context piecemeal. Front-load all requirements in your first message.`,
      pillar: "intent",
      source: "coaching-suggestion",
      baselineScore: clarity?.avgScore,
    }] : []),
    ...(clarity?.avgScore < 50 ? [{
      priority: "high", emoji: "📝", title: "Improve Opening Prompts",
      body: `Average Intent score of ${clarity.avgScore}/100. Include file paths, constraints, and expected behavior upfront.`,
      pillar: "intent",
      source: "coaching-suggestion",
      baselineScore: clarity?.avgScore,
    }] : []),
  ].sort((a, b) => {
    const p = { high: 0, medium: 1, low: 2, info: 3 };
    return (p[a.priority] ?? 3) - (p[b.priority] ?? 3);
  });

  return (
    <>
      <div className="card">
        <div className="card-header">🎯 Key Metrics</div>
        <div className="stats-grid stats-grid-4">
          <MiniStat label={<MetricHelp label="Agent Leverage" definition="Ratio of agent output to your input. Higher means the agent does more work." target="2x+ good, 3x+ excellent." action="Delegate higher-level tasks." />} value={`${delegation?.overallLeverage ?? 0}x`} sub="output/input ratio" />
          <MiniStat label={<MetricHelp label="File Operations" definition="Files the agent created or edited." target="Higher = agent doing real coding work." />} value={delegation?.totalFileOps ?? 0} sub="agent-created files" />
          <MiniStat label={<MetricHelp label="Rubber-Stamp Rate" definition="How often you approved then corrected — approving without reviewing." target="0% ideal, over 30% penalized." action="Review agent output before approving." />} value={`${judgment?.rubberStampRate ?? 0}%`} sub="approvals before fix" />
          <MiniStat label={<MetricHelp label="Turn Efficiency" definition="Percentage of productive turns (not corrections)." target="90%+ excellent, 75%+ good." action="Provide clearer upfront context." />} value={`${efficiency?.aggregate?.avgEfficiency ?? 0}%`} sub="productive turns" />
        </div>
      </div>

      {allSuggestions.length > 0 && (
        <div className="card">
          <div className="card-header">💡 Top Coaching Tips</div>
          <SuggestionsStack
            suggestions={allSuggestions.slice(0, 5)}
            showAddButton
          />
        </div>
      )}
    </>
  );
}
