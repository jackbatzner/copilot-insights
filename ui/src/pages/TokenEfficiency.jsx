import { useState, useEffect } from "react";
import { fetchTokenEfficiency } from "../api.js";
import { useRefresh } from "../App.jsx";

const GRADE_COLORS = {
  "Excellent": "#3fb950",
  "Good": "#58a6ff",
  "Needs Work": "#d29922",
  "Poor": "#f85149",
};

function GradeBadge({ grade, score }) {
  const color = GRADE_COLORS[grade] || "#8b949e";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 12,
      background: `${color}20`, color,
      fontSize: 13, fontWeight: 600,
    }}>
      {score !== undefined && <span>{score}</span>}
      {grade}
    </span>
  );
}

function BarChart({ label, value, max, color }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ color: "var(--text-muted)" }}>{value.toLocaleString()} tokens</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--border)" }}>
        <div style={{ height: 6, borderRadius: 3, width: `${pct}%`, background: color, transition: "width 0.3s" }} />
      </div>
    </div>
  );
}

export default function TokenEfficiency() {
  const { key: refreshKey } = useRefresh();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeframe, setTimeframe] = useState("30d");

  useEffect(() => {
    setLoading(true);
    fetchTokenEfficiency(timeframe)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [timeframe, refreshKey]);

  if (loading) return <div className="page"><div className="loading-spinner" /></div>;
  if (error) return <div className="page"><div className="card" style={{ padding: 24, color: "var(--red)" }}>Error: {error}</div></div>;
  if (!data) return null;

  const { aggregate, sessions } = data;

  // Flatten session data for display
  const displaySessions = (sessions || []).map((s) => ({
    sessionId: s.sessionId,
    summary: s.summary,
    totalTokens: s.efficiency?.totalTokens || 0,
    wastedTokens: s.efficiency?.wastedTokens || 0,
    efficiencyRatio: s.efficiency?.efficiencyRatio,
    grade: s.efficiency?.grade?.label || "—",
  }));

  // Build waste breakdown as {category: tokens} from the array shape
  const wasteBreakdown = {};
  if (aggregate?.wasteByCategory) {
    for (const { category, tokens } of aggregate.wasteByCategory) {
      wasteBreakdown[category] = tokens;
    }
  }

  // Derive aggregate display values
  const aggWastedTokens = aggregate?.totalWasted || 0;
  const aggEfficiencyPct = aggregate?.avgEfficiency ?? null;
  const aggGrade = aggEfficiencyPct != null
    ? (aggEfficiencyPct >= 90 ? "Excellent" : aggEfficiencyPct >= 75 ? "Good" : aggEfficiencyPct >= 60 ? "Needs Work" : "Poor")
    : null;

  return (
    <div className="page">
      <div className="page-header">
        <h1>⚡ Token Efficiency</h1>
        <select
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value)}
          aria-label="Select time period for token efficiency data"
          style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--card-bg)", color: "var(--text)", fontSize: 13 }}
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">All time</option>
        </select>
      </div>
      <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>
        Understand how efficiently you spend tokens — fewer retries and clearer prompts mean lower cost.
      </p>

      {/* Aggregate Stats */}
      {aggregate && (
        <div className="card" style={{ marginBottom: 16, padding: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, textAlign: "center" }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--accent)" }}>
                {aggregate.totalTokens?.toLocaleString() || "—"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Total Tokens</div>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--red)" }}>
                {aggWastedTokens > 0 ? aggWastedTokens.toLocaleString() : "—"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Wasted Tokens</div>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--green)" }}>
                {aggEfficiencyPct != null ? `${aggEfficiencyPct}%` : "—"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Efficiency</div>
            </div>
            <div>
              {aggGrade ? <GradeBadge grade={aggGrade} score={data.pillarScore} /> : <span>—</span>}
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Overall Grade</div>
            </div>
          </div>
        </div>
      )}

      {/* Waste Breakdown */}
      {Object.keys(wasteBreakdown).length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: 20 }}>
          <div className="card-header" style={{ marginBottom: 12 }}>🗑️ Waste Breakdown</div>
          {Object.entries(wasteBreakdown)
            .sort((a, b) => b[1] - a[1])
            .map(([category, tokens]) => (
              <BarChart
                key={category}
                label={category}
                value={tokens}
                max={aggWastedTokens || 1}
                color="var(--orange)"
              />
            ))}
        </div>
      )}

      {/* Per-Session Table */}
      {displaySessions.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-header" style={{ padding: "12px 16px" }}>📊 Sessions by Token Usage</div>
          <table className="session-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Total Tokens</th>
                <th>Wasted</th>
                <th>Efficiency</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {displaySessions.slice(0, 20).map((s) => (
                <tr key={s.sessionId}>
                  <td style={{ fontSize: 13 }}>
                    {s.summary?.substring(0, 40) || s.sessionId?.substring(0, 8)}
                  </td>
                  <td>{s.totalTokens.toLocaleString()}</td>
                  <td style={{ color: "var(--orange)" }}>{s.wastedTokens.toLocaleString()}</td>
                  <td>{s.efficiencyRatio != null ? `${Math.round(s.efficiencyRatio * 100)}%` : "—"}</td>
                  <td><GradeBadge grade={s.grade} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {displaySessions.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "40px 16px" }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📭</div>
          <div style={{ fontSize: 16, fontWeight: 500 }}>No token data yet</div>
          <div style={{ color: "var(--text-muted)", marginTop: 4, fontSize: 13 }}>
            Token efficiency data will appear once sessions have been analyzed.
            Check that session-state JSONL files exist in ~/.copilot/session-state/.
          </div>
        </div>
      )}
    </div>
  );
}
