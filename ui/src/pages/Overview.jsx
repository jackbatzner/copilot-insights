import { useState, useEffect } from "react";
import { fetchSessions, fetchTrends, fetchInsights, fetchPillarTrends, fetchWorkStyle } from "../api.js";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrendChart } from "../components/TrendChart.jsx";
import { CategoryBreakdown } from "../components/CategoryBreakdown.jsx";
import { InsightCard } from "../components/InsightCard.jsx";
import { TimeframeSelector } from "../components/TimeframeSelector.jsx";
import { rateColor } from "../components/ScoreBadge.jsx";
import { useRefresh } from "../App.jsx";
import { TIERS, getTier } from "@shared/tiers.mjs";

export default function Overview() {
  const { key: refreshKey } = useRefresh();
  const [data, setData] = useState(null);
  const [trends, setTrends] = useState(null);
  const [insights, setInsights] = useState(null);
  const [pillarTrends, setPillarTrends] = useState(null);
  const [workStyle, setWorkStyle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeframe, setTimeframe] = useState("all");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchSessions(timeframe),
      fetchTrends(timeframe),
      fetchInsights(timeframe),
      fetchPillarTrends(timeframe),
      fetchWorkStyle(timeframe),
    ])
      .then(([sessionsData, trendsData, insightsData, pillarData, workStyleData]) => {
        setData(sessionsData);
        setTrends(trendsData.trends);
        setInsights(insightsData.insights);
        setPillarTrends(pillarData);
        setWorkStyle(workStyleData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [timeframe, refreshKey]);

  if (loading) return <div className="loading">Loading analysis…</div>;
  if (error) return <div className="empty"><div className="empty-icon">❌</div><p>{error}</p></div>;
  if (!data) return null;

  const { aggregate } = data;
  const avgRate = aggregate.avgRedirectionRate || 0;

  // Derive tier from latest pillar score
  const overallScore = pillarTrends?.weeks?.length
    ? pillarTrends.weeks[pillarTrends.weeks.length - 1].overall
    : 0;
  const tier = getTier(overallScore);

  return (
    <>
      <div className="page-header">
        <h1>📊 Overview</h1>
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </div>

      {/* Hero stats */}
      <div className="stats-grid stats-grid-overview">
        {pillarTrends && (
          <div className="card" style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div className="card-header">Your Tier</div>
            <div style={{ fontSize: 48, margin: "4px 0" }}>{tier.emoji}</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{tier.name}</div>
            {tier.next && (
              <div style={{ width: "80%", marginTop: 8 }}>
                <div style={{ height: 4, background: "var(--border)", borderRadius: 2 }}>
                  <div style={{
                    width: `${Math.round((overallScore - tier.min) / (tier.next.min - tier.min) * 100)}%`,
                    height: "100%", borderRadius: 2, background: "var(--green)", transition: "width 0.3s"
                  }} />
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {tier.next.min - overallScore} pts to {tier.next.emoji} {tier.next.name}
                </div>
              </div>
            )}
            {!tier.next && (
              <div style={{ fontSize: 11, color: "var(--green)", marginTop: 4 }}>Max tier reached!</div>
            )}
          </div>
        )}
        <div className="card" style={{ textAlign: "center" }}>
          <div className="card-header">Sessions Analyzed</div>
          <div className="stat-value">{aggregate.sessionsAnalyzed}</div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div className="card-header">With Redirections</div>
          <div className={`stat-value ${rateColor(aggregate.sessionsWithRedirections / Math.max(aggregate.sessionsAnalyzed, 1))}`}>
            {aggregate.sessionsWithRedirections}
          </div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div className="card-header">Total Redirections</div>
          <div className="stat-value">{aggregate.totalRedirections}</div>
        </div>
        <div className="card" style={{ textAlign: "center" }}>
          <div className="card-header">Avg Redirection Rate</div>
          <div className={`stat-value ${rateColor(avgRate)}`}>
            {(avgRate * 100).toFixed(1)}%
          </div>
          <div className="stat-label">of user turns are corrections</div>
        </div>
      </div>

      {/* Charts */}
      <div className="charts-grid">
        <div className="card">
          <div className="card-header">Redirection Rate Over Time</div>
          <TrendChart trends={trends} />
        </div>
        <div className="card">
          <div className="card-header">By Category</div>
          <CategoryBreakdown categoryTotals={aggregate.categoryTotals} />
        </div>
      </div>

      {/* Pillar Trends */}
      {pillarTrends && pillarTrends.weeks && pillarTrends.weeks.length > 0 && (() => {
        // Build callouts only for noteworthy trends
        const PILLAR_META = {
          delegation: { label: "Delegation", color: "#58a6ff" },
          judgment: { label: "Judgment", color: "#3fb950" },
          feedback: { label: "Feedback", color: "#d29922" },
          tokenEfficiency: { label: "Token Efficiency", color: "#bc8cff" },
        };
        const callouts = [];
        if (pillarTrends.trend && pillarTrends.weeks.length >= 2) {
          const latest = pillarTrends.weeks[pillarTrends.weeks.length - 1];
          const previous = pillarTrends.weeks[pillarTrends.weeks.length - 2];
          for (const [key, meta] of Object.entries(PILLAR_META)) {
            const dir = pillarTrends.trend[key];
            const diff = (latest[key] ?? 0) - (previous[key] ?? 0);
            if (dir === "declining") {
              callouts.push({ key, ...meta, icon: "⬇️", diff, type: "declining",
                msg: `dropped ${Math.abs(diff)} pts this week — check the ${meta.label} coaching tab for tips.` });
            } else if (dir === "improving" && diff >= 10) {
              callouts.push({ key, ...meta, icon: "🎉", diff, type: "improving",
                msg: `jumped +${diff} pts — nice progress!` });
            }
          }
        }
        return (
        <>
          <div className="page-header">
            <h2>📈 Skill Growth Over Time</h2>
            <p>Delegation, judgment, feedback, and token efficiency scores week-over-week</p>
          </div>
          <div className="card">
            <div className="card-header">Pillar Scores by Week</div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={pillarTrends.weeks} margin={{ top: 16, right: 24, bottom: 8, left: 0 }}>
                <XAxis dataKey="week" tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={{ stroke: "#30363d" }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={{ stroke: "#30363d" }} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, color: "#e6edf3" }}
                  labelStyle={{ color: "#8b949e" }}
                  formatter={(value, name) => {
                    const label = name === "tokenEfficiency" ? "Token Efficiency" : name.charAt(0).toUpperCase() + name.slice(1);
                    return [`${value}`, label];
                  }}
                />
                <Line type="monotone" dataKey="delegation" stroke="#58a6ff" strokeWidth={2} dot={{ fill: "#58a6ff", r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="judgment" stroke="#3fb950" strokeWidth={2} dot={{ fill: "#3fb950", r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="feedback" stroke="#d29922" strokeWidth={2} dot={{ fill: "#d29922", r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="tokenEfficiency" stroke="#bc8cff" strokeWidth={2} dot={{ fill: "#bc8cff", r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", justifyContent: "center", gap: 24, padding: "8px 0 4px", fontSize: 12, color: "#8b949e" }}>
              <span><span style={{ color: "#58a6ff" }}>●</span> Delegation</span>
              <span><span style={{ color: "#3fb950" }}>●</span> Judgment</span>
              <span><span style={{ color: "#d29922" }}>●</span> Feedback</span>
              <span><span style={{ color: "#bc8cff" }}>●</span> Token Efficiency</span>
            </div>
          </div>
          {callouts.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {callouts.map((c) => (
                <div key={c.key} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px", borderRadius: 8,
                  background: c.type === "declining"
                    ? "rgba(248, 81, 73, 0.08)" : "rgba(63, 185, 80, 0.08)",
                  border: `1px solid ${c.type === "declining"
                    ? "rgba(248, 81, 73, 0.25)" : "rgba(63, 185, 80, 0.25)"}`,
                  fontSize: 13,
                }}>
                  <span style={{ fontSize: 18 }}>{c.icon}</span>
                  <span>
                    <strong style={{ color: c.color }}>{c.label}</strong>{" "}
                    {c.msg}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
        );
      })()}

      {/* Work Style */}
      {workStyle && workStyle.summary && (
        <>
          <div className="page-header">
            <h2>🌊 Work Style</h2>
            <p>How you approach tasks across sessions</p>
          </div>
          <div className="charts-grid">
            <div className="card">
              <div className="card-header">Style Distribution</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" }}>
                {(() => {
                  const { styleCounts, total } = workStyle.summary;
                  const styles = [
                    { key: "vibe", label: "🌊 Vibe", color: "#58a6ff" },
                    { key: "structured", label: "📋 Structured", color: "#3fb950" },
                    { key: "iterative", label: "🔄 Iterative", color: "#d29922" },
                    { key: "mixed", label: "🔀 Mixed", color: "#8b949e" },
                  ];
                  return styles.map(({ key, label, color }) => {
                    const count = styleCounts[key] || 0;
                    const pct = total > 0 ? (count / total) * 100 : 0;
                    return (
                      <div key={key}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                          <span style={{ color: "#e6edf3" }}>{label}</span>
                          <span style={{ color: "#8b949e" }}>{count} session{count !== 1 ? "s" : ""} ({pct.toFixed(0)}%)</span>
                        </div>
                        <div style={{ height: 8, borderRadius: 4, background: "#21262d", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width 0.3s" }} />
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
              <div style={{ textAlign: "center", padding: "8px 0", fontSize: 14 }}>
                <span style={{ color: "#e6edf3" }}>
                  Dominant style: {workStyle.summary.dominantEmoji} {workStyle.summary.dominantStyle}
                </span>
              </div>
            </div>
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="card-header">Session Stats</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "8px 0" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#e6edf3" }}>{workStyle.summary.total}</div>
                  <div style={{ fontSize: 11, color: "#8b949e" }}>Total Sessions</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#58a6ff" }}>{(workStyle.summary.vibeRate * 100).toFixed(0)}%</div>
                  <div style={{ fontSize: 11, color: "#8b949e" }}>Vibe Rate</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#3fb950" }}>{(workStyle.summary.structuredRate * 100).toFixed(0)}%</div>
                  <div style={{ fontSize: 11, color: "#8b949e" }}>Structured Rate</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#d29922" }}>{workStyle.summary.avgFirstFileTurn.toFixed(1)}</div>
                  <div style={{ fontSize: 11, color: "#8b949e" }}>Avg First File Turn</div>
                </div>
              </div>
              {workStyle.coachingTip && (
                <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#e6edf3" }}>
                  💡 <strong>Coaching Tip:</strong> {workStyle.coachingTip}
                </div>
              )}
            </div>
          </div>

          {/* Plan vs Execution */}
          {workStyle.planVsExecution && workStyle.planVsExecution.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header">Plan Completion Rates</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, padding: "12px 0" }}>
                {workStyle.planVsExecution.map((item, i) => {
                  const pct = item.completionRate != null ? item.completionRate * 100 : 0;
                  const color = pct >= 80 ? "#3fb950" : pct >= 50 ? "#d29922" : "#f85149";
                  return (
                    <div key={i} style={{ background: "#161b22", borderRadius: 8, padding: "10px 14px", border: "1px solid #30363d" }}>
                      <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.session || item.name || `Session ${i + 1}`}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ height: 6, flex: 1, borderRadius: 3, background: "#21262d", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, color }}>{pct.toFixed(0)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Insights */}
      {insights && insights.length > 0 && (
        <>
          <div className="page-header">
            <h2>💡 Prompting Insights</h2>
            <p>Actionable tips based on your redirection patterns</p>
          </div>
          <div className="insights-grid">
            {insights.map((insight, i) => (
              <InsightCard key={i} insight={insight} />
            ))}
          </div>
        </>
      )}

    </>
  );
}
