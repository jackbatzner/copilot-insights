import { Link } from "react-router-dom";
import { addDevPlanGoal } from "../../api";
import { MetricHelp } from "../../components/MetricHelp.jsx";
import { getPillarLabel, getPillarBadgeKey } from "../../pillar-config.js";
import { useDevPlan } from "./DevPlanContext.jsx";

export function AddToDevPlanButton({ pillar, title, description, source, baselineScore }) {
  const { addedGoals, setAddedGoals, addingGoal, setAddingGoal } = useDevPlan();
  const goalKey = `${pillar}:${title}`;
  const isAdded = addedGoals.has(goalKey);
  const isAdding = addingGoal === goalKey;

  const handleAdd = async () => {
    setAddingGoal(goalKey);
    try {
      await addDevPlanGoal({ pillar, title, description, source, baselineScore });
      setAddedGoals((prev) => new Set([...prev, goalKey]));
    } catch (err) {
      if (String(err?.message || err).includes("409")) {
        setAddedGoals((prev) => new Set([...prev, goalKey]));
      }
    } finally {
      setAddingGoal(null);
    }
  };

  if (isAdded) {
    return <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 500 }}>✓ In Dev Plan</span>;
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleAdd();
      }}
      disabled={isAdding}
      style={{
        background: "none",
        border: "1px solid var(--accent)",
        borderRadius: 6,
        color: "var(--accent)",
        fontSize: 11,
        padding: "3px 8px",
        cursor: isAdding ? "wait" : "pointer",
        opacity: isAdding ? 0.6 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {isAdding ? "Adding…" : "➕ Add to Dev Plan"}
    </button>
  );
}

export function MiniStat({ label, value, sub }) {
  return (
    <div className="stat-card" style={{ padding: "12px 16px" }}>
      <div className="stat-value" style={{ fontSize: 22 }}>{value}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

export function SuggestionsStack({
  suggestions,
  showAddButton = false,
  defaultPillar,
  defaultSource,
  defaultBaselineScore,
}) {
  const PRIORITY_COLORS = { high: "#f85149", medium: "#d29922", low: "#58a6ff", info: "#3fb950" };
  return (
    <div className="suggestions-stack">
      {suggestions.map((s, i) => (
        <div key={i} className="suggestion-block" style={{ borderLeftColor: PRIORITY_COLORS[s.priority] || "#8b949e" }}>
          <div className="suggestion-header">
            <span className="suggestion-emoji">{s.emoji}</span>
            <span className="suggestion-title">{s.title}</span>
            <span className="priority-tag" style={{ background: PRIORITY_COLORS[s.priority] }}>{s.priority}</span>
            {showAddButton && (
              <span style={{ marginLeft: 8 }}>
                <AddToDevPlanButton
                  pillar={s.pillar || defaultPillar || "intent"}
                  title={s.title}
                  description={s.body}
                  source={s.source || defaultSource || "coaching-suggestion"}
                  baselineScore={s.baselineScore ?? defaultBaselineScore}
                />
              </span>
            )}
          </div>
          <p className="suggestion-body">{s.body}</p>
        </div>
      ))}
    </div>
  );
}

export function ClarityBar({ distribution }) {
  const total = distribution.excellent + distribution.good + distribution.fair + distribution.poor;
  if (total === 0) return null;
  const segments = [
    { label: "Excellent", count: distribution.excellent, color: "#3fb950" },
    { label: "Good", count: distribution.good, color: "#58a6ff" },
    { label: "Fair", count: distribution.fair, color: "#d29922" },
    { label: "Poor", count: distribution.poor, color: "#f85149" },
  ];
  return (
    <div className="clarity-bar-wrapper">
      <div className="clarity-bar">
        {segments.map((seg) => seg.count > 0 && (
          <div key={seg.label} className="clarity-segment" style={{ width: `${(seg.count / total) * 100}%`, background: seg.color }} title={`${seg.label}: ${seg.count}`} />
        ))}
      </div>
      <div className="clarity-legend">
        {segments.map((seg) => (
          <span key={seg.label} className="clarity-legend-item">
            <span className="dot" style={{ background: seg.color }} /> {seg.label} ({seg.count})
          </span>
        ))}
      </div>
    </div>
  );
}

export function ResourceCard({ resource: r, priority }) {
  return (
    <a href={r.url} target="_blank" rel="noopener noreferrer" className={`resource-card${priority ? " priority" : ""}`}>
      <div className="resource-main">
        <div className="resource-title">{r.title}</div>
        <div className="resource-desc">{r.description}</div>
      </div>
      <div className="resource-meta">
        <span className="resource-provider-tag">{r.provider}</span>
        <span className="resource-time">⏱ {r.time}</span>
        <span className="resource-type">{r.type}</span>
      </div>
    </a>
  );
}

export function clarityColor(score) {
  if (score >= 80) return "#3fb950";
  if (score >= 60) return "#58a6ff";
  if (score >= 40) return "#d29922";
  return "#f85149";
}

export function styleEmoji(style) {
  const map = { delegator: "🎯", collaborative: "🤝", "hands-on": "🔧", corrective: "🔄", exploratory: "🔍" };
  return map[style] || "📋";
}

export function buildDelegationSuggestions(data) {
  const suggestions = [];
  if (data.overallDelegationRatio < 20) {
    suggestions.push({
      priority: "medium", emoji: "🤝", title: "Delegate More",
      body: `Only ${data.overallDelegationRatio}% work design ratio. Try giving high-level goals and letting the agent choose the approach.`,
    });
  }
  if (data.overallLeverage < 0.5) {
    suggestions.push({
      priority: "medium", emoji: "📈", title: "Low Agent Leverage",
      body: `Agent output is only ${data.overallLeverage}x your input. Consider delegating larger chunks.`,
    });
  }
  return suggestions;
}
