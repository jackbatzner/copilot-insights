import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AllMetrics, Evidence, formatMetric, knownNumber, LoadState, MetricValue, UsageTotal } from "./Usage.jsx";
import { scopeLabels, validUtcDay } from "../hooks/useUsageQuery.js";
import { outcomeLabels } from "../usage-data.js";
import { fetchSessionTurns } from "../api.js";
import { useUsageData } from "../hooks/useUsageData.js";
import { LocalContentView, LocalTextPreview, useLocalContent } from "./LocalContent.jsx";
import { safeUsageQueryValues } from "../usage-query-values.js";
import { callEnding } from "../turn-usage.js";

const counted = (count, label) => `${formatMetric(count)} ${label}${count === 1 ? "" : "s"}`;

function Pages({ value, onChange, label }) {
  if (value.pages === 1) return null;
  return <nav className="turn-pages" aria-label={label}>
    <button disabled={value.page === 1} onClick={() => onChange(value.page - 1)}>Previous {label}</button>
    <span>Page {value.page} of {value.pages}</span>
    <button disabled={value.page === value.pages} onClick={() => onChange(value.page + 1)}>Next {label}</button>
  </nav>;
}

function CallSummary({ value }) {
  return <p className="call-summary scope-note">{value
    ? [counted(value.total, "matching call"), ...["primary", "subagent", "unattributed"]
      .filter((scope) => value.scopes[scope] > 0)
      .map((scope) => `${formatMetric(value.scopes[scope])} ${scope}`)].join(" · ")
    : "Call ownership counts are unavailable."}</p>;
}

function Request({ value, attribution, onInspect, onBack }) {
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const targetIndex = attribution.findIndex((group) => group.key === value.attributionKey);
  const ending = callEnding(value.finishReason);
  return <article className="usage-request">
    <button onClick={onBack}>Back to turn</button>
    <header className="inspector-heading">
      <div><h4 ref={heading} tabIndex={-1}>Model call {value.ordinal}</h4><span className="scope-note">{value.model} · {scopeLabels[value.scope]}</span></div>
      <span><UsageTotal metrics={value.metrics} /></span>
      <span className="scope-note">{value.createdAt ? <time dateTime={value.createdAt}>{value.createdAt.replace("T", " ").replace("Z", " UTC")}</time> : "Time unavailable"}</span>
    </header>
    <div className="request-evidence">
      <section className="call-explanation" aria-label="Call explanation">
        <h5>What we know about this call</h5>
        <p>{value.correlation === "exact-child"
          ? `Recorded child-agent call in ${value.agentLabel}'s invocation. The parent LLM call that triggered the invocation is not identified.`
          : value.correlation === "recorded-primary"
            ? "Recorded primary-agent call. Its triggering event is not identified."
            : "Agent ownership and the triggering event are unknown."}</p>
        <p><strong>Ending: {ending.label}</strong> <span className="scope-note">
          {ending.label === "Ending unknown" ? "Not recorded" : "Recorded · SessionDB finish reason"}
        </span></p>
        <p>{ending.description}</p>
        {value.contentFiltered === true && <p className="scope-note">SessionDB also records a content-filter flag for this call. No filtered content is displayed.</p>}
      </section>
      <dl className="request-context">
        <div><dt>Recorded model</dt><dd>{value.model}</dd></div>
        <div><dt>Agent</dt><dd>{value.agentLabel}</dd></div>
        <div><dt>Relationship</dt><dd>{value.correlation === "exact-child" ? "Exact child linkage"
          : value.correlation === "recorded-primary" ? "Recorded primary" : "Unattributed"}</dd></div>
        {value.requestedModel && <div><dt>Requested model</dt><dd>{value.requestedModel}</dd></div>}
        {value.invocationCategory && <div><dt>Invocation category</dt><dd>{value.invocationCategory}</dd></div>}
        {value.outcome !== "not-recorded" && <div><dt>Recorded outcome</dt><dd>{outcomeLabels[value.outcome]}</dd></div>}
      </dl>
      <AllMetrics metrics={value.metrics} evidence={value.evidence} />
      {targetIndex >= 0 && <a className="request-attribution-link" href={`#attribution-${targetIndex}`} onClick={(event) => {
        event.preventDefault();
        onInspect(value.attributionKey, event.currentTarget);
      }}>Inspect {value.agentLabel} attribution</a>}
    </div>
  </article>;
}

function Turn({ value, attribution, toolUsage, onInspect, handle, filters, revision, selected, onSelect, inspector }) {
  const [requestPage, setRequestPage] = useState(1);
  const [requestKey, setRequestKey] = useState(null);
  const row = useRef(null);
  const requestNodes = useRef(new Map());
  const content = useLocalContent({ kind: "turn", turnIndex: value.turnIndex });
  const calls = useUsageData(useCallback((options) => fetchSessionTurns(handle, {
    ...filters, turn: value.turnIndex ?? "unassigned", requestPage,
  }, options), [handle, filters, value.turnIndex, requestPage, revision]), { enabled: selected });
  const loadedTurn = calls.data?.turns[0];
  const page = loadedTurn?.requestPagination ?? value.requestPagination;
  const childKeys = new Set(value.childAttributionKeys);
  const tools = (toolUsage?.groups || []).filter((group) => group.attributionKey && childKeys.has(group.attributionKey));
  const matching = value.matchingUsage;
  const filtered = value.matchingRequestCount !== value.requestCount;
  const request = loadedTurn?.requests.find((entry) => entry.key === requestKey);
  useEffect(() => {
    if (!selected) return;
    inspector?.querySelector("h3")?.focus({ preventScroll: true });
    if (window.matchMedia("(max-width: 900px)").matches) inspector?.scrollIntoView({ block: "start" });
  }, [selected, inspector]);
  const backToTurn = () => {
    const key = requestKey;
    setRequestKey(null);
    requestAnimationFrame(() => requestNodes.current.get(key)?.focus());
  };
  return <>
    <button ref={row} className="turn-list-row" aria-label={`Inspect ${value.label}`} aria-pressed={selected}
      onClick={() => onSelect(value.key)}>
      <span><strong>{value.label}</strong><LocalTextPreview content={content} /><span className="scope-note">{value.matchingRequestCount} of {counted(value.requestCount, "recorded model call")}</span></span>
      <span className="turn-models">{value.models.join(" · ")}</span>
      <span className="turn-total">{filtered && <span className="matching-total"><UsageTotal metrics={matching.metrics} interactive={false} /><span className="scope-note">Matching calls{matching.evidence.totalTokens.status === "partial" ? " · Partial" : ""}</span></span>}
        <UsageTotal metrics={value.metrics} interactive={false} /><span className="scope-note">{value.turnIndex === null ? "Unassigned total" : "Whole turn"}</span></span>
    </button>
    {selected && inspector && createPortal(<article className="usage-turn">
      <div className="inspector-heading"><h3 tabIndex={-1}>{value.label}</h3><button onClick={() => {
        onSelect(null);
        requestAnimationFrame(() => row.current?.focus());
      }}>Back to turns</button></div>
      {requestKey ? <LoadState {...calls} loadingLabel="Loading model call evidence...">{request
        ? <Request value={request} attribution={attribution} onInspect={onInspect} onBack={backToTurn} />
        : <><p className="notice">This call is no longer in the current page of evidence.</p><button onClick={backToTurn}>Back to turn</button></>}</LoadState>
        : <div className="turn-content">
      <div className="inspector-total"><UsageTotal metrics={value.metrics} /><span className="scope-note">Whole turn</span></div>
      {value.turnIndex !== null && <LocalContentView content={content} />}
      <div className="turn-evidence">
        <Evidence value={value.evidence.totalTokens} />
        {knownNumber(value.metrics.cacheReadTokens) && <span>Group cache reads: <MetricValue value={value.metrics.cacheReadTokens} name="cacheReadTokens" /></span>}
      </div>
      {filtered && <div className="selected-usage"><strong>Matching model calls in this turn</strong><AllMetrics metrics={matching.metrics} evidence={matching.evidence} /></div>}
      <p className="scope-note">Showing matching model calls below. Whole-turn totals include every call in this group; cache is separate from input plus output.</p>
      {tools.length > 0 && <div className="turn-tool-links" role="group" aria-label="Associated child tool activity">
        <strong>Associated child activity</strong>
        <p className="scope-note">Invocation-wide tools, not assigned to this turn. The same child can appear in several turns.</p>
        {tools.map((group) => <button key={group.attributionKey} onClick={(event) => onInspect(group.attributionKey, event.currentTarget)}>
          Inspect {group.agentLabel} tools (<MetricValue value={group.count} interactive={false} />)
        </button>)}
      </div>}
      <LoadState {...calls} loadingLabel="Loading model calls...">{loadedTurn && <>
        <CallSummary value={loadedTurn.callBreakdown} />
        <ol className="request-list" aria-label="Recorded model calls">{loadedTurn.requests.map((request) => <li key={request.key}><button className="request-list-row"
          aria-label={`Inspect model call ${request.ordinal}`} ref={(node) => {
            if (node) requestNodes.current.set(request.key, node); else requestNodes.current.delete(request.key);
          }}
          onClick={() => setRequestKey(request.key)}>
          <span><strong>Model call {request.ordinal}</strong><span className="scope-note">{request.model} · {request.agentLabel}</span>
            <span className="call-ending">Ending: {callEnding(request.finishReason).label}</span></span>
          <span><UsageTotal metrics={request.metrics} interactive={false} /><span className="scope-note">{outcomeLabels[request.outcome] || "Outcome not recorded"}</span></span>
        </button></li>)}</ol>
        <Pages value={page} onChange={(value) => { setRequestPage(value); setRequestKey(null); }} label="model calls" />
      </>}</LoadState>
    </div>}
    </article>, inspector)}
  </>;
}

export default function TurnUsage({ handle, revision, models, attribution, toolUsage, initialFilters, onInspect }) {
  const [model, setModel] = useState(() => safeUsageQueryValues({ model: initialFilters.model }).model);
  const [scope, setScope] = useState(Object.hasOwn(scopeLabels, initialFilters.scope) ? initialFilters.scope : "");
  const [day, setDay] = useState(validUtcDay(initialFilters.day) ? initialFilters.day : "");
  const [assignment, setAssignment] = useState("");
  const [sort, setSort] = useState("turn");
  const [page, setPage] = useState(1);
  const [selectedTurn, setSelectedTurn] = useState(null);
  const [inspector, setInspector] = useState(null);
  const invalidModel = model === "invalid-model";
  const filters = useMemo(() => ({ model, scope, day, assignment, sort }), [model, scope, day, assignment, sort]);
  const state = useUsageData(useCallback((options) => fetchSessionTurns(handle, { ...filters, page }, options),
    [handle, filters, page, revision]), { enabled: !invalidModel });
  const value = state.data;
  const turns = value?.turns ?? [];
  const matchingCount = value?.matchingRequestCount ?? 0;
  const filtered = Boolean(model || scope || day || assignment);
  const change = (setter, value) => { setPage(1); setSelectedTurn(null); setter(value); };
  return <section className="turn-explorer" aria-labelledby="turn-usage-heading">
    <div className="section-heading"><div><h2 id="turn-usage-heading">Turns &amp; model calls</h2>
      <p>A turn is a conversation step. It can make several model calls, including calls from child agents.</p></div></div>
    {value && value.status !== "available" ? <p className="notice" role="note">
      {value?.status === "aggregate-only"
        ? "Only shutdown aggregates are available. They cannot reconstruct individual turns or requests; choose Agents & models for recorded attribution."
        : "Individual SessionDB usage requests are unavailable. Recorded aggregates and output-only history cannot reconstruct turns."}
    </p> : <>
      {value && <p className="turn-coverage">{counted(value.requestCount, "recorded model call")} · {formatMetric(value.turnCount)} recorded turn {value.turnCount === 1 ? "index" : "indices"} · {counted(value.unassignedRequestCount, "unassigned model call")}</p>}
      <details className="scope-explanation"><summary>How calls relate to turns and text</summary><p className="scope-note">Turn labels use the recorded index, including Turn 0. Missing or invalid indices stay Unassigned.
        Unassigned calls are not necessarily part of one turn. The call summary counts all matching calls across every page, using SessionDB ownership.
        Call numbers identify observations, not a guaranteed execution sequence. Timestamps are UTC where verified.
        Recorded endings describe how calls stopped, not what triggered the next call; tool continuations and retries are not inferred.
        Input may include earlier context; these measurements do not assign cost to individual comments. Original text is controlled by presentation mode.</p></details>
      <div className="filter-bar turn-filters">
        <label>Model call model<select aria-label="Model call model" value={model} onChange={(event) => change(setModel, event.target.value)}>
          <option value="">All models</option>
          {model && !models.includes(model) && <option value={model}>Selected model (not recorded)</option>}
          {models.map((name) => <option key={name}>{name}</option>)}
        </select></label>
        <label>Model call scope<select value={scope} onChange={(event) => change(setScope, event.target.value)}>
          <option value="">All scopes</option>{Object.entries(scopeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>Model call UTC day<input type="date" value={day} onChange={(event) => change(setDay, event.target.value)} /></label>
        <label>Turn assignment<select value={assignment} onChange={(event) => change(setAssignment, event.target.value)}>
          <option value="">All model calls</option><option value="assigned">Recorded turn</option><option value="unassigned">Unassigned</option>
        </select></label>
        <label>Turn order<select value={sort} onChange={(event) => change(setSort, event.target.value)}>
          <option value="turn">Recorded index</option><option value="tokens">Highest whole-turn tokens</option>
        </select></label>
        {filtered && <button onClick={() => { setModel(""); setScope(""); setDay(""); setAssignment(""); setPage(1); setSelectedTurn(null); }}>Clear model call filters</button>}
      </div>
      {invalidModel && <><p className="notice" role="alert">Invalid model selection. Clear model call filters to choose a recorded model.</p>
        <p className="scope-note" role="status">0 matching model calls for the invalid selection.</p></>}
      {!invalidModel && <LoadState {...state} loadingLabel="Loading turns...">{value && <>
        <p className="scope-note" role="status">{counted(matchingCount, "matching model call")} in {counted(value.matchingTurnCount, "group")}. Whole-session totals and attribution remain unchanged.</p>
        {!turns.length ? <p className="notice">No model calls match these filters. Clear model call filters to see all recorded calls.</p>
          : <div className={`turn-workspace${turns.some((turn) => turn.key === selectedTurn) ? " has-selection" : ""}`}>
            <div className="turn-list" aria-label="Recorded turns" key={JSON.stringify({ ...filters, page: value.pagination.page })}>
              {turns.map((turn) => <Turn key={turn.key} value={turn} handle={handle} revision={revision} filters={filters}
                selected={selectedTurn === turn.key} onSelect={setSelectedTurn} inspector={inspector}
                attribution={attribution} toolUsage={toolUsage} onInspect={onInspect} />)}
              <Pages value={value.pagination} onChange={(value) => { setSelectedTurn(null); setPage(value); }} label="turns" />
            </div>
            <section className="turn-inspector" ref={setInspector} aria-label="Turn inspector">
              {!turns.some((turn) => turn.key === selectedTurn) && <div className="inspector-empty"><h3>Select a turn</h3>
                <p>Inspect its usage and model calls here without losing your place in the list.</p></div>}
            </section>
          </div>}
      </>}</LoadState>}
      <p className="scope-note">Only stable same-session evidence links child requests to an invocation. Skills remain independent session-level observations, not inferred causes of model usage.</p>
    </>}
  </section>;
}
