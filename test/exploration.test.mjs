import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { isUtcDay, safeDate, safeRequestTimestamp } from "../src/usage-metrics.mjs";
import { event, usageFixture } from "./usage-fixtures.mjs";

const NOW = "2026-09-15T12:34:56.000Z";
const DAY = "2026-09-15";
const fixtures = [];
function fixture(t, options) {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(NOW) });
  const value = usageFixture(options);
  fixtures.push(value);
  return value;
}
afterEach(() => {
  for (const value of fixtures.splice(0)) value.cleanup();
});
function shutdown() {
  return {
    type: "session.shutdown", timestamp: NOW,
    data: {
      modelMetrics: {
        "gpt-5.4": {
          requests: { count: 2, cost: 0 },
          usage: { inputTokens: 100, outputTokens: 20 },
          totalNanoAiu: 12,
        },
      },
      totalNanoAiu: 16, totalApiDurationMs: 2200,
    },
  };
}

describe("timestamp-grounded usage exploration", () => {
  it("buckets exact requests by UTC timestamp and never estimates missing metrics on empty days", (t) => {
    const f = fixture(t);
    const id = f.session();
    f.usage(id, { created_at: "2026-09-14T23:30:00-02:00", input_tokens: 10, output_tokens: 1 });
    f.usage(id, { created_at: "2026-09-15T00:15:00+02:00", input_tokens: 20, output_tokens: 2 });
    f.usage(id, { created_at: "2026-09-15T00:00:00", input_tokens: 30, output_tokens: 3 });
    f.usage(id, { created_at: null });
    f.usage(id, { created_at: "2026-02-30T12:00:00Z" });
    const result = f.store().snapshot({ timeframe: "7d" });
    const trend = result.exploration.trend;
    assert.equal(trend.basis, "sessiondb-request-timestamp");
    assert.equal(trend.available, true);
    assert.equal(trend.windowDays, 7);
    assert.equal(trend.startDay, "2026-09-09");
    assert.equal(trend.endDay, DAY);
    assert.equal(trend.days.length, 7);
    assert.equal(trend.recordedRequests, 2);
    assert.equal(trend.undatedRequests, 3);
    assert.equal(trend.excludedAggregateSessions, 0);
    assert.equal(trend.days.find((day) => day.day === DAY).metrics.totalTokens, 11);
    assert.equal(trend.days.find((day) => day.day === "2026-09-14").metrics.totalTokens, 22);
    assert.equal(trend.days.find((day) => day.day === DAY).sessionCount, 1);
    const empty = trend.days[0];
    assert.equal(empty.metrics.requests, 0);
    assert.equal(empty.sessionCount, 0);
    assert.equal(empty.metrics.totalTokens, null);
    assert.equal(empty.metrics.outputTokens, null);
    assert.deepEqual(empty.evidence.requests, { source: "sessiondb", status: "derived", recorded: 0, total: 0 });
    assert.equal(result.metrics.requests, 5);
    assert.match(result.capabilities.diagnostics.join(" "), /unverified timezone semantics/);
  });

  it("uses calendar boundaries for 7/30/90 days and caps only the all-history trend at 90 days", (t) => {
    const f = fixture(t);
    const id = f.session();
    for (const created_at of [
      "2026-06-17T23:59:59Z", "2026-06-18T00:00:00Z",
      "2026-08-17T00:00:00Z", "2026-09-09T00:00:00Z",
      "2026-09-15T23:59:59Z", "2026-09-16T00:00:00Z",
    ]) f.usage(id, { created_at });
    const store = f.store();
    const expected = [
      ["7d", 7, "2026-09-09", 2],
      ["30d", 30, "2026-08-17", 3],
      ["90d", 90, "2026-06-18", 4],
      ["all", 90, "2026-06-18", 4],
    ];
    for (const [timeframe, windowDays, startDay, count] of expected) {
      const result = store.snapshot({ timeframe });
      assert.equal(result.metrics.requests, 6);
      assert.equal(result.exploration.trend.windowDays, windowDays);
      assert.equal(result.exploration.trend.startDay, startDay);
      assert.equal(result.exploration.trend.endDay, DAY);
      assert.equal(result.exploration.trend.recordedRequests, count);
      assert.equal(result.exploration.trend.days.length, windowDays);
    }
  });

  it("intersects model, day and scope on one record while keeping discovery graphs and whole-session totals", (t) => {
    const f = fixture(t);
    f.session("split-match");
    f.session("exact-match");
    f.events("split-match", [event("subagent.started", { toolCallId: "split-child" })]);
    f.events("exact-match", [event("subagent.started", { toolCallId: "exact-child" })]);
    f.usage("split-match", { model: "gpt-5.4", created_at: NOW, input_tokens: 10, output_tokens: 1 });
    f.usage("split-match", { model: "gpt-5-mini", parent_tool_call_id: "split-child", created_at: NOW, input_tokens: 20, output_tokens: 2 });
    f.usage("split-match", { model: "gpt-5.4", parent_tool_call_id: "split-child", created_at: "2026-09-14T12:00:00Z", input_tokens: 30, output_tokens: 3 });
    f.usage("exact-match", { model: "gpt-5.4", parent_tool_call_id: "exact-child", created_at: NOW, input_tokens: 40, output_tokens: 4 });
    f.usage("exact-match", { model: "gpt-5-mini", created_at: "2026-09-14T12:00:00Z", input_tokens: 50, output_tokens: 5 });
    const store = f.store();
    const result = store.snapshot({ timeframe: "all", model: "gpt-5.4", scope: "subagent", day: DAY });
    assert.equal(result.sessionCount, 1);
    assert.equal(store.resolveHandle(result.sessions[0].handle), "exact-match");
    assert.equal(result.metrics.totalTokens, 44);
    assert.equal(result.sessions[0].selectedUsage.totalTokens, 44);
    assert.equal(result.sessions[0].metrics.totalTokens, 99);
    assert.equal(result.sessions[0].performance.childTokens, 44);
    assert.equal(result.performance.groups.find((group) => group.scope === "subagent").metrics.totalTokens, 77);
    assert.equal(result.performance.groups.find((group) => group.scope === "subagent").sessionCount, 2);
    assert.equal(result.performance.groups.find((group) => group.scope === "primary").sessionCount, 1);
    assert.equal(result.exploration.trend.days.find((day) => day.day === DAY).metrics.totalTokens, 55);
    assert.equal(result.exploration.trend.recordedRequests, 3);
    const modelOnly = store.snapshot({ timeframe: "all", model: "gpt-5.4" });
    assert.equal(modelOnly.sessionCount, 2);
    assert.equal(modelOnly.metrics.totalTokens, 88);
    assert.equal(modelOnly.models.length, 2);
    assert.equal(store.detail(result.sessions[0].handle).session.selectedUsage, null);
  });

  it("excludes shutdown and output fallback from daily buckets but retains their model and scope usage", (t) => {
    const f = fixture(t);
    f.session("aggregate");
    f.events("aggregate", [shutdown()]);
    f.session("output-only");
    f.events("output-only", [
      event("session.start", { selectedModel: "gpt-5.4" }),
      { ...event("assistant.message", { outputTokens: 17 }), timestamp: NOW },
    ]);
    f.session("exact");
    f.usage("exact", { agent_id: "unmatched", created_at: NOW });
    const store = f.store();
    const base = store.snapshot({ timeframe: "all" });
    assert.equal(base.exploration.trend.recordedRequests, 1);
    assert.equal(base.exploration.trend.excludedAggregateSessions, 1);
    assert.equal(base.exploration.trend.undatedRequests, 0);
    assert.equal(base.exploration.trend.days.find((day) => day.day === DAY).metrics.outputTokens, 5);
    const scope = store.snapshot({ timeframe: "all", scope: "unattributed" });
    assert.equal(scope.sessionCount, 3);
    assert.equal(scope.metrics.outputTokens, 42);
    assert.equal(scope.metrics.totalNanoAiu, 112);
    assert.equal(scope.metrics.apiDurationMs, null);
    assert.equal(scope.performance.groups.find((group) => group.scope === "unattributed").sessionCount, 3);
    assert.equal(base.metrics.totalNanoAiu, 116);
    assert.equal(base.metrics.apiDurationMs, 2200);
    const day = store.snapshot({ timeframe: "all", model: "gpt-5.4", scope: "unattributed", day: DAY });
    assert.equal(day.sessionCount, 1);
    assert.equal(day.metrics.outputTokens, 5);
    assert.equal(day.exploration.trend.excludedAggregateSessions, 1);
    assert.equal(day.models[0].metrics.outputTokens, 42);
  });

  it("returns an unavailable trend for aggregate-only sources rather than inventing a shutdown timeline", (t) => {
    const f = fixture(t, { usageTable: false });
    const id = f.session();
    f.events(id, [shutdown()]);
    const store = f.store();
    const result = store.snapshot({ timeframe: "30d" });
    assert.equal(result.metrics.requests, 2);
    assert.equal(result.exploration.trend.available, false);
    assert.deepEqual(result.exploration.trend.days, []);
    assert.equal(result.exploration.trend.recordedRequests, 0);
    assert.equal(result.exploration.trend.excludedAggregateSessions, 1);
    assert.equal(result.sessions[0].performance.outcome, "not-recorded");
    assert.equal(store.snapshot({ timeframe: "30d", day: DAY }).sessionCount, 0);
  });

  it("counts missing timestamp-column rows as undated instead of using session or event timestamps", (t) => {
    const f = fixture(t, { omit: ["created_at"] });
    const id = f.session();
    f.usage(id);
    f.usage(id);
    f.events(id, [event("session.start")]);
    const store = f.store();
    const result = store.snapshot({ timeframe: "7d" });
    assert.equal(result.capabilities.sessionDb, "partial");
    assert.equal(result.exploration.trend.available, false);
    assert.equal(result.exploration.trend.undatedRequests, 2);
    assert.deepEqual(result.exploration.trend.days, []);
    assert.equal(store.snapshot({ timeframe: "7d", day: DAY }).sessionCount, 0);
  });

  it("excludes hidden sessions from daily buckets, scope counts, and aggregate-exclusion counts", (t) => {
    const f = fixture(t);
    f.session("visible");
    f.usage("visible", { created_at: NOW });
    f.session("hidden-exact");
    f.usage("hidden-exact", { created_at: NOW });
    f.session("hidden-aggregate");
    f.events("hidden-aggregate", [shutdown()]);
    const hiddenIds = new Set(["hidden-exact", "hidden-aggregate"]);
    const store = f.store({ hiddenIds });
    const visible = store.snapshot({ timeframe: "all" });
    assert.equal(visible.exploration.trend.recordedRequests, 1);
    assert.equal(visible.exploration.trend.excludedAggregateSessions, 0);
    assert.equal(visible.exploration.trend.days.find((day) => day.day === DAY).sessionCount, 1);
    assert.equal(visible.performance.groups.find((group) => group.scope === "primary").sessionCount, 1);
    const all = store.snapshot({ timeframe: "all", includeHidden: true });
    assert.equal(all.exploration.trend.recordedRequests, 2);
    assert.equal(all.exploration.trend.excludedAggregateSessions, 1);
    assert.equal(all.performance.groups.find((group) => group.scope === "unattributed").sessionCount, 1);
  });

  it("provides partial exact-child usage and recorded lifecycle counters/outcomes without unsafe metadata", (t) => {
    const f = fixture(t);
    const id = f.session("PRIVATE_SESSION");
    f.usage(id, { created_at: NOW, finish_reason: "PRIVATE_REASON" });
    f.usage(id, { created_at: NOW, parent_tool_call_id: "PRIVATE_CHILD", input_tokens: 0, output_tokens: 0 });
    f.usage(id, { created_at: NOW, parent_tool_call_id: "PRIVATE_CHILD", input_tokens: null, output_tokens: 7 });
    f.events(id, [
      event("subagent.started", { toolCallId: "PRIVATE_CHILD", agentName: "PRIVATE_AGENT", model: "PRIVATE_MODEL" }),
      event("subagent.completed", { toolCallId: "PRIVATE_CHILD" }),
      event("tool.execution_start", { toolCallId: "PRIVATE_TOOL_ID", toolName: "PRIVATE_TOOL" }),
      event("tool.execution_complete", { toolCallId: "PRIVATE_TOOL_ID", result: "PRIVATE_RESULT", error: "PRIVATE_ERROR" }),
      event("skill.invoked", { name: "PRIVATE_SKILL", content: "PRIVATE_CONTENT", path: "PRIVATE_PATH" }),
    ]);
    const store = f.store();
    const result = store.snapshot({ timeframe: "all" });
    const performance = result.sessions[0].performance;
    assert.equal(performance.childTokens, 0);
    assert.equal(performance.childRequests, 2);
    assert.equal(performance.childCount, 1);
    assert.equal(performance.toolCount, 1);
    assert.equal(performance.outcome, "completed");
    assert.equal(performance.evidence.childTokens.status, "partial");
    assert.equal(performance.evidence.childTokens.recorded, 1);
    assert.equal(performance.evidence.childTokens.total, 2);
    assert.equal(performance.evidence.outcome.status, "partial");
    assert.equal(performance.evidence.outcome.source, "mixed");
    assert.deepEqual(store.detail(result.sessions[0].handle).session.performance, performance);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  });

  it("keeps unobserved performance null and combines only recorded outcome enums", (t) => {
    const f = fixture(t);
    const id = f.session();
    f.usage(id, { finish_reason: "error", content_filter_triggered: 0 });
    f.usage(id, { finish_reason: "stop" });
    const store = f.store();
    const result = store.snapshot({ timeframe: "all" });
    const performance = result.sessions[0].performance;
    assert.equal(performance.childTokens, null);
    assert.equal(performance.childRequests, null);
    assert.equal(performance.childCount, null);
    assert.equal(performance.toolCount, null);
    assert.equal(performance.outcome, "mixed");
    assert.equal(performance.evidence.outcome.source, "sessiondb");
    f.events(id, [event("session.start")]);
    const observed = store.detail(result.sessions[0].handle).session.performance;
    assert.equal(observed.childCount, 0);
    assert.equal(observed.toolCount, 0);
    assert.equal(observed.childTokens, null);
  });

  it("strictly validates calendar-day and scope filters with safe errors", (t) => {
    const f = fixture(t);
    const store = f.store();
    for (const day of ["2026-02-29", "2026-02-30", "2026-09-31", "2026-9-15", "2026-09-15T00:00:00Z", "PRIVATE_DAY", "", 123, {}]) {
      assert.throws(() => store.snapshot({ day }), (error) => error.code === "DAY" && !error.message.includes("PRIVATE"));
    }
    for (const scope of ["PRIVATE_SCOPE", "child", "", 123, {}]) {
      assert.throws(() => store.snapshot({ scope }), (error) => error.code === "SCOPE" && !error.message.includes("PRIVATE"));
    }
    assert.equal(store.snapshot({ timeframe: "all", day: "2024-02-29", scope: "primary" }).sessionCount, 0);
  });

  it("normalizes recorded UTC dates deterministically and rejects rollover dates or invalid times", () => {
    assert.equal(isUtcDay("2024-02-29"), true);
    assert.equal(isUtcDay("2026-02-29"), false);
    assert.equal(safeDate("2026-09-15T00:30:00"), "2026-09-15T00:30:00.000Z");
    assert.equal(safeDate("2026-09-15 00:30:00+02:00"), "2026-09-14T22:30:00.000Z");
    assert.equal(safeDate("2026-09-15"), "2026-09-15T00:00:00.000Z");
    assert.equal(safeDate("2026-02-30T00:00:00Z"), null);
    assert.equal(safeDate("2026-09-15T24:00:00Z"), null);
    assert.equal(safeDate("2026-09-15T00:60:00Z"), null);
    assert.equal(safeRequestTimestamp("2026-09-15T00:30:00"), null);
    assert.equal(safeRequestTimestamp("2026-09-15 00:30:00"), null);
    assert.equal(safeRequestTimestamp("2026-09-15 00:30:00", { sqliteUtc: true }), "2026-09-15T00:30:00.000Z");
    assert.equal(safeRequestTimestamp("2026-09-15"), null);
  });

  for (const [schemaDefault, verified] of [
    ["CURRENT_TIMESTAMP", true],
    ["(datetime('now'))", true],
    ["(datetime('now', 'localtime'))", false],
    ["NULL", false],
  ]) {
    it(`treats unzoned SQLite timestamps as UTC only with a verified default: ${schemaDefault}`, (t) => {
      const f = fixture(t);
      const schema = f.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'assistant_usage_events'").get().sql;
      assert.ok(schema.includes("created_at TEXT"));
      f.db.exec("DROP TABLE assistant_usage_events");
      f.db.exec(schema.replace("created_at TEXT", `created_at TEXT DEFAULT ${schemaDefault}`));
      const id = f.session();
      f.usage(id, { created_at: "2026-09-15 00:00:00" });
      f.usage(id, { created_at: "2026-09-14 23:59:59" });
      f.usage(id, { created_at: "2026-09-15T00:00:00" });
      const store = f.store();
      const result = store.snapshot({ timeframe: "7d" });
      assert.equal(result.metrics.requests, 3);
      assert.equal(result.exploration.trend.recordedRequests, verified ? 2 : 0);
      assert.equal(result.exploration.trend.undatedRequests, verified ? 1 : 3);
      assert.equal(store.snapshot({ timeframe: "7d", day: DAY }).metrics.requests, verified ? 1 : null);
      assert.match(result.capabilities.diagnostics.join(" "), /unverified timezone semantics/);
    });
  }
});
