import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { fetchModelComparison } from "../api.js";
import { useUsageData } from "../hooks/useUsageData.js";
import { scopeLabels, useUsageQuery, validUtcDay } from "../hooks/useUsageQuery.js";
import { Capabilities, Evidence, knownNumber, LoadState, MetricValue, PageHeading, UsageTotal } from "../components/Usage.jsx";
import NumberValue from "../components/NumberValue.jsx";
import HelpDisclosure from "../components/HelpDisclosure.jsx";
import ComparisonBaseline from "../components/ComparisonBaseline.jsx";
import "../components/ResponsiveTables.css";
import { SCENARIO_KEY, clearStored, readScenario, saveScenario, scenarioDefaults, selectionKey, selectionMetadata } from "../comparison-state.js";
import { CACHE_MODES, combineBasis, costDifference, estimateCost, exactUsd } from "../model-comparison.js";
import { PRICING_CATALOG } from "../pricing-catalog.js";
import { COPILOT_MODEL_CATALOG, copilotModel, selectableCopilotModels } from "../../../src/copilot-model-catalog.mjs";

const priceFor = (model) => PRICING_CATALOG.models.find((price) => price.model === model);
const modelLabel = (model) => copilotModel(model)?.label ?? model;

function Cost({ value, price }) {
  if (value.usd === null) return <HelpDisclosure label={value.reason}>-</HelpDisclosure>;
  const tooltip = `${exactUsd(value.usd)} USD benchmark. Input ${exactUsd(value.components.input)}; output ${exactUsd(value.components.output)}; cache reads ${exactUsd(value.components.cacheRead)}. ` +
    `Rates per 1M: input ${exactUsd(price.input)}, output ${exactUsd(price.output)}, cache read ${exactUsd(price.cacheRead)}. ` +
    `Checked ${PRICING_CATALOG.checkedOn}. Eligible observations: ${value.coverage.included}/${value.coverage.total}. Not a Copilot bill.`;
  return <><NumberValue value={value.usd} metric="estimatedUsd" exact={exactUsd(value.usd)} tooltip={tooltip} />
    {value.partial && <span className="cell-note">Partial coverage</span>}</>;
}

function RecordedValue({ value, name }) {
  return knownNumber(value) ? <MetricValue value={value} name={name} /> : <span aria-label="Not recorded" title="Not recorded">-</span>;
}

function PricingAssumptions({ mode, setMode }) {
  return <div className="comparison-assumptions">
    <label>Cache treatment<select aria-label="Cache treatment" value={mode} onChange={(event) => setMode(event.target.value)}>
      {Object.entries(CACHE_MODES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></label>
    <details><summary>Cache assumptions and exclusions</summary><p className="scope-note">Recorded input/cache accounting is not verified. The default prices only input and output at standard rates,
      without adjusting for cache fields. Cache-aware scenarios are explicit assumptions; missing cache fields and writes with unknown TTL are excluded.
      Actual context tiers are not verified.</p></details>
  </div>;
}

function Observed({ models, mode, query }) {
  return <section aria-labelledby="observed-heading">
    <h2 id="observed-heading">Models you actually used</h2>
    <p className="scope-note">Different tasks, context sizes and execution scopes can explain differences. Finished calls and latency are not quality scores.</p>
    <div className="session-table-scroll comparison-scroll" role="region" aria-label="Observed model comparison" tabIndex={0}>
      <table role="table" className="session-table comparison-table responsive-card-table">
        <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Model</th><th role="columnheader" scope="col">Recorded tokens</th>
          <th role="columnheader" scope="col">Estimated token cost <span className="cell-note">USD standard-rate benchmark</span></th>
          <th role="columnheader" scope="col">Cache reads</th><th role="columnheader" scope="col">Model calls</th><th role="columnheader" scope="col">First-token latency</th><th role="columnheader" scope="col">Call outcomes</th></tr></thead>
        <tbody role="rowgroup">{models.map((row) => <tr role="row" key={row.model}>
          <th role="rowheader" scope="row"><Link to={query.link(query.session ? `/sessions/${query.session}` : "/sessions", { model: row.model, page: 1 })}>{row.model}</Link></th>
          <td role="cell" data-label="Recorded tokens" data-primary><UsageTotal metrics={row.metrics} /><Evidence value={row.evidence.totalTokens} /></td>
          <td role="cell" data-label="Estimated token cost"><Cost value={estimateCost(row.pricingBasis[mode], priceFor(row.model))} price={priceFor(row.model)} /></td>
          <td role="cell" data-label="Cache reads"><RecordedValue value={row.metrics.cacheReadTokens} name="cacheReadTokens" /><Evidence value={row.evidence.cacheReadTokens} /></td>
          <td role="cell" data-label="Model calls"><RecordedValue value={row.metrics.requests} /><Evidence value={row.evidence.requests} /></td>
          <td role="cell" data-label="First-token latency"><RecordedValue value={row.metrics.ttftMs} name="ttftMs" /><Evidence value={row.evidence.ttftMs} /></td>
          <td role="cell" data-label="Call outcomes">{row.outcomes.requests ? <><MetricValue value={row.outcomes.completed} /> finished
            <span className="cell-note">{row.outcomes.failed} failed / {row.outcomes.cancelled} cancelled / {row.outcomes.unknown} unknown</span>
            <span className="cell-note">SessionDB model calls only</span></> : <span className="scope-note" aria-label="No call outcomes" title="No call outcomes">-</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function Candidate({ label, value, onChange, options, available, exclude = [], optional = false }) {
  return <label>{label}<select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
    {optional && <option value="">None</option>}
    {options.filter((name) => name === value || !exclude.includes(name)).map((name) =>
      <option key={name} value={name}>{modelLabel(name)}
        {!available.includes(name) ? " (historical / not listed for CLI)"
          : copilotModel(name)?.restriction ? ` (${copilotModel(name).restriction})` : ""}
        {!priceFor(name) ? " (pricing unavailable)" : ""}</option>)}
  </select></label>;
}

function WhatIf({ models, mode, query, scenario, updateScenario }) {
  const options = selectableCopilotModels().map((entry) => entry.key);
  const { baseline, first, second, trial } = scenario;
  const firstChoice = options.includes(first) ? first : "";
  const secondChoice = options.includes(second) ? second : "";
  const basis = combineBasis(models, mode);
  const baselineValue = estimateCost(basis, priceFor(baseline));
  const candidates = [...new Set([baseline, firstChoice, secondChoice].filter(Boolean))];
  const activeTrial = candidates.includes(trial) && options.includes(trial) ? copilotModel(trial) : null;
  const notices = [...new Set(candidates.map((model) => copilotModel(model)?.notice).filter(Boolean))];
  return <section aria-labelledby="what-if-heading">
    <h2 id="what-if-heading">Same usage, different model prices</h2>
    <p>The same eligible token mix at each model's standard rates, not a prediction of a rerun.</p>
    <p className="scope-note">Alternatives use the{" "}
      <a href={COPILOT_MODEL_CATALOG.source} target="_blank" rel="noopener noreferrer">published Copilot CLI model list</a>
      {" "}(checked {COPILOT_MODEL_CATALOG.checkedOn}), not the pricing catalog. Your plan, client version and organization policy determine access;
      this is not a check of your account. The list is bundled for offline use; Refresh reloads usage, not model availability.</p>
    <div className="filter-bar comparison-candidates">
      <Candidate label="Baseline model" value={baseline} available={options} options={[...new Set([baseline, ...models.map((row) => row.model), ...options])]}
        onChange={(value) => updateScenario({ baseline: value, first: first === value ? "" : first, second: second === value ? "" : second, trial: "" })} />
      <Candidate label="Alternative 1" value={firstChoice} available={options} options={options} exclude={[baseline, secondChoice]} optional onChange={(value) => updateScenario({ first: value, trial: "" })} />
      <Candidate label="Alternative 2" value={secondChoice} available={options} options={options} exclude={[baseline, firstChoice]} optional onChange={(value) => updateScenario({ second: value, trial: "" })} />
    </div>
    {(first && !firstChoice || second && !secondChoice) && <p className="notice">A selected alternative reached its published retirement date. Choose another model.</p>}
    {notices.map((notice) => <p className="notice" key={notice}>{notice}</p>)}
    <p className="comparison-basis" role="status">Eligible observations: <MetricValue value={basis.included} /> of <MetricValue value={basis.total} />.
      {" "}Pricing input: <MetricValue value={basis.inputTokens} /> / output: <MetricValue value={basis.outputTokens} />
      {mode !== "uncached" && <> / cache reads: <MetricValue value={basis.cacheReadTokens} /></>}.
      {" "}Model calls or model aggregates; incomplete observations excluded.</p>
    {baselineValue.usd === null && <p className="notice">The baseline cannot be priced for this selection. Available alternatives can show a benchmark, but no savings claim.</p>}
    <div className="session-table-scroll comparison-scroll" role="region" aria-label="What-if model comparison" tabIndex={0}>
      <table role="table" className="session-table comparison-table what-if-table responsive-card-table">
        <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Model</th><th role="columnheader" scope="col">Estimated token cost <span className="cell-note">Same eligible usage / USD benchmark</span></th>
          <th role="columnheader" scope="col">Difference from baseline</th><th role="columnheader" scope="col">Next step</th></tr></thead>
        <tbody role="rowgroup">{candidates.map((model) => {
          const price = priceFor(model), estimate = estimateCost(basis, price);
          const difference = costDifference(estimate.usd, baselineValue.usd);
          return <tr role="row" key={model}>
            <th role="rowheader" scope="row">{modelLabel(model)}{model === baseline && <span className="cell-note">Baseline scenario, not recorded spend</span>}
              {!options.includes(model) && <span className="cell-note">Historical / not listed for CLI</span>}
              {options.includes(model) && copilotModel(model)?.retiresOn && <span className="cell-note">Retires {copilotModel(model).retiresOn}</span>}</th>
            <td role="cell" data-label="Estimated token cost"><Cost value={estimate} price={price} /></td>
            <td role="cell" data-label="Difference from baseline">{model === baseline ? "Baseline" : difference === null ? "Unavailable"
              : difference.usd === 0 ? "Same benchmark"
                : <><NumberValue value={Math.abs(difference.usd)} metric="estimatedUsd" exact={exactUsd(Math.abs(difference.usd))} />
                  {" "}{difference.usd < 0 ? "lower" : "higher"}
                  {difference.percent !== null && <span className="cell-note">{Math.abs(difference.percent).toFixed(1)}% at these fixed rates</span>}</>}</td>
            <td role="cell" data-label="Next step" data-action>{model !== baseline && options.includes(model) && <button onClick={() => updateScenario({ trial: model })}>Choose for trial: {modelLabel(model)}</button>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {activeTrial && <aside className="notice comparison-trial" aria-label="Model trial">
      <h3>Try {activeTrial.label} on a comparable task</h3>
      <p>Choose the model manually in Copilot. Compare similar task complexity and context, then Refresh this app and review the recorded usage.
        Check the result yourself; lower estimated cost does not establish equivalent quality.</p>
      <p>Use Save local baseline below before your trial. Afterward, return here and choose a later session.</p>
      {!priceFor(trial) && <p>Pricing is unavailable for this model. Compare recorded tokens, latency and outcomes without a savings estimate.</p>}
      {!activeTrial.model && <p>The published model name is known, but its usage identifier is not verified. Browse sessions without guessing a model filter.</p>}
      <Link to={query.link("/sessions", { model: activeTrial.model ?? "", scope: "", day: "", session: "", page: 1 })}>
        {activeTrial.model ? `View recorded ${activeTrial.label} sessions` : "Browse recorded sessions"}</Link>
      <p className="scope-note">Nothing is switched, saved as a plan, or sent to a model. This scenario stays in this tab for this exact selection, subject to site storage availability.</p>
    </aside>}
  </section>;
}

function RateNotes() {
  return <details className="comparison-rates">
    <summary>Pricing sources, rates and limitations - checked {PRICING_CATALOG.checkedOn}</summary>
    <p>{PRICING_CATALOG.notice}</p>
    <div className="session-table-scroll" role="region" aria-label="Documented pricing rates" tabIndex={0}>
      <table className="session-table what-if-table"><thead><tr>
        <th scope="col">Model</th><th scope="col">Input / 1M</th><th scope="col">Output / 1M</th><th scope="col">Cache read / 1M</th><th scope="col">Official source</th>
      </tr></thead><tbody>{PRICING_CATALOG.models.map((price) => <tr key={price.model}>
        <th scope="row">{price.model}</th><td>{exactUsd(price.input)}</td><td>{exactUsd(price.output)}</td>
        <td>{exactUsd(price.cacheRead)}</td><td><a href={price.source} target="_blank" rel="noopener noreferrer">{price.provider} pricing</a></td>
      </tr>)}</tbody></table>
    </div>
    <p className="scope-note">Rates are bundled for offline use, not fetched while you browse. They are a dated reference, not a guarantee of current prices.
      No AIU, request-cost units or premium-request multipliers are converted to money. Copilot billing, taxes, tools, service tiers and future model behavior are not predicted.</p>
  </details>;
}

function Comparison({ data, query }) {
  const models = [...data.models].sort((a, b) => (b.metrics.totalTokens ?? -1) - (a.metrics.totalTokens ?? -1) || a.model.localeCompare(b.model));
  const tabStorage = () => window.sessionStorage;
  const [stored, setStored] = useState(() => readScenario(tabStorage, query));
  const [scenario, setScenario] = useState(() => stored.value ?? scenarioDefaults(models, PRICING_CATALOG.models.map((price) => price.model)));
  const { mode, view } = scenario;
  function updateScenario(changes) {
    const next = { ...scenario, ...changes };
    setScenario(next);
    setStored(saveScenario(tabStorage, query, next));
  }
  const setMode = (value) => updateScenario({ mode: value });
  const coverage = combineBasis(models, mode);
  return <>
    <div className="comparison-context">
      <strong>{data.sessionLabel || `${data.sessionCount} selected sessions`}</strong>
      {query.scope && <span>{scopeLabels[query.scope] || "Invalid scope"}</span>}
      {query.day && <span>{validUtcDay(query.day) ? `${query.day} UTC` : "Invalid UTC day"}</span>}
      {query.source && <span>{query.source === "cli" ? "Copilot CLI" : "VS Code"}</span>}
      {query.includeHidden && <span>Includes hidden sessions</span>}
      <Link to={query.link("/sessions")}>Change session filters</Link>
    </div>
    <label className="comparison-model-filter">Usage model<select aria-label="Usage model" value={query.model} onChange={(event) => query.update({ model: event.target.value })}>
      <option value="">All selected models</option>
      {query.model && !data.availableModels.includes(query.model) && <option value={query.model}>Selected model unavailable</option>}
      {data.availableModels.map((model) => <option key={model}>{model}</option>)}
    </select></label>
    <p className="notice">USD standard-rate benchmark, not your Copilot bill. Assumes requests up to 200K context tokens; future savings are not established.</p>
    {!["ok", "empty"].includes(stored.status) && <div className="notice" role="alert">
      <p>{stored.status === "corrupt" ? "Saved tab scenarios are invalid and were not used." : "Tab scenario storage is unavailable or full."}
        {" "}Current choices work on this page but may not survive navigation or reload.</p>
      <button onClick={() => {
        const cleared = clearStored(tabStorage, SCENARIO_KEY);
        setStored(cleared.status === "empty" ? saveScenario(tabStorage, query, scenario) : cleared);
      }}>Reset saved tab scenarios and retry</button>
    </div>}
    <PricingAssumptions mode={mode} setMode={setMode} />
    <p className="scope-note">View, cache assumptions and trial choices are kept in this tab for the last eight exact selections.
      Changing usage filters starts a separate scenario; returning restores that selection's choices.</p>
    {models.length ? <>
      <div className="attention-switches" role="group" aria-label="Comparison view">
        <button aria-pressed={view === "observed"} onClick={() => updateScenario({ view: "observed" })}>Observed usage</button>
        <button aria-pressed={view === "what-if"} onClick={() => updateScenario({ view: "what-if" })}>What-if cost</button>
      </div>
      <p className="scope-note comparison-coverage">{coverage.included}/{coverage.total} eligible observations;
        {" "}{models.filter((row) => priceFor(row.model)).length}/{models.length} observed models have price profiles.
        {" "}A dash means unavailable, never zero. Hover, focus or tap a cost for details.</p>
      <div hidden={view !== "observed"}><Observed models={models} mode={mode} query={query} /></div>
      <div hidden={view !== "what-if"}><WhatIf models={models} mode={mode} query={query} scenario={scenario} updateScenario={updateScenario} /></div>
    </> : <section className="notice"><h2>No comparable usage in this selection</h2>
      <p>Change the session filters or timeframe. Output-only history can be inspected, but cannot provide a complete input/output cost benchmark.</p></section>}
    <ComparisonBaseline data={data} query={query} scenario={scenario} />
    <RateNotes />
    <Capabilities value={data.capabilities} explain={false} />
  </>;
}

export default function ModelComparison() {
  const query = useUsageQuery();
  const { timeframe, model, scope, day, source, includeHidden, session } = query;
  const valid = selectionMetadata(query) !== null;
  const state = useUsageData(useCallback((options) => valid ? fetchModelComparison(timeframe, {
    model, scope, day, source, includeHidden, session,
  }, options).then((data) => ({ ...data, comparisonSelection: selectionKey({ timeframe, model, scope, day, source, includeHidden, session }) }))
    : Promise.reject(new Error("Invalid comparison selection. Choose valid session filters.")),
  [valid, timeframe, model, scope, day, source, includeHidden, session]), { pollActive: valid && Boolean(session) });
  if (!valid) return <section className="notice"><h1>Invalid comparison selection</h1>
    <p>No saved scenario has been applied. Choose valid filters to continue.</p><Link to="/tokens/compare?timeframe=all">Reset comparison filters</Link></section>;
  return <>
    <Link className="back-link" to={query.link(session ? `/sessions/${session}` : "/tokens")}>
      {session ? "Back to session" : "Back to Token Usage"}
    </Link>
    <PageHeading title="Compare models" description="Inspect observed usage, then test a same-usage pricing scenario."
      {...(!session ? { timeframe, setTimeframe: query.setTimeframe } : {})} />
    <p className="scope-note">Timeframe selects sessions; totals cover their recorded history. Model, scope and UTC-day filters match the same observations.</p>
    <LoadState {...state} skeleton="comparison" loadingLabel="Loading model comparison...">{state.data?.comparisonSelection === selectionKey(query)
      && <Comparison key={selectionKey(query)} data={state.data} query={query} />}</LoadState>
  </>;
}
