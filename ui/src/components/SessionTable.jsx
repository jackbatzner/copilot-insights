import { Link } from "react-router-dom";
import { formatDate, formatMetric, knownNumber, MetricValue } from "./Usage.jsx";
import { outcomeLabels, sourceDescription } from "../usage-data.js";
import "./ResponsiveTables.css";

export function TableValue({ value, metric }) {
  return knownNumber(value) ? <MetricValue value={value} name={metric} /> : <span className="unknown-value" aria-label="Not recorded">—</span>;
}

function UsageCell({ metrics }) {
  return <><TableValue value={metrics?.totalTokens} />
    {!knownNumber(metrics?.totalTokens) && knownNumber(metrics?.outputTokens) &&
      <small className="cell-note"><MetricValue value={metrics.outputTokens} name="outputTokens" /> output only</small>}
  </>;
}

function ModelMix({ models }) {
  if (!models.length) return <span className="unknown-value" aria-label="Model not recorded">—</span>;
  if (models.length <= 2) return <span className="table-models">{models.join(" · ")}</span>;
  return <details className="table-models"><summary>{models[0]} <span className="cell-note">+{models.length - 1} models</span></summary>
    <ul>{models.map((model) => <li key={model}>{model}</li>)}</ul>
  </details>;
}

export function SessionTable({ sessions, link, filtered = false, sort, onSort, caption = "Recorded sessions" }) {
  const sortHeader = (label, key) => <th scope="col" role="columnheader" aria-label={label} aria-sort={sort === key ? "descending" : "none"}>
    {onSort ? <button className="table-sort" onClick={() => onSort(key)} aria-label={`Sort by ${label.toLowerCase()}`}>
      {label}{sort === key && <span aria-hidden="true"> ↓</span>}
    </button> : label}
  </th>;
  return <div className="session-table-scroll" role="region" aria-label={`${caption} table`} tabIndex={0}>
    <table className="session-table responsive-card-table" role="table">
      <caption>{caption}</caption>
      <thead role="rowgroup"><tr role="row">
        {sortHeader("Session", "recent")}<th scope="col">Model mix</th>
        {filtered && sortHeader("Selected usage", "tokens")}
        {filtered ? <th scope="col">Whole-session usage</th> : sortHeader("Whole-session usage", "tokens")}
        {sortHeader("Cache read", "cache")}{sortHeader("Request duration", "duration")}
        {sortHeader("Delegation", "delegation")}<th scope="col">Outcome</th><th scope="col">Source / coverage</th>
      </tr></thead>
      <tbody role="rowgroup">{sessions.map((session) => {
        const coverage = sourceDescription(session, filtered);
        const metrics = filtered ? session.selectedUsage : session.metrics;
        return <tr key={session.handle} role="row">
          <th scope="row" role="rowheader" data-primary><Link to={link(`/sessions/${encodeURIComponent(session.handle)}`)}>{session.label}</Link>
            <span className="cell-note">Updated {session.updatedAt ? formatDate(session.updatedAt) : "—"}</span>
            {session.hidden && <span className="pill">Hidden</span>}
          </th>
          <td role="cell" data-label="Model mix"><ModelMix models={session.models} /></td>
          {filtered && <td role="cell" data-label="Selected usage" className="numeric selected-cell"><UsageCell metrics={session.selectedUsage} /></td>}
          <td role="cell" data-label="Whole-session usage" className="numeric"><UsageCell metrics={session.metrics} /></td>
          <td role="cell" data-label={filtered ? "Selected cache read" : "Cache read"} className="numeric"><TableValue value={metrics?.cacheReadTokens} /></td>
          <td role="cell" data-label={filtered ? "Selected request duration" : "Request duration"} className="numeric"><TableValue value={metrics?.durationMs} metric="durationMs" /></td>
          <td role="cell" data-label="Whole-session delegation" className="numeric"><TableValue value={session.performance?.childTokens} />
            {knownNumber(session.performance?.childCount) && <small className="cell-note">{formatMetric(session.performance.childCount)} child invocations</small>}
          </td>
          <td role="cell" data-label="Outcome">{outcomeLabels[session.performance?.outcome] || "—"}
            {session.performance?.evidence?.outcome?.status === "partial" && <small className="cell-note">Partial recording</small>}
          </td>
          <td role="cell" data-label="Source / coverage" className="source-cell"><span>{session.source === "cli" ? "CLI" : "VS Code"} · {coverage.source}</span>
            {coverage.granularity && coverage.granularity !== coverage.source && <small className="cell-note">{coverage.granularity}</small>}
            {coverage.partial && <small className="cell-note">Partial coverage</small>}
          </td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

export function TableExplanation({ filtered = false }) {
  return <details className="scope-note table-explanation">
    <summary>How to read session metrics</summary>
    <p>— means not recorded, not zero. Token totals exclude incomplete input/output pairs; output-only values are labeled.
    Request duration sums recorded requests, not wall-clock time. Delegation counts are whole-session recorded metadata.
    Outcomes combine recorded request/child events; they do not measure task success, quality, or liveness.
    {filtered && " Selected usage, cache, and duration match the combined model/day/scope filters; whole-session usage stays unchanged."}
    </p>
  </details>;
}
