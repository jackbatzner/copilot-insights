import { safeModel, isUtcDay, safeDate } from "../../src/usage-metrics.mjs";
import { COPILOT_MODEL_CATALOG, selectableCopilotModels } from "../../src/copilot-model-catalog.mjs";

export const SCENARIO_KEY = "copilot-insights-comparison-tab-v1";
export const BASELINE_KEY = "copilot-insights-comparison-baseline-v1";
export const RECORDED_METRICS = {
  totalTokens: "Total tokens", inputTokens: "Input tokens", outputTokens: "Output tokens",
  requests: "Reported model calls", cacheReadTokens: "Cache read tokens", cacheWriteTokens: "Cache write tokens",
};
const MODES = ["uncached", "cache-included", "cache-excluded"];
const SOURCES = ["sessiondb", "jsonl", "jsonl-shutdown", "mixed", "not-recorded"];
const STATUSES = ["recorded", "derived", "partial", "not-recorded"];
const OUTCOMES = ["requests", "completed", "failed", "cancelled", "unknown"];
const MAX_BYTES = 24_000;
const MAX_SCENARIOS = 8;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const number = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const timestamp = (value) => typeof value === "string" && safeDate(value) === value;
export const validHandle = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const telemetryModel = (value) => typeof value === "string" && (value === "Unknown model" || safeModel(value) !== "Unknown model");
const catalogModel = (value) => COPILOT_MODEL_CATALOG.models.some((entry) => entry.key === value);
const scenarioModel = (value) => telemetryModel(value) || catalogModel(value);

export function selectionMetadata(query) {
  const result = {
    timeframe: query.timeframe ?? "all", model: query.model ?? "", scope: query.scope ?? "",
    day: query.day ?? "", source: query.source ?? "", includeHidden: query.includeHidden ?? false,
    session: query.session ?? "",
  };
  return ["all", "7d", "30d", "90d"].includes(result.timeframe)
    && (!result.model || telemetryModel(result.model))
    && ["", "primary", "subagent", "unattributed"].includes(result.scope)
    && (!result.day || isUtcDay(result.day)) && ["", "cli", "vscode"].includes(result.source)
    && typeof result.includeHidden === "boolean" && (!result.session || validHandle(result.session)) ? result : null;
}

export function selectionKey(query) {
  const value = selectionMetadata(query);
  return value ? JSON.stringify(value) : null;
}

function validSelection(value) {
  return exactKeys(value, ["timeframe", "model", "scope", "day", "source", "includeHidden", "session"])
    && selectionMetadata(value) !== null;
}

export function validScenario(value) {
  return exactKeys(value, ["view", "mode", "baseline", "first", "second", "trial"])
    && ["observed", "what-if"].includes(value.view) && MODES.includes(value.mode)
    && scenarioModel(value.baseline) && [value.first, value.second, value.trial].every((entry) => entry === "" || catalogModel(entry))
    && (!value.first || value.first !== value.baseline) && (!value.second || ![value.baseline, value.first].includes(value.second))
    && (!value.trial || [value.first, value.second].includes(value.trial));
}

function validScenarioStore(value) {
  return exactKeys(value, ["version", "entries"]) && value.version === 1 && Array.isArray(value.entries)
    && value.entries.length <= MAX_SCENARIOS && value.entries.every((entry) =>
      exactKeys(entry, ["selection", "scenario"]) && validSelection(entry.selection) && validScenario(entry.scenario));
}

function read(storage, key, validate) {
  try {
    const raw = storage().getItem(key);
    if (raw === null) return { status: "empty", value: null };
    if (raw.length > MAX_BYTES) return { status: "corrupt", value: null };
    const value = JSON.parse(raw);
    return validate(value) ? { status: "ok", value } : { status: "corrupt", value: null };
  } catch (error) {
    return { status: error instanceof SyntaxError ? "corrupt" : "unavailable", value: null };
  }
}

function write(storage, key, value) {
  try {
    const raw = JSON.stringify(value);
    if (raw.length > MAX_BYTES) return { status: "corrupt", value: null };
    storage().setItem(key, raw);
    return { status: "ok", value };
  } catch (error) {
    return { status: error?.name === "QuotaExceededError" ? "quota" : "unavailable", value: null };
  }
}

export function clearStored(storage, key) {
  try { storage().removeItem(key); return { status: "empty", value: null }; }
  catch { return { status: "unavailable", value: null }; }
}

export function readScenario(storage, query) {
  const stored = read(storage, SCENARIO_KEY, validScenarioStore);
  return { status: stored.status, value: stored.value?.entries.find((entry) =>
    selectionKey(entry.selection) === selectionKey(query))?.scenario ?? null };
}

export function saveScenario(storage, query, scenario) {
  const selection = selectionMetadata(query);
  if (!selection || !validScenario(scenario)) return { status: "corrupt", value: null };
  const stored = read(storage, SCENARIO_KEY, validScenarioStore);
  // Do not silently replace corrupted or inaccessible storage.
  if (!["empty", "ok"].includes(stored.status)) return stored;
  const entries = (stored.value?.entries ?? []).filter((entry) => selectionKey(entry.selection) !== selectionKey(selection));
  entries.push({ selection, scenario });
  return write(storage, SCENARIO_KEY, { version: 1, entries: entries.slice(-MAX_SCENARIOS) });
}

export function scenarioDefaults(models, pricedModels) {
  const options = selectableCopilotModels().map((entry) => entry.key);
  const defaults = options.filter((key) => pricedModels.includes(key) && !COPILOT_MODEL_CATALOG.models.find((entry) => entry.key === key)?.restriction);
  const baseline = models.find((row) => telemetryModel(row.model))?.model || options[0];
  const first = defaults.find((key) => key !== baseline) || "";
  return { view: "observed", mode: "uncached", baseline, first, second: defaults.find((key) => key !== baseline && key !== first) || "", trial: "" };
}

function aggregateMetric(models, key) {
  const present = models.filter((row) => number(row.metrics?.[key]));
  const sum = present.reduce((total, row) => total + row.metrics[key], 0);
  const recorded = models.reduce((total, row) => total + (count(row.evidence?.[key]?.recorded) ? row.evidence[key].recorded : 0), 0);
  const total = models.reduce((sum, row) => sum + (count(row.evidence?.[key]?.total) ? row.evidence[key].total : 0), 0);
  const sources = [...new Set(present.map((row) => row.evidence?.[key]?.source))];
  const value = present.length && number(sum) ? sum : null;
  return {
    value, recorded, total,
    source: value === null ? "not-recorded" : sources.length > 1 ? "mixed" : SOURCES.includes(sources[0]) ? sources[0] : "not-recorded",
    status: value === null ? "not-recorded" : present.length < models.length || recorded < total ? "partial"
      : key === "totalTokens" ? "derived" : "recorded",
  };
}

export function recordedSnapshot(data, query, scenario, now = new Date()) {
  const models = Array.isArray(data.models) ? data.models : [];
  const calls = models.filter((row) => row.outcomes?.source === "sessiondb" && count(row.outcomes.requests) && row.outcomes.requests > 0);
  const snapshot = {
    version: 1, capturedAt: now.toISOString(), selection: selectionMetadata(query),
    sessionCount: data.sessionCount,
    metrics: Object.fromEntries(Object.keys(RECORDED_METRICS).map((key) => [key, aggregateMetric(models, key)])),
    calls: Object.fromEntries(OUTCOMES.map((key) => [key, calls.length ? calls.reduce((sum, row) => sum + row.outcomes[key], 0) : null])),
    scenario: { ...scenario },
  };
  return validBaseline(snapshot) ? snapshot : null;
}

export function validBaseline(value) {
  return exactKeys(value, ["version", "capturedAt", "selection", "sessionCount", "metrics", "calls", "scenario"])
    && value.version === 1 && timestamp(value.capturedAt) && validSelection(value.selection) && count(value.sessionCount)
    && validScenario(value.scenario) && exactKeys(value.metrics, Object.keys(RECORDED_METRICS))
    && Object.values(value.metrics).every((metric) => exactKeys(metric, ["value", "recorded", "total", "source", "status"])
      && (metric.value === null || number(metric.value)) && count(metric.recorded) && count(metric.total) && metric.recorded <= metric.total
      && SOURCES.includes(metric.source) && STATUSES.includes(metric.status)
      && (metric.value === null ? metric.status === "not-recorded" && metric.source === "not-recorded"
        : metric.status !== "not-recorded"))
    && exactKeys(value.calls, OUTCOMES) && Object.values(value.calls).every((entry) => entry === null || count(entry))
    && (value.calls.requests === null ? Object.values(value.calls).every((entry) => entry === null)
      : OUTCOMES.slice(1).every((key) => count(value.calls[key]))
        && OUTCOMES.slice(1).reduce((sum, key) => sum + value.calls[key], 0) === value.calls.requests);
}

export const readBaseline = (storage) => read(storage, BASELINE_KEY, validBaseline);
export const saveBaseline = (storage, snapshot) => validBaseline(snapshot)
  ? write(storage, BASELINE_KEY, snapshot) : { status: "corrupt", value: null };

export function metricChange(before, after) {
  if (!number(before) || !number(after)) return null;
  const delta = after - before;
  const percent = before === 0 ? null : delta / before * 100;
  return { delta, percent: Number.isFinite(percent) ? percent : null };
}

export function laterSessions(sessions, baseline, now = new Date()) {
  if (!validBaseline(baseline) || !Array.isArray(sessions)) return [];
  const after = Date.parse(baseline.capturedAt);
  const seen = new Set();
  return sessions.filter((row) => {
    if (!validHandle(row.handle) || seen.has(row.handle) || row.handle === baseline.selection.session
      || !["cli", "vscode"].includes(row.source) || row.hidden === true
      || !Object.keys(RECORDED_METRICS).some((key) => number(row.metrics?.[key]))) return false;
    const time = safeDate(row.updatedAt) ?? safeDate(row.createdAt);
    if (!time || Date.parse(time) <= after || Date.parse(time) > now.getTime()) return false;
    seen.add(row.handle);
    return true;
  }).map((row) => ({
    handle: row.handle, source: row.source, updatedAt: safeDate(row.updatedAt) ?? safeDate(row.createdAt),
    newSession: Boolean(safeDate(row.createdAt) && Date.parse(safeDate(row.createdAt)) > after),
  })).sort((a, b) => Number(b.newSession) - Number(a.newSession) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12);
}

export function laterSelection(handle) {
  return validHandle(handle) ? { timeframe: "all", session: handle, model: "", day: "", scope: "", source: "", includeHidden: "", page: 1 } : null;
}

export function selectionDescription(selection, sessionCount) {
  if (!validSelection(selection)) return "Unavailable selection";
  return `${selection.session ? "Single session" : `${sessionCount} sessions`} · ${selection.timeframe} · ${selection.model || "all models"} · ${
    selection.scope || "all scopes"} · ${selection.day ? `${selection.day} UTC` : "all recorded days"} · ${
    selection.source || "all sources"}${selection.includeHidden ? " · includes hidden" : ""}`;
}
