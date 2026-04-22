import { useState, useEffect } from "react";
import { fetchSessions, fetchTrends, fetchInsights, fetchPillarTrends, fetchWorkStyle } from "../api.js";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrendChart } from "../components/TrendChart.jsx";
import { CategoryBreakdown } from "../components/CategoryBreakdown.jsx";
import { InsightCard } from "../components/InsightCard.jsx";
import { TimeframeSelector } from "../components/TimeframeSelector.jsx";
import { CollapsibleSection } from "../components/CollapsibleSection.jsx";
import { SinceLastVisit } from "../components/SinceLastVisit.jsx";
import { rateColor } from "../components/ScoreBadge.jsx";
import { useRefresh } from "../App.jsx";
import { TIERS, getTier } from "@shared/tiers.mjs";
import { PageBanner } from "../components/PageBanner.jsx";
import { MetricHelp } from "../components/MetricHelp.jsx";
import { SuggestedNext } from "../components/SuggestedNext.jsx";
import { EmptyState, MIN_SESSIONS_FOR_TRENDS } from "../components/EmptyState.jsx";

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

  useEffect(() => { localStorage.setItem("overview-visited", "true"); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchSessions(timeframe),
      fetchTrends(timeframe),
      fetchInsights(timeframe),
      fetchPillarTrends(timeframe),
      fetchWorkStyle(timeframe),
    ])
      .then(([sessionsData, trendsData, insightsData, pillarData, workStyleData]) => {
        if (cancelled) return;
        setData(sessionsData);
        setTrends(trendsData.trends);
        setInsights(insightsData.insights);
        setPillarTrends(pillarData);
        setWorkStyle(workStyleData);
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [timeframe, refreshKey]);

  useEffect(() => { localStorage.setItem("overview-visited", "true"); }, []);

  if (loading) return <div className="loading">Loading analysis…</div>;
  if (error) return (
    <div className="empty">
      <div className="empty-icon">⚠️</div>
      <p style={{ fontSize: 14, lineHeight: 1.6 }}>
        {error.includes("session database") || error.includes("HTTP 500")
          ? "Couldn't connect to your session data. Make sure the Copilot Insights server is running and you've completed at least one Copilot CLI session."
          : error}
      </p>
      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Need help? Run <code>copilot-insights --help</code> to get started.
      </p>
    </div>
  );
  if (!data) return null;

  const { aggregate } = data;
  const sessionCount = aggregate.sessionsAnalyzed || 0;
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
      <PageBanner pageId="overview">
        Your snapshot — growth across delegation, judgment, and feedback.
      </PageBanner>

      {/* Since Last Visit — shown for returning users */}
      <SinceLastVisit refreshKey={refreshKey} />

      {/* Empty / low-session state */}
      {sessionCount < MIN_SESSIONS_FOR_TRENDS && (
        <EmptyState sessionCount={sessionCount} feature="trend analysis and coaching" />
      )}

      {/* ── THE 5-MINUTE WOW ──────────────────────────────────────── */}

      {/* Tier Hero — your level at a glance */}
      {pillarTrends && (
        <div className="tier-hero-card card">
          <div className="tier-hero-content">
            <div style={{ fontSize: 36, lineHeight: 1 }}>{tier.emoji}</div>
            <div className="tier-hero-info">
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                <MetricHelp
                  label={tier.name}
                  definition="Your overall skill tier, derived from your combined Delegation + Judgment + Feedback pillar scores."
                  target="Progress through tiers by improving your weakest pillar."
                />
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Score: {overallScore}/100</div>
              {tier.next && (
                <div className="tier-hero-progress">
                  <div className="tier-progress-bar">
                    <div className="tier-progress-fill" style={{
                      width: `${Math.round((overallScore - tier.min) / (tier.next.min - tier.min) * 100)}%`
                    }} />
                  </div>
                  <span className="tier-progress-label">
                    {tier.next.min - overallScore} pts to {tier.next.emoji} {tier.next.name}
                  </span>
                </div>
              )}
              {!tier.next && (
                <span style={{ fontSize: 12, color: "var(--green)" }}>Max tier reached!</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Insight — the ONE thing that makes you go "oh, I do that" */}
      {insights && insights.length > 0 && (
        <div className="top-insight-card">
          <div className="top-insight-header">
            💡 <strong>{insights[0].title}</strong>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {insights[0].body}
          </div>
          {insights.length > 1 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              +{insights.length - 1} more insight{insights.length > 2 ? "s" : ""} below
            </div>
          )}
        </div>
      )}

      {/* Quick Stats — just the headline numbers */}
      <div className="stats-row" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ textAlign: "center", padding: "12px 8px" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Sessions</div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{aggregate.sessionsAnalyzed}</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "12px 8px" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
            <MetricHelp
              label="Redirections"
              definition="Total turns where you corrected, redirected, or re-explained something to the agent. Each one means the agent didn't do what you wanted on the first try."
              target="Fewer is better — each redirection is a chance to improve your opening prompt."
            />
          </div>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{aggregate.totalRedirections}</div>
        </div>
        <div className="card" style={{ textAlign: "center", padding: "12px 8px" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
            <MetricHelp
              label="Avg Rate"
              definition="Percentage of your turns that correct or redirect the agent."
              target="Under 10% is smooth. 10-25% is some friction. Over 25% needs attention."
            />
          </div>
          <div className={`${rateColor(avgRate)}`} style={{ fontSize: 24, fontWeight: 600 }}>
            {(avgRate * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* What to do next — clear CTAs */}
      <div className="card next-steps-card" style={{ padding: "12px 16px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🚀 What to do next</div>
        <div className="next-steps-grid">
          <SuggestedNext
            to="/coaching"
            icon="🎓"
            label="Coaching"
            description="Delegation, judgment & feedback scores"
          />
          <SuggestedNext
            to="/sessions"
            icon="📋"
            label="Sessions"
            description="Replay where you corrected the AI"
          />
          <SuggestedNext
            to="/practice"
            icon="🧪"
            label="Practice"
            description="Rewrite a prompt, see your score improve"
          />
        </div>
      </div>

      {/* ── DEEPER DIVES (collapsed by default) ────────────────── */}

      {/* Remaining insights */}
      {insights && insights.length > 1 && (
        <CollapsibleSection title="💡 More Insights" id="overview-insights" defaultOpen={false}>
          <div className="insights-grid">
            {insights.slice(1).map((insight) => (
              <InsightCard key={insight.title || insight.message} insight={insight} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Charts */}
      <CollapsibleSection title="Trends" id="overview-trends" defaultOpen={false}>
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
      </CollapsibleSection>

      {/* Pillar Trends */}
      {pillarTrends && pillarTrends.weeks && pillarTrends.weeks.length > 0 && (
        <CollapsibleSection title="📈 Skill Growth Over Time" id="overview-pillars" defaultOpen={false}>
          <div className="card">
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span>Pillar Scores by Week</span>
              {pillarTrends.trendDirection && (
                <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
                  {["delegation", "judgment", "feedback"].map((pillar) => {
                    const dir = pillarTrends.trendDirection[pillar];
                    const badge = dir === "improving" ? "⬆️ Improving" : dir === "declining" ? "⬇️ Declining" : "➡️ Stable";
                    const color = dir === "improving" ? "#3fb950" : dir === "declining" ? "#f85149" : "#8b949e";
                    return (
                      <span key={pillar} style={{ color, fontWeight: 500 }}>
                        {pillar.charAt(0).toUpperCase() + pillar.slice(1)}: {badge}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={pillarTrends.weeks} margin={{ top: 16, right: 24, bottom: 8, left: 0 }}>
                <XAxis dataKey="week" tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={{ stroke: "#30363d" }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={{ stroke: "#30363d" }} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, color: "#e6edf3" }}
                  labelStyle={{ color: "#8b949e" }}
                  formatter={(value, name) => [`${value}`, name.charAt(0).toUpperCase() + name.slice(1)]}
                />
                <Line type="monotone" dataKey="delegation" stroke="#58a6ff" strokeWidth={2} dot={{ fill: "#58a6ff", r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="judgment" stroke="#3fb950" strokeWidth={2} dot={{ fill: "#3fb950", r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="feedback" stroke="#d29922" strokeWidth={2} dot={{ fill: "#d29922", r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", justifyContent: "center", gap: 24, padding: "8px 0 4px", fontSize: 12, color: "#8b949e" }}>
              <span><span style={{ color: "#58a6ff" }}>●</span> <MetricHelp label="Delegation" definition="How effectively you hand off work to the agent — giving goals vs. step-by-step instructions." target="Over 60% delegation ratio is good." /></span>
              <span><span style={{ color: "#3fb950" }}>●</span> <MetricHelp label="Judgment" definition="How well you evaluate agent output — catching issues early, not rubber-stamping." target="70+ is good, 80+ is excellent." /></span>
              <span><span style={{ color: "#d29922" }}>●</span> <MetricHelp label="Feedback" definition="How clearly you communicate requirements and corrections to the agent." target="70+ clarity score is clear communication." /></span>
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Work Style */}
      {workStyle && workStyle.summary && (
        <CollapsibleSection title="🌊 Work Style" id="overview-workstyle" defaultOpen={false}>
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
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#58a6ff" }}>{workStyle.summary.vibeRate}%</div>
                  <div style={{ fontSize: 11, color: "#8b949e" }}><MetricHelp label="Vibe Rate" definition="Percentage of sessions where you jumped straight to code (first file edit on turn 0-1) without planning." target="Not inherently good or bad — depends on task complexity. Quick fixes suit vibe coding; complex tasks benefit from planning first." /></div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#3fb950" }}>{workStyle.summary.structuredRate}%</div>
                  <div style={{ fontSize: 11, color: "#8b949e" }}><MetricHelp label="Structured Rate" definition="Percentage of sessions where you planned first (2+ planning turns before first file edit after turn 3+)." target="Higher is better for complex tasks. Structured sessions tend to have fewer redirections." /></div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#d29922" }}>{workStyle.summary.avgFirstFileTurn.toFixed(1)}</div>
                  <div style={{ fontSize: 11, color: "#8b949e" }}><MetricHelp label="Avg First File Turn" definition="Average turn number when the first file is created or edited in your sessions. Lower means you start coding sooner." target="Not a target per se — turn 0-1 is vibe coding, turn 3+ means you planned first. Match to your task complexity." /></div>
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
                {workStyle.planVsExecution.map((item) => {
                  const pct = item.completionRate != null ? item.completionRate * 100 : 0;
                  const color = pct >= 80 ? "#3fb950" : pct >= 50 ? "#d29922" : "#f85149";
                  const itemKey = item.session || item.name || `rate-${pct}`;
                  return (
                    <div key={itemKey} style={{ background: "#161b22", borderRadius: 8, padding: "10px 14px", border: "1px solid #30363d" }}>
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

        </CollapsibleSection>
      )}
    </>
  );
}
