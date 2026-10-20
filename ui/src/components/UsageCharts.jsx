import { useState } from "react";
import { Link } from "react-router-dom";
import { Evidence, formatMetric, knownNumber, MetricValue } from "./Usage.jsx";
import { scopeLabels } from "../hooks/useUsageQuery.js";
import { compareKnownDescending, shareMetric } from "../usage-data.js";

const dailyMetrics = { totalTokens: "Total tokens", outputTokens: "Output tokens", requests: "Model calls", cacheReadTokens: "Cache read tokens" };
const shortNumber = (value) => value.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 });
const valueText = (value, interactive = true) => knownNumber(value) ? <MetricValue value={value} interactive={interactive} /> : "—";

export function DailyUsageChart({ trend, timeframe, link }) {
  const [requestedMetric, setRequestedMetric] = useState("totalTokens");
  const days = trend?.days || [];
  const availableMetrics = Object.keys(dailyMetrics).filter((key) => days.some((day) => knownNumber(day.metrics[key])));
  const metric = availableMetrics.includes(requestedMetric) ? requestedMetric : availableMetrics[0];
  const available = trend?.available === true && trend.basis === "sessiondb-request-timestamp" && days.length > 0 && metric;
  const max = Math.max(1, ...days.map((day) => knownNumber(day.metrics[metric]) ? day.metrics[metric] : 0));
  const width = 960, height = 282, left = 64, right = 12, top = 16, baseline = 240;
  const step = (width - left - right) / Math.max(days.length, 1);
  return <section className="card trend-card" aria-labelledby="daily-usage-heading">
    <div className="section-heading"><div><p className="eyebrow">TIMESTAMPED MODEL CALLS ONLY</p><h2 id="daily-usage-heading">Daily usage</h2></div>
      {available && <label className="chart-control">Daily metric<select aria-label="Daily metric" value={metric} onChange={(event) => setRequestedMetric(event.target.value)}>
        {availableMetrics.map((key) => <option key={key} value={key}>{dailyMetrics[key]}</option>)}
      </select></label>}
    </div>
    {available ? <>
      <div className="trend-window"><strong>{dailyMetrics[metric]}</strong>
        <span>{trend.startDay} – {trend.endDay} UTC{timeframe === "all" ? " · Last 90 days of all-time history" : ` · ${trend.windowDays} days`}</span></div>
      <div className="chart-scroll">
        <svg className="daily-chart" viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`Daily recorded ${dailyMetrics[metric].toLowerCase()}`}>
          <title>Daily {dailyMetrics[metric].toLowerCase()} from timestamped SessionDB requests</title>
          {[0, .5, 1].map((fraction) => <g key={fraction} aria-hidden="true">
            <line className="chart-gridline" x1={left} x2={width - right} y1={baseline - fraction * (baseline - top)} y2={baseline - fraction * (baseline - top)} />
            <text className="chart-axis" x={left - 10} y={baseline - fraction * (baseline - top) + 4} textAnchor="end">{shortNumber(max * fraction)}</text>
          </g>)}
          {days.map((day, index) => {
            const value = day.metrics[metric];
            const x = left + index * step + step / 2;
            const measured = knownNumber(value);
            const recordedDay = measured || (knownNumber(day.metrics.requests) && day.metrics.requests > 0);
            const label = `${day.day}: ${measured ? `${formatMetric(value)} ${dailyMetrics[metric].toLowerCase()}` : "measurement not recorded"}`;
            return <g key={day.day}>
              {recordedDay && <Link className="trend-point" to={link("/sessions", { day: day.day })} aria-label={`View sessions for ${label}`}>
                <title>{label} · {formatMetric(day.sessionCount)} sessions · Open filtered Sessions</title>
                <rect className="trend-hit-area" x={x - step / 2} y={top} width={step} height={baseline - top + 6} />
                {measured ? value === 0
                  ? <line className="trend-zero" x1={x - Math.max(2, step - 4) / 2} x2={x + Math.max(2, step - 4) / 2} y1={baseline} y2={baseline} />
                  : <rect className="trend-bar" x={x - Math.max(2, step - 4) / 2}
                    y={baseline - value / max * (baseline - top)} width={Math.max(2, step - 4)} height={value / max * (baseline - top)} rx={2} />
                  : <circle className="trend-missing" cx={x} cy={baseline - 4} r={3} />}
              </Link>}
              {(index % Math.ceil(days.length / 6) === 0 || index === days.length - 1) &&
                <text className="chart-axis" aria-hidden="true" x={x} y={height - 10} textAnchor="middle">{day.day.slice(5)}</text>}
            </g>;
          })}
        </svg>
      </div>
      <p className="scope-note">{formatMetric(trend.recordedRequests)} timestamped model calls in this UTC window; {formatMetric(trend.undatedRequests)} model calls lack dates.
        {" "}{formatMetric(trend.excludedAggregateSessions)} aggregate-only sessions are excluded from this timeline.
        Gaps mean missing measurements, not zero. No shutdown total is distributed across days.</p>
      <details className="chart-data"><summary>View daily usage data</summary>
        <div className="chart-table-scroll"><table><caption>Daily usage data (UTC)</caption>
          <thead><tr><th scope="col">Day</th><th scope="col">{dailyMetrics[metric]}</th><th scope="col">Sessions</th><th scope="col">Evidence</th></tr></thead>
          <tbody>{days.map((day) => <tr key={day.day}><th scope="row"><Link to={link("/sessions", { day: day.day })}>{day.day}</Link></th>
            <td>{valueText(day.metrics[metric])}</td><td>{valueText(day.sessionCount)}</td>
            <td><Evidence value={day.evidence[metric]} /></td></tr>)}</tbody>
        </table></div>
      </details>
    </> : <div className="no-trend" role="status">
      <h3>No daily request trend available</h3>
      <p>Daily charts need exact request timestamps. Shutdown aggregates and output-only history are not request timelines; model and scope charts still show available usage.</p>
      {timeframe === "all" && <p className="scope-note">The all-time daily view is limited to the latest 90 UTC days.</p>}
    </div>}
  </section>;
}

function ChartData({ rows, metric, label, rowLabel, href }) {
  return <details className="chart-data"><summary>View {label.toLowerCase()} data</summary>
    <div className="chart-table-scroll"><table><caption>{label} data</caption>
      <thead><tr><th scope="col">{rowLabel}</th><th scope="col">{metric === "outputTokens" ? "Output tokens" : "Total tokens"}</th><th scope="col">Sessions</th><th scope="col">Evidence</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key}><th scope="row"><Link to={href(row)}>{row.label}</Link></th>
        <td>{valueText(row.metrics[metric])}</td><td>{valueText(row.sessionCount)}</td><td><Evidence value={row.evidence[metric]} /></td></tr>)}</tbody>
    </table></div>
  </details>;
}

export function ModelShareChart({ models, link }) {
  const metric = shareMetric(models);
  const rows = models.map((row) => ({ ...row, key: row.model, label: row.model })).sort((a, b) => compareKnownDescending(a.metrics[metric], b.metrics[metric]) || a.label.localeCompare(b.label));
  const displayed = rows.slice(0, 6);
  const total = displayed.reduce((sum, row) => sum + (knownNumber(row.metrics[metric]) ? row.metrics[metric] : 0), 0);
  const partial = metric && displayed.some((row) => !knownNumber(row.metrics[metric]) || row.evidence[metric]?.status === "partial");
  return <section className="card share-card" aria-labelledby="model-share-heading">
    <div className="section-heading"><h2 id="model-share-heading">Model share</h2><Link to={`${link("/tokens")}#models`}>View all models</Link></div>
    <p className="scope-note">{metric === "outputTokens" ? "Share of available output tokens (partial)." : "Share of model tokens with available totals."} Percentages use only the displayed models and metric. Missing values are excluded, not zero.</p>
    {partial && <p className="scope-note chart-coverage">Partial coverage: some displayed measurements are incomplete or missing.</p>}
    <ul className="share-bars" aria-label="Token usage by model">{displayed.map((row) => {
      const value = row.metrics[metric];
      const percent = knownNumber(value) && total > 0 ? value / total * 100 : null;
      return <li key={row.key}><Link to={link("/sessions", { model: row.model })}>
        <span className="share-label">{row.model}</span><span className="share-value">{valueText(value, false)}{percent !== null && <small>{percent.toFixed(1)}%</small>}</span>
        <span className="share-track" aria-hidden="true">{knownNumber(value) && <span className="share-fill" style={{ width: `${percent ?? 0}%` }} />}</span>
      </Link></li>;
    })}</ul>
    {!rows.length && <p className="chart-empty">No model measurements available.</p>}
    {rows.length > 6 && <p className="scope-note">Showing six of {rows.length} models. Other models are not included in these percentages.</p>}
    {displayed.length > 0 && <ChartData rows={displayed} metric={metric} label="Model share" rowLabel="Model" href={(row) => link("/sessions", { model: row.model })} />}
  </section>;
}

export function ScopeShareChart({ groups, link }) {
  const rows = Object.entries(scopeLabels).map(([scope, label]) => {
    const group = groups.find((row) => row.scope === scope);
    return { ...group, key: scope, scope, label, metrics: group?.metrics || {}, evidence: group?.evidence || {} };
  });
  const metric = shareMetric(rows);
  const total = rows.reduce((sum, row) => sum + (knownNumber(row.metrics[metric]) ? row.metrics[metric] : 0), 0);
  const partial = metric && rows.some((row) => !knownNumber(row.metrics[metric]) || row.evidence[metric]?.status === "partial");
  return <section className="card share-card" aria-labelledby="scope-share-heading">
    <div className="section-heading"><h2 id="scope-share-heading">Usage by scope</h2><Link to={`${link("/tokens")}#performance`}>Explore performance</Link></div>
    <p className="scope-note">{metric === "outputTokens" ? "Available output tokens (partial)." : "Available token totals."} Unattributed usage remains visible; missing linkage is not primary usage.</p>
    {partial && <p className="scope-note chart-coverage">Partial coverage: percentages use available measurements only; missing values are excluded.</p>}
    <div className="scope-chart" role="group" aria-label="Token usage by scope">
      {total > 0 && <div className="scope-strip">{rows.filter((row) => knownNumber(row.metrics[metric]) && row.metrics[metric] > 0).map((row) =>
        <Link className={`scope-segment scope-${row.scope}`} key={row.key} to={link("/sessions", { scope: row.scope })}
          style={{ flex: row.metrics[metric] }} aria-label={`Inspect ${row.label.toLowerCase()}: ${formatMetric(row.metrics[metric])} ${metric === "outputTokens" ? "output tokens (partial)" : "tokens"}`}>
          <span aria-hidden="true">{(row.metrics[metric] / total * 100).toFixed(0)}%</span>
        </Link>)}</div>}
      <ul className="scope-legend">{rows.map((row) => <li key={row.key}><Link to={link("/sessions", { scope: row.scope })}>
        <span className={`scope-dot scope-${row.scope}`} aria-hidden="true" /><span>{row.label}
          <small>{knownNumber(row.sessionCount) ? `${formatMetric(row.sessionCount)} sessions` : "Session count unavailable"}</small></span>
        <strong>{valueText(row.metrics[metric], false)}</strong>
      </Link></li>)}</ul>
    </div>
    <ChartData rows={rows} metric={metric} label="Scope usage" rowLabel="Scope" href={(row) => link("/sessions", { scope: row.scope })} />
  </section>;
}
