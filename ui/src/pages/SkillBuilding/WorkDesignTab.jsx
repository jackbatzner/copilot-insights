import { MetricHelp } from "../../components/MetricHelp.jsx";
import { MiniStat, SuggestionsStack, buildDelegationSuggestions, styleEmoji } from "./shared.jsx";

export function WorkDesignTab({ delegation }) {
  if (!delegation) return <p className="empty-state">No work design data available yet. Complete a few sessions to see analysis.</p>;
  const suggestions = buildDelegationSuggestions(delegation);
  return (
    <>
      <p className="page-intro">
        Work design measures how you structure and scope work for the agent — chunking, context-setting, and iteration flow.
      </p>

      <div className="stats-grid stats-grid-4">
        <MiniStat label={<MetricHelp label="Work Design Ratio" definition="Percentage of Copilot-generated code vs. total code." target="50%+ means good delegation." action="Delegate full features, not just boilerplate." />} value={`${delegation.overallDelegationRatio}%`} sub="agent-authored" />
        <MiniStat label={<MetricHelp label="Agent Leverage" definition="Ratio of agent output to your input." target="2x+ good, 3x+ excellent." />} value={`${delegation.overallLeverage}x`} sub="output/input" />
        <MiniStat label="Sessions" value={delegation.sessions?.length ?? 0} sub="analyzed" />
        <MiniStat label="Total Files" value={delegation.totalFileOps} sub="agent-created" />
      </div>

      {delegation.styleBreakdown && Object.keys(delegation.styleBreakdown).length > 0 && (
        <div className="card">
          <div className="card-header">🎨 Work Design Styles</div>
          <div className="style-grid">
            {Object.entries(delegation.styleBreakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([style, count]) => (
                <div key={style} className="style-card">
                  <span className="style-emoji">{styleEmoji(style)}</span>
                  <span className="style-name">{style}</span>
                  <span className="style-count">{count} sessions</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="card">
          <div className="card-header">💡 Work Design Suggestions</div>
          <SuggestionsStack
            suggestions={suggestions}
            showAddButton
            defaultPillar="workDesign"
            defaultSource="coaching-suggestion"
            defaultBaselineScore={delegation.overallDelegationRatio}
          />
        </div>
      )}
    </>
  );
}
