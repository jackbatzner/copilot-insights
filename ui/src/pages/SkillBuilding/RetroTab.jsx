import { Link } from "react-router-dom";
import { MetricHelp } from "../../components/MetricHelp.jsx";
import { CollapsibleSection } from "../../components/CollapsibleSection.jsx";
import { MiniStat, SuggestionsStack, clarityColor } from "./shared.jsx";

export function RetroTab({ trends, improve, chronicle }) {
  const trendDirection = (trend) => {
    if (!trend || trend.weeks < 2) return null;
    // Don't show direction labels with fewer than 3 sessions per week
    if ((trend.totalSessions ?? 0) / Math.max(trend.weeks, 1) < 3) return null;
    const gap = trend.latestAvg - trend.earliestAvg;
    if (gap >= 5) return { label: "Improving ↑", color: "#3fb950" };
    if (gap <= -5) return { label: "Declining ↓", color: "#f85149" };
    return { label: "Stable →", color: "#8b949e" };
  };

  return (
    <>
      <p className="page-intro">
        Retro is your retrospective — tracking progress over time and surfacing improvement patterns.
      </p>

      {trends && Object.keys(trends).length > 0 && (
        <div className="card">
          <div className="card-header">📈 Pillar Trends</div>
          <div className="trends-grid">
            {Object.entries(trends).map(([pillar, trend]) => {
              const dir = trendDirection(trend);
              return (
                <div key={pillar} className="trend-card">
                  <div className="trend-pillar">{pillar}</div>
                  <div className="trend-values">
                    <span>Latest: <strong>{trend.latestAvg}</strong></span>
                    <span>Earlier: <strong>{trend.earliestAvg}</strong></span>
                  </div>
                  {dir && (
                    <div className="trend-direction" style={{ color: dir.color }}>
                      <span aria-label={`Trend: ${dir.label}`}>{dir.label}</span>
                      <span className="trend-label-text" style={{ fontSize: 10, marginLeft: 4 }}>
                        ({trend.totalSessions ?? "?"} sessions over {trend.weeks} weeks)
                      </span>
                    </div>
                  )}
                  {!dir && trend.weeks >= 2 && (
                    <div className="trend-direction" style={{ color: "#8b949e", fontSize: 11 }}>
                      Not enough data (need 3+ sessions/week)
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {improve?.length > 0 && (
        <div className="card">
          <div className="card-header">🎯 Areas to Improve</div>
          <SuggestionsStack
            suggestions={improve.map((item) => ({
              priority: item.priority || "medium",
              emoji: item.emoji || "🎯",
              title: item.title,
              body: item.body || item.description,
              pillar: item.pillar || "retro",
              source: item.source || "coaching-suggestion",
            }))}
            showAddButton
            defaultPillar="retro"
            defaultSource="retro-improve"
          />
        </div>
      )}

      {chronicle?.sessions?.length > 0 && (
        <CollapsibleSection title="📖 Session Chronicle" id="skills-chronicle" defaultOpen={false}>
          <table className="data-table">
            <thead><tr><th style={{ textAlign: "left" }}>Session</th><th>Score</th><th>Highlights</th></tr></thead>
            <tbody>
              {chronicle.sessions.slice(0, 10).map((s) => (
                <tr key={s.sessionId}>
                  <td className="truncate"><Link to={`/sessions/${s.sessionId}`}>{s.summary || s.sessionId.slice(0, 12)}</Link></td>
                  <td style={{ textAlign: "center" }}><span className="clarity-badge" style={{ background: clarityColor(s.score ?? 0) }}>{s.score ?? "—"}</span></td>
                  <td className="truncate">{s.highlights?.[0] || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleSection>
      )}
    </>
  );
}
