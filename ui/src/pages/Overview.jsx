import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { fetchSessions, fetchTrends, fetchInsights, fetchPillarTrends, fetchWorkStyle, fetchTokenSummary, fetchVSCodeSummary } from "../api.js";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { TrendChart } from "../components/TrendChart.jsx";
import { CategoryBreakdown } from "../components/CategoryBreakdown.jsx";
import { InsightCard } from "../components/InsightCard.jsx";
import { TimeframeSelector } from "../components/TimeframeSelector.jsx";
import { CollapsibleSection } from "../components/CollapsibleSection.jsx";
import { SinceLastVisit } from "../components/SinceLastVisit.jsx";
import { rateColor } from "../components/ScoreBadge.jsx";
import { SkeletonCard } from "../components/SkeletonCard.jsx";
import { useRefresh } from "../App.jsx";
import { useTimeframe } from "../TimeframeContext.jsx";
import { getTier } from "@shared/tiers.mjs";
import { PageBanner } from "../components/PageBanner.jsx";
import { MetricHelp } from "../components/MetricHelp.jsx";
import { SuggestedNext } from "../components/SuggestedNext.jsx";
import { EmptyState, MIN_SESSIONS_FOR_TRENDS } from "../components/EmptyState.jsx";

function formatTokens(n) {
  if (n == null) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n) {
  if (n == null || n === 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

function formatModelName(model) {
  if (!model || model === "unknown") return "Unknown";
  if (model === "auto") return "Auto";
  return model;
}

const PILLAR_DISPLAY = {
  delegation: "Work Design",
  judgment: "Quality Control",
  specification: "Intent",
  efficiency: "Evaluation",
};

function useOverviewResource(loader, deps) {
  const [state, setState] = useState({
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setState({ data: null, error: null, loading: true });

    Promise.resolve()
      .then(() => loader(controller.signal))
      .then((data) => {
        if (!cancelled) {
          setState({ data, error: null, loading: false });
        }
      })
      .catch((err) => {
        if (!cancelled && err.name !== "AbortError") {
          setState({ data: null, error: err.message || "Failed to load section.", loading: false });
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, deps);

  return state;
}

function OverviewSkeletonCard({ lines = 3, className = "" }) {
  return (
    <div className={`card ${className}`.trim()}>
      <SkeletonCard lines={lines} />
    </div>
  );
}

function OverviewStatSkeletons({ count }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={`overview-stat-skeleton-${index}`} className="card overview-stat-card" style={{ padding: "12px 8px" }}>
      <SkeletonCard variant="stat" />
    </div>
  ));
}

function OverviewStatCard({ label, value, valueClassName, children }) {
  return (
    <div className="card overview-stat-card" style={{ textAlign: "center", padding: "12px 8px" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
        {label}
      </div>
      <div className={valueClassName} style={{ fontSize: 24, fontWeight: 600 }}>
        {value}
      </div>
      {children}
    </div>
  );
}

function OverviewInlineNotice({ children, tone = "neutral" }) {
  const borderColor = tone === "error" ? "var(--red, #f85149)" : "var(--border)";
  return (
    <div
      className="card"
      style={{
        marginBottom: 16,
        borderLeft: `3px solid ${borderColor}`,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

export default function Overview() {
  const { key: refreshKey } = useRefresh();
  const { timeframe, setTimeframe } = useTimeframe();
  const sessionsState = useOverviewResource(
    (signal) => fetchSessions(timeframe, undefined, { signal }),
    [timeframe, refreshKey]
  );
  const trendsState = useOverviewResource(
    (signal) => fetchTrends(timeframe, undefined, { signal }),
    [timeframe, refreshKey]
  );
  const insightsState = useOverviewResource(
    (signal) => fetchInsights(timeframe, undefined, { signal }),
    [timeframe, refreshKey]
  );
  const pillarTrendsState = useOverviewResource(
    (signal) => fetchPillarTrends(timeframe, undefined, { signal }),
    [timeframe, refreshKey]
  );
  const workStyleState = useOverviewResource(
    (signal) => fetchWorkStyle(timeframe, undefined, { signal }),
    [timeframe, refreshKey]
  );
  const tokenState = useOverviewResource(
    (signal) => fetchTokenSummary(timeframe, undefined, { signal }),
    [timeframe, refreshKey]
  );
  const vscodeState = useOverviewResource(
    (signal) => fetchVSCodeSummary({ signal }),
    [timeframe, refreshKey]
  );

  useEffect(() => { localStorage.setItem("overview-visited", "true"); }, []);

  const data = sessionsState.data;
  const trends = trendsState.data?.trends || null;
  const insights = insightsState.data?.insights || null;
  const pillarTrends = pillarTrendsState.data;
  const workStyle = workStyleState.data;
  const tokenData = tokenState.data;
  const vscodeSummary = vscodeState.data;
  const sectionErrors = [
    sessionsState.error && "session summary",
    trendsState.error && "trend charts",
    insightsState.error && "insights",
    pillarTrendsState.error && "skill growth",
    workStyleState.error && "work style",
    tokenState.error && "token usage",
    vscodeState.error && "VS Code summary",
  ].filter(Boolean);
  const primaryErrors = [
    sessionsState.error,
    trendsState.error,
    insightsState.error,
    pillarTrendsState.error,
  ].filter(Boolean);
  const aggregate = data?.aggregate || null;
  const sessionCount = aggregate?.sessionsAnalyzed || 0;
  const avgRate = aggregate?.avgRedirectionRate || 0;
  const topModel = tokenData?.byModel?.find((model) => model.model !== "unknown") || tokenData?.byModel?.[0] || null;

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
        Snapshot into how you're using Copilot CLI — sessions, trends, work styles, and skill insights.
      </PageBanner>

      {primaryErrors.length > 0 && (
        <OverviewInlineNotice tone="error">
          Some sections are still unavailable right now: {sectionErrors.join(", ")}.
          {sessionsState.error?.includes("session database") || sessionsState.error?.includes("HTTP 500")
            ? " Make sure the Copilot Insights server is running and your session database is available."
            : ""}
        </OverviewInlineNotice>
      )}

      {vscodeSummary?.totalSessions > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "3px solid var(--purple)" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
            VS Code Copilot chat history is available separately for {vscodeSummary.totalSessions} workspace{vscodeSummary.totalSessions === 1 ? "" : "s"}.
            Current scores in Copilot Insights reflect CLI sessions only.
            {" "}
            <Link to="/vscode" style={{ color: "var(--accent)" }}>
              View VS Code sessions →
            </Link>
          </div>
        </div>
      )}
      {vscodeState.error && (
        <OverviewInlineNotice tone="error">
          VS Code session summary couldn&apos;t load right now.
        </OverviewInlineNotice>
      )}

      {/* Since Last Visit — shown for returning users */}
      <SinceLastVisit refreshKey={refreshKey} />

      {/* Empty / low-session state */}
      {aggregate && sessionCount < MIN_SESSIONS_FOR_TRENDS && (
        <EmptyState sessionCount={sessionCount} feature="trend analysis and coaching" />
      )}

      {/* ── THE 5-MINUTE WOW ──────────────────────────────────────── */}

      {/* Tier + Top Insight — side by side */}
      <div className="hero-row">
        {/* Tier Hero — your level at a glance */}
        {pillarTrendsState.loading ? (
          <OverviewSkeletonCard lines={4} className="overview-hero-card" />
        ) : pillarTrends ? (
          <div className="tier-hero-card card overview-hero-card">
            <div className="tier-hero-content">
              <div style={{ fontSize: 36, lineHeight: 1 }}>{tier.emoji}</div>
              <div className="tier-hero-info">
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  <MetricHelp
                    label={tier.name}
                    definition="Your overall skill tier, derived from your combined Intent, Work Design, Quality Control, and Evaluation pillar scores."
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
        ) : pillarTrendsState.error ? (
          <div className="card overview-hero-card">
            <div className="card-header">📈 Skill Growth</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
              Skill growth is unavailable right now.
            </div>
          </div>
        ) : (
          <div className="card overview-hero-card">
            <div className="card-header">📈 Skill Growth</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
              Tier data will appear once enough sessions are available.
            </div>
          </div>
        )}

        {/* Top Insight — the ONE thing that makes you go "oh, I do that" */}
        {insightsState.loading ? (
          <OverviewSkeletonCard lines={4} className="overview-hero-card" />
        ) : insights && insights.length > 0 ? (
          <div className="top-insight-card overview-hero-card">
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
        ) : insightsState.error ? (
          <div className="top-insight-card overview-hero-card">
            <div className="top-insight-header">
              💡 <strong>Insights unavailable</strong>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Insights are unavailable right now.
            </div>
          </div>
        ) : (
          <div className="top-insight-card overview-hero-card">
            <div className="top-insight-header">
              💡 <strong>No insights yet</strong>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Complete a few more sessions to unlock top coaching insights.
            </div>
          </div>
        )}
      </div>

      {/* Quick Stats — just the headline numbers */}
      <div className="stats-row overview-stats-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginBottom: 16 }}>
        {sessionsState.loading ? (
          <OverviewStatSkeletons count={3} />
        ) : aggregate ? (
          <>
            <OverviewStatCard label="Sessions" value={aggregate.sessionsAnalyzed} />
            <OverviewStatCard
              label={
                <MetricHelp
                  label="Redirections"
                  definition="Total turns where you corrected, redirected, or re-explained something to the agent. Each one means the agent didn't do what you wanted on the first try."
                  target="Fewer is better — each redirection is a chance to improve your opening prompt."
                />
              }
              value={aggregate.totalRedirections}
            />
            <OverviewStatCard
              label={
                <MetricHelp
                  label="Avg Rate"
                  definition="Percentage of your turns that correct or redirect the agent."
                  target="Under 10% is smooth. 10-25% is some friction. Over 25% needs attention."
                />
              }
              value={`${(avgRate * 100).toFixed(1)}%`}
              valueClassName={rateColor(avgRate)}
            />
          </>
        ) : (
          <>
            <OverviewStatCard label="Sessions" value="—" />
            <OverviewStatCard label="Redirections" value="—" />
            <OverviewStatCard label="Avg Rate" value="—" />
          </>
        )}
        {tokenState.loading ? (
          <OverviewStatSkeletons count={2} />
        ) : tokenData && tokenData.sessionsAnalyzed > 0 ? (
          <>
            <OverviewStatCard
              label={
                <MetricHelp
                  label="Est. Tokens"
                  definition="Estimated total token usage across all sessions, calculated from message text length (~4 chars per token)."
                  target="Lower is more efficient — reduce redirections to save tokens."
                />
              }
              value={formatTokens(tokenData.totals.total)}
            />
            <OverviewStatCard
              label={
                <MetricHelp
                  label="Est. Cost"
                  definition="Estimated cost based on token usage and model pricing. This is an approximation — actual costs depend on your plan and provider."
                  target="Optimize by reducing redirections and choosing appropriate models for each task."
                />
              }
              value={formatCost(tokenData.estimatedCost)}
            />
          </>
        ) : (
          <>
            <OverviewStatCard label="Est. Tokens" value="—" />
            <OverviewStatCard label="Est. Cost" value="—" />
          </>
        )}
      </div>

      {tokenState.loading && <OverviewSkeletonCard lines={3} />}
      {tokenState.error && (
        <OverviewInlineNotice tone="error">Token usage is unavailable right now.</OverviewInlineNotice>
      )}
      {tokenData && tokenData.sessionsAnalyzed > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span>💰 Token Usage</span>
            <Link to="/tokens" style={{ color: "var(--accent)", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>
              View Details →
            </Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Est. Cost</div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>{formatCost(tokenData.estimatedCost)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Total Tokens</div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>{formatTokens(tokenData.totals.total)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>Top Model</div>
              <div style={{ fontSize: 24, fontWeight: 600, overflowWrap: "anywhere" }}>{formatModelName(topModel?.model)}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                {topModel ? `${formatTokens(topModel.total)} tokens` : "No model data"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* What to do next — clear CTAs */}
      <div className="card next-steps-card" style={{ padding: "12px 16px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🚀 What to do next</div>
        <div className="next-steps-grid">
          <SuggestedNext
            to="/skills"
            icon="🎯"
            label="Skill Building"
            description="Intent, Work Design, Quality Control & Evaluation scores"
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
          <SuggestedNext
            to="/tokens"
            icon="💰"
            label="Token Usage"
            description="See your token spend and optimization tips"
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
            {trendsState.loading ? <SkeletonCard lines={4} /> : trends ? <TrendChart trends={trends} /> : <p style={{ color: "var(--text-muted)" }}>Trend data is unavailable right now.</p>}
          </div>
          <div className="card">
            <div className="card-header">By Category</div>
            {sessionsState.loading ? <SkeletonCard lines={4} /> : aggregate ? <CategoryBreakdown categoryTotals={aggregate.categoryTotals} /> : <p style={{ color: "var(--text-muted)" }}>Category breakdown is unavailable right now.</p>}
          </div>
        </div>
      </CollapsibleSection>

      {/* Pillar Trends */}
      {(pillarTrendsState.loading || (pillarTrends && pillarTrends.weeks && pillarTrends.weeks.length > 0) || pillarTrendsState.error) && (
        <CollapsibleSection title="📈 Skill Growth Over Time" id="overview-pillars" defaultOpen={false}>
          <div className="card">
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span>Pillar Scores by Week</span>
              {pillarTrends?.trend && (
                <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
                  {["delegation", "judgment", "specification", "efficiency"].map((pillar) => {
                    const dir = pillarTrends.trend[pillar];
                    const badge = dir === "improving" ? "⬆️ Improving" : dir === "declining" ? "⬇️ Declining" : "➡️ Stable";
                    const color = dir === "improving" ? "#3fb950" : dir === "declining" ? "#f85149" : "#8b949e";
                    return (
                      <span key={pillar} style={{ color, fontWeight: 500 }}>
                        {PILLAR_DISPLAY[pillar] || pillar}: {badge}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            {pillarTrendsState.loading ? (
              <SkeletonCard lines={4} />
            ) : pillarTrends ? (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={pillarTrends.weeks} margin={{ top: 16, right: 24, bottom: 8, left: 0 }}>
                    <XAxis dataKey="week" tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}
                      labelStyle={{ color: "var(--text-muted)" }}
                      formatter={(value, name) => [`${value}`, PILLAR_DISPLAY[name] || name]}
                    />
                    <Line type="monotone" dataKey="delegation" stroke="#58a6ff" strokeWidth={2} dot={{ fill: "#58a6ff", r: 4 }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="judgment" stroke="#3fb950" strokeWidth={2} dot={{ fill: "#3fb950", r: 4 }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="specification" stroke="#d29922" strokeWidth={2} dot={{ fill: "#d29922", r: 4 }} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="efficiency" stroke="#bc8cff" strokeWidth={2} dot={{ fill: "#bc8cff", r: 4 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", justifyContent: "center", gap: 24, padding: "8px 0 4px", fontSize: 12, color: "var(--text-muted)", flexWrap: "wrap" }}>
                  <span><span style={{ color: "#58a6ff" }}>●</span> <MetricHelp label="Work Design" definition="How you divide work between yourself and the agent — giving goals vs. step-by-step instructions." target="Over 60% delegation ratio is good." /></span>
                  <span><span style={{ color: "#3fb950" }}>●</span> <MetricHelp label="Quality Control" definition="How well you evaluate agent output — catching issues early, not rubber-stamping." target="70+ is good, 80+ is excellent." /></span>
                  <span><span style={{ color: "#d29922" }}>●</span> <MetricHelp label="Intent" definition="How clearly you set intent — defining the desired outcome and quality bar upfront." target="70+ clarity score is clear communication." /></span>
                  <span><span style={{ color: "#bc8cff" }}>●</span> <MetricHelp label="Evaluation" definition="Building evaluation discipline — productive turns, session completion, and token efficiency." target="70+ is good." /></span>
                </div>
              </>
            ) : (
              <p style={{ color: "var(--text-muted)" }}>Skill growth is unavailable right now.</p>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Work Style */}
      {(workStyleState.loading || workStyle?.summary || workStyleState.error) && (
        <CollapsibleSection title="🌊 Work Style" id="overview-workstyle" defaultOpen={false}>
          {workStyleState.loading ? (
            <div className="charts-grid">
              <OverviewSkeletonCard lines={4} />
              <OverviewSkeletonCard lines={4} />
            </div>
          ) : workStyle?.summary ? (
            <>
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
                              <span style={{ color: "var(--text)" }}>{label}</span>
                              <span style={{ color: "var(--text-muted)" }}>{count} session{count !== 1 ? "s" : ""} ({pct.toFixed(0)}%)</span>
                            </div>
                            <div style={{ height: 8, borderRadius: 4, background: "var(--bg-hover)", overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width 0.3s" }} />
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                  <div style={{ textAlign: "center", padding: "8px 0", fontSize: 14 }}>
                    <span style={{ color: "var(--text)" }}>
                      Dominant style: {workStyle.summary.dominantEmoji} {workStyle.summary.dominantStyle}
                    </span>
                  </div>
                </div>
                <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="card-header">Session Stats</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "8px 0" }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>{workStyle.summary.total}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Total Sessions</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "#58a6ff" }}>{workStyle.summary.vibeRate}%</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}><MetricHelp label="Vibe Rate" definition="Percentage of sessions where you jumped straight to code (first file edit on turn 0-1) without planning." target="Not inherently good or bad — depends on task complexity. Quick fixes suit vibe coding; complex tasks benefit from planning first." /></div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "#3fb950" }}>{workStyle.summary.structuredRate}%</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}><MetricHelp label="Structured Rate" definition="Percentage of sessions where you planned first (2+ planning turns before first file edit after turn 3+)." target="Higher is better for complex tasks. Structured sessions tend to have fewer redirections." /></div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: "#d29922" }}>{workStyle.summary.avgFirstFileTurn.toFixed(1)}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}><MetricHelp label="Avg First File Turn" definition="Average turn number when the first file is created or edited in your sessions. Lower means you start coding sooner." target="Not a target per se — turn 0-1 is vibe coding, turn 3+ means you planned first. Match to your task complexity." /></div>
                    </div>
                  </div>
                  {workStyle.coachingTip && (
                    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "var(--text)" }}>
                      💡 <strong>Coaching Tip:</strong> {workStyle.coachingTip}
                    </div>
                  )}
                </div>
              </div>

              {/* Plan vs Execution */}
              {workStyle.planExecution?.sessions?.length > 0 && (
                <div className="card" style={{ marginTop: 16 }}>
                  <div className="card-header">Plan Completion Rates</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
                    {workStyle.planExecution.insight}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, padding: "12px 0" }}>
                    {workStyle.planExecution.sessions.map((item, index) => {
                      const pct = item.completionRate ?? 0;
                      const color = pct >= 80 ? "#3fb950" : pct >= 50 ? "#d29922" : "#f85149";
                      const itemKey = item.sessionId || item.intentPreview || `rate-${index}`;
                      return (
                        <div key={itemKey} style={{ background: "var(--bg)", borderRadius: 8, padding: "10px 14px", border: "1px solid var(--border)" }}>
                          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {item.intentPreview || `Session ${index + 1}`}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ height: 6, flex: 1, borderRadius: 3, background: "var(--bg-hover)", overflow: "hidden" }}>
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
          ) : (
            <p style={{ color: "var(--text-muted)" }}>Work style is unavailable right now.</p>
          )}

        </CollapsibleSection>
      )}
    </>
  );
}
