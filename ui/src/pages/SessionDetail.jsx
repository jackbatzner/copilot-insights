import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchSessionDetail, fetchSessions, fetchSessionTools, setSessionHidden } from "../api.js";
import { useUsageData } from "../hooks/useUsageData.js";
import { scopeLabels, useUsageQuery, validUtcDay } from "../hooks/useUsageQuery.js";
import { AllMetrics, Capabilities, Evidence, formatDate, formatMetric, knownNumber, LoadState, MetricGrid, MetricValue, PageHeading, Recommendation, Skills, UsageTotal } from "../components/Usage.jsx";
import TurnUsage from "../components/TurnUsage.jsx";
import ToolActivity, { AgentToolActivity } from "../components/ToolActivity.jsx";
import { LocalContentConsent, LocalContentPanel, LocalContentProvider } from "../components/LocalContent.jsx";
import { useRefresh } from "../App.jsx";

const correlations = { "exact-child": "Exact child linkage", "recorded-primary": "Recorded primary", unattributed: "No exact linkage recorded" };
const outcomes = { completed: "Completed", failed: "Failed", cancelled: "Cancelled", mixed: "Mixed", "not-recorded": "Not recorded" };
const scopeOrder = { primary: 0, subagent: 1, unattributed: 2 };

function InvocationMetadata({ group }) {
  const values = [
    knownNumber(group.durationMs) && `Invocation duration: ${formatMetric(group.durationMs, "durationMs")}`,
    group.requestedModel && `Requested model: ${group.requestedModel}`,
    group.invocationCategory && `Category: ${group.invocationCategory}`,
  ].filter(Boolean);
  return values.length ? <p className="scope-note">{values.join(" · ")}</p> : null;
}

function SelectedSessionUsage({ session, query }) {
  const { timeframe, model, day, scope, includeHidden } = query;
  const state = useUsageData(useCallback(async (options) => {
    const value = await fetchSessions(timeframe, { model, day, scope, session: session.handle, includeHidden: includeHidden || session.hidden }, options);
    return value.sessions.find((entry) => entry.handle === session.handle) || null;
  }, [timeframe, model, day, scope, includeHidden, session]));
  return <section className="selected-usage" aria-label="Matching usage totals"><h2>Matching usage only</h2>
    <LoadState {...state} skeleton="metrics" loadingLabel="Loading matching usage totals...">{state.data ? <MetricGrid metrics={state.data.selectedUsage} evidence={state.data.selectedEvidence}
      names={[knownNumber(state.data.selectedUsage.totalTokens) ? "totalTokens" : "outputTokens", "requests", "cacheReadTokens"]} compact />
      : <p>No recorded usage matches this session and the current selection.</p>}</LoadState>
    <p className="scope-note">Model, scope and UTC day must match the same record. These are not whole-session totals; shutdown aggregates cannot match a request day.</p>
  </section>;
}

export default function SessionDetail() {
  const { handle } = useParams();
  const query = useUsageQuery();
  const state = useUsageData(useCallback((options) => fetchSessionDetail(handle, options, "summary"), [handle]), { pollActive: true });
  const revision = state.data?.revision ?? state.data?.session;
  const tools = useUsageData(useCallback((options) => fetchSessionTools(handle, options), [handle, revision]), { enabled: Boolean(revision) });
  const [saving, setSaving] = useState(false);
  const [hideError, setHideError] = useState(null);
  const [openAttribution, setOpenAttribution] = useState({});
  const [view, setView] = useState("turns");
  const { key: refreshKey, refreshing } = useRefresh();
  const attributionNodes = useRef(new Map());
  const returnTarget = useRef(null);
  const [returnKey, setReturnKey] = useState(null);
  useEffect(() => {
    returnTarget.current = null;
    setReturnKey(null);
    setOpenAttribution({});
    setView("turns");
  }, [handle]);
  const data = state.data;
  const selectedModel = data?.session.models.find((model) => model === query.model);
  const inspectAttribution = (key, origin = document.activeElement) => {
    const node = attributionNodes.current.get(key);
    if (!node) return;
    returnTarget.current = { node: origin, view };
    setView("agents");
    setReturnKey(key);
    setOpenAttribution((previous) => ({ ...previous, [key]: true }));
    node.open = true;
    requestAnimationFrame(() => {
      node.querySelector("summary").focus();
      node.scrollIntoView({ block: "nearest" });
    });
  };
  const returnToOrigin = () => {
    const target = returnTarget.current;
    setView(target?.view || "turns");
    requestAnimationFrame(() => {
      const origin = target?.node?.isConnected ? target.node : document.getElementById("turn-usage-heading");
      if (!origin) return;
      if (origin.tagName === "H2") origin.tabIndex = -1;
      origin.focus({ preventScroll: true });
      origin.scrollIntoView({ block: "nearest" });
    });
    setReturnKey(null);
  };
  const hide = async () => {
    setSaving(true);
    setHideError(null);
    try {
      await setSessionHidden(handle, !data.session.hidden);
      state.retry();
    } catch {
      setHideError("Session visibility could not be changed. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return <LocalContentProvider key={handle} handle={handle} refreshing={refreshing} refreshKey={refreshKey}>
    <Link className="back-link" to={query.link("/sessions")}>← Back to Sessions</Link>
    <LoadState {...state} skeleton="detail" loadingLabel="Loading session totals and attribution...">{data && <div className="session-explorer">
      <PageHeading title={data.session.label} description="Follow a turn into its model calls, agents and recorded evidence." />
      <div className="section-heading"><p className="scope-note">Created {formatDate(data.session.createdAt)} · {data.session.source === "cli" ? "Copilot CLI" : "VS Code"}</p>
        <button onClick={hide} disabled={saving}>{saving ? "Saving..." : data.session.hidden ? "Unhide session" : "Hide session"}</button></div>
      {hideError && <p role="alert" className="notice error">{hideError}</p>}
      {(query.model || query.day || query.scope) && <div className="notice session-filter-context" aria-label="Session filter context">
        {query.model && <strong>Selected model: {selectedModel || "Not recorded in this session"}</strong>}
        {query.scope && <p>Selected scope: {scopeLabels[query.scope] || "Invalid scope filter"}</p>}
        {query.day && <p>Selected UTC day: {validUtcDay(query.day) ? query.day : "Invalid day filter"}</p>}
      </div>}
      {(query.model || query.day || query.scope) && <SelectedSessionUsage session={data.session} query={query} />}
      <section className="detail-summary" aria-label="Whole-session totals">
        <h2>Whole-session totals (all models)</h2>
        <MetricGrid metrics={data.session.metrics} evidence={data.session.evidence}
          names={[knownNumber(data.session.metrics.totalTokens) ? "totalTokens" : "outputTokens", "requests", "cacheReadTokens"]} compact />
      </section>
      <LocalContentConsent />
      <nav className="detail-sections" aria-label="Session analysis">
        {[["turns", "Turns"], ["agents", "Agents & models"], ["tools", "Tool activity"]].map(([key, label]) =>
          <button key={key} aria-pressed={view === key} aria-controls={`session-view-${key}`} onClick={() => setView(key)}>{label}</button>)}
        <Link to={query.link("/tokens/compare", { session: handle, timeframe: "all", includeHidden: data.session.hidden || query.includeHidden ? "true" : "" })}>Compare models for this session</Link>
      </nav>
      <div id="session-view-turns" hidden={view !== "turns"}>
        <TurnUsage key={`${handle}:${query.model}:${query.scope}:${query.day}`} handle={handle} revision={revision} models={data.session.models}
          attribution={data.attribution} toolUsage={tools.data} initialFilters={query} onInspect={inspectAttribution} />
      </div>
      <div id="session-view-agents" hidden={view !== "agents"}>
      <section aria-labelledby="attribution-heading"><div className="section-heading"><div>
        <h2 id="attribution-heading">Usage attribution</h2><p>Scope → model → metrics and evidence. Expand only what you need.</p>
      </div></div>
        <div className="attribution-tree">{[...data.attribution].sort((a, b) => scopeOrder[a.scope] - scopeOrder[b.scope]).map((group) => <details className="card attribution-group" key={group.key}
          open={Boolean(openAttribution[group.key])}
          id={`attribution-${data.attribution.findIndex((entry) => entry.key === group.key)}`}
          onToggle={(event) => {
            if (event.target === event.currentTarget) {
              const open = event.currentTarget.open;
              setOpenAttribution((previous) => ({ ...previous, [group.key]: open }));
            }
          }}
          ref={(node) => { if (node) attributionNodes.current.set(group.key, node); else attributionNodes.current.delete(group.key); }}>
          <summary><span><strong>{group.label}</strong><span className="scope-note">{correlations[group.correlation]}</span></span>
            {query.scope === group.scope && <span className="pill">Selected scope</span>}
            <span className="attribution-total"><UsageTotal metrics={group.metrics} />{group.outcome !== "not-recorded" && <span className="scope-note">{outcomes[group.outcome]}</span>}</span>
          </summary>
          {returnKey === group.key && <button className="return-to-call" onClick={returnToOrigin}>Return to model call or tool link</button>}
          <p className="scope-note">Whole invocation / scope totals across this session, not just the matching calls.</p>
          <Evidence value={group.evidence.totalTokens} />
          <InvocationMetadata group={group} />
          <AgentToolActivity group={tools.data?.groups.find((entry) => entry.attributionKey === group.key)} />
          {openAttribution[group.key] && group.correlation === "exact-child" && <LocalContentPanel kind="agent" attributionKey={group.key} />}
          {group.models.length ? group.models.map((row) => <details className="model-attribution" key={row.model}>
            <summary><strong>{row.model}</strong>{query.model === row.model && <span className="pill">Selected model</span>}
              <span><UsageTotal metrics={row.metrics} /></span></summary>
            {Object.values(row.evidence).some((value) => value.source === "jsonl-shutdown") &&
              <p className="scope-note">Session/model shutdown aggregate. Individual request and child attribution are unavailable for these totals.</p>}
            <AllMetrics metrics={row.metrics} evidence={row.evidence} />
          </details>) : <><p>Model breakdown not recorded. Available scope evidence:</p><AllMetrics metrics={group.metrics} evidence={group.evidence} /></>}
        </details>)}</div>
        {!data.attribution.length && <div className="notice">Attribution is not recorded.</div>}
      </section>
      <div className="card"><Skills skills={data.skills} /></div>
      </div>
      <div id="session-view-tools" hidden={view !== "tools"}>
        <LoadState {...tools} loadingLabel="Loading tool activity...">{tools.data && <ToolActivity value={tools.data} attribution={data.attribution} onInspect={inspectAttribution} />}</LoadState>
      </div>
      <details className="card diagnostic" aria-label="Session diagnostic">
        <summary>Session information · {data.diagnostic.active === true ? "Recorded open lifecycle" : "Recorded history"}</summary>
        <p className="scope-note">Hiding changes only this app's visibility. It does not delete source data.</p>
        <div className="section-heading"><span className={`pill${data.diagnostic.active === true ? " active" : ""}`}>
          {data.diagnostic.status === "active" ? "Recorded open lifecycle" : data.diagnostic.status === "completed" ? "Recorded closed lifecycle" : "Not recorded"}
        </span></div>
        <p>Not verified live; history may be incomplete.</p>
        <p>Last recorded activity: {formatDate(data.diagnostic.updatedAt)}</p>
        <p>Child observations: {formatMetric(data.diagnostic.childCount)}</p>
        {knownNumber(data.session.metrics.apiDurationMs) && <p>Session API duration: <MetricValue value={data.session.metrics.apiDurationMs} name="apiDurationMs" />.
          Not allocated to individual models or child invocations. <Evidence value={data.session.evidence.apiDurationMs} /></p>}
        {data.session.evidence.totalNanoAiu?.scope === "session" && knownNumber(data.session.metrics.totalNanoAiu) && <p>
          Recorded session nano-AIU: <MetricValue value={data.session.metrics.totalNanoAiu} name="totalNanoAiu" />.
          Opaque units, not currency. This session total may differ from the model sum; the difference is not allocated.
          <Evidence value={data.session.evidence.totalNanoAiu} /></p>}
        {data.diagnostic.active === true && <p className="scope-note">Usage metadata refreshes every 15 seconds while the lifecycle remains recorded open. This does not verify a running process. Text follows the Local text controls and stays separate from usage caching.</p>}
        <Capabilities value={data.capabilities} />
      </details>
      <Recommendation value={data.recommendation} />
    </div>}</LoadState>
  </LocalContentProvider>;
}
