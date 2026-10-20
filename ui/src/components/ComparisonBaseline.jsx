import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchSessions } from "../api.js";
import { MetricValue } from "./Usage.jsx";
import {
  BASELINE_KEY, RECORDED_METRICS, clearStored, laterSelection, laterSessions, metricChange,
  readBaseline, recordedSnapshot, saveBaseline, selectionDescription,
} from "../comparison-state.js";
import "./ComparisonBaseline.css";
import "./ResponsiveTables.css";

const storage = () => window.localStorage;
const storageError = (status) => ({
  corrupt: "The saved baseline is invalid or from an unsupported version. It has not been used. Clear it or explicitly replace it.",
  unavailable: "Local baseline storage is unavailable. Nothing was saved or cleared. Allow site storage and try again.",
  quota: "Local storage is full. The new baseline was not saved. Clear the saved baseline or free site storage and retry.",
})[status];
const sourceLabel = { sessiondb: "SessionDB", jsonl: "output events", "jsonl-shutdown": "shutdown aggregates", mixed: "mixed sources", "not-recorded": "source unavailable" };

function RecordedMetric({ metric }) {
  return <><MetricValue value={metric.value} />
    <span className="cell-note">{metric.status === "partial" ? "Partial · " : ""}{sourceLabel[metric.source]} · {metric.recorded}/{metric.total} observations</span></>;
}

function Difference({ before, after }) {
  const difference = metricChange(before, after);
  if (!difference) return <>Unavailable</>;
  return <>{difference.delta === 0 ? "No recorded change" : <><MetricValue value={Math.abs(difference.delta)} /> {difference.delta > 0 ? "more" : "fewer"}</>}
    <span className="cell-note">{difference.percent === null ? before === 0 ? "Percent unavailable: zero baseline" : "Percent unavailable"
      : `${Math.abs(difference.percent).toFixed(1)}%${difference.percent === 0 ? "" : difference.percent > 0 ? " more" : " fewer"}`}</span></>;
}

export default function ComparisonBaseline({ data, query, scenario }) {
  const [saved, setSaved] = useState(() => readBaseline(storage));
  const [feedback, setFeedback] = useState("");
  const [chooser, setChooser] = useState({ status: "idle", rows: [], checkedAt: null });
  const request = useRef(null);
  const baseline = saved.value;
  const current = recordedSnapshot(data, query, scenario);
  useEffect(() => {
    const changed = (event) => {
      if (event.key !== BASELINE_KEY && event.key !== null) return;
      setSaved(readBaseline(storage));
      setFeedback("Local baseline changed in another tab.");
      request.current?.abort();
      setChooser({ status: "idle", rows: [], checkedAt: null });
    };
    window.addEventListener("storage", changed);
    return () => { window.removeEventListener("storage", changed); request.current?.abort(); };
  }, []);
  function save() {
    const result = saveBaseline(storage, current);
    if (result.status === "ok") {
      setSaved(result);
      setFeedback("Recorded metric baseline saved locally. It will remain unchanged until you replace or clear it.");
      request.current?.abort();
      setChooser({ status: "idle", rows: [], checkedAt: null });
    } else {
      setFeedback(storageError(result.status));
    }
  }
  function clear() {
    const result = clearStored(storage, BASELINE_KEY);
    if (result.status === "empty") {
      setSaved(result);
      setFeedback("Local baseline cleared.");
      request.current?.abort();
      setChooser({ status: "idle", rows: [], checkedAt: null });
    } else setFeedback(storageError(result.status));
  }
  async function findLater(noCache = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setChooser({ status: "loading", rows: [], checkedAt: null });
    try {
      const response = await fetchSessions("all", {
        after: baseline.capturedAt, exclude: baseline.selection.session || undefined, sort: "later", pageSize: 12,
      }, { noCache, signal: controller.signal });
      if (controller.signal.aborted) return;
      setChooser({ status: "ready", rows: laterSessions(response.sessions, baseline), checkedAt: new Date().toISOString(), refreshed: noCache });
    } catch {
      if (!controller.signal.aborted) setChooser({ status: "error", rows: [], checkedAt: null });
    }
  }
  return <section className="comparison-baseline" aria-labelledby="recorded-comparison-heading">
    <h2 id="recorded-comparison-heading">Compare recorded snapshots</h2>
    <p>Save this selection before a manual trial. Return after a comparable task to compare its recorded metrics—not hypothetical model prices.</p>
    <p className="scope-note">One metric-only baseline stays in this browser until replaced or cleared. No content, paths, raw session IDs or custom names are saved.
      Scenario choices are assumptions, not evidence that a model was switched.</p>
    <div className="comparison-baseline-actions">
      <button onClick={save} disabled={!current || !data.models.length}>{baseline || saved.status === "corrupt" ? "Replace local baseline" : "Save local baseline"}</button>
      {(baseline || !["ok", "empty"].includes(saved.status)) && <button onClick={clear}>Clear local baseline</button>}
    </div>
    {storageError(saved.status) && <p className="notice" role="alert">{storageError(saved.status)}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {!baseline && <p className="scope-note">No saved baseline is available. Save a recorded selection first; then choose a model manually in Copilot and run a comparable task.</p>}
    {baseline && current && <>
      <div className="comparison-snapshot-context">
        <div><h3>Saved snapshot</h3><p>Saved at <time dateTime={baseline.capturedAt}>{baseline.capturedAt.replace("T", " ").replace(/Z$/, " UTC")}</time></p>
          <p className="scope-note">Capture time, not the time of the recorded usage; the loaded data may have been cached.</p>
          <p className="scope-note">{selectionDescription(baseline.selection, baseline.sessionCount)}</p>
          <p className="scope-note">Saved scenario: {baseline.scenario.baseline}; {baseline.scenario.mode}; trial {baseline.scenario.trial || "not chosen"}. Not recorded spend.</p></div>
        <div><h3>Current recorded selection</h3><p className="scope-note">{selectionDescription(current.selection, current.sessionCount)}</p>
          <p className="scope-note">Uses the loaded usage snapshot. Refresh usage deliberately to include new records; live-session updates may change this column.</p></div>
      </div>
      <p className="notice">These selections can differ in task, context, date, models, source and coverage. Current totals are whole selected history, not an incremental delta since the snapshot.
        Differences do not establish savings, quality or the effect of a model change.</p>
      <div className="session-table-scroll" role="region" aria-label="Recorded baseline comparison" tabIndex={0}>
        <table role="table" className="session-table responsive-card-table">
          <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Recorded metric</th><th role="columnheader" scope="col">Saved snapshot</th><th role="columnheader" scope="col">Current selection</th><th role="columnheader" scope="col">Recorded difference</th></tr></thead>
          <tbody role="rowgroup">{Object.entries(RECORDED_METRICS).map(([key, label]) => <tr role="row" key={key}>
            <th role="rowheader" scope="row">{label}</th>
            <td role="cell" data-label="Saved snapshot"><RecordedMetric metric={baseline.metrics[key]} /></td>
            <td role="cell" data-label="Current selection"><RecordedMetric metric={current.metrics[key]} /></td>
            <td role="cell" data-label="Recorded difference"><Difference before={baseline.metrics[key].value} after={current.metrics[key].value} />
              {(baseline.metrics[key].status === "partial" || current.metrics[key].status === "partial") && <span className="cell-note">Partial evidence; coverage differs or is incomplete</span>}</td>
          </tr>)}
          <tr role="row"><th role="rowheader" scope="row">Recorded model calls<span className="cell-note">SessionDB only</span></th>
            <td role="cell" data-label="Saved snapshot"><MetricValue value={baseline.calls.requests} /></td>
            <td role="cell" data-label="Current selection"><MetricValue value={current.calls.requests} /></td>
            <td role="cell" data-label="Recorded difference"><Difference before={baseline.calls.requests} after={current.calls.requests} /></td></tr>
          </tbody>
        </table>
      </div>
      <details><summary>Call outcomes and snapshot limits</summary>
        <p>Saved / current finished: <MetricValue value={baseline.calls.completed} /> / <MetricValue value={current.calls.completed} />;
          failed: <MetricValue value={baseline.calls.failed} /> / <MetricValue value={current.calls.failed} />;
          cancelled: <MetricValue value={baseline.calls.cancelled} /> / <MetricValue value={current.calls.cancelled} />;
          unknown: <MetricValue value={baseline.calls.unknown} /> / <MetricValue value={current.calls.unknown} />.</p>
        <p className="scope-note">Reported model calls can include model aggregates and are not the same as individual recorded calls.
          Total tokens require recorded input and output; cache fields are separate and must not be added to totals without verified accounting.
          A dash is unavailable, not zero. Completed calls do not measure task success.</p>
      </details>
      <h3>Choose a later session</h3>
      <p className="scope-note">Up to 12 visible sessions updated after the saved date, with newly created sessions first. The saved single session is excluded.
        An updated older session may overlap the baseline. Opening a session clears previous model, day, scope, source and timeframe filters, but keeps the baseline.</p>
      <div className="comparison-baseline-actions">
        <button onClick={() => findLater(false)} disabled={chooser.status === "loading"}>Find later sessions</button>
        <button onClick={() => findLater(true)} disabled={chooser.status === "loading"}>Check for newer sessions</button>
      </div>
      <p className="scope-note">Find uses the shared usage cache when available. Check for newer sessions explicitly requests fresh session metadata; no content is requested.</p>
      {chooser.status === "loading" && <p role="status">Looking for recorded sessions…</p>}
      {chooser.status === "error" && <p role="alert">Session metadata could not be loaded. Try Check for newer sessions again.</p>}
      {chooser.status === "ready" && <>
        <p role="status">{chooser.rows.length ? `${chooser.rows.length} later sessions available.` : "No later recorded sessions found."}
          {" "}{chooser.refreshed ? "Fresh metadata requested" : "Cached metadata may be included"} at {chooser.checkedAt.slice(11, 19)} UTC.</p>
        {!chooser.rows.length && <p>Run a new comparable task in Copilot, then choose <strong>Check for newer sessions</strong>. Keep this baseline for your return.</p>}
        <ul className="comparison-later-sessions">{chooser.rows.map((row, index) => <li key={row.handle}>
          <Link to={query.link("/tokens/compare", laterSelection(row.handle))}>Compare later session {index + 1}</Link>
          <span className="scope-note">{row.newSession ? "New session" : "Updated older session"} · {row.source === "cli" ? "Copilot CLI" : "VS Code"} · {row.updatedAt.replace("T", " ")}</span>
        </li>)}</ul>
      </>}
    </>}
  </section>;
}
