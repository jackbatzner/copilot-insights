import { useCallback } from "react";
import { Link } from "react-router-dom";
import { fetchSummary } from "../api.js";
import { useUsageData } from "../hooks/useUsageData.js";
import { useUsageQuery } from "../hooks/useUsageQuery.js";
import { Capabilities, EmptyUsage, formatMetric, knownNumber, LoadState, MetricGrid, MetricValue, PageHeading, Recommendation, UsageTotal } from "../components/Usage.jsx";
import { DailyUsageChart, ModelShareChart, ScopeShareChart } from "../components/UsageCharts.jsx";
import { UsageInsights } from "../components/UsageInsights.jsx";
import { sortSessions } from "../usage-data.js";

export default function Overview() {
  const query = useUsageQuery();
  const { timeframe } = query;
  const state = useUsageData(useCallback((options) => fetchSummary(timeframe, options), [timeframe]));
  const data = state.data;
  // Overview charts describe the unfiltered snapshot, so each drill starts a matching new slice.
  const drill = (path, overrides) => query.link(path, {
    model: "", day: "", scope: "", source: "", includeHidden: "", sort: "tokens", page: 1, ...overrides,
  });
  return <>
    <PageHeading title="Overview" description="See how usage changes. Follow the evidence into a session." {...query} />
    <LoadState {...state} skeleton="overview" loadingLabel="Loading Overview...">{data && (data.sessionCount === 0 ? <>
      <EmptyUsage />
      <p className="scope-note">Start a Copilot session, check Data Sources, then use Refresh data. <Link to="/welcome">How this works</Link></p>
      <Capabilities value={data.capabilities} />
    </> : <>
      <div className="overview-summary-heading"><h2>Recorded local usage</h2><span className="pill">{formatMetric(data.sessionCount)} sessions</span>
        <Link className="button-link" to={drill("/tokens")}>Explore Token Usage</Link></div>
      <MetricGrid metrics={data.metrics} evidence={data.evidence} />
      <UsageInsights snapshot={data} link={drill} />
      <div className="share-chart-grid">
        <ModelShareChart models={data.models} link={drill} />
        <ScopeShareChart groups={data.performance.groups} link={drill} />
      </div>
      <DailyUsageChart trend={data.exploration?.trend} timeframe={timeframe} link={drill} />
      <details className="scope-explanation"><summary>Chart scope and source coverage</summary>
        <p className="scope-note snapshot-note">Totals cover the whole recorded history of non-hidden sessions selected by timeframe. Daily points use exact UTC request timestamps only.
          Chart links start a new focused filter; they do not carry an unrelated model, day, scope, or source filter.</p></details>
      <section className="card attention-sessions" aria-labelledby="attention-heading">
        <div className="section-heading"><div><p className="eyebrow">FOLLOW THE USAGE</p><h2 id="attention-heading">Sessions to inspect</h2></div>
          <Link to={drill("/sessions")}>View all sessions</Link></div>
        <nav className="attention-switches" aria-label="Session attention">
          <Link to={drill("/sessions", { sort: "tokens" })}>High usage</Link>
          <Link to={drill("/sessions", { sort: "duration" })}>Long request durations</Link>
          <Link to={drill("/sessions", { sort: "delegation" })}>Delegated usage</Link>
        </nav>
        {data.sessions.length ? <ol className="attention-list">{sortSessions(data.sessions, "tokens").slice(0, 5).map((session) => <li key={session.handle}>
          <Link to={drill(`/sessions/${encodeURIComponent(session.handle)}`)}><strong>{session.label}</strong>
            <span>{session.models.length ? session.models.slice(0, 2).join(" · ") : "Model unavailable"}</span></Link>
          <div><strong><UsageTotal metrics={session.metrics} interactive={false} /></strong>
            {knownNumber(session.metrics.durationMs) && <span><MetricValue value={session.metrics.durationMs} name="durationMs" interactive={false} /> summed request duration</span>}</div>
        </li>)}</ol> : <EmptyUsage />}
      </section>
      <Recommendation value={data.recommendation} />
      <Capabilities value={data.capabilities} />
    </>)}</LoadState>
    <p className="scope-note">Usage, not conversation content. No personal scores or automatic configuration changes. <Link to="/welcome">How this works</Link></p>
  </>;
}
