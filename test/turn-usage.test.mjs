import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { USAGE_COLUMNS } from "../src/db.mjs";
import { createUsageStore, usageSessionHandle } from "../src/runtime-telemetry.mjs";
import { METRICS } from "../src/usage-metrics.mjs";

const fixtures = [];
const secret = "turn-usage-synthetic-secret";
const rawId = "PRIVATE_SESSION_ID";
const time = "2026-09-01T12:00:00.000Z";
const event = (type, data = {}) => ({ type, data, timestamp: time });
function fixture({ omit = [], usageTable = true } = {}) {
  const root = mkdtempSync(join(process.cwd(), ".turn-usage-fixture-"));
  const dbPath = join(root, "usage.db");
  const sessionStatePath = join(root, "state");
  const db = new Database(dbPath);
  const columns = USAGE_COLUMNS.filter((column) => !omit.includes(column));
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, summary TEXT)");
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(rawId, time, time, "PRIVATE_SUMMARY");
  // No affinity on turn_index: malformed text must remain text rather than becoming a number.
  if (usageTable) db.exec(`CREATE TABLE assistant_usage_events (${columns.map((column) => `"${column}"`).join(", ")}, private_content TEXT)`);
  const stores = [];
  const result = {
    db,
    usage(values = {}) {
      const row = {
        session_id: rawId, model: "gpt-5.4", input_tokens: 10, output_tokens: 5,
        turn_index: 0, agent_id: null, parent_tool_call_id: null, cache_read_tokens: 0,
        cache_write_tokens: 2, total_nano_aiu: 100, duration_ms: 20,
        time_to_first_token_ms: 4, request_multiplier: 1, finish_reason: "stop",
        content_filter_triggered: 0, created_at: time, ...values,
      };
      db.prepare(`INSERT INTO assistant_usage_events (${columns.join(", ")}, private_content) VALUES (${columns.map(() => "?").join(", ")}, 'PRIVATE_REQUEST_CONTENT')`)
        .run(...columns.map((column) => row[column] ?? null));
    },
    events(events, id = rawId) {
      const dir = join(sessionStatePath, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "events.jsonl"), events.map((value) => JSON.stringify(value)).join("\n"));
    },
    store() {
      const store = createUsageStore({ dbPath, sessionStatePath, handleSecret: secret });
      stores.push(store);
      return store;
    },
    detail(store = result.store()) {
      return store.detail(usageSessionHandle(rawId, secret));
    },
    cleanup() {
      for (const store of stores) store.close();
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
  fixtures.push(result);
  return result;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

const requests = (usage) => usage.turns.flatMap((turn) => turn.requests);
const shutdown = event("session.shutdown", {
  modelMetrics: { "gpt-5.4": {
    requests: { count: 50, cost: 2 },
    usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0 },
    totalNanoAiu: 80,
  } },
  totalApiDurationMs: 200, totalNanoAiu: 100,
});

describe("detail-only recorded turn and request usage", () => {
  it("exposes only recognized endings and counts ownership without inventing causal links", () => {
    const f = fixture();
    const reasons = ["tool_calls", "stop", "length", "error", "cancelled", "content_filter", null, "PRIVATE_REASON"];
    reasons.forEach((finish_reason, index) => f.usage({
      finish_reason,
      parent_tool_call_id: index === 0 ? "PRIVATE_CHILD" : null,
      agent_id: index === 1 ? "PRIVATE_UNLINKED_AGENT" : null,
      content_filter_triggered: index === 1 ? 1 : null,
    }));
    f.events([
      event("subagent.started", { toolCallId: "PRIVATE_CHILD", agentType: "explore" }),
      event("tool.execution_start", { toolCallId: "PRIVATE_TOOL", toolName: "read_file", arguments: "PRIVATE_ARGUMENTS" }),
      event("tool.execution_complete", { toolCallId: "PRIVATE_TOOL", success: true, result: "PRIVATE_RESULTS" }),
    ]);
    const turn = f.detail().turnUsage.turns[0];
    assert.deepEqual(turn.callBreakdown, {
      source: "sessiondb", total: 8,
      scopes: { primary: 6, subagent: 1, unattributed: 1 },
      endings: [
        ...reasons.slice(0, 6).map((reason) => ({ reason, count: 1 })),
        { reason: "not-recorded", count: 2 },
      ],
    });
    assert.deepEqual(turn.requests.map((request) => request.finishReason), [
      ...reasons.slice(0, 6), "not-recorded", "not-recorded",
    ]);
    assert.equal(turn.requests[0].contentFiltered, null);
    assert.equal(turn.requests[1].contentFiltered, true);
    assert.equal(turn.requests[1].finishReason, "stop", "a filter flag must not rewrite the recorded ending");
    for (const request of turn.requests) {
      for (const field of ["previousCall", "nextCall", "trigger", "retryOf", "toolCalls"]) {
        assert.equal(Object.hasOwn(request, field), false, "timestamps and tool proximity do not establish causality");
      }
    }
    assert.doesNotMatch(JSON.stringify(turn), /PRIVATE_/);
  });

  it("reconciles multiple turns, models and exact attribution without changing snapshot DTOs", () => {
    const f = fixture();
    f.usage({ turn_index: 3, model: "gpt-5-mini", parent_tool_call_id: "PRIVATE_CHILD", input_tokens: 30 });
    f.usage({ turn_index: 0, duration_ms: 0, cache_read_tokens: 0, total_nano_aiu: 0 });
    f.usage({ turn_index: 3, parent_tool_call_id: "PRIVATE_CHILD", output_tokens: null, time_to_first_token_ms: 8 });
    f.usage({ turn_index: null, agent_id: "PRIVATE_UNMATCHED", model: "claude-sonnet-4.6" });
    f.events([
      event("subagent.started", { toolCallId: "PRIVATE_CHILD", agentType: "explore", model: "gpt-5-mini", agentName: "PRIVATE_AGENT" }),
      event("subagent.completed", { toolCallId: "PRIVATE_CHILD", cancelled: true }),
      event("skill.invoked", { name: "PRIVATE_SKILL" }),
    ]);
    const store = f.store();
    const detail = f.detail(store);
    const usage = detail.turnUsage;
    assert.equal(usage.status, "available");
    assert.equal(usage.source, "sessiondb");
    assert.equal(usage.requestCount, 4);
    assert.equal(usage.assignedRequestCount, 3);
    assert.equal(usage.unassignedRequestCount, 1);
    assert.equal(usage.turnCount, 2);
    assert.deepEqual(usage.turns.map((turn) => [turn.key, turn.label]), [
      ["turn-0", "Turn 0"], ["turn-3", "Turn 3"], ["unassigned", "Unassigned"],
    ]);
    assert.deepEqual(usage.metrics, detail.session.metrics);
    assert.deepEqual(usage.evidence, detail.session.evidence);
    assert.equal(usage.metrics.totalTokens, 65);
    assert.equal(usage.metrics.ttftMs, 5);
    assert.equal(usage.evidence.outputTokens.status, "partial");
    assert.equal(usage.evidence.totalTokens.status, "partial");
    assert.equal(usage.metrics.localCredits, null);
    for (const metric of ["requests", "inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens", "totalNanoAiu", "durationMs"]) {
      assert.equal(usage.turns.reduce((sum, turn) => sum + (turn.metrics[metric] ?? 0), 0), usage.metrics[metric]);
    }
    assert.deepEqual(usage.turns[1].models, ["gpt-5-mini", "gpt-5.4"]);
    assert.equal(usage.turns[1].evidence.outputTokens.recorded, 1);
    assert.equal(usage.turns[1].evidence.outputTokens.total, 2);
    for (const request of requests(usage)) {
      const group = detail.attribution.find((entry) => entry.key === request.attributionKey);
      assert.ok(group);
      assert.equal(request.agentLabel, group.label);
      assert.equal(request.scope, group.scope);
      assert.equal(request.correlation, group.correlation);
      assert.equal(request.metrics.requests, 1);
      assert.equal(request.evidence.requests.total, 1);
      assert.equal(request.metrics.localCredits, null);
      if (request.scope === "subagent") {
        assert.equal(request.requestedModel, "gpt-5-mini");
        assert.equal(request.invocationCategory, "explore");
        assert.equal(request.outcome, "completed");
        assert.equal(group.outcome, "cancelled");
      } else {
        assert.equal(request.requestedModel, null);
        assert.equal(request.invocationCategory, null);
      }
    }
    assert.deepEqual(detail.skills, [{ category: "skill", count: 1 }]);
    const snapshot = store.snapshot({ timeframe: "all" });
    assert.equal(Object.hasOwn(snapshot, "turnUsage"), false);
    assert.equal(Object.hasOwn(snapshot.sessions[0], "turnUsage"), false);
    assert.doesNotMatch(JSON.stringify({ detail, snapshot }), /PRIVATE_/);
  });

  it("keeps invalid indices unassigned and preserves the recorded zero and largest safe index", () => {
    const f = fixture();
    for (const turn_index of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "2", "PRIVATE_INDEX", null, Infinity]) {
      f.usage({ turn_index });
    }
    f.usage({ turn_index: Number.MAX_SAFE_INTEGER });
    f.usage({ turn_index: 0 });
    const usage = f.detail().turnUsage;
    assert.equal(usage.requestCount, 9);
    assert.equal(usage.assignedRequestCount, 2);
    assert.equal(usage.unassignedRequestCount, 7);
    assert.equal(usage.turnCount, 2);
    assert.deepEqual(usage.turns.map((turn) => turn.turnIndex), [0, Number.MAX_SAFE_INTEGER, null]);
    assert.equal(usage.turns[2].requestCount, 7);
    assert.equal(usage.metrics.requests, 9);
    assert.doesNotMatch(JSON.stringify(usage), /PRIVATE_/);
  });

  it("retains exact requests with missing columns and no recorded metrics", () => {
    const f = fixture({ omit: USAGE_COLUMNS.filter((column) => column !== "session_id") });
    f.usage();
    f.usage();
    const usage = f.detail().turnUsage;
    assert.equal(usage.status, "available");
    assert.equal(usage.turnCount, 0);
    assert.equal(usage.unassignedRequestCount, 2);
    assert.equal(usage.turns[0].key, "unassigned");
    for (const request of requests(usage)) {
      assert.equal(request.turnIndex, null);
      assert.equal(request.model, "Unknown model");
      assert.equal(request.createdAt, null);
      assert.equal(request.scope, "unattributed");
      assert.equal(request.outcome, "not-recorded");
      assert.equal(request.finishReason, "not-recorded");
      assert.equal(request.contentFiltered, null);
      for (const metric of METRICS) {
        assert.equal(request.metrics[metric], metric === "requests" ? 1 : null);
        assert.equal(request.evidence[metric].status, metric === "requests" ? "recorded" : "not-recorded");
      }
    }
    assert.deepEqual(usage.turns[0].callBreakdown, {
      source: "sessiondb", total: 2, scopes: { primary: 0, subagent: 0, unattributed: 2 },
      endings: [{ reason: "not-recorded", count: 2 }],
    });
  });

  it("uses stable presentation keys, verified timestamps and source-order ties without inventing chronology", () => {
    const f = fixture();
    const rows = [
      { created_at: null, input_tokens: 1 },
      { created_at: "2026-09-01T14:00:00+01:00", input_tokens: 2 },
      { created_at: time, input_tokens: 3 },
      { created_at: time, input_tokens: 4 },
      { created_at: "2026-09-01 10:00:00", input_tokens: 5 },
      { created_at: "PRIVATE_TIME", input_tokens: 6 },
      { created_at: "2026-02-30T00:00:00Z", input_tokens: 7 },
    ];
    for (const row of rows) f.usage(row);
    const store = f.store();
    const first = f.detail(store).turnUsage;
    assert.deepEqual(f.detail(store).turnUsage, first);
    assert.deepEqual(f.detail().turnUsage, first);
    assert.deepEqual(requests(first).map((request) => request.metrics.inputTokens), [3, 4, 2, 1, 5, 6, 7]);
    assert.deepEqual(requests(first).map((request) => request.createdAt), [
      time, time, "2026-09-01T13:00:00.000Z", null, null, null, null,
    ]);
    assert.deepEqual(requests(first).map((request) => request.key), rows.map((_, index) => `request-${index + 1}`));
    assert.deepEqual(requests(first).map((request) => request.ordinal), [1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps exact partial DB rows authoritative over shutdown and output-only fallback", () => {
    const f = fixture();
    f.usage({ input_tokens: 0, output_tokens: null, total_nano_aiu: null, finish_reason: "error" });
    f.events([shutdown, event("assistant.message", { outputTokens: 999, content: "PRIVATE_OUTPUT" })]);
    const detail = f.detail();
    assert.equal(detail.turnUsage.status, "available");
    assert.equal(detail.turnUsage.requestCount, 1);
    assert.equal(detail.turnUsage.metrics.inputTokens, 0);
    assert.equal(detail.turnUsage.metrics.outputTokens, null);
    assert.equal(detail.turnUsage.metrics.requestCost, null);
    assert.equal(detail.turnUsage.metrics.totalNanoAiu, null);
    assert.equal(detail.turnUsage.metrics.apiDurationMs, null);
    assert.equal(requests(detail.turnUsage)[0].outcome, "failed");
    assert.deepEqual(detail.turnUsage.metrics, detail.session.metrics);
  });

  it("never synthesizes requests from shutdown, output events or absent usage", () => {
    for (const usageTable of [true, false]) {
      for (const [events, status, source, count] of [
        [[shutdown], "aggregate-only", "jsonl-shutdown", 50],
        [[event("assistant.message", { outputTokens: 9 })], "unavailable", "jsonl", null],
        [[], "unavailable", "not-recorded", null],
      ]) {
        const f = fixture({ usageTable });
        f.events(events);
        const detail = f.detail();
        const usage = detail.turnUsage;
        assert.equal(usage.status, status);
        assert.equal(usage.source, source);
        assert.deepEqual(usage.turns, []);
        assert.equal(usage.requestCount, 0);
        assert.equal(usage.assignedRequestCount, 0);
        assert.equal(usage.unassignedRequestCount, 0);
        assert.equal(usage.turnCount, 0);
        assert.equal(usage.metrics.requests, count);
        assert.deepEqual(usage.metrics, detail.session.metrics);
        assert.deepEqual(usage.evidence, detail.session.evidence);
        if (status === "aggregate-only") {
          assert.equal(usage.metrics.totalNanoAiu, 100);
          assert.equal(usage.metrics.apiDurationMs, 200);
          assert.equal(usage.metrics.requestCost, 2);
          assert.equal(usage.metrics.localCredits, null);
        }
      }
    }
  });

  it("uses only safe exact same-session child metadata, never arbitrary IDs, names or content", () => {
    const f = fixture();
    f.db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run("PRIVATE_OTHER_SESSION", time, time, "PRIVATE_OTHER_SUMMARY");
    f.usage({ parent_tool_call_id: "PRIVATE_FOREIGN_CHILD", finish_reason: "PRIVATE_REASON" });
    f.usage({ parent_tool_call_id: "PRIVATE_COMPLETION_ONLY", finish_reason: "cancelled" });
    f.usage({
      parent_tool_call_id: "PRIVATE_EXACT_CHILD", agent_id: "PRIVATE_AGENT_ID",
      model: "https://PRIVATE_MODEL", finish_reason: "stop", content_filter_triggered: 1,
    });
    f.events([event("subagent.started", { toolCallId: "PRIVATE_FOREIGN_CHILD" })], "PRIVATE_OTHER_SESSION");
    f.events([
      event("subagent.completed", { toolCallId: "PRIVATE_COMPLETION_ONLY" }),
      event("subagent.started", {
        toolCallId: "PRIVATE_EXACT_CHILD", agentType: "PRIVATE_CATEGORY",
        model: "PRIVATE_REQUESTED_MODEL", agentName: "PRIVATE_NAME",
        agentDisplayName: "PRIVATE_DISPLAY", description: "PRIVATE_DESCRIPTION",
      }),
      event("skill.invoked", { name: "PRIVATE_SKILL", path: "C:\\PRIVATE_PATH", content: "PRIVATE_CONTENT" }),
      event("user.message", { content: "PRIVATE_PROMPT", turnIndex: 999 }),
    ]);
    const detail = f.detail();
    const rows = requests(detail.turnUsage);
    assert.deepEqual(rows.map((request) => request.scope), ["unattributed", "unattributed", "subagent"]);
    assert.deepEqual(rows.map((request) => request.outcome), ["not-recorded", "cancelled", "failed"]);
    assert.equal(rows[2].model, "Unknown model");
    assert.equal(rows[2].requestedModel, "Unknown model");
    assert.equal(rows[2].invocationCategory, "subagent");
    assert.equal(rows[2].agentLabel, "Subagent 1");
    assert.equal(rows[2].correlation, "exact-child");
    assert.deepEqual(detail.turnUsage.turns.map((turn) => turn.turnIndex), [0]);
    assert.doesNotMatch(JSON.stringify(detail), /PRIVATE_|https:|C:\\|agent_id|parent_tool_call_id|session_id|private_content/);
  });

  it("keeps all requests in large details and never reads conversation tables", (t) => {
    const f = fixture();
    f.db.transaction(() => {
      for (let index = 0; index < 2501; index++) f.usage({ turn_index: index % 23, input_tokens: index });
    })();
    const prepare = Database.prototype.prepare;
    const statements = [];
    t.mock.method(Database.prototype, "prepare", function(sql) {
      statements.push(sql);
      assert.doesNotMatch(sql, /SELECT\s+\*|FROM\s+(?:turns|messages)|private_content/i);
      return prepare.call(this, sql);
    });
    const usage = f.detail().turnUsage;
    assert.equal(usage.requestCount, 2501);
    assert.equal(usage.turnCount, 23);
    assert.equal(requests(usage).length, 2501);
    assert.equal(new Set(requests(usage).map((request) => request.key)).size, 2501);
    assert.equal(usage.metrics.inputTokens, 2500 * 2501 / 2);
    assert.equal(statements.filter((sql) => /FROM assistant_usage_events/.test(sql)).length, 1);
  });
});
