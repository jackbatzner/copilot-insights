const INSIGHT_ICONS = {
  tip: "💡",
  warning: "⚠️",
  info: "ℹ️",
  success: "✅",
};

export function InsightCard({ insight }) {
  return (
    <div className={`card insight-card ${insight.type}`}>
      <div className="insight-title">
        {INSIGHT_ICONS[insight.type] || "💡"} {insight.title}
      </div>
      <div className="insight-body">{insight.body}</div>
    </div>
  );
}
