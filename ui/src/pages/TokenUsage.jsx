import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { fetchTokenSummary } from "../api.js";
import { useUsageData } from "../hooks/useUsageData.js";
import { useUsageQuery } from "../hooks/useUsageQuery.js";
import { Capabilities, EmptyUsage, knownNumber, LoadState, MetricGrid, Models, PageHeading, Recommendation, Skills, TimeframeNote, UsageTotal } from "../components/Usage.jsx";

const scopeLabels = { primary: "Primary", subagent: "Child invocations", unattributed: "Unattributed" };
export default function TokenUsage() {
  const query = useUsageQuery();
  const { timeframe } = query;
  const state = useUsageData(useCallback((options) => fetchTokenSummary(timeframe, options), [timeframe]));
  const data = state.data;
  const [showAllModels, setShowAllModels] = useState(false);
  const location = useLocation();
  useEffect(() => {
    if (data && ["#performance", "#models", "#optimization"].includes(location.hash)) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
    }
  }, [data, location.hash]);
  const performanceGroups = data?.performance.groups.filter((group) => Object.values(group.metrics).some(knownNumber)) ?? [];
  const link = (path, overrides) => query.link(path, { model: "", scope: "", day: "", page: 1, ...overrides });
  return <>
    <PageHeading title="Token Usage" description="Follow a model into the sessions that used it, in any scope." {...query} />
    <TimeframeNote />
    <p className="scope-note">Model and scope links keep your source and hidden-session preferences, and start a new usage filter within this timeframe.</p>
    <nav className="page-section-nav" aria-label="Token usage sections"><a href="#performance">Agent &amp; Skill Performance</a>
      <a href="#models">Models</a><Link to={query.link("/tokens/compare")}>Compare models</Link>
      <a href="#optimization">Advisory optimization</a><Link to={query.link("/sessions")}>Browse Sessions</Link></nav>
    <LoadState {...state} skeleton="tokens" loadingLabel="Loading Token Usage...">{data && <>
      <MetricGrid metrics={data.metrics} evidence={data.evidence} />
      <section id="performance" className="card performance section-anchor" aria-labelledby="performance-heading">
        <h2 id="performance-heading">Agent &amp; Skill Performance</h2>
        <p className="scope-note">Execution metadata, not an assessment of your skills. Request durations can overlap and are not wall-clock time.</p>
        {performanceGroups.map((group) => <details key={group.scope} className="performance-group">
          <summary>{scopeLabels[group.scope] || "Unattributed"} · <UsageTotal metrics={group.metrics} />{knownNumber(group.sessionCount) && ` · ${group.sessionCount} sessions`}</summary>
          <Link to={link("/sessions", { scope: group.scope })}>View {scopeLabels[group.scope]?.toLowerCase() || "unattributed"} sessions</Link>
          <MetricGrid compact metrics={group.metrics} evidence={group.evidence}
            names={["totalTokens", "outputTokens", "requests", "durationMs", "ttftMs", "requestMultiplier", "outputTtftMs", "interTokenLatencyMs", "contentFilteredRequests"]} />
        </details>)}
        {!performanceGroups.length && <p className="scope-note">No scope-level usage available.</p>}
        <Skills skills={data.performance.skills} />
      </section>
      <section id="models" className="section-anchor" aria-labelledby="models-heading"><div className="section-heading"><h2 id="models-heading">Models</h2>
        <span className="scope-note">Highest available token totals first</span></div>
        {data.models.length ? <Models models={data.models} link={link} limit={showAllModels ? undefined : 6} /> : <EmptyUsage />}
        {data.models.length > 6 && <button className="show-models" onClick={() => setShowAllModels((value) => !value)}>{showAllModels ? "Show fewer models" : `Show all ${data.models.length} models`}</button>}
      </section>
      <div id="optimization" className="section-anchor"><Recommendation value={data.recommendation} /></div>
      <Capabilities value={data.capabilities} />
    </>}</LoadState>
  </>;
}
