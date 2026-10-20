import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { usageSessionHandle } from "../src/runtime-telemetry.mjs";
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

describe("privacy-safe usage runtime", () => {
  it("shares the exact no-I/O session handle algorithm with internal legacy migration", () => {
    const f = fixture();
    const rawId = f.session("12345678-1234-1234-1234-123456789abc");
    const expected = f.store().snapshot({ timeframe: "all" }).sessions[0].handle;
    assert.equal(usageSessionHandle(rawId, "synthetic-fixed-secret"), expected);
    assert.equal(usageSessionHandle(rawId, Buffer.from("synthetic-fixed-secret")), expected);
    assert.notEqual(usageSessionHandle(rawId, "different-secret"), expected);
    assert.match(usageSessionHandle("absent-private-source-id", "synthetic-fixed-secret"), /^[a-f0-9]{64}$/);
    assert.throws(() => usageSessionHandle(rawId, ""), { code: "HANDLE_SECRET" });
    assert.throws(() => usageSessionHandle(null, "synthetic-fixed-secret"), { code: "HANDLE_ID" });
  });

  it("joins many child requests by same-session parent tool ID without JSONL agentId", () => {
    const f = fixture();
    const id = f.session();
    f.usage();
    f.usage(id, { parent_tool_call_id: "raw-child-id", model: "gpt-5-mini", duration_ms: 20 });
    f.usage(id, { parent_tool_call_id: "raw-child-id", model: "gpt-5.4", duration_ms: 30 });
    f.usage(id, { agent_id: "unmatched-agent", model: "claude-sonnet-4.6" });
    f.events(id, [
      event("session.start"),
      event("subagent.started", { toolCallId: "raw-child-id", agentName: "PRIVATE_AGENT", agentDisplayName: "PRIVATE_AGENT_LABEL", agentType: "explore", model: "gpt-5-mini" }),
      event("tool.execution_start", { toolCallId: "raw-child-id", toolName: "PRIVATE_TOOL", model: "gpt-5-mini" }),
      event("skill.invoked", { name: "PRIVATE_SKILL", model: "gpt-5-mini", content: "PRIVATE_CONTENT", path: "C:\\PRIVATE_PATH", description: "PRIVATE_DESCRIPTION" }),
      event("subagent.completed", { toolCallId: "raw-child-id", durationMs: 40, model: "gpt-5-mini", totalTokens: 99999, totalToolCalls: 20, cancelled: false }),
    ]);
    const store = f.store();
    const snapshot = store.snapshot({ timeframe: "all" });
    const detail = store.detail(snapshot.sessions[0].handle);
    const [primary, child, unattributed] = detail.attribution;
    assert.deepEqual(detail.attribution.map((group) => group.scope), ["primary", "subagent", "unattributed"]);
    assert.equal(primary.metrics.requests, 1);
    assert.equal(child.metrics.requests, 2);
    assert.equal(child.correlation, "exact-child");
    assert.equal(child.durationMs, 40);
    assert.equal(child.metrics.durationMs, 50);
    assert.equal(child.outcome, "completed");
    assert.equal(child.skill, null);
    assert.equal(child.requestedModel, "gpt-5-mini");
    assert.equal(child.models.length, 2);
    assert.equal(unattributed.metrics.requests, 1);
    assert.equal(snapshot.metrics.totalTokens, 60);
    assert.equal(detail.attribution.reduce((sum, group) => sum + group.metrics.totalTokens, 0), 60);
    assert.deepEqual(detail.skills, [{ category: "skill", count: 1 }]);
    assert.equal(detail.skillLinkage, "session-only");
    assert.equal(detail.diagnostic.childCount, 1);
    assert.equal(detail.diagnostic.toolCount, 1);
    assert.equal(detail.diagnostic.status, "active");
    assert.doesNotMatch(JSON.stringify({ snapshot, detail }), /PRIVATE_|raw-child-id|unmatched-agent|synthetic-session/);
  });

  it("does not join another session's child or infer child identity from completion alone", () => {
    const f = fixture();
    f.session("session-a");
    f.session("session-b");
    f.usage("session-a", { parent_tool_call_id: "same-id" });
    f.usage("session-b", { parent_tool_call_id: "same-id" });
    f.events("session-a", [event("subagent.started", { toolCallId: "same-id" })]);
    f.events("session-b", [event("subagent.completed", { toolCallId: "same-id" })]);
    const store = f.store();
    const result = store.snapshot({ timeframe: "all" });
    const a = store.detail(result.sessions.find((session) => store.resolveHandle(session.handle) === "session-a").handle);
    const b = store.detail(result.sessions.find((session) => store.resolveHandle(session.handle) === "session-b").handle);
    assert.equal(a.attribution[0].correlation, "exact-child");
    assert.equal(a.attribution[0].outcome, "not-recorded");
    assert.equal(b.attribution[0].scope, "unattributed");
  });

  it("preserves cancellation/failure without errors and does not charge lifecycle totals", () => {
    const f = fixture();
    const id = f.session();
    f.events(id, [
      event("subagent.started", { toolCallId: "cancelled-call" }),
      event("subagent.completed", { toolCallId: "cancelled-call", cancelled: true, durationMs: 0, totalTokens: 99 }),
      event("subagent.started", { toolCallId: "failed-call" }),
      event("subagent.failed", { toolCallId: "failed-call", error: "PRIVATE_ERROR" }),
      event("session.shutdown"),
    ]);
    const store = f.store();
    const result = store.snapshot({ timeframe: "all" });
    const detail = store.detail(result.sessions[0].handle);
    assert.deepEqual(detail.attribution.map((group) => group.outcome), ["cancelled", "failed"]);
    assert.equal(detail.attribution[0].durationMs, 0);
    assert.equal(detail.attribution[0].metrics.totalTokens, null);
    assert.equal(detail.diagnostic.status, "completed");
    assert.equal(result.metrics.totalTokens, null);
    assert.doesNotMatch(JSON.stringify(detail), /PRIVATE_ERROR/);
  });

  it("filters primary, child, and unattributed models while preserving whole-session totals", () => {
    const f = fixture();
    const id = f.session();
    f.usage(id, { model: "gpt-5.4" });
    f.usage(id, { model: "gpt-5-mini", parent_tool_call_id: "child" });
    f.usage(id, { model: "claude-sonnet-4.6", agent_id: "unmatched" });
    f.events(id, [event("subagent.started", { toolCallId: "child" })]);
    const store = f.store();
    for (const model of ["gpt-5.4", "gpt-5-mini", "claude-sonnet-4.6"]) {
      const snapshot = store.snapshot({ timeframe: "all", model });
      assert.equal(snapshot.sessionCount, 1);
      assert.equal(snapshot.metrics.totalTokens, 15);
      assert.equal(snapshot.sessions[0].metrics.totalTokens, 45);
      assert.equal(snapshot.sessions[0].selectedUsage.totalTokens, 15);
      assert.equal(snapshot.models.length, 3);
    }
    assert.equal(store.snapshot({ timeframe: "all", model: "unknown-filter" }).sessionCount, 0);
  });

  it("uses activity-window catalog filtering but always reports whole-session request usage", () => {
    const f = fixture();
    const old = "2000-01-01T00:00:00.000Z";
    f.session("active", { createdAt: old });
    f.session("old", { createdAt: old, updatedAt: old });
    f.usage("active", { created_at: old });
    f.usage("old", { created_at: old });
    const store = f.store();
    for (const timeframe of ["7d", "30d", "90d"]) {
      const result = store.snapshot({ timeframe });
      assert.equal(result.sessionCount, 1);
      assert.equal(result.metrics.totalTokens, 15);
    }
    assert.equal(store.snapshot({ timeframe: "all" }).sessionCount, 2);
  });

  it("labels old open lifecycle records as unverified rather than claiming process liveness", () => {
    const f = fixture();
    const old = "2000-01-01T00:00:00.000Z";
    const id = f.session("old-open-lifecycle", { createdAt: old, updatedAt: old });
    f.events(id, [{ type: "session.start", timestamp: old, data: {} }]);
    const store = f.store();
    const session = store.snapshot({ timeframe: "all" }).sessions[0];
    const detail = store.detail(session.handle);
    assert.equal(session.active, true);
    assert.equal(session.activityEvidence, "recorded-open-lifecycle");
    assert.equal(session.liveStatus, "not-verified");
    assert.equal(detail.diagnostic.activityEvidence, "recorded-open-lifecycle");
    assert.equal(detail.diagnostic.liveStatus, "not-verified");
    assert.equal(detail.diagnostic.updatedAt, old);
    assert.match(detail.capabilities.diagnostics.join(" "), /do not verify a live process/);
    f.events(id, [{ type: "session.shutdown", timestamp: old, data: {} }]);
    const closed = store.detail(session.handle);
    assert.equal(closed.session.active, false);
    assert.equal(closed.diagnostic.activityEvidence, "recorded-closed-lifecycle");
    assert.equal(closed.diagnostic.liveStatus, "not-verified");
  });

  it("provides stable secret-keyed handles and safe internal-only hide resolution", () => {
    const f = fixture();
    const id = f.session("RAW_SOURCE_ID_CANARY");
    f.usage(id);
    const hiddenIds = new Set();
    const store = f.store({ hiddenIds });
    const handle = store.snapshot({ timeframe: "all" }).sessions[0].handle;
    assert.match(handle, /^[a-f0-9]{64}$/);
    assert.equal(f.store().snapshot({ timeframe: "all" }).sessions[0].handle, handle);
    assert.notEqual(f.store({ handleSecret: "other-secret" }).snapshot({ timeframe: "all" }).sessions[0].handle, handle);
    assert.equal(store.resolveHandle(handle), id);
    assert.equal(store.resolveHandle(id), null);
    assert.equal(store.detail(id), null);
    assert.equal(store.detail("a".repeat(64)), null);
    hiddenIds.add(id);
    assert.equal(store.snapshot({ timeframe: "all" }).sessionCount, 0);
    assert.equal(store.snapshot({ timeframe: "all", includeHidden: true }).sessions[0].hidden, true);
    assert.equal(store.detail(handle).session.hidden, true);
    assert.doesNotMatch(JSON.stringify(store.detail(handle)), /RAW_SOURCE_ID_CANARY/);
  });

  it("resolves thousands of persisted handles with one catalog read and no event or usage scans", (t) => {
    const f = fixture();
    const id = f.session();
    f.usage();
    const handle = f.store().snapshot({ timeframe: "all" }).sessions[0].handle;
    const prepare = Database.prototype.prepare;
    const statements = [];
    t.mock.method(Database.prototype, "prepare", function(sql) {
      statements.push(sql);
      assert.doesNotMatch(sql, /assistant_usage_events/);
      return prepare.call(this, sql);
    });
    const store = f.store();
    for (let index = 0; index < 5000; index++) {
      assert.equal(store.resolveHandle(handle), id);
      assert.equal(store.resolveHandle("0".repeat(64)), null);
    }
    assert.deepEqual(statements, ["PRAGMA table_info(sessions)", "SELECT id FROM sessions"]);
    store.close();
    assert.throws(() => store.resolveHandle(handle), { code: "STORE_CLOSED" });
  });

  it("refreshes cached catalog handles after a snapshot or store recreation", () => {
    const f = fixture();
    const firstId = f.session();
    const store = f.store();
    const firstHandle = store.snapshot({ timeframe: "all" }).sessions[0].handle;
    assert.equal(store.resolveHandle(firstHandle), firstId);
    f.db.prepare("DELETE FROM sessions WHERE id = ?").run(firstId);
    store.snapshot({ timeframe: "all" });
    assert.equal(store.resolveHandle(firstHandle), null);
    assert.equal(f.store().resolveHandle(firstHandle), null);
    const secondId = f.session("second-session");
    const secondHandle = store.snapshot({ timeframe: "all" }).sessions[0].handle;
    assert.equal(store.resolveHandle(secondHandle), secondId);
  });

  it("refreshes unresolved hidden handles when an absent database appears", () => {
    const f = fixture();
    const id = f.session();
    f.usage();
    const handle = f.store().snapshot({ timeframe: "all" }).sessions[0].handle;
    const recoveredPath = join(f.root, "recovered.db");
    const hiddenIds = new Set();
    const store = f.store({ dbPath: recoveredPath, hiddenIds });
    assert.equal(store.resolveHandle(handle), null);
    copyFileSync(f.dbPath, recoveredPath);
    assert.equal(store.resolveHandle(handle), id);
    hiddenIds.add(store.resolveHandle(handle));
    assert.equal(store.snapshot({ timeframe: "all" }).sessionCount, 0);
    assert.equal(store.snapshot({ timeframe: "all", includeHidden: true }).sessions[0].hidden, true);
  });

  for (const journalMode of ["delete", "wal"]) {
    it(`invalidates handle cache on ${journalMode} catalog changes before snapshot filtering`, () => {
      const f = fixture();
      f.db.pragma(`journal_mode = ${journalMode}`);
      const originalId = f.session();
      const originalHandle = f.store().snapshot({ timeframe: "all" }).sessions[0].handle;
      const hiddenIds = new Set();
      const store = f.store({ hiddenIds });
      assert.equal(store.resolveHandle(originalHandle), originalId);
      const addedId = f.session("new-hidden-session");
      f.usage(addedId);
      const addedHandle = f.store().snapshot({ timeframe: "all" }).sessions.find((session) => session.handle !== originalHandle).handle;
      assert.equal(store.resolveHandle(addedHandle), addedId);
      hiddenIds.add(store.resolveHandle(addedHandle));
      const snapshot = store.snapshot({ timeframe: "all" });
      assert.equal(snapshot.sessionCount, 1);
      assert.equal(snapshot.sessions[0].handle, originalHandle);
      f.db.prepare("DELETE FROM sessions WHERE id = ?").run(originalId);
      assert.equal(store.resolveHandle(originalHandle), null);
    });
  }

  it("reads usage and JSONL only for the requested detail session", (t) => {
    const f = fixture();
    const wanted = f.session("wanted-session");
    const unrelated = f.session("unrelated-session");
    f.usage(wanted);
    f.usage(unrelated, { input_tokens: 999999 });
    f.events(wanted, [event("session.start")]);
    f.events(unrelated, ["PRIVATE_MALFORMED_EVENT"]);
    const store = f.store();
    const catalog = store.snapshot({ timeframe: "all" }).sessions;
    const wantedSummary = catalog.find((session) => store.resolveHandle(session.handle) === wanted);
    const otherSummary = catalog.find((session) => store.resolveHandle(session.handle) === unrelated);
    const prepare = Database.prototype.prepare;
    const usageQueries = [];
    t.mock.method(Database.prototype, "prepare", function(sql) {
      if (sql.includes("FROM assistant_usage_events")) usageQueries.push(sql);
      return prepare.call(this, sql);
    });
    const detail = store.detail(wantedSummary.handle);
    assert.equal(usageQueries.length, 1);
    assert.match(usageQueries[0], /WHERE session_id = \?$/);
    assert.equal(detail.session.label, wantedSummary.label);
    assert.equal(detail.session.metrics.inputTokens, 10);
    assert.equal(detail.capabilities.sessionState, "available");
    assert.doesNotMatch(detail.capabilities.diagnostics.join(" "), /Malformed/);
    assert.equal(store.resolveHandle(otherSummary.handle), unrelated);
  });

  it("drops arbitrary model/name/path/date/finish-reason text before serialization", () => {
    const f = fixture();
    const id = f.session("PRIVATE_ID", { createdAt: "https://PRIVATE_DATE", updatedAt: "PRIVATE_DATE" });
    f.usage(id, { model: "https://PRIVATE_MODEL", finish_reason: "PRIVATE_FINISH", agent_id: "PRIVATE_AGENT", parent_tool_call_id: "PRIVATE_PARENT" });
    f.events(id, [
      event("subagent.started", { toolCallId: "PRIVATE_PARENT", agentName: "PRIVATE_AGENT_NAME", agentDisplayName: "PRIVATE_DISPLAY", agentType: "C:\\PRIVATE_TYPE", model: "PRIVATE_MODEL" }),
      event("skill.invoked", { name: "https://PRIVATE_SKILL", description: "PRIVATE_DESCRIPTION", content: "PRIVATE_CONTENT", path: "PRIVATE_PATH" }),
      event("tool.execution_complete", { toolCallId: "PRIVATE_TOOL_ID", parentToolCallId: "PRIVATE_PARENT", toolName: "PRIVATE_TOOL", model: "PRIVATE_MODEL", success: false, result: "PRIVATE_RESULT", arguments: "PRIVATE_ARGUMENTS" }),
    ]);
    const store = f.store();
    const snapshot = store.snapshot({ timeframe: "all" });
    const detail = store.detail(snapshot.sessions[0].handle);
    assert.deepEqual(snapshot.sessions[0].models, ["Unknown model"]);
    assert.equal(detail.attribution[0].invocationCategory, "subagent");
    assert.equal(detail.attribution[0].requestedModel, "Unknown model");
    assert.equal(detail.session.createdAt, null);
    assert.doesNotMatch(JSON.stringify({ snapshot, detail }), /PRIVATE_|https:|C:\\/);
  });

  it("supports mixed source coverage and static evidence-backed recommendations", () => {
    const f = fixture();
    f.session("exact");
    f.session("fallback");
    f.usage("exact");
    f.events("fallback", [event("assistant.message", { outputTokens: 2 })]);
    const result = f.store().snapshot({ timeframe: "all" });
    assert.equal(result.metrics.outputTokens, 7);
    assert.equal(result.evidence.outputTokens.source, "mixed");
    assert.equal(result.evidence.inputTokens.status, "partial");
    assert.equal(result.evidence.requests.status, "partial");
    assert.equal(result.recommendation.kind, "insufficient-data");
    f.usage("exact", { cache_read_tokens: 100 });
    const exact = f.store().snapshot({ timeframe: "all", model: "gpt-5.4" });
    assert.equal(exact.recommendation.kind, "cache");
    assert.equal(exact.recommendation.compareMetric, "cacheReadTokens");
    assert.match(exact.recommendation.caveat, /Advisory only/);
  });
});
