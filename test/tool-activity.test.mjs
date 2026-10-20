import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { createUsageStore, usageSessionHandle } from "../src/runtime-telemetry.mjs";
import { createSessionExecutionReader } from "../src/session-state.mjs";
import { USAGE_COLUMNS } from "../src/db.mjs";

const ID = "PRIVATE_SESSION_ID";
const OTHER = "PRIVATE_OTHER_SESSION";
const CHILD = "PRIVATE_CHILD_ID";
const SECOND = "PRIVATE_SECOND_CHILD";
const SECRET = "PRIVATE_PAYLOAD_CANARY";
const START = "2026-09-16T12:00:00.000Z";
const END = "2026-09-16T12:00:00.100Z";
const secret = "synthetic-tool-handle-secret";
const event = (type, data = {}, timestamp = START, id) => ({ type, data, timestamp, ...(id ? { id } : {}) });
const child = (id = CHILD) => event("subagent.started", { toolCallId: id, agentType: "explore", agentName: SECRET });
function tool(id, name = "view", parent = CHILD, extras = {}) {
  return [
    event("tool.execution_start", { toolCallId: id, toolName: name, parentToolCallId: parent, model: "gpt-5.4", ...extras.start }, extras.startAt ?? START, extras.startId),
    event("tool.execution_complete", { toolCallId: id, parentToolCallId: parent, success: true, ...extras.complete }, extras.endAt ?? END, extras.endId),
  ];
}

const fixtures = [];
function fixture({ events = null, usage = true } = {}) {
  const root = fs.mkdtempSync(join(process.cwd(), ".tool-activity-fixture-"));
  const dbPath = join(root, "usage.db");
  const sessionStatePath = join(root, "state");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT)");
  for (const id of [ID, OTHER]) db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(id, START, START);
  db.exec(`CREATE TABLE assistant_usage_events (${USAGE_COLUMNS.map((name) => `"${name}"`).join(", ")})`);
  const stores = [];
  const f = {
    root, db, dbPath, sessionStatePath,
    usage(values = {}) {
      const row = {
        session_id: ID, model: "gpt-5.4", turn_index: 0,
        input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0,
        parent_tool_call_id: null, agent_id: null, created_at: START, ...values,
      };
      db.prepare(`INSERT INTO assistant_usage_events VALUES (${USAGE_COLUMNS.map(() => "?").join(", ")})`)
        .run(...USAGE_COLUMNS.map((column) => row[column] ?? null));
    },
    events(values, id = ID, file = "events.jsonl") {
      const dir = join(sessionStatePath, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(join(dir, file), values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join("\n"));
    },
    store() {
      const store = createUsageStore({ dbPath, sessionStatePath, handleSecret: secret });
      stores.push(store);
      return store;
    },
    detail(store = f.store(), id = ID) {
      return store.detail(usageSessionHandle(id, secret));
    },
    cleanup() {
      for (const store of stores) store.close();
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  if (usage) f.usage();
  if (events !== null) f.events(events);
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});
const categories = (usage) => usage.groups.flatMap((group) => group.categories);
function reconcile(detail) {
  const usage = detail.toolUsage;
  assert.equal(usage.count, detail.diagnostic.toolCount);
  if (usage.count !== null) {
    assert.equal(usage.linkedCount + usage.unlinkedCount, usage.count);
    assert.equal(usage.groups.reduce((sum, group) => sum + group.count, 0), usage.count);
    for (const group of usage.groups) {
      assert.equal(group.categories.reduce((sum, category) => sum + category.count, 0), group.count);
      for (const category of group.categories) {
        assert.equal(category.succeededCount + category.failedCount + category.unknownOutcomeCount, category.count);
        assert.ok(category.completedCount <= category.count);
        assert.ok(category.timedCount <= category.count);
      }
    }
  }
  assert.doesNotMatch(JSON.stringify(usage), /PRIVATE_|parentToolCallId|toolCallId|arguments|turnIndex|turnId/);
}

describe("detail-only tool execution activity", () => {
  it("reconciles exact child descendants, categories and invocation wrappers without changing usage accounting", () => {
    const f = fixture({ events: [child(), child(SECOND), event("skill.invoked", { name: SECRET })] });
    f.usage({ parent_tool_call_id: CHILD, model: "gpt-5-mini" });
    const store = f.store();
    const before = f.detail(store);
    f.events([
      child(), child(SECOND), event("skill.invoked", { name: SECRET }),
      ...tool(CHILD, "task", SECOND),
      ...tool("PRIVATE_READ", "view"),
      ...tool("PRIVATE_EDIT", "apply_patch", CHILD, { complete: { success: false } }),
      ...tool("PRIVATE_SEARCH", "rg", SECOND),
      ...tool("PRIVATE_SHELL", "powershell", null),
      ...tool("PRIVATE_SELF", "view", "PRIVATE_SELF"),
    ]);
    const detail = f.detail(store);
    const usage = detail.toolUsage;
    reconcile(detail);
    assert.equal(usage.source, "jsonl");
    assert.equal(usage.status, "recorded");
    assert.equal(usage.count, 6);
    assert.equal(usage.linkedCount, 3);
    assert.equal(usage.unlinkedCount, 3);
    assert.deepEqual(usage.groups.map((group) => group.agentLabel), ["Subagent 1", "Subagent 2", "Session / unlinked"]);
    for (const group of usage.groups.filter((group) => group.scope === "subagent")) {
      assert.ok(detail.attribution.some((entry) => entry.key === group.attributionKey && entry.label === group.agentLabel));
    }
    const unlinked = usage.groups.at(-1);
    assert.equal(unlinked.attributionKey, null);
    assert.equal(unlinked.scope, "unattributed");
    assert.deepEqual(unlinked.categories.map((value) => value.category), ["delegation", "file-read", "shell"]);
    const edit = categories(usage).find((value) => value.category === "file-edit");
    assert.equal(edit.failedCount, 1);
    assert.equal(edit.succeededCount, 0);
    assert.equal(edit.durationMs, 100);
    assert.equal(edit.timedCount, 1);
    assert.deepEqual(edit.models, ["gpt-5.4"]);
    assert.deepEqual(detail.session.metrics, before.session.metrics);
    assert.deepEqual(detail.session.evidence, before.session.evidence);
    assert.deepEqual(detail.turnUsage, before.turnUsage);
    assert.deepEqual(detail.skills, before.skills);
    const snapshot = store.snapshot({ timeframe: "all" });
    assert.equal(Object.hasOwn(snapshot, "toolUsage"), false);
    assert.equal(snapshot.sessions.some((session) => Object.hasOwn(session, "toolUsage")), false);
    assert.equal(detail.session.metrics.totalTokens, 30);
    assert.equal(categories(usage).some((category) => Object.hasOwn(category, "metrics")), false);
    assert.match(usage.notice, /derived.*JSONL/);
    assert.match(usage.notice, /not charged usage/);
  });

  it("classifies explicit MCP metadata without retaining names or inferring agent linkage", () => {
    const f = fixture({ events: [
      child(),
      ...tool("PRIVATE_MCP", SECRET, null, { start: { mcpServerName: SECRET, mcpToolName: SECRET, agentId: CHILD } }),
      ...tool("PRIVATE_MCP_COLLISION", "view", null, { start: { mcpServerName: SECRET } }),
      ...tool("PRIVATE_MCP_LEGACY", `mcp__${SECRET}`, null),
      ...tool("PRIVATE_NO_SERVER", SECRET, null, { start: { mcpToolName: SECRET } }),
      ...tool("PRIVATE_INVALID_SERVER", "view", null, { start: { mcpServerName: { name: SECRET } } }),
      ...tool("PRIVATE_EMPTY_SERVER", "view", null, { start: { mcpServerName: "  " } }),
    ] });
    const detail = f.detail();
    reconcile(detail);
    assert.equal(categories(detail.toolUsage).find((value) => value.category === "mcp").count, 3);
    assert.equal(categories(detail.toolUsage).find((value) => value.category === "other").count, 1);
    assert.equal(categories(detail.toolUsage).find((value) => value.category === "file-read").count, 2);
    assert.equal(detail.toolUsage.linkedCount, 0);
    const serialized = JSON.stringify(detail);
    assert.ok(!serialized.includes(SECRET));
    assert.ok(!serialized.includes("mcpServerName"));
    assert.ok(!serialized.includes("mcpToolName"));
    assert.equal(detail.session.metrics.totalTokens, 15);
  });

  it("deduplicates repeated phases and duplicate files by call ID using canonical outcomes and timestamps", () => {
    const first = tool("PRIVATE_CALL", "view", CHILD, { startId: "start-one", endId: "end-one" });
    const duplicate = tool("PRIVATE_CALL", "powershell", CHILD, {
      startId: "start-two", endId: "end-two", endAt: "2026-09-16T12:01:00Z",
      complete: { success: false }, start: { model: "claude-sonnet-4.6" },
    });
    const f = fixture({ events: [child(), ...first, ...duplicate] });
    f.events([child(), ...duplicate, ...first], ID, "turns.jsonl");
    f.events([...first, ...duplicate], ID, "extra.jsonl");
    const detail = f.detail();
    reconcile(detail);
    assert.equal(detail.toolUsage.count, 1);
    assert.equal(detail.toolUsage.linkedCount, 1);
    assert.deepEqual(categories(detail.toolUsage)[0], {
      category: "file-read", count: 1, completedCount: 1, succeededCount: 1,
      failedCount: 0, unknownOutcomeCount: 0, durationMs: 100, timedCount: 1, models: ["gpt-5.4"],
    });
    assert.deepEqual(f.detail().toolUsage, detail.toolUsage);
  });

  it("fails closed on conflicting parents across phases and ignored duplicate identities", () => {
    for (const conflict of ["phase", "same-id", "distinct-id", "duplicate-file", "invalid"]) {
      const first = tool("PRIVATE_CONFLICT", "view", CHILD, { startId: "start", endId: "end" });
      if (conflict === "phase") first[1].data.parentToolCallId = SECOND;
      if (conflict === "invalid") first[1].data.parentToolCallId = { value: SECRET };
      const repeated = event("tool.execution_start", {
        toolCallId: "PRIVATE_CONFLICT", parentToolCallId: SECOND, toolName: "view",
      }, START, conflict === "distinct-id" ? "different" : "start");
      const f = fixture({ events: [child(), child(SECOND), ...first, ...(conflict === "same-id" || conflict === "distinct-id" ? [repeated] : [])] });
      if (conflict === "duplicate-file") f.events([repeated], ID, "turns.jsonl");
      const detail = f.detail();
      reconcile(detail);
      assert.equal(detail.toolUsage.count, 1);
      assert.equal(detail.toolUsage.linkedCount, 0);
      assert.equal(detail.toolUsage.unlinkedCount, 1);
      assert.equal(detail.toolUsage.status, "partial");
      assert.equal(detail.toolUsage.groups[0].attributionKey, null);
      assert.equal(categories(detail.toolUsage)[0].durationMs, 100);
    }
  });

  it("uses only explicit same-session parent evidence, never names, turns, timestamps or another session's child", () => {
    const f = fixture({ events: [
      child(),
      ...tool("PRIVATE_FOREIGN", "view", SECOND),
      ...tool("PRIVATE_NO_PARENT", "rg", null, {
        start: { agentId: CHILD, agentName: CHILD, turnId: CHILD, turnIndex: 0 },
      }),
      ...tool("PRIVATE_KNOWN_PARENT", "view", CHILD, { complete: { parentToolCallId: null } }),
      event("subagent.completed", { toolCallId: "PRIVATE_COMPLETE_ONLY" }),
      ...tool("PRIVATE_UNPROVEN_PARENT", "rg", "PRIVATE_COMPLETE_ONLY"),
    ] });
    f.events([child(SECOND), ...tool("PRIVATE_OTHER_CALL", "view", SECOND)], OTHER);
    const detail = f.detail();
    reconcile(detail);
    assert.equal(detail.toolUsage.count, 4);
    assert.equal(detail.toolUsage.linkedCount, 1);
    assert.equal(detail.toolUsage.unlinkedCount, 3);
    assert.equal(f.detail(f.store(), OTHER).toolUsage.linkedCount, 1);
    assert.equal(detail.toolUsage.groups[0].agentLabel, "Subagent 1");
    assert.equal(Object.hasOwn(detail.turnUsage.turns[0], "toolUsage"), false);
  });

  it("preserves missing start/completion/IDs and unknown outcomes rather than assuming success", () => {
    const f = fixture({ events: [
      child(),
      event("tool.execution_start", { toolCallId: "PRIVATE_START_ONLY", toolName: "view", parentToolCallId: CHILD }),
      event("tool.execution_complete", { toolCallId: "PRIVATE_END_ONLY", toolName: "rg", success: false, parentToolCallId: CHILD }),
      ...tool("PRIVATE_UNKNOWN", "view", CHILD, { complete: { success: "true" } }),
      event("tool.execution_start", { toolName: "powershell", parentToolCallId: CHILD }),
      event("tool.execution_complete", { toolCallId: 12, success: true }),
    ] });
    const detail = f.detail();
    reconcile(detail);
    assert.equal(detail.toolUsage.count, 3);
    assert.equal(detail.toolUsage.status, "partial");
    const values = categories(detail.toolUsage);
    const read = values.find((value) => value.category === "file-read");
    assert.equal(read.count, 2);
    assert.equal(read.completedCount, 1);
    assert.equal(read.succeededCount, 0);
    assert.equal(read.unknownOutcomeCount, 2);
    assert.equal(read.timedCount, 1);
    const search = values.find((value) => value.category === "search");
    assert.equal(search.failedCount, 1);
    assert.equal(search.durationMs, null);
    assert.equal(search.timedCount, 0);
  });

  it("derives timing only from verified ordered event timestamps, retaining zero and partial coverage", () => {
    const f = fixture({ events: [
      ...tool("PRIVATE_ZERO", "view", null, { endAt: START }),
      ...tool("PRIVATE_NORMAL", "view", null),
      ...tool("PRIVATE_REVERSE", "view", null, { startAt: END, endAt: START }),
      ...tool("PRIVATE_INVALID", "view", null, { startAt: "PRIVATE_DATE", complete: { durationMs: 1234 } }),
      ...tool("PRIVATE_UNZONED", "view", null, { startAt: "2026-09-16 12:00:00" }),
      ...tool("PRIVATE_DATE_ONLY", "view", null, { startAt: "2026-09-16" }),
      ...tool("PRIVATE_OFFSET", "view", null, { startAt: "2026-09-16T13:00:00+01:00", endAt: START }),
    ] });
    const detail = f.detail();
    reconcile(detail);
    const value = categories(detail.toolUsage)[0];
    assert.equal(value.count, 7);
    assert.equal(value.timedCount, 3);
    assert.equal(value.durationMs, 100);
    assert.equal(value.succeededCount, 7);
    assert.equal(detail.toolUsage.status, "partial");
    const zero = fixture({ events: tool("PRIVATE_ONLY_ZERO", "view", null, { endAt: START }) });
    assert.equal(categories(zero.detail().toolUsage)[0].durationMs, 0);
    assert.equal(zero.detail().toolUsage.status, "recorded");
  });

  it("distinguishes absent, empty, malformed and missing-ID execution sources", () => {
    for (const [events, count, status, source] of [
      [null, null, "not-recorded", "not-recorded"],
      [[], 0, "recorded", "jsonl"],
      [["PRIVATE_MALFORMED"], 0, "partial", "jsonl"],
      [[event("tool.execution_start", { toolName: "view" })], 0, "partial", "jsonl"],
      [[event("session.start", {})], 0, "recorded", "jsonl"],
    ]) {
      const f = fixture({ events });
      const detail = f.detail();
      reconcile(detail);
      assert.equal(detail.toolUsage.count, count);
      assert.equal(detail.toolUsage.status, status);
      assert.equal(detail.toolUsage.source, source);
      assert.equal(detail.toolUsage.linkedCount, count === null ? null : 0);
      assert.equal(detail.toolUsage.unlinkedCount, count === null ? null : 0);
      assert.deepEqual(detail.toolUsage.groups, []);
    }
  });

  it("sanitizes every metadata field and retains only safe tool categories and recorded model labels", () => {
    const names = ["view", "apply_patch", "rg", "powershell", "task", "web_fetch", "mcp__PRIVATE_SERVER_TOOL", "PRIVATE_CUSTOM_TOOL"];
    const f = fixture({ events: [
      child(),
      ...names.flatMap((name, index) => tool(`PRIVATE_CALL_${index}`, name, CHILD, {
        start: {
          model: "PRIVATE_MODEL", toolCategory: SECRET, name: SECRET,
          arguments: { prompt: SECRET, command: SECRET }, turnId: SECRET,
        },
        complete: { model: "gpt-5-mini", result: SECRET, error: SECRET, output: SECRET },
      })),
    ] });
    const detail = f.detail();
    reconcile(detail);
    assert.deepEqual(categories(detail.toolUsage).map((value) => value.category).sort(), [
      "delegation", "file-edit", "file-read", "mcp", "other", "search", "shell", "web",
    ]);
    for (const value of categories(detail.toolUsage)) {
      assert.deepEqual(value.models, ["Unknown model", "gpt-5-mini"]);
    }
    assert.doesNotMatch(JSON.stringify(detail), /PRIVATE_|mcp__|toolName|arguments|systemPrompt/);
    const reader = createSessionExecutionReader(f.sessionStatePath);
    const normalized = [...reader.read(ID).tools.values()];
    assert.doesNotMatch(JSON.stringify(normalized), /PRIVATE_PAYLOAD|PRIVATE_MODEL|PRIVATE_CUSTOM|PRIVATE_SERVER|arguments|result|toolName/);
    reader.clear();
  });

  it("retains cache-hit maps and partial diagnostics, refreshes changes, and accounts for tool metadata in cache admission", (t) => {
    const f = fixture({ events: [child(), ...tool("PRIVATE_FIRST"), ...tool("PRIVATE_SECOND"), ...tool("PRIVATE_THIRD"), "PRIVATE_BROKEN"] });
    const original = fs.readSync;
    let reads = 0;
    t.mock.method(fs, "readSync", (...args) => { reads++; return original(...args); });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
    const reader = createSessionExecutionReader(f.sessionStatePath);
    const first = reader.read(ID);
    const coldReads = reads;
    assert.ok(first.tools instanceof Map);
    assert.equal(first.tools.size, 3);
    assert.equal(reader.read(ID), first);
    assert.equal(reads, coldReads);
    const store = f.store();
    const detail = f.detail(store);
    const afterDetail = reads;
    assert.equal(detail.toolUsage.status, "partial");
    assert.deepEqual(f.detail(store).toolUsage, detail.toolUsage);
    assert.equal(reads, afterDetail);
    f.events([child(), ...tool("PRIVATE_UPDATED")]);
    assert.equal(reader.read(ID).tools.size, 1);
    assert.equal(f.detail(store).toolUsage.status, "recorded");
    f.events([child(), ...tool("PRIVATE_FIRST"), ...tool("PRIVATE_SECOND"), ...tool("PRIVATE_THIRD")]);
    const bounded = createSessionExecutionReader(f.sessionStatePath, { maxCacheBytes: 5000 });
    assert.equal(bounded.read(ID).tools.size, 3);
    const beforeRepeat = reads;
    assert.equal(bounded.read(ID).tools.size, 3);
    assert.ok(reads > beforeRepeat);
    reader.clear();
    bounded.clear();
  });

  it("keeps exact, shutdown and output-only token sources independent of tool telemetry", () => {
    const shutdown = event("session.shutdown", {
      modelMetrics: { "gpt-5.4": { requests: { count: 2 }, usage: { inputTokens: 100, outputTokens: 50 } } },
      totalNanoAiu: 90,
    });
    for (const [usage, events, requests, tokens] of [
      [true, [shutdown], 1, 15],
      [false, [shutdown], 2, 150],
      [false, [event("assistant.message", { outputTokens: 99, content: SECRET })], null, null],
    ]) {
      const f = fixture({ usage, events: [child(), ...events] });
      const before = f.detail();
      f.events([child(), ...events, ...tool("PRIVATE_SEPARATE_COST", "view", CHILD, {
        start: { inputTokens: 999, outputTokens: 999, totalNanoAiu: 999 },
        complete: { totalTokens: 999, durationMs: 999, cost: 999 },
      })]);
      const detail = f.detail();
      reconcile(detail);
      assert.equal(detail.toolUsage.count, 1);
      assert.deepEqual(detail.session.metrics, before.session.metrics);
      assert.deepEqual(detail.session.evidence, before.session.evidence);
      assert.deepEqual(detail.turnUsage, before.turnUsage);
      assert.equal(detail.session.metrics.requests, requests);
      assert.equal(detail.session.metrics.totalTokens, tokens);
      assert.equal(detail.session.metrics.localCredits, null);
    }
  });
});
