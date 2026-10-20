import { Link } from "react-router-dom";
import { TimeframeSelector } from "./TimeframeSelector.jsx";
import { knownNumber } from "../usage-data.js";
import NumberValue from "./NumberValue.jsx";
import HelpDisclosure from "./HelpDisclosure.jsx";
import UsageLoading from "./UsageLoading.jsx";
export { knownNumber } from "../usage-data.js";

const metricDefinitions = {
  requests: ["Model calls", "Each request to a model is one call. A conversation turn can contain several calls, including child agents; coverage can be incomplete."],
  totalTokens: ["Total tokens", "Input plus output, only where both are recorded. Cache tokens are shown separately, not added again."],
  inputTokens: ["Input tokens", "Recorded input tokens; cache accounting can vary by producer."],
  outputTokens: ["Output tokens", "Recorded output tokens. JSONL-only fallback may be partial."],
  cacheReadTokens: ["Cache read tokens", "Recorded cache reads, not a guaranteed savings estimate."],
  cacheWriteTokens: ["Cache write tokens", "Recorded cache writes, not an additional total-token component."],
  localCredits: ["Local credits", "Not recorded when no verified conversion is available. Never an organization bill."],
  totalNanoAiu: ["Recorded nano-AIU", "Opaque recorded telemetry units. No verified credit or billing conversion is available."],
  durationMs: ["Request duration", "Sum of recorded request durations, not elapsed session time. Requests can overlap."],
  ttftMs: ["First-token latency", "Mean recorded time to first token (TTFT). Compare only with its coverage."],
  requestMultiplier: ["Mean request multiplier", "Mean recorded request multiplier, not a currency conversion or quality measure."],
  outputTtftMs: ["Output first-token latency", "Mean explicitly recorded output time to first token, with its own coverage."],
  interTokenLatencyMs: ["Mean inter-token latency", "Mean recorded inter-token latency. Missing observations are excluded, not treated as zero."],
  contentFilteredRequests: ["Content-filtered requests", "Count of requests with a recorded content-filter flag. No filtered content is read or displayed."],
  requestCost: ["Recorded request cost", "Opaque request-cost telemetry from a shutdown aggregate. Its unit is not verified; this is not currency or local credits."],
  apiDurationMs: ["Session API duration", "Recorded session-wide API duration from a shutdown aggregate. It is not allocated to individual models or child invocations."],
};
export const headlineMetrics = ["totalTokens", "outputTokens", "cacheReadTokens", "requests"];

export function formatMetric(value, name) {
  if (!knownNumber(value)) return "Not recorded";
  if (["durationMs", "apiDurationMs", "ttftMs", "outputTtftMs", "interTokenLatencyMs"].includes(name)) return `${value.toLocaleString(undefined, { maximumFractionDigits: 20 })} ms`;
  if (name === "requestMultiplier") return `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })}×`;
  return value.toLocaleString(undefined, { maximumFractionDigits: ["localCredits", "requestCost"].includes(name) ? 3 : 0 });
}

export function formatDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function MetricValue({ value, name, interactive = true }) {
  return <NumberValue value={value} metric={name} exact={formatMetric(value, name)} interactive={interactive} />;
}

export function UsageTotal({ metrics, interactive = true }) {
  if (knownNumber(metrics?.totalTokens)) return <><MetricValue value={metrics.totalTokens} name="totalTokens" interactive={interactive} /> tokens</>;
  if (knownNumber(metrics?.outputTokens)) return <><MetricValue value={metrics.outputTokens} name="outputTokens" interactive={interactive} /> output tokens (partial)</>;
  if (knownNumber(metrics?.inputTokens)) return <><MetricValue value={metrics.inputTokens} name="inputTokens" interactive={interactive} /> input tokens (partial)</>;
  if (knownNumber(metrics?.requests)) return <><MetricValue value={metrics.requests} name="requests" interactive={interactive} /> model calls</>;
  return "Usage totals unavailable";
}

export function Evidence({ value }) {
  if (!value || value.status === "not-recorded") return null;
  const source = { sessiondb: "SessionDB", jsonl: "JSONL", "jsonl-shutdown": "Shutdown aggregate", mixed: "Mixed sources" }[value.source] || "Source unavailable";
  const status = { recorded: "Recorded", partial: "Partial", derived: "Derived" }[value.status] || "Not recorded";
  return <small className={`evidence${value.status === "partial" ? " partial" : ""}`}>
    {status} · {source}{value.scope === "session" ? " · Session-wide" : ""} · {formatMetric(value.recorded)} / {formatMetric(value.total)} observations
  </small>;
}

export function MetricGrid({ metrics, evidence, names = headlineMetrics, compact = false }) {
  const preferred = names.filter((name) => knownNumber(metrics?.[name]));
  const available = preferred.length ? preferred : Object.keys(metricDefinitions).filter((name) => knownNumber(metrics?.[name]));
  if (!available.length) return <p className="scope-note usage-unavailable">No usage measurements available.</p>;
  return <dl className={compact ? "metric-grid compact" : "metric-grid"}>
    {available.map((name) => <div className="metric" key={name}>
      <dt>{metricDefinitions[name][0]} <HelpDisclosure label={metricDefinitions[name][1]} /></dt>
      <dd><MetricValue value={metrics[name]} name={name} /></dd>
      <Evidence value={evidence?.[name]} />
    </div>)}
  </dl>;
}

export function usageSummary(metrics) {
  if (knownNumber(metrics?.totalTokens)) return `${formatMetric(metrics.totalTokens)} tokens`;
  if (knownNumber(metrics?.outputTokens)) return `${formatMetric(metrics.outputTokens)} output tokens (partial)`;
  if (knownNumber(metrics?.inputTokens)) return `${formatMetric(metrics.inputTokens)} input tokens (partial)`;
  if (knownNumber(metrics?.requests)) return `${formatMetric(metrics.requests)} model calls`;
  return "Usage totals unavailable";
}

export function AllMetrics({ metrics, evidence }) {
  const first = ["totalTokens", "inputTokens", "outputTokens", "cacheReadTokens"].filter((name) => knownNumber(metrics?.[name]));
  const more = Object.keys(metricDefinitions).filter((name) => !first.includes(name) && knownNumber(metrics?.[name]));
  return <>
    {first.length > 0 && <MetricGrid metrics={metrics} evidence={evidence} names={first} compact />}
    {more.length > 0 && <details className="advanced-metrics"><summary>More metrics &amp; evidence ({more.length})
      {more.some((name) => evidence?.[name]?.status === "partial") ? " · Partial coverage" : ""}</summary>
      <MetricGrid metrics={metrics} evidence={evidence} names={more} compact />
    </details>}
    {!first.length && !more.length && <p className="scope-note">No usage measurements available.</p>}
  </>;
}

export function PageHeading({ title, description, timeframe, setTimeframe }) {
  return <header className="page-header"><div><h1>{title}</h1><p>{description}</p></div>
    {setTimeframe && <div className="timeframe-context"><span>Sessions active in</span><TimeframeSelector value={timeframe} onChange={setTimeframe} />
      <small>Totals include their whole recorded history.</small></div>}
  </header>;
}

export function TimeframeNote() {
  return <details className="scope-explanation"><summary>How timeframe and totals work</summary><p className="scope-note">Timeframe selects sessions by recorded activity or creation. Metrics cover each selected session's whole recorded history, not a request-time window. Hidden sessions are excluded from Overview and Token Usage. Lifecycle labels describe recorded history, not verified live activity.</p></details>;
}

export function Capabilities({ value, explain = true }) {
  if (!value) return <div className="notice">Source availability is not recorded.</div>;
  const status = (source) => ({ available: "Available", partial: "Partial", unavailable: "Unavailable" }[source] || "Not recorded");
  return <div className="source-coverage">{explain && <p className="scope-note">Only available measurements are shown; missing values are not zero. Local credits are unavailable because no verified conversion is defined.</p>}
    <details className="source-status">
    <summary>Data sources: SessionDB {status(value.sessionDb)} · JSONL {status(value.sessionState)}</summary>
    <p>Usage table: {value.usageTable ? "Available" : "Unavailable"}. Coverage labels distinguish recorded requests, shutdown aggregates, and partial output-only history.</p>
    {value.diagnostics?.filter((message) => !message.startsWith("Local credits are unavailable")).map((message, index) => <p key={index}>{message}</p>)}
    <Link to="/settings">Data source settings</Link>
  </details></div>;
}

export function LoadState({ loading, error, retry, children, skeleton, loadingLabel }) {
  if (loading) return <UsageLoading variant={skeleton} label={loadingLabel} />;
  if (error) return <div role="alert" className="notice error"><p>{error}</p><button onClick={retry}>Retry</button></div>;
  return children;
}

export function EmptyUsage({ filtered = false }) {
  return <section className="card empty-state"><h2>{filtered ? "No sessions match these filters" : "No recorded sessions yet"}</h2>
    <p>{filtered ? "Choose another model, source, or timeframe, or include hidden sessions." : "This view uses local usage metadata only. Check source availability, then refresh after a Copilot session."}</p>
    <Link to="/settings">Check Data Sources</Link>
  </section>;
}

export function Recommendation({ value }) {
  if (!value) return <aside className="card"><h2>Optimization unavailable</h2><p>Recommendation evidence was not recorded.</p></aside>;
  return <aside className="card recommendation" aria-label="Advisory optimization">
    <p className="eyebrow">ONE OPTIMIZATION · ADVISORY ONLY</p>
    <h2>{value.title}</h2><p>{value.evidence}</p>
    <details className="coaching">
      <summary>Why this matters / What to try</summary>
      <dl className="guidance"><dt>Why</dt><dd>{value.evidence}</dd>
        <dt>Try</dt><dd>{value.action}</dd>
        <dt>Caveat</dt><dd>{value.caveat}</dd>
        <dt>Compare afterward</dt><dd>{metricDefinitions[value.compareMetric]?.[0] || value.compareMetric || "Gather more usage evidence before comparing."}</dd>
      </dl>
      <p className="scope-note">Optional guidance, not a quality score or savings promise. You decide what to change; this app does not write Copilot configuration.</p>
    </details>
  </aside>;
}

export function Models({ models, link, limit }) {
  const sorted = [...models].sort((a, b) => (b.metrics?.totalTokens ?? -1) - (a.metrics?.totalTokens ?? -1) || a.model.localeCompare(b.model));
  return <div className="model-list">{sorted.slice(0, limit).map((row) => <article className="card model-card" key={row.model}>
    <div className="section-heading"><div><h3><Link to={link("/sessions", { model: row.model })}>{row.model}</Link></h3>
      <p>{formatMetric(row.sessionCount)} sessions · primary, child, or unattributed usage</p></div><span className="pill">Model</span></div>
    <MetricGrid metrics={row.metrics} evidence={row.evidence} compact />
  </article>)}</div>;
}

export function Skills({ skills }) {
  return <section className="skill-counts"><h3>Session-level skill observations</h3>
    <p className="scope-note">Independent session-level invocation counts. Not linked to a child or model; no linkage is inferred from timing.</p>
    {skills?.length ? <ul className="inline-counts">{skills.map((skill) => <li key={skill.category}>
      {skill.category}: <strong>{formatMetric(skill.count)}</strong>
    </li>)}</ul> : <p className="scope-note">No skill observations available.</p>}
  </section>;
}

export function SessionCards({ sessions, link, selectedModel }) {
  return <div className="session-list">{sessions.map((session) => <article className="card session-card" key={session.handle}>
    <div className="section-heading"><div>
      <h2><Link to={link(`/sessions/${encodeURIComponent(session.handle)}`)}>{session.label}</Link></h2>
      <p>{session.source === "cli" ? "Copilot CLI" : "VS Code"} · Updated {formatDate(session.updatedAt)}</p>
    </div><div className="badges">{session.active === true && <span className="pill active">Recorded open lifecycle</span>}
      {session.active === false && <span className="pill">Recorded closed lifecycle</span>}
      {session.hidden && <span className="pill">Hidden</span>}</div></div>
    <p className="model-labels">{session.models.length ? session.models.join(" · ") : "Model not recorded"}</p>
    {selectedModel && <div className="selected-usage"><h3>Selected model usage · {selectedModel}</h3>
      <MetricGrid metrics={session.selectedUsage} evidence={session.selectedEvidence} names={["totalTokens", "outputTokens", "requests"]} compact /></div>}
    <h3 className="metric-heading">Whole session</h3>
    <MetricGrid metrics={session.metrics} evidence={session.evidence} names={["totalTokens", "outputTokens", "requests"]} compact />
  </article>)}</div>;
}
