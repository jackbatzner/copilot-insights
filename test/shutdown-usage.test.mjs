import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { event, usageFixture } from "./usage-fixtures.mjs";
import { formatUsageModels, formatUsageSession, formatUsageSummary } from "../src/formatter.mjs";

const fixtures = [];
function fixture(options) {
  const value = usageFixture(options);
  fixtures.push(value);
  return value;
}
afterEach(() => {
  for (const value of fixtures.splice(0)) value.cleanup();
});

function snapshot(data, timestamp = "2026-09-02T12:00:00.000Z", id) {
  return { ...event("session.shutdown", data, id), timestamp };
}
function model(count = 2, input = 100, output = 20, cost = 0.75, nano = 100) {
  return {
    requests: { count, cost },
    usage: { inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 10 },
    totalNanoAiu: nano,
  };
}
function fullSnapshot() {
  return {
    modelMetrics: {
      "gpt-5.4": model(),
      "gpt-5-mini": model(1, 0, 5, 0, 50),
    },
    totalApiDurationMs: 1234,
    totalNanoAiu: 200,
  };
}

describe("coherent shutdown aggregate usage", () => {
  it("recovers session-model aggregates without allocating root totals or linking children", () => {
    const f = fixture();
    const id = f.session();
    f.events(id, [
      event("subagent.started", { toolCallId: "PRIVATE_CHILD", model: "gpt-5-mini" }),
      event("assistant.message", { outputTokens: 999999, content: "PRIVATE_CONTENT" }),
      snapshot(fullSnapshot()),
      event("subagent.completed", { toolCallId: "PRIVATE_CHILD", totalTokens: 999999, durationMs: 10 }),
    ]);
    const store = f.store();
    const result = store.snapshot({ timeframe: "all" });
    const detail = store.detail(result.sessions[0].handle);
    assert.equal(result.metrics.requests, 3);
    assert.equal(result.metrics.inputTokens, 100);
    assert.equal(result.metrics.outputTokens, 25);
    assert.equal(result.metrics.totalTokens, 125);
    assert.equal(result.metrics.requestCost, 0.75);
    assert.equal(result.metrics.totalNanoAiu, 200);
    assert.equal(result.metrics.apiDurationMs, 1234);
    assert.equal(result.metrics.durationMs, null);
    assert.equal(result.metrics.localCredits, null);
    assert.equal(result.usageGranularity, "session-model-aggregate");
    assert.deepEqual(result.evidence.requests, { source: "jsonl-shutdown", status: "recorded", recorded: 2, total: 2 });
    assert.equal(detail.session.evidence.totalNanoAiu.scope, "session");
    assert.equal(result.models.reduce((sum, row) => sum + row.metrics.totalNanoAiu, 0), 150);
    for (const row of result.models) {
      assert.equal(row.metrics.apiDurationMs, null);
      assert.equal(row.metrics.durationMs, null);
    }
    const unattributed = detail.attribution.find((group) => group.scope === "unattributed");
    assert.equal(unattributed.metrics.totalTokens, 125);
    assert.equal(unattributed.metrics.totalNanoAiu, 150);
    assert.equal(unattributed.metrics.apiDurationMs, null);
    assert.equal(unattributed.usageGranularity, "session-model-aggregate");
    assert.equal(detail.attribution.find((group) => group.scope === "subagent").metrics.requests, null);
    assert.match(result.capabilities.diagnostics.join(" "), /not individually linked requests or exact child attribution/);
    assert.doesNotMatch(JSON.stringify({ result, detail }), /PRIVATE_|synthetic-session/);
  });

  it("never adds repeated or duplicate snapshots and chooses the latest timestamp, not input order or maxima", () => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    const older = snapshot({ modelMetrics: { "gpt-5.4": model(99, 999, 999) } }, "2026-09-01T00:00:00Z", "older");
    const latest = snapshot({ modelMetrics: { "gpt-5.4": model(1, 3, 4) } }, "2026-09-02T00:00:00Z", "newer");
    f.events(id, [latest, older, latest]);
    f.events(id, [older, latest], "turns.jsonl");
    const result = f.store().snapshot({ timeframe: "all" });
    assert.equal(result.metrics.requests, 1);
    assert.equal(result.metrics.inputTokens, 3);
    assert.equal(result.metrics.outputTokens, 4);
    assert.equal(result.metrics.totalTokens, 7);
  });

  it("uses canonical file precedence on timestamp ties and later canonical stream order within that file", () => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    f.events(id, [
      snapshot({ modelMetrics: { "gpt-5.4": model(4, 4, 4) } }),
      snapshot({ modelMetrics: { "gpt-5.4": model(2, 2, 2) } }),
    ]);
    f.events(id, [snapshot({ modelMetrics: { "gpt-5.4": model(999, 999, 999) } })], "turns.jsonl");
    const store = f.store();
    assert.equal(store.snapshot({ timeframe: "all" }).metrics.requests, 2);
    f.events(id, [snapshot({ modelMetrics: { "gpt-5.4": model(3, 3, 3) } }, "2026-09-03T00:00:00Z")], "turns.jsonl");
    assert.equal(store.snapshot({ timeframe: "all" }).metrics.requests, 3);
  });

  it("keeps a newer partial snapshot coherent without filling fields from earlier snapshots or output events", () => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    f.events(id, [
      snapshot(fullSnapshot(), "2026-09-01T00:00:00Z"),
      snapshot({ modelMetrics: { "gpt-5.4": { requests: { count: 0 }, usage: { inputTokens: 0 } } } }),
      event("assistant.message", { outputTokens: 999 }),
    ]);
    const result = f.store().snapshot({ timeframe: "all" });
    assert.equal(result.metrics.requests, 0);
    assert.equal(result.metrics.inputTokens, 0);
    for (const metric of ["outputTokens", "totalTokens", "requestCost", "totalNanoAiu", "apiDurationMs", "cacheReadTokens"]) {
      assert.equal(result.metrics[metric], null);
    }
    assert.deepEqual(result.sessions[0].models, ["gpt-5.4"]);
  });

  it("preserves zero and partial model-row coverage while discarding invalid values and unsafe names", () => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    f.events(id, [snapshot({
      modelMetrics: {
        "gpt-5.4": { requests: { count: 0, cost: 0 }, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, totalNanoAiu: 0 },
        "https://PRIVATE_MODEL": { requests: { count: "PRIVATE_COUNT", cost: -1 }, usage: { inputTokens: -5, outputTokens: "PRIVATE_OUTPUT" }, totalNanoAiu: null, agentName: "PRIVATE_AGENT" },
      },
      totalApiDurationMs: 0, totalNanoAiu: 0,
      content: "PRIVATE_CONTENT", path: "PRIVATE_PATH", error: "PRIVATE_ERROR",
    })]);
    const result = f.store().snapshot({ timeframe: "all" });
    for (const metric of ["requests", "inputTokens", "outputTokens", "totalTokens", "requestCost", "totalNanoAiu", "apiDurationMs"]) {
      assert.equal(result.metrics[metric], 0);
    }
    assert.deepEqual(result.evidence.inputTokens, { source: "jsonl-shutdown", status: "partial", recorded: 1, total: 2 });
    assert.equal(result.models.find((row) => row.model === "Unknown model").metrics.requests, null);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|https:/);
  });

  it("ignores invalid snapshot structures/timestamps and retains output-only fallback when none is usable", () => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    f.events(id, [
      snapshot(fullSnapshot(), "PRIVATE_INVALID_TIME"),
      snapshot({ modelMetrics: [] }),
      snapshot({ modelMetrics: { "gpt-5.4": { requests: { count: -1, cost: "PRIVATE_COST" } } } }),
      event("assistant.message", { outputTokens: 4 }),
    ]);
    const result = f.store().snapshot({ timeframe: "all" });
    assert.equal(result.metrics.outputTokens, 4);
    assert.equal(result.metrics.requests, null);
    assert.equal(result.evidence.outputTokens.source, "jsonl");
    assert.equal(result.usageGranularity, "output-events");
    assert.equal(result.capabilities.sessionState, "partial");
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  });

  it("prefers any exact SessionDB rows, even with partial fields, over every shutdown metric", () => {
    const f = fixture();
    const id = f.session();
    f.usage(id, { output_tokens: null, total_nano_aiu: null, duration_ms: null });
    f.events(id, [snapshot(fullSnapshot()), event("assistant.message", { outputTokens: 999 })]);
    const store = f.store();
    const result = store.snapshot({ timeframe: "all" });
    const detail = store.detail(result.sessions[0].handle);
    assert.equal(result.metrics.requests, 1);
    assert.equal(result.metrics.inputTokens, 10);
    for (const metric of ["outputTokens", "totalTokens", "requestCost", "totalNanoAiu", "apiDurationMs", "durationMs"]) {
      assert.equal(result.metrics[metric], null);
      assert.equal(detail.session.metrics[metric], null);
    }
    assert.equal(result.usageGranularity, "recorded-requests");
    assert.equal(result.evidence.inputTokens.source, "sessiondb");
    assert.ok(Object.values(detail.session.evidence).every((value) => value.source !== "jsonl-shutdown"));
  });

  it("counts root metrics once per session and never allocates them into a model filter", () => {
    const f = fixture();
    f.session("shutdown");
    f.events("shutdown", [snapshot(fullSnapshot())]);
    f.session("exact");
    f.usage("exact", { total_nano_aiu: 50 });
    f.session("output");
    f.events("output", [event("assistant.message", { outputTokens: 3 })]);
    const store = f.store();
    const all = store.snapshot({ timeframe: "all" });
    assert.equal(all.metrics.totalNanoAiu, 250);
    assert.equal(all.metrics.apiDurationMs, 1234);
    assert.deepEqual(all.evidence.totalNanoAiu, { source: "mixed", status: "partial", recorded: 2, total: 3, scope: "session" });
    assert.equal(all.evidence.apiDurationMs.recorded, 1);
    assert.equal(all.evidence.apiDurationMs.total, 3);
    const selected = store.snapshot({ timeframe: "all", model: "gpt-5-mini" });
    assert.equal(selected.metrics.totalNanoAiu, 50);
    assert.equal(selected.metrics.apiDurationMs, null);
    assert.equal(selected.sessions[0].metrics.totalNanoAiu, 200);
    assert.equal(selected.sessions[0].metrics.apiDurationMs, 1234);
    assert.equal(selected.sessions[0].selectedUsage.totalNanoAiu, 50);
    assert.equal(selected.sessions[0].selectedUsage.apiDurationMs, null);
  });

  it("uses model nano-AIU totals when no valid root total is recorded, without invented duration", () => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    f.events(id, [snapshot({ ...fullSnapshot(), totalNanoAiu: "PRIVATE_ROOT", totalApiDurationMs: -1 })]);
    const result = f.store().snapshot({ timeframe: "all" });
    assert.equal(result.metrics.totalNanoAiu, 150);
    assert.equal(result.metrics.apiDurationMs, null);
    assert.equal(result.sessions[0].evidence.totalNanoAiu.scope, undefined);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ROOT/);
  });

  it("preserves root-only partial snapshots without inventing model rows or combining output events", () => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    f.events(id, [
      snapshot(fullSnapshot(), "2026-09-01T00:00:00Z"),
      snapshot({ totalApiDurationMs: 0, totalNanoAiu: 25 }),
      event("assistant.message", { outputTokens: 999 }),
    ]);
    const store = f.store();
    const result = store.snapshot({ timeframe: "all" });
    assert.equal(result.metrics.apiDurationMs, 0);
    assert.equal(result.metrics.totalNanoAiu, 25);
    assert.equal(result.metrics.requests, null);
    assert.equal(result.metrics.outputTokens, null);
    assert.equal(result.usageGranularity, "session-model-aggregate");
    assert.deepEqual(result.models, []);
    assert.deepEqual(store.detail(result.sessions[0].handle).attribution, []);
    assert.equal(result.evidence.totalNanoAiu.scope, "session");
  });

  it("renders shutdown evidence and opaque cost while suppressing repeated unknown rows and credits", () => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    f.events(id, [snapshot(fullSnapshot())]);
    const store = f.store();
    const result = store.snapshot({ timeframe: "all" });
    const outputs = [
      formatUsageSummary(result),
      formatUsageSession(store.detail(result.sessions[0].handle)),
      formatUsageModels(result),
    ];
    for (const output of outputs) {
      assert.match(output, /Shutdown aggregate/);
      assert.match(output, /Recorded request cost \(opaque unit\)/);
      assert.match(output, /not currency or local credits/);
      assert.equal((output.match(/Local credits: Not recorded/g) ?? []).length, 1);
      assert.doesNotMatch(output, /\| [^|\n]+ \| Not recorded \|/);
      assert.doesNotMatch(output, /\| Local credits \||\| Mean time to first token/);
    }
    assert.match(outputs[0], /\| Session API duration \(ms\) \| 1234 \|/);
    assert.doesNotMatch(outputs[2], /\| Session API duration \(ms\) \|/);
  });
});
