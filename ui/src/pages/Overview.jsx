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
import { PageBanner } from "../components/PageBanner.jsx";
import { MetricHelp } from "../components/MetricHelp.jsx";
import { SuggestedNext } from "../components/SuggestedNext.jsx";

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
      <PageBanner pageId="overview">
        Your snapshot of how you lead AI — tracking your growth across the skills that matter: framing problems clearly (Create Clarity), reviewing output critically (Deliver Success), and iterating intentionally (Generate Energy).
      </PageBanner>

      {/* Hero stats */}
      <div className="stats-grid stats-grid-overview">
        {pillarTrends && (
          <div className="card" style={{ textAlign: "center", padding: "12px 16px" }}>
            <div className="card-header">Your Tier</div>
            <div style={{ fontSize: 36, margin: "4px 0" }}>{tier.emoji} {tier.name}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>{tier.description || `Score: ${overallScore}/100`}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {[...TIERS].reverse().map((t) => {
                const isCurrent = t.name === tier.name;
                const isPast = t.min < tier.min;
                return (
                  <div key={t.name} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "3px 8px",
                    borderRadius: 6, fontSize: 12,
                    background: isCurrent ? "rgba(88, 166, 255, 0.12)" : "transparent",
                    border: isCurrent ? "1px solid var(--accent)" : "1px solid transparent",
                    opacity: isPast ? 0.4 : 1,
                  }}>
                    <span style={{ width: 24 }}>{t.emoji}</span>
                    <span style={{ flex: 1, textAlign: "left", fontWeight: isCurrent ? 700 : 400, color: isCurrent ? "var(--accent)" : "var(--text)" }}>{t.name}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{t.min}+</span>
                    {isCurrent && <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>← YOU</span>}
                  </div>
                );
              })}
            </div>
            {tier.next && (
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
                {tier.next.min - overallScore} points to reach {tier.next.emoji} {tier.next.name}
              </div>
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
          <div className="card-header"><MetricHelp
            label="Avg Redirection Rate"
            definition="Percentage of your turns that correct or redirect the agent."
            target="Under 10% is smooth. 10-25% is some friction. Over 25% needs attention."
            action="Provide more context upfront — include file paths, constraints, and acceptance criteria in your first message."
          /></div>
          <div className={`stat-value ${rateColor(avgRate)}`}>
            {(avgRate * 100).toFixed(1)}%
          </div>
          <div className="stat-label">of user turns are corrections</div>
        </div>
      </div>

      {/* Charts */}
      <div style={{ background: "rgba(88, 166, 255, 0.05)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13 }}>
        <strong style={{ color: "var(--accent)" }}>💡 What is a "redirection"?</strong>
        <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
          Any turn where you correct, redirect, or have to repeat yourself to the agent. A lower redirection rate means you provided better clarity upfront. Under 10% is smooth sailing; over 25% means your prompts need more context.
        </span>
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
          <strong style={{ color: "var(--yellow)" }}>🧪 Note:</strong> Sessions with heavy testing/feedback (e.g., reviewing someone else's work, doing comprehensive QA, or providing multiple rounds of iterative feedback) will naturally show higher redirection rates. These corrections are <em>intentional feedback</em>, not poor prompting — the tool flags these as "Testing & Feedback" sessions.
        </div>
      </div>
      <div className="charts-grid">
        <div className="card">
          <div className="card-header">Redirection Rate Over Time</div>
          <TrendChart trends={trends} />
        </div>
        <div className="card">
          <div className="card-header">By Category</div>
          <CategoryBreakdown categoryTotals={aggregate.categoryTotals} />
          <div style={{ marginTop: 12, padding: "12px 16px", background: "rgba(88, 166, 255, 0.05)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text-muted)" }}>
            <strong style={{ color: "var(--text)", fontSize: 13 }}>What each category means:</strong>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              <div><strong style={{ color: "#f85149" }}>Explicit Correction</strong> — You directly told the agent it was wrong ("no", "that's not right"). <em>Reduce by providing clearer acceptance criteria upfront.</em></div>
              <div><strong style={{ color: "#58a6ff" }}>Course Change</strong> — You changed direction mid-task. <em>Some is natural as you learn; frequent changes suggest the goal wasn't clear at the start.</em></div>
              <div><strong style={{ color: "#bc8cff" }}>Repetition</strong> — You had to restate the same instruction. <em>The agent didn't "get it" — try rephrasing with examples or constraints.</em></div>
              <div><strong style={{ color: "#db6d28" }}>Rollback</strong> — You asked the agent to undo or revert changes. <em>Review agent output more carefully before approving, or add tests to catch issues early.</em></div>
              <div><strong style={{ color: "#d29922" }}>Frustration</strong> — Emotional signals or repeated failures. <em>If this is high, step back and re-scope the task into smaller, clearer chunks.</em></div>
            </div>
          </div>
        </div>
      </div>

      {/* Pillar Trends */}
      {pillarTrends && pillarTrends.weeks && pillarTrends.weeks.length > 0 && (
        <>
          <div className="page-header">
            <h2>📈 Skill Growth Over Time</h2>
            <p>Delegation, judgment, and feedback scores week-over-week</p>
          </div>
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
              <span><span style={{ color: "#58a6ff" }}>●</span> Delegation</span>
              <span><span style={{ color: "#3fb950" }}>●</span> Judgment</span>
              <span><span style={{ color: "#d29922" }}>●</span> Feedback</span>
            </div>
          </div>
        </>
      )}

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

          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-header">📖 Understanding Your Work Styles</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "0 4px" }}>
              <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
                <div style={{ borderLeft: "3px solid #3fb950", paddingLeft: 10 }}>
                  <strong style={{ color: "var(--text)" }}>📋 Structured</strong>
                  <div style={{ marginTop: 4 }}>You planned first — defined the problem, constraints, and approach before writing code. Maps to <em>Create Clarity</em>.</div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "var(--accent)" }}>🎯 <strong>Best task fit:</strong> New features, architecture changes, multi-file tasks. Plan first, then delegate.</div>
                </div>
                <div style={{ borderLeft: "3px solid #58a6ff", paddingLeft: 10 }}>
                  <strong style={{ color: "var(--text)" }}>🌊 Vibe Coding</strong>
                  <div style={{ marginTop: 4 }}>You jumped straight to code (first file edit on turn 0-1). Great for quick fixes and small tasks. Risk: more redirections on complex work.</div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "var(--accent)" }}>🎯 <strong>Best task fit:</strong> Quick fixes, typos, simple refactors. Low risk, you know the codebase well.</div>
                </div>
                <div style={{ borderLeft: "3px solid #d29922", paddingLeft: 10 }}>
                  <strong style={{ color: "var(--text)" }}>🔄 Iterative</strong>
                  <div style={{ marginTop: 4 }}>You alternated between planning and coding. Good for exploration where requirements evolve, but watch for excessive back-and-forth.</div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "var(--accent)" }}>🎯 <strong>Best task fit:</strong> Debugging, exploration, learning new APIs. Back-and-forth is expected.</div>
                </div>
                <div style={{ borderLeft: "3px solid #8b949e", paddingLeft: 10 }}>
                  <strong style={{ color: "var(--text)" }}>🔀 Mixed</strong>
                  <div style={{ marginTop: 4 }}>A blend of styles within a session. This is natural — the key is matching your style to the task complexity.</div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "var(--accent)" }}>🎯 <strong>Best task fit:</strong> Tasks that evolve. Fine if intentional, but frequent mixing may mean unclear goals upfront.</div>
                </div>
              </div>
              <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(88, 166, 255, 0.06)", borderRadius: 6, fontSize: 12 }}>
                💡 <strong>Key insight:</strong> Match your style to your task. Structured for complex, vibe for simple. Structured sessions have the lowest redirection rates — planning first saves turns and frustration.
              </div>
            </div>
          </div>
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

      <SuggestedNext
        to="/coaching"
        icon="🎓"
        label="Coaching"
        description="Detailed analysis of your delegation, judgment, and feedback scores"
      />
    </>
  );
}
