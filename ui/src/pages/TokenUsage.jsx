import { useState, useEffect } from "react";
import {
  fetchTokenPricing,
  fetchTokenSummary,
  fetchTokensByModel,
  fetchTokenTrends,
  fetchTokenCorrelations,
  fetchTokenBudget,
  fetchTokenTips,
} from "../api.js";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, PieChart, Pie, Legend,
} from "recharts";
import { useRefresh } from "../App.jsx";
import { useTimeframe } from "../TimeframeContext.jsx";
import { TimeframeSelector } from "../components/TimeframeSelector.jsx";
import { PageBanner } from "../components/PageBanner.jsx";
import { CollapsibleSection } from "../components/CollapsibleSection.jsx";
import { MetricHelp } from "../components/MetricHelp.jsx";
import { SkeletonGrid } from "../components/SkeletonCard.jsx";
import { EmptyState } from "../components/EmptyState.jsx";
import { TabBar, TabPanel } from "../components/TabBar.jsx";

const TT_STYLE = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
};

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

function formatTokens(n) {
  if (n == null) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n) {
  if (n == null || n === 0) return "$0.00";
  if (n < 0.01) return `<$0.01`;
  return `$${n.toFixed(2)}`;
}

export default function TokenUsage() {
  const { key: refreshKey } = useRefresh();
  const { timeframe, setTimeframe } = useTimeframe();
  const [summary, setSummary] = useState(null);
  const [byModel, setByModel] = useState(null);
  const [trends, setTrends] = useState(null);
  const [correlations, setCorrelations] = useState(null);
  const [budget, setBudget] = useState(null);
  const [tips, setTips] = useState(null);
  const [livePricing, setLivePricing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");

  // Fetch live pricing once on mount (not per timeframe change)
  useEffect(() => {
    fetchTokenPricing().then(setLivePricing).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchTokenSummary(timeframe),
      fetchTokensByModel(timeframe),
      fetchTokenTrends(timeframe),
      fetchTokenCorrelations(timeframe),
      fetchTokenBudget(timeframe),
      fetchTokenTips(timeframe),
    ])
      .then(([s, m, t, c, b, tp]) => {
        if (cancelled) return;
        setSummary(s);
        setByModel(m);
        setTrends(t);
        setCorrelations(c);
        setBudget(b);
        setTips(tp);
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [timeframe, refreshKey]);

  if (loading) return (
    <>
      <div className="page-header"><h1>💰 Token Usage</h1><TimeframeSelector value={timeframe} onChange={setTimeframe} /></div>
      <SkeletonGrid count={6} />
    </>
  );
  if (error) return <div className="error-box">{error}</div>;
  if (!summary || summary.sessionsAnalyzed === 0) return (
    <>
      <div className="page-header"><h1>💰 Token Usage</h1><TimeframeSelector value={timeframe} onChange={setTimeframe} /></div>
      <EmptyState message="No session data found for this timeframe." />
    </>
  );

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "models", label: "Models" },
    { id: "correlations", label: "Cost Insights" },
    { id: "budget", label: "Budget" },
    { id: "tips", label: "Optimization" },
  ];

  return (
    <>
      <PageBanner pageId="token-usage">
        Understand your token consumption, model costs, and optimization opportunities.
      </PageBanner>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div />
        <TimeframeSelector value={timeframe} onChange={setTimeframe} />
      </div>

      {summary.isEstimated ? (
        <div className="info-banner" style={{ margin: "0.75rem 0", padding: "0.5rem 1rem", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: "0.85rem", color: "var(--text-muted)" }}>
          ℹ️ Token counts are <strong>estimated</strong> from message text (~4 chars/token). Actual usage may vary.
        </div>
      ) : (
        <div className="info-banner" style={{ margin: "0.75rem 0", padding: "0.5rem 1rem", background: "rgba(63, 185, 80, 0.08)", border: "1px solid rgba(63, 185, 80, 0.3)", borderRadius: 8, fontSize: "0.85rem", color: "var(--text-muted)" }}>
          ✅ Using <strong>real token data</strong> from Copilot session files where available. Some sessions may fall back to estimates.
        </div>
      )}
      <div style={{ margin: "0 0 0.75rem", padding: "0.5rem 1rem", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: "0.8rem", color: "var(--text-muted)" }}>
        💰 Cost estimates use <a href="https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>GitHub Copilot per-token pricing</a> (1 AI credit = $0.01). Your actual spend depends on your plan&apos;s included allowance.
      </div>

      {/* Hero Stats */}
      <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <StatCard label="Total Tokens" value={formatTokens(summary.totals.total)} sub={`${formatTokens(summary.totals.input)} in / ${formatTokens(summary.totals.output)} out`} />
        <StatCard label="Est. Cost" value={formatCost(summary.estimatedCost)} sub={summary.costBreakdown ? `${formatCost(summary.costBreakdown.input)} input / ${formatCost(summary.costBreakdown.output)} output` : `${formatCost(summary.avgCostPerSession)} / session avg`} />
        <StatCard label="Sessions" value={summary.sessionsAnalyzed} sub={`${formatTokens(summary.avgTokensPerSession)} tokens / session`} />
        <StatCard label="Models Used" value={summary.byModel.filter(m => m.model !== "unknown").length || summary.byModel.length} sub={summary.byModel.filter(m => m.model !== "unknown").map((m) => m.model === "auto" ? "auto" : m.model).join(", ") || "no model data"} />
      </div>

      <TabBar tabs={tabs} activeTab={tab} onTabChange={setTab} />

      <TabPanel id="overview" activeTab={tab}>
        <OverviewTab trends={trends} summary={summary} />
      </TabPanel>

      <TabPanel id="models" activeTab={tab}>
        <ModelsTab data={byModel} />
      </TabPanel>

      <TabPanel id="correlations" activeTab={tab}>
        <CorrelationsTab data={correlations} />
      </TabPanel>

      <TabPanel id="budget" activeTab={tab}>
        <BudgetTab data={budget} />
      </TabPanel>

      <TabPanel id="tips" activeTab={tab}>
        <TipsTab data={tips} livePricing={livePricing} />
      </TabPanel>
    </>
  );
}

// ── Stat Card ────────────────────────────────────────────────

function StatCard({ label, value, sub }) {
  return (
    <div className="card" style={{ padding: "1rem", textAlign: "center" }}>
      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>}
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────

function OverviewTab({ trends, summary }) {
  if (!trends || !trends.weeks || trends.weeks.length === 0) {
    return <EmptyState message="Not enough data for token trends yet." />;
  }

  const chartData = trends.weeks.map((w) => ({
    week: w.week.replace(/^\d{4}-/, ""),
    input: w.input,
    output: w.output,
    cost: w.cost,
    sessions: w.sessions,
  }));

  const trendLabel = { increasing: "📈 Increasing", decreasing: "📉 Decreasing", stable: "➡️ Stable" }[trends.trend] || "➡️ Stable";

  return (
    <>
      <CollapsibleSection title={`Weekly Token Trends — ${trendLabel}`} defaultOpen>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData}>
            <XAxis dataKey="week" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={formatTokens} tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={TT_STYLE} formatter={(v) => formatTokens(v)} />
            <Bar dataKey="input" name="Input" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} />
            <Bar dataKey="output" name="Output" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CollapsibleSection>

      <CollapsibleSection title="Weekly Cost Trend" defaultOpen>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData}>
            <XAxis dataKey="week" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(v) => formatCost(v)} tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={TT_STYLE} formatter={(v) => formatCost(v)} />
            <Line type="monotone" dataKey="cost" name="Est. Cost" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </CollapsibleSection>

      {/* Top sessions by token usage */}
      {summary.sessions && summary.sessions.length > 0 && (
        <CollapsibleSection title="Top Sessions by Token Usage">
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Tokens</th>
                  <th>Cost</th>
                  <th>Turns</th>
                </tr>
              </thead>
              <tbody>
                {summary.sessions.slice(0, 10).map((s) => (
                  <tr key={s.sessionId}>
                    <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <a href={`/sessions/${s.sessionId}`}>{s.summary || s.branch || s.sessionId.slice(0, 8)}</a>
                    </td>
                    <td>{formatTokens(s.tokens.total)}</td>
                    <td>{formatCost(s.estimatedCost)}</td>
                    <td>{s.turnCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>
      )}
    </>
  );
}

// ── Models Tab ──────────────────────────────────────────────

function ModelsTab({ data }) {
  if (!data || !data.models || data.models.length === 0) {
    return <EmptyState message="No model data available." />;
  }

  const modelLabel = (name) => {
    if (name === "unknown") return "Unknown (no model data)";
    if (name === "auto") return "Auto (Copilot default)";
    return name;
  };

  const chartData = data.models.map((m) => ({
    name: modelLabel(m.model),
    tokens: m.total,
    cost: m.cost,
    sessions: m.sessions,
  }));

  return (
    <>
      <CollapsibleSection title="Tokens by Model" defaultOpen>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} layout="vertical">
            <XAxis type="number" tickFormatter={formatTokens} tick={{ fontSize: 12 }} />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={TT_STYLE} formatter={(v) => formatTokens(v)} />
            <Bar dataKey="tokens" name="Total Tokens" fill="#6366f1" radius={[0, 4, 4, 0]}>
              {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CollapsibleSection>

      <CollapsibleSection title="Model Comparison" defaultOpen>
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Sessions</th>
                <th>Total Tokens</th>
                <th>Avg / Session</th>
                <th>Est. Cost</th>
                <th>Cache Hit</th>
              </tr>
            </thead>
            <tbody>
              {data.models.map((m) => (
                <tr key={m.model}>
                  <td><strong>{modelLabel(m.model)}</strong></td>
                  <td>{m.sessions}</td>
                  <td>{formatTokens(m.total)}</td>
                  <td>{formatTokens(m.avgTokensPerSession)}</td>
                  <td>{formatCost(m.cost)}</td>
                  <td>{m.cacheHitRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
    </>
  );
}

// ── Efficiency Tab ──────────────────────────────────────────

// ── Correlations Tab ────────────────────────────────────────

function CorrelationsTab({ data }) {
  if (!data) return <EmptyState message="No correlation data available." />;

  const { byWorkStyle } = data;
  const styleChartData = byWorkStyle?.styles?.filter((s) => s.sessions > 0).map((s) => ({
    name: `${s.emoji} ${s.style}`,
    avgTokens: s.avgTokensPerSession,
    avgCost: s.avgCostPerSession,
    totalCost: s.totalCost,
    totalTokens: s.totalTokens,
    sessions: s.sessions,
    avgRedirections: s.avgRedirectionsPerSession,
  })) || [];

  const classifiedSessions = styleChartData.reduce((sum, s) => sum + s.sessions, 0);
  const classifiedCost = styleChartData.reduce((sum, s) => sum + s.totalCost, 0);
  const classifiedTokens = styleChartData.reduce((sum, s) => sum + s.totalTokens, 0);

  return (
    <>
      {byWorkStyle?.insight && (
        <div className="card" style={{ padding: "1rem", marginBottom: "1rem", background: "var(--bg-card)", borderLeft: "4px solid #6366f1" }}>
          <strong>💡 Insight:</strong> {byWorkStyle.insight}
        </div>
      )}

      {styleChartData.length > 0 && (
        <CollapsibleSection title="Avg Tokens per Session by Work Style" defaultOpen>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={styleChartData}>
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={formatTokens} tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={TT_STYLE} formatter={(v, name) => name === "avgCost" ? formatCost(v) : formatTokens(v)} />
              <Bar dataKey="avgTokens" name="Avg Tokens" fill="#6366f1" radius={[4, 4, 0, 0]}>
                {styleChartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CollapsibleSection>
      )}

      {styleChartData.length > 0 && (
        <CollapsibleSection title="Work Style Cost Comparison" defaultOpen>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Style</th>
                  <th>Sessions</th>
                  <th>Total Tokens</th>
                  <th>Total Cost</th>
                  <th>Avg Cost</th>
                  <th>Avg Redirections</th>
                </tr>
              </thead>
              <tbody>
                {styleChartData.map((s) => (
                  <tr key={s.name}>
                    <td><strong>{s.name}</strong></td>
                    <td>{s.sessions}</td>
                    <td>{formatTokens(s.totalTokens)}</td>
                    <td>{formatCost(s.totalCost)}</td>
                    <td>{formatCost(s.avgCost)}</td>
                    <td>{s.avgRedirections}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 600 }}>
                  <td>Total (classified)</td>
                  <td>{classifiedSessions}</td>
                  <td>{formatTokens(classifiedTokens)}</td>
                  <td>{formatCost(classifiedCost)}</td>
                  <td>{formatCost(classifiedSessions > 0 ? classifiedCost / classifiedSessions : 0)}</td>
                  <td>—</td>
                </tr>
              </tbody>
            </table>
          </div>
          {classifiedSessions < (data.totalSessions || 0) && (
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
              ℹ️ {(data.totalSessions || 0) - classifiedSessions} sessions with &lt;2 turns were excluded from work style classification. They account for the remaining cost difference from the Overview total.
            </div>
          )}
        </CollapsibleSection>
      )}
    </>
  );
}

// ── Budget Tab ──────────────────────────────────────────────

function BudgetTab({ data }) {
  if (!data || !data.hasData) return <EmptyState message="Not enough data for budget projections. Use Copilot for a few more sessions." />;

  const trendIcon = { increasing: "📈", decreasing: "📉", stable: "➡️" }[data.trend] || "➡️";

  return (
    <>
      <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
        <StatCard label="Projected Monthly Cost" value={formatCost(data.projectedMonthlyCost)} sub={`${formatTokens(data.projectedMonthlyTokens)} tokens`} />
        <StatCard label="Avg Weekly Cost" value={formatCost(data.avgWeeklyCost)} sub={`${formatTokens(data.avgWeeklyTokens)} tokens`} />
        <StatCard label="Avg Weekly Sessions" value={data.avgWeeklySessions} sub="sessions / week" />
        <StatCard label="Trend" value={`${trendIcon} ${data.trend}`} sub={`based on last ${data.recentWeeks.length} weeks`} />
      </div>

      {data.alerts && data.alerts.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          {data.alerts.map((alert, i) => (
            <div key={i} className="card" style={{
              padding: "0.75rem 1rem", marginBottom: "0.5rem",
              borderLeft: `4px solid ${alert.level === "warning" ? "#f59e0b" : "#6366f1"}`,
            }}>
              {alert.level === "warning" ? "⚠️" : "ℹ️"} {alert.message}
            </div>
          ))}
        </div>
      )}

      {data.recentWeeks && data.recentWeeks.length > 0 && (
        <CollapsibleSection title="Recent Weekly Breakdown" defaultOpen>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr><th>Week</th><th>Sessions</th><th>Tokens</th><th>Est. Cost</th></tr>
              </thead>
              <tbody>
                {data.recentWeeks.map((w) => (
                  <tr key={w.week}>
                    <td>{w.week}</td>
                    <td>{w.sessions}</td>
                    <td>{formatTokens(w.total)}</td>
                    <td>{formatCost(w.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleSection>
      )}
    </>
  );
}

// ── Tips Tab ────────────────────────────────────────────────

function TipsTab({ data, livePricing }) {
  const hasTips = data?.tips?.length > 0;
  const hasRecs = data?.modelRecommendations?.length > 0;
  const hasGuide = data?.modelGuide?.length > 0 || (livePricing?.models && Object.keys(livePricing.models).length > 0);
  const complexity = data?.sessionComplexity;

  if (!hasTips && !hasRecs && !hasGuide) {
    return (
      <div className="card" style={{ padding: "1.5rem", textAlign: "center" }}>
        <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>✨</div>
        <div><strong>No optimization tips right now!</strong></div>
        <div style={{ color: "var(--text-muted)", marginTop: "0.25rem" }}>
          Your token usage patterns look efficient. Keep up the great work!
        </div>
      </div>
    );
  }

  const tierColors = { powerful: "#ef4444", versatile: "#6366f1", lightweight: "#22c55e" };
  const tierLabels = { powerful: "Powerful", versatile: "Versatile", lightweight: "Lightweight" };

  return (
    <>
      {data?.summary && (
        <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
          <StatCard label="Waste Rate" value={`${data.summary.wasteRate}%`} sub="tokens on redirections" />
          <StatCard label="Productive %" value={`${data.summary.productiveRatio}%`} sub="of turns are productive" />
          <StatCard label="Token ROI" value={data.summary.tokenROI} sub="file ops / 1K tokens" />
        </div>
      )}

      {/* Session complexity breakdown */}
      {complexity && complexity.total > 0 && (
        <CollapsibleSection title="Your Session Complexity" defaultOpen>
          <div style={{ display: "flex", gap: "1rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            {[
              { label: "Simple", count: complexity.simple, desc: "≤3 turns, ≤2 files", color: "#22c55e", rec: "Lightweight models" },
              { label: "Moderate", count: complexity.moderate, desc: "4-10 turns, 3-8 files", color: "#6366f1", rec: "Versatile models" },
              { label: "Complex", count: complexity.complex, desc: "10+ turns, 8+ files", color: "#ef4444", rec: "Powerful models" },
            ].map((c) => (
              <div key={c.label} className="card" style={{ flex: "1 1 140px", padding: "0.75rem", textAlign: "center", borderTop: `3px solid ${c.color}` }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{c.count}</div>
                <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{c.label}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{c.desc}</div>
                <div style={{ fontSize: "0.75rem", color: c.color, marginTop: 4 }}>→ {c.rec}</div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Model recommendations based on usage */}
      {hasRecs && (
        <CollapsibleSection title="🤖 Model Recommendations" defaultOpen>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {data.modelRecommendations.map((rec) => (
              <div key={rec.id} className="card" style={{ padding: "1rem", borderLeft: `4px solid ${rec.id.includes("lightweight") ? "#22c55e" : rec.id.includes("powerful") ? "#ef4444" : "#6366f1"}` }}>
                <div style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                  {rec.icon} {rec.title}
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                  {rec.detail}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: rec.potentialSavings ? "0.25rem" : 0 }}>
                  {rec.models.map((m) => (
                    <span key={m} style={{ fontSize: "0.8rem", padding: "2px 8px", borderRadius: 12, background: "var(--bg-card)", border: "1px solid var(--border)" }}>{m}</span>
                  ))}
                </div>
                {rec.potentialSavings && (
                  <div style={{ fontSize: "0.8rem", color: "#22c55e", marginTop: "0.25rem" }}>
                    💰 {rec.potentialSavings}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Optimization tips */}
      {hasTips && (
        <CollapsibleSection title="💡 Optimization Tips" defaultOpen>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {data.tips.map((tip) => (
              <div key={tip.id} className="card" style={{ padding: "1rem", borderLeft: "4px solid #f59e0b" }}>
                <div style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                  {tip.icon} {tip.title}
                </div>
                <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                  {tip.impact}
                </div>
                <div style={{ fontSize: "0.85rem" }}>
                  💡 {tip.suggestion}
                </div>
                {tip.savings && (
                  <div style={{ fontSize: "0.8rem", color: "#22c55e", marginTop: "0.25rem" }}>
                    📊 {tip.savings}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Model Guide — what's best for what */}
      {hasGuide && (() => {
        // Build model list: merge guide info with live pricing when available
        const liveModels = livePricing?.models || {};
        const guideModels = data?.modelGuide || [];

        // Create merged entries: start from live pricing if available, overlay guide metadata
        const guideBySlug = Object.fromEntries(guideModels.map((m) => [m.model?.toLowerCase().replace(/\s+/g, "-"), m]));
        const allSlugs = new Set([
          ...Object.keys(liveModels),
          ...guideModels.map((m) => m.model?.toLowerCase().replace(/\s+/g, "-")),
        ]);

        const merged = [...allSlugs].map((slug) => {
          const live = liveModels[slug];
          const guide = guideBySlug[slug];
          return {
            slug,
            model: guide?.model || slug,
            vendor: live?.vendor || guide?.vendor || "—",
            tier: (live?.category || guide?.tier || "versatile").toLowerCase(),
            bestFor: guide?.bestFor || guide?.strengths || "—",
            input: live?.input ?? guide?.inputCost,
            output: live?.output ?? guide?.outputCost,
            cachedInput: live?.cachedInput,
            cacheWrite: live?.cacheWrite,
          };
        });

        const isLive = livePricing?.source === "live";
        const fetchedAt = livePricing?.fetchedAt ? new Date(livePricing.fetchedAt).toLocaleString() : null;

        return (
          <CollapsibleSection title="📖 Model Guide — What's Best for What">
            {isLive && (
              <div style={{ fontSize: "0.8rem", color: "#22c55e", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#22c55e" }} />
                Live pricing ({merged.length} models) · updated {fetchedAt}
              </div>
            )}
            {["powerful", "versatile", "lightweight"].map((tier) => {
              const models = merged.filter((m) => m.tier === tier);
              if (models.length === 0) return null;
              return (
                <div key={tier} style={{ marginBottom: "1rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: tierColors[tier] }} />
                    <strong style={{ fontSize: "0.9rem" }}>{tierLabels[tier]}</strong>
                    <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                      {tier === "powerful" ? "— complex tasks, architecture, multi-file" : tier === "versatile" ? "— day-to-day coding, balanced cost" : "— quick fixes, simple edits, cheapest"}
                    </span>
                  </div>
                  <div className="table-container">
                    <table className="data-table" style={{ fontSize: "0.85rem" }}>
                      <thead>
                        <tr>
                          <th>Model</th>
                          <th>Vendor</th>
                          <th>Best For</th>
                          <th>Input $/M</th>
                          <th>Cached $/M</th>
                          <th>Output $/M</th>
                        </tr>
                      </thead>
                      <tbody>
                        {models.map((m) => (
                          <tr key={m.slug} style={data?.currentModels?.includes(m.slug) ? { background: "rgba(99, 102, 241, 0.08)" } : {}}>
                            <td>
                              <strong>{m.model}</strong>
                              {data?.currentModels?.includes(m.slug) && <span style={{ fontSize: "0.7rem", marginLeft: 6, color: "#6366f1" }}>✦ in use</span>}
                            </td>
                            <td>{m.vendor}</td>
                            <td style={{ maxWidth: 250 }}>{m.bestFor}</td>
                            <td>{m.input != null ? `$${m.input.toFixed(2)}` : "—"}</td>
                            <td>{m.cachedInput != null ? `$${m.cachedInput.toFixed(3)}` : "—"}</td>
                            <td>{m.output != null ? `$${m.output.toFixed(2)}` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
              {isLive ? "Live pricing" : "Hardcoded pricing"} from <a href="https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>GitHub Copilot docs</a>. 1 AI credit = $0.01. Actual cost depends on plan.
            </div>
          </CollapsibleSection>
        );
      })()}
    </>
  );
}
