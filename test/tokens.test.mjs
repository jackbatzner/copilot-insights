import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readUsageDb, USAGE_COLUMNS } from "../src/db.mjs";
import { UsageSourceError } from "../src/runtime-telemetry.mjs";
import { event, usageFixture } from "./usage-fixtures.mjs";

const fixtures = [];
function fixture(options) {
  const value = usageFixture(options);
  fixtures.push(value);
  return value;
}
afterEach(() => {
  for (const value of fixtures.splice(0)) value.cleanup();
});

describe("recorded usage readers", () => {
  it("preserves JSONL output and model changes without text estimation or invented requests", () => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    f.events(id, [
      event("session.start", { selectedModel: "gpt-5.4-mini" }),
      event("assistant.message", { outputTokens: 1200, content: "PRIVATE_RESPONSE_CANARY" }),
      event("session.model_change", { newModel: "claude-sonnet-4.6" }),
      event("assistant.message", { outputTokens: 800 }),
      event("assistant.message", { text: "No token metadata" }),
    ]);
    const snapshot = f.store().snapshot({ timeframe: "all" });
    assert.equal(snapshot.metrics.outputTokens, 2000);
    assert.equal(snapshot.metrics.inputTokens, null);
    assert.equal(snapshot.metrics.totalTokens, null);
    assert.equal(snapshot.metrics.requests, null);
    assert.equal(snapshot.evidence.outputTokens.source, "jsonl");
    assert.equal(snapshot.evidence.outputTokens.status, "partial");
    assert.equal(snapshot.evidence.outputTokens.total, 3);
    assert.equal(snapshot.evidence.outputTokens.recorded, 2);
    assert.equal(snapshot.capabilities.sessionDb, "partial");
    assert.deepEqual(snapshot.sessions[0].models, ["claude-sonnet-4.6", "gpt-5.4-mini"]);
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_/);
  });

  it("reads every modern column safely and preserves recorded zero", () => {
    const f = fixture();
    f.session();
    f.usage(undefined, { input_tokens: 0, output_tokens: 0, total_nano_aiu: 0, duration_ms: 0, time_to_first_token_ms: 0 });
    const snapshot = f.store().snapshot({ timeframe: "all" });
    assert.equal(snapshot.metrics.inputTokens, 0);
    assert.equal(snapshot.metrics.outputTokens, 0);
    assert.equal(snapshot.metrics.totalTokens, 0);
    assert.equal(snapshot.metrics.cacheReadTokens, 0);
    assert.equal(snapshot.metrics.totalNanoAiu, 0);
    assert.equal(snapshot.metrics.durationMs, 0);
    assert.equal(snapshot.metrics.ttftMs, 0);
    assert.equal(snapshot.metrics.localCredits, null);
    assert.equal(snapshot.metrics.requestMultiplier, 1);
    assert.equal(snapshot.metrics.outputTtftMs, 11);
    assert.equal(snapshot.metrics.interTokenLatencyMs, 2);
    assert.equal(snapshot.metrics.contentFilteredRequests, 0);
    assert.equal(snapshot.evidence.totalTokens.status, "derived");
    assert.equal(snapshot.evidence.inputTokens.status, "recorded");
    assert.match(snapshot.capabilities.diagnostics.join(" "), /no verified recorded nano-AIU conversion/);
  });

  for (const column of USAGE_COLUMNS) {
    it(`capability-checks a missing ${column} column`, () => {
      const f = fixture({ omit: [column] });
      f.session();
      f.usage();
      const snapshot = f.store().snapshot({ timeframe: "all" });
      assert.equal(snapshot.capabilities.sessionDb, "partial");
      assert.ok(snapshot.capabilities.diagnostics.length);
      if (column === "session_id") assert.equal(snapshot.metrics.requests, null);
      if (column === "input_tokens") assert.equal(snapshot.metrics.inputTokens, null);
      if (column === "output_tokens") assert.equal(snapshot.metrics.outputTokens, null);
      const extraMetric = {
        request_multiplier: "requestMultiplier", output_ttft_ms: "outputTtftMs",
        inter_token_latency_ms: "interTokenLatencyMs", content_filter_triggered: "contentFilteredRequests",
      }[column];
      if (extraMetric) {
        assert.equal(snapshot.metrics[extraMetric], null);
        assert.deepEqual(snapshot.evidence[extraMetric], { source: "not-recorded", status: "not-recorded", recorded: 0, total: 1 });
      }
      if (column === "finish_reason") {
        assert.equal(readUsageDb(f.dbPath).records[0].finishReason, "not-recorded");
      }
      if (["agent_id", "parent_tool_call_id"].includes(column)) {
        assert.equal(snapshot.performance.groups.find((group) => group.scope === "unattributed").metrics.requests, 1);
      }
    });
  }

  it("averages only observed TTFT and reports partial field coverage", () => {
    const f = fixture();
    f.session();
    f.usage(undefined, { input_tokens: 0, duration_ms: 30, time_to_first_token_ms: 0 });
    f.usage(undefined, { input_tokens: null, duration_ms: 20, time_to_first_token_ms: 20 });
    f.usage(undefined, { input_tokens: -1, duration_ms: null, time_to_first_token_ms: null, output_ttft_ms: null });
    const result = f.store().snapshot({ timeframe: "all" });
    assert.equal(result.metrics.inputTokens, 0);
    assert.equal(result.metrics.totalTokens, 5);
    assert.equal(result.metrics.ttftMs, 10);
    assert.equal(result.metrics.durationMs, 50);
    assert.deepEqual(result.evidence.inputTokens, { source: "sessiondb", status: "partial", recorded: 1, total: 3 });
    assert.deepEqual(result.evidence.totalTokens, { source: "sessiondb", status: "partial", recorded: 1, total: 3 });
    assert.equal(result.evidence.ttftMs.recorded, 2);
  });

  it("retains modern latency, multiplier, filtering, and request outcome evidence", () => {
    const f = fixture();
    f.session();
    f.usage(undefined, { request_multiplier: 0, output_ttft_ms: 0, inter_token_latency_ms: 0, content_filter_triggered: 0 });
    f.usage(undefined, { request_multiplier: 2, output_ttft_ms: 20, inter_token_latency_ms: 4, content_filter_triggered: 1, finish_reason: "content_filter" });
    f.usage(undefined, { request_multiplier: null, output_ttft_ms: null, inter_token_latency_ms: null, content_filter_triggered: null, finish_reason: null });
    const store = f.store();
    const result = store.snapshot({ timeframe: "all" });
    assert.equal(result.metrics.requestMultiplier, 1);
    assert.equal(result.metrics.outputTtftMs, 10);
    assert.equal(result.metrics.interTokenLatencyMs, 2);
    assert.equal(result.metrics.contentFilteredRequests, 1);
    assert.deepEqual(result.evidence.requestMultiplier, { source: "sessiondb", status: "partial", recorded: 2, total: 3 });
    assert.equal(store.detail(result.sessions[0].handle).attribution[0].outcome, "mixed");
  });

  it("normalizes finish reasons exclusively to fixed enums including not-recorded", () => {
    const f = fixture();
    const id = f.session();
    const known = ["stop", "length", "tool_calls", "content_filter", "cancelled", "error"];
    for (const finish_reason of [...known, "PRIVATE_REASON https://PRIVATE_URL", null]) {
      f.usage(id, { finish_reason });
    }
    assert.deepEqual(readUsageDb(f.dbPath).records.map((record) => record.finishReason), [...known, "not-recorded", "not-recorded"]);
    assert.doesNotMatch(JSON.stringify(f.store().snapshot({ timeframe: "all" })), /PRIVATE_REASON|PRIVATE_URL/);
  });

  it("does not combine output fallback with partially recorded requests without an exact request match", () => {
    const f = fixture({ omit: ["output_tokens"] });
    const id = f.session();
    f.usage();
    f.events(id, [event("assistant.message", { outputTokens: 99 })]);
    const result = f.store().snapshot({ timeframe: "all" });
    assert.equal(result.metrics.inputTokens, 10);
    assert.equal(result.metrics.outputTokens, null);
    assert.equal(result.metrics.requests, 1);
    assert.match(result.capabilities.diagnostics.join(" "), /without a stable request match/);
  });

  it("records output TTFT as the available variant when initial TTFT is absent", () => {
    const f = fixture({ omit: ["time_to_first_token_ms"] });
    f.session();
    f.usage();
    const result = f.store().snapshot({ timeframe: "all" });
    assert.equal(result.metrics.ttftMs, 11);
    assert.equal(result.metrics.outputTtftMs, 11);
  });

  it("prefers exact DB usage and never adds fallback, shutdown, or invocation totals", () => {
    const f = fixture();
    const id = f.session();
    f.usage();
    f.events(id, [
      event("assistant.message", { outputTokens: 999999 }),
      event("session.shutdown", { modelMetrics: { "gpt-5.4": { usage: { inputTokens: 999999, outputTokens: 999999 } } } }),
      event("subagent.started", { toolCallId: "child-call", model: "gpt-5.4" }),
      event("subagent.completed", { toolCallId: "child-call", totalTokens: 999999, totalToolCalls: 999999 }),
    ]);
    const result = f.store().snapshot({ timeframe: "all" });
    assert.equal(result.metrics.requests, 1);
    assert.equal(result.metrics.totalTokens, 15);
    assert.equal(result.metrics.outputTokens, 5);
  });

  it("uses canonical anonymous events and deduplicates identified events across files", () => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    const events = [
      event("assistant.message", { outputTokens: 4 }, "event-1"),
      event("assistant.message", { outputTokens: 7 }),
      event("skill.invoked", { name: "PRIVATE_SKILL_CANARY" }, "skill-1"),
      event("skill.invoked", { name: "PRIVATE_SKILL_CANARY" }),
    ];
    f.events(id, events);
    f.events(id, events, "turns.jsonl");
    f.events(id, events, "copy.jsonl");
    const store = f.store();
    const result = store.snapshot({ timeframe: "all" });
    assert.equal(result.metrics.outputTokens, 11);
    assert.deepEqual(result.performance.skills, [{ category: "skill", count: 2 }]);
    assert.equal(store.detail(result.sessions[0].handle).skillLinkage, "session-only");
  });

  it("reports malformed lines without exposing them and retains valid metadata", () => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    f.events(id, [event("assistant.message", { outputTokens: 0 }), "{\"PRIVATE_BROKEN_JSON_CANARY\":"]);
    const result = f.store().snapshot({ timeframe: "all" });
    assert.equal(result.metrics.outputTokens, 0);
    assert.equal(result.capabilities.sessionState, "partial");
    assert.match(result.capabilities.diagnostics.join(" "), /Malformed/);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  });

  it("makes missing and incompatible sources explicit with safe errors", () => {
    const f = fixture();
    const missing = f.store({ dbPath: join(f.root, "missing.db"), sessionStatePath: join(f.root, "missing-state") });
    const snapshot = missing.snapshot({ timeframe: "all" });
    assert.equal(snapshot.sessionCount, 0);
    assert.equal(snapshot.metrics.totalTokens, null);
    assert.equal(snapshot.capabilities.sessionDb, "unavailable");
    assert.equal(snapshot.capabilities.sessionState, "unavailable");
    const corrupt = join(f.root, "PRIVATE_CORRUPT_PATH.db");
    writeFileSync(corrupt, "PRIVATE_CORRUPT_CONTENT");
    assert.throws(() => f.store({ dbPath: corrupt }).snapshot(), (error) => error instanceof UsageSourceError && error.code === "DB_READ" && !error.message.includes("PRIVATE"));
    f.db.exec("DROP TABLE sessions");
    assert.throws(() => f.store().snapshot(), { code: "DB_SCHEMA" });
  });

  it("keeps sources read-only and surfaces close or invalid timeframe use", () => {
    const f = fixture();
    f.session();
    f.usage();
    const before = f.db.prepare("SELECT * FROM assistant_usage_events").all();
    const store = f.store();
    store.snapshot({ timeframe: "all" });
    assert.deepEqual(f.db.prepare("SELECT * FROM assistant_usage_events").all(), before);
    assert.throws(() => store.snapshot({ timeframe: "bad" }), { code: "TIMEFRAME" });
    store.close();
    assert.throws(() => store.snapshot(), { code: "STORE_CLOSED" });
  });
});
