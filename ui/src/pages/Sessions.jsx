import { useCallback } from "react";
import { Link } from "react-router-dom";
import { fetchSessions } from "../api.js";
import { useUsageData } from "../hooks/useUsageData.js";
import { scopeLabels, useUsageQuery, validUtcDay } from "../hooks/useUsageQuery.js";
import { Capabilities, EmptyUsage, LoadState, PageHeading, TimeframeNote } from "../components/Usage.jsx";
import { SessionTable, TableExplanation } from "../components/SessionTable.jsx";

const PAGE_SIZE = 25;
export default function Sessions() {
  const query = useUsageQuery();
  const { timeframe, model, day, scope, includeHidden, source, sort, page: requestedPage } = query;
  const state = useUsageData(useCallback((options) => fetchSessions(timeframe, { model, day, scope, includeHidden, source, sort, page: requestedPage }, options),
    [timeframe, model, day, scope, includeHidden, source, sort, requestedPage]));
  const data = state.data;
  const safeModel = data?.models.find((row) => row.model === model)?.model;
  const filtered = Boolean(model || day || scope);
  const sessions = data?.sessions || [];
  const total = data?.pagination?.total ?? sessions.length;
  const pageCount = data?.pagination?.pages ?? 1;
  const page = data?.pagination?.page ?? 1;
  const start = (page - 1) * PAGE_SIZE;
  return <>
    <PageHeading title="Sessions" description="Compare recorded usage, then inspect the session behind it." {...query} />
    <TimeframeNote />
    <nav className="attention-switches" aria-label="Session attention">
      <button aria-pressed={sort === "tokens"} onClick={() => query.update({ sort: "tokens" })}>High usage</button>
      <button aria-pressed={sort === "duration"} onClick={() => query.update({ sort: "duration" })}>Long request durations</button>
      <button aria-pressed={sort === "delegation"} onClick={() => query.update({ sort: "delegation" })}>Delegated usage</button>
      <Link className="button-link" to={query.link("/tokens/compare")}>Compare models in this selection</Link>
    </nav>
    <div className="filter-bar session-filters">
      <label>Model<select aria-label="Model" value={model} onChange={(event) => query.update({ model: event.target.value })}>
        <option value="">All models</option>
        {model && !safeModel && <option value={model}>Model not in this timeframe</option>}
        {data?.models.map((row) => <option key={row.model} value={row.model}>{row.model}</option>)}
      </select></label>
      <label>Scope<select aria-label="Scope" value={scope} onChange={(event) => query.update({ scope: event.target.value })}>
        <option value="">All scopes</option>
        {scope && !scopeLabels[scope] && <option value={scope}>Invalid scope filter</option>}
        {Object.entries(scopeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>UTC day<input aria-label="UTC day" type="date" value={validUtcDay(day) ? day : ""} onChange={(event) => query.update({ day: event.target.value })} /></label>
      <label>Source<select aria-label="Source" value={source} onChange={(event) => query.update({ source: event.target.value })}>
        <option value="">All sources</option><option value="cli">Copilot CLI</option><option value="vscode">VS Code</option>
      </select></label>
      <label>Sort by<select aria-label="Sort by" value={sort} onChange={(event) => query.update({ sort: event.target.value })}>
        <option value="tokens">Highest tokens</option><option value="recent">Latest recorded update</option>
        <option value="duration">Longest request duration</option><option value="cache">Most cache read tokens</option>
        <option value="delegation">Most child tokens</option>
      </select></label>
      <label className="checkbox-label"><input type="checkbox" checked={includeHidden}
        onChange={(event) => query.update({ includeHidden: event.target.checked ? "true" : "" })} />Include hidden</label>
    </div>
    {filtered && <div className="filter-context" aria-label="Selected usage filters">
      <strong>Selected usage</strong>
      {model && <button onClick={() => query.update({ model: "" })} aria-label="Clear model filter">Model: {safeModel || "Not in this timeframe"} <span aria-hidden="true">×</span></button>}
      {scope && <button onClick={() => query.update({ scope: "" })} aria-label="Clear scope filter">Scope: {scopeLabels[scope] || "Invalid filter"} <span aria-hidden="true">×</span></button>}
      {day && <button onClick={() => query.update({ day: "" })} aria-label="Clear day filter">UTC day: {validUtcDay(day) ? day : "Invalid filter"} <span aria-hidden="true">×</span></button>}
      <p>Model, scope, and UTC day must match the same usage record. Whole-session totals stay unchanged; shutdown aggregates have no request-day timeline.</p>
    </div>}
    {source === "vscode" && <div className="notice">VS Code content-only sources cannot supply usage metadata. Data Sources in Settings explains availability.</div>}
    <LoadState {...state} skeleton="sessions" loadingLabel="Loading matching sessions...">{data && <>
      <div className="table-toolbar"><p className="result-count" role="status">{total} matching sessions
        {sessions.length > 0 && ` · Showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)}`}</p>
        <p className="scope-note">Highest known values first; missing values last. {sort === "delegation" ? "Delegation sorts whole-session child tokens." : filtered ? "Usage sorting follows the selected records." : "Usage covers each session's whole recorded history."}</p></div>
      <TableExplanation filtered={filtered} />
      {sessions.length ? <>
        <SessionTable sessions={sessions} link={query.link} filtered={filtered} sort={sort} onSort={(value) => query.update({ sort: value })} />
        <nav className="pagination" aria-label="Session pages">
          <button disabled={page === 1} onClick={() => query.update({ page: page - 1 })}>Previous page</button>
          <span aria-live="polite">Page {page} of {pageCount} · {PAGE_SIZE} per page</span>
          <button disabled={page === pageCount} onClick={() => query.update({ page: page + 1 })}>Next page</button>
        </nav>
      </> : <EmptyUsage filtered />}
      <Capabilities value={data.capabilities} explain={false} />
    </>}</LoadState>
  </>;
}
