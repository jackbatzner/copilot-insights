import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareUsage } from "../src/model-comparison.mjs";
import {
  BASELINE_KEY, SCENARIO_KEY, selectionMetadata, scenarioDefaults, saveScenario, readScenario,
  recordedSnapshot, saveBaseline, readBaseline, clearStored, metricChange, laterSessions,
  laterSelection, validBaseline,
} from "../ui/src/comparison-state.js";

const selection = { timeframe: "all" };
const record = { model: "gpt-5-mini", source: "sessiondb", inputTokens: 100, outputTokens: 20,
  totalTokens: 120, cacheReadTokens: 0, requests: 1, finishReason: "stop" };
const data = compareUsage([record], 1);
const scenario = { view: "what-if", mode: "uncached", baseline: "gpt-5-mini", first: "gpt-5.4", second: "", trial: "gpt-5.4" };
const snapshot = () => recordedSnapshot(data, selection, scenario, new Date("2026-09-18T12:00:00.000Z"));
const memory = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};
describe("bounded comparison state", () => {
  it("excludes retired alternatives from new defaults but preserves saved scenarios", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-18T12:00:00.000Z") });
    assert.equal(scenarioDefaults(data.models, ["gpt-5-mini", "gpt-5.4"]).first, "gpt-5.4");
    const storage = memory(), get = () => storage;
    assert.equal(saveScenario(get, selection, scenario).status, "ok");
    const baseline = snapshot();
    assert.equal(saveBaseline(get, baseline).status, "ok");
    t.mock.timers.setTime(new Date("2026-10-20T12:00:00.000Z").getTime());
    const defaults = scenarioDefaults(data.models, ["gpt-5-mini", "gpt-5.4"]);
    assert.equal(defaults.first, "");
    assert.equal(defaults.second, "");
    assert.deepEqual(readScenario(get, selection).value, scenario);
    assert.deepEqual(readBaseline(get).value, baseline);
  });

  it("restores exact selections and isolates changed model, scope, source, day, timeframe and session", () => {
    const storage = memory(), get = () => storage;
    assert.equal(saveScenario(get, selection, scenario).status, "ok");
    assert.deepEqual(readScenario(get, selection).value, scenario);
    for (const change of [{ model: "gpt-5.4" }, { scope: "primary" }, { source: "cli" }, { day: "2026-09-18" },
      { timeframe: "7d" }, { session: "a".repeat(64) }, { includeHidden: true }]) {
      assert.equal(readScenario(get, { ...selection, ...change }).value, null);
    }
    for (let index = 1; index <= 12; index++) saveScenario(get, { day: `2026-09-${String(index).padStart(2, "0")}` }, scenario);
    assert.equal(JSON.parse(storage.getItem(SCENARIO_KEY)).entries.length, 8);
  });
  it("rejects unknown model IDs, listing-only telemetry filters, raw IDs and malformed dates", () => {
    for (const change of [{ model: "private-project" }, { model: "listing:fable-5" }, { session: "raw-session-id" },
      { day: "2026-02-30" }, { timeframe: "forever" }, { scope: "private" }, { source: "private" }, { includeHidden: "true" }]) {
      assert.equal(selectionMetadata(change), null);
    }
  });
  it("never reflects corrupted storage and requires explicit removal before scenario writes", () => {
    const storage = memory(), get = () => storage;
    for (const value of ["{", '{"private":"CANARY"}', "x".repeat(24_001)]) {
      storage.setItem(SCENARIO_KEY, value);
      assert.deepEqual(readScenario(get, selection), { status: "corrupt", value: null });
      assert.equal(saveScenario(get, selection, scenario).status, "corrupt");
    }
    assert.equal(clearStored(get, SCENARIO_KEY).status, "empty");
    assert.equal(saveScenario(get, selection, scenario).status, "ok");
  });
  it("explicitly reports unavailable and quota storage without claiming success", () => {
    const denied = () => { throw new Error("CANARY"); };
    assert.equal(readBaseline(denied).status, "unavailable");
    assert.equal(saveBaseline(denied, snapshot()).status, "unavailable");
    assert.equal(clearStored(denied, BASELINE_KEY).status, "unavailable");
    const quota = () => ({ setItem: () => { throw Object.assign(new Error(), { name: "QuotaExceededError" }); } });
    assert.equal(saveBaseline(quota, snapshot()).status, "quota");
  });
});
describe("recorded metric-only baseline", () => {
  it("persists only one allowlisted snapshot with no content, arbitrary names or price estimates", () => {
    const storage = memory(), get = () => storage;
    const baseline = recordedSnapshot({ ...data, sessionLabel: "CANARY", content: "CANARY", path: "CANARY" },
      { ...selection, private: "CANARY" }, scenario, new Date("2026-09-18T12:00:00.000Z"));
    assert.equal(saveBaseline(get, baseline).status, "ok");
    assert.deepEqual(readBaseline(get).value, baseline);
    const raw = storage.getItem(BASELINE_KEY);
    for (const forbidden of ["CANARY", "estimatedUsd", "price", "label", "path", "content", "totalNanoAiu"]) assert.ok(!raw.includes(forbidden));
    assert.equal(saveBaseline(get, { ...baseline, capturedAt: "2026-09-18T13:00:00.000Z" }).status, "ok");
    assert.equal(readBaseline(get).value.capturedAt, "2026-09-18T13:00:00.000Z");
    assert.equal(clearStored(get, BASELINE_KEY).status, "empty");
  });
  it("rejects extra keys and forged coverage, calls, dates or model fields", () => {
    for (const mutate of [
      (v) => { v.content = "CANARY"; },
      (v) => { v.scenario.first = "CANARY"; },
      (v) => { v.scenario.first = "gpt-4.1"; },
      (v) => { v.metrics.totalTokens.source = "CANARY"; },
      (v) => { v.metrics.totalTokens.recorded = 999; },
      (v) => { v.metrics.totalTokens.value = -1; },
      (v) => { v.calls.requests = 99; },
      (v) => { v.capturedAt = "not a date"; },
    ]) {
      const value = snapshot(); mutate(value);
      assert.equal(validBaseline(value), false);
      const storage = memory(); storage.setItem(BASELINE_KEY, JSON.stringify(value));
      assert.deepEqual(readBaseline(() => storage), { status: "corrupt", value: null });
    }
  });
  it("preserves zero, absent and partial evidence without treating missing calls as zero", () => {
    const value = snapshot();
    assert.equal(value.metrics.cacheReadTokens.value, 0);
    assert.equal(value.metrics.cacheWriteTokens.value, null);
    assert.equal(value.calls.completed, 1);
    const partial = recordedSnapshot(compareUsage([record, { ...record, source: "jsonl", inputTokens: null, totalTokens: null }], 1), selection, scenario);
    assert.deepEqual(partial.metrics.totalTokens, { value: 120, recorded: 1, total: 2, source: "sessiondb", status: "partial" });
    const noCalls = recordedSnapshot(compareUsage([{ ...record, source: "jsonl-shutdown" }], 1), selection, scenario);
    assert.equal(noCalls.calls.requests, null);
    assert.deepEqual(metricChange(0, 0), { delta: 0, percent: null });
    assert.deepEqual(metricChange(0, 100), { delta: 100, percent: null });
    assert.deepEqual(metricChange(100, 75), { delta: -25, percent: -25 });
    assert.equal(metricChange(null, 0), null);
    assert.equal(metricChange(0, null), null);
    assert.equal(metricChange(Number.MIN_VALUE, Number.MAX_SAFE_INTEGER).percent, null);
  });
  it("chooses bounded later known metric sessions, prefers new sessions, and clears incompatible scope", () => {
    const baseline = { ...snapshot(), selection: { ...selectionMetadata(selection), session: "a".repeat(64) } };
    const later = { handle: "b".repeat(64), source: "cli", metrics: { totalTokens: 0 },
      createdAt: "2026-09-18T12:01:00.000Z", updatedAt: "2026-09-18T12:02:00.000Z", label: "CANARY" };
    const updated = { ...later, handle: "c".repeat(64), createdAt: "2026-09-17T12:00:00.000Z" };
    const list = laterSessions([updated, later, later, { ...later, handle: "raw" }, { ...later, handle: baseline.selection.session },
      { ...later, handle: "d".repeat(64), metrics: {} }, { ...later, handle: "e".repeat(64), hidden: true }], baseline);
    assert.equal(list.length, 2);
    assert.equal(list[0].handle, later.handle);
    assert.equal(list[0].newSession, true);
    assert.ok(!JSON.stringify(list).includes("CANARY"));
    assert.deepEqual(laterSelection(later.handle), { timeframe: "all", session: later.handle, model: "", day: "", scope: "", source: "", includeHidden: "", page: 1 });
    assert.equal(laterSelection("raw"), null);
    const many = Array.from({ length: 30 }, (_, index) => ({ ...later, handle: index.toString(16).padStart(64, "0") }));
    assert.equal(laterSessions(many, baseline).length, 12);
  });
});
