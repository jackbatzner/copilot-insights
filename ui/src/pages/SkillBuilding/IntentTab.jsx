import { Link } from "react-router-dom";
import { MetricHelp } from "../../components/MetricHelp.jsx";
import { CollapsibleSection } from "../../components/CollapsibleSection.jsx";
import { MiniStat, AddToDevPlanButton, ClarityBar, clarityColor } from "./shared.jsx";

export function IntentTab({ clarity, efficiency }) {
  return (
    <>
      <p className="page-intro">
        How effectively you set clear intent — defining the desired outcome and quality bar.
        Clear intent = fewer iterations, faster results.
      </p>

      <div className="stats-grid stats-grid-4">
        <MiniStat label={<MetricHelp label="Intent Score" definition="Quality of your first message. Checks for file paths, constraints, acceptance criteria, context." target="70+ is clear. Under 50 needs work." action="Include specific files, constraints, and what success looks like." />} value={clarity?.avgScore ?? "—"} sub="/100 avg first-turn" />
        <MiniStat label={<MetricHelp label="Turn Efficiency" definition="Percentage of productive turns vs. corrections." target="90%+ excellent, 75%+ good." action="Front-load requirements." />} value={`${efficiency?.aggregate?.avgEfficiency ?? 0}%`} sub="productive turns" />
        <MiniStat label={<MetricHelp label="Recovery Speed" definition="Turns to get back on track after a redirection." target="Under 1.5 turns is good." action="Be specific about what went wrong." />} value={efficiency?.aggregate?.avgRecoveryTurns ?? "—"} sub="turns after redirect" />
        <MiniStat label={<MetricHelp label="Context Drips" definition="Times you added context piecemeal after your first message." target="0 is ideal." action="Write everything the agent needs before sending." />} value={efficiency?.aggregate?.totalDripFeeds ?? 0} sub="piecemeal info adds" />
      </div>

      {clarity && (
        <div className="card">
          <div className="card-header">📏 First-Turn Intent Distribution</div>
          <ClarityBar distribution={clarity.distribution} />
        </div>
      )}

      {clarity?.topTips?.length > 0 && (
        <div className="card">
          <div className="card-header">💡 Most Common Intent Gaps</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, padding: "6px 10px", background: "rgba(88, 166, 255, 0.05)", borderRadius: 6 }}>
            Each percentage shows how often this element was <strong style={{ color: "var(--text)" }}>missing from your opening prompts</strong>.
          </div>
          <div className="tips-list">
            {clarity.topTips.map((t, i) => (
              <div key={i} className="tip-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="tip-bar-track"><div className="tip-bar-fill" style={{ width: `${t.pct}%` }} /></div>
                <span className="tip-pct">{t.pct}%</span>
                <span className="tip-text">{t.tip}</span>
                <span style={{ marginLeft: "auto", flexShrink: 0 }}>
                  <AddToDevPlanButton
                    pillar="intent"
                    title={`Improve: ${t.tip}`}
                    description={`${t.pct}% of prompts are missing this element.`}
                    source="coaching-suggestion"
                    baselineScore={clarity?.avgScore}
                  />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {efficiency?.aggregate?.completionBreakdown && (
        <div className="card">
          <div className="card-header">🏁 Session Outcomes</div>
          <div className="completion-grid">
            {Object.entries(efficiency.aggregate.completionBreakdown).map(([status, count]) => (
              <div key={status} className="completion-item">
                <span className="completion-count">{count}</span>
                <span className="completion-label">{status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-row">
        {efficiency?.aggregate?.totalDripFeeds > 0 && (
          <div className="card" style={{ flex: 1 }}>
            <h2>💧 Context Drip-Feeding</h2>
            <p className="card-subtitle">Info added piecemeal ({efficiency.aggregate.totalDripFeeds} instances)</p>
            <p className="coaching-tip"><strong>Fix:</strong> Write everything the agent needs in your first message.</p>
          </div>
        )}
        {efficiency?.aggregate?.totalSkimSignals > 0 && (
          <div className="card" style={{ flex: 1 }}>
            <h2>👀 Response Skimming</h2>
            <p className="card-subtitle">Quick redirects after long responses ({efficiency.aggregate.totalSkimSignals} instances)</p>
            <p className="coaching-tip"><strong>Fix:</strong> Read the full response before redirecting.</p>
          </div>
        )}
      </div>

      {clarity?.sessions?.length > 0 && (
        <CollapsibleSection title="🔍 Prompts with Room to Grow" id="skills-weak-prompts" defaultOpen={false}>
          <table className="data-table" style={{ tableLayout: "fixed" }}>
            <thead><tr><th style={{ width: 80, textAlign: "left" }}>Score</th><th style={{ textAlign: "left" }}>Session</th><th style={{ width: 220, textAlign: "left" }}>Missing</th></tr></thead>
            <tbody>
              {clarity.sessions.slice(0, 8).map((s) => (
                <tr key={s.sessionId}>
                  <td><span className="clarity-badge" style={{ background: clarityColor(s.clarity.score) }}>{s.clarity.score}</span></td>
                  <td className="truncate" title={s.firstMessage}><Link to={`/sessions/${s.sessionId}`}>{s.summary || s.firstMessage?.substring(0, 80) || s.sessionId.slice(0, 8)}</Link></td>
                  <td className="tip-cell">{s.clarity.tips[0] || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CollapsibleSection>
      )}
    </>
  );
}
