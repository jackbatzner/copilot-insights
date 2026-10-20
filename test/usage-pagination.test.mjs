import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { usageFixture, event } from "./usage-fixtures.mjs";
import { createUsageService, UsageRequestError } from "../server/usage-service.mjs";

const fixtures = [];
function fixture() {
  const f = usageFixture();
  const service = createUsageService({ ...f, stateDir: join(f.root, "app") });
  fixtures.push(() => { service.close(); f.cleanup(); });
  return { ...f, service };
}
afterEach(() => { for (const cleanup of fixtures.splice(0)) cleanup(); });

describe("bounded usage projections", () => {
  it("keeps aggregate totals and global insight leaders while bounding the overview and session pages", () => {
    const f = fixture();
    for (let i = 0; i < 80; i++) {
      const id = f.session(`synthetic-${i}`);
      f.usage(id, { input_tokens: i, output_tokens: 1, duration_ms: 80 - i });
    }
    const all = f.store().snapshot({ timeframe: "all" });
    const overview = f.service.snapshot({ timeframe: "all" });
    assert.equal(overview.sessionCount, 80);
    assert.equal(overview.sessions.length, 25);
    assert.equal(overview.sessionsComplete, false);
    assert.deepEqual(overview.metrics, all.metrics);
    assert.equal(overview.insights.duration.metrics.durationMs, 80);
    assert.equal(overview.pagination.pages, 4);
    const handles = [];
    for (let page = 1; page <= 4; page++) {
      const result = f.service.sessions({ timeframe: "all", page });
      assert.equal(result.pagination.total, 80);
      assert.ok(result.sessions.length <= 25);
      handles.push(...result.sessions.map((row) => row.handle));
    }
    assert.equal(new Set(handles).size, 80);
    assert.equal(f.service.sessions({ timeframe: "all", page: 999 }).pagination.page, 4);
    assert.equal(f.service.sessions({ timeframe: "all", source: "vscode" }).pagination.total, 0);
    assert.doesNotMatch(JSON.stringify(overview), /synthetic-|PRIVATE_/);
  });

  it("applies all filters before paging and computes matching totals for just one selected session", () => {
    const f = fixture();
    const day = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < 30; i++) {
      const id = f.session(`synthetic-${i}`);
      f.usage(id, { model: "gpt-5.4", input_tokens: i, output_tokens: 1, created_at: `${day}T01:00:00.000Z` });
      f.usage(id, { model: "gpt-5-mini", input_tokens: 1000, output_tokens: 0, created_at: `${day}T02:00:00.000Z` });
    }
    const page = f.service.sessions({ timeframe: "all", model: "gpt-5.4", scope: "primary", day, page: 2 });
    assert.equal(page.pagination.total, 30);
    assert.equal(page.sessions.length, 5);
    assert.ok(page.sessions.every((row) => row.selectedUsage.totalTokens <= 5 && row.metrics.totalTokens >= 1001));
    const row = page.sessions[0];
    const selected = f.service.sessions({ timeframe: "all", session: row.handle, model: "gpt-5.4", scope: "primary", day });
    assert.equal(selected.sessions.length, 1);
    assert.deepEqual(selected.sessions[0].selectedUsage, row.selectedUsage);
    f.service.setHidden(row.handle, true);
    assert.equal(f.service.sessions({ timeframe: "all", session: row.handle }).pagination.total, 0);
    assert.equal(f.service.sessions({ timeframe: "all", session: row.handle, includeHidden: "true" }).pagination.total, 1);
  });

  it("loads turn summaries independently and only pages request evidence after a turn is opened", () => {
    const f = fixture();
    const id = f.session();
    f.db.transaction(() => {
      for (let i = 0; i < 2203; i++) f.usage(id, {
        turn_index: Math.floor(i / 40), model: i % 2 ? "gpt-5-mini" : "gpt-5.4",
        finish_reason: i % 2 ? "tool_calls" : "stop",
      });
    })();
    const handle = f.service.sessions({ timeframe: "all" }).sessions[0].handle;
    const header = f.service.detail(handle, { view: "summary" });
    assert.equal(header.session.metrics.requests, 2203);
    assert.equal(header.turnUsage, undefined);
    assert.equal(header.toolUsage, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(header)) < 50000);
    const page = f.service.turns(handle, {});
    assert.equal(page.requestCount, 2203);
    assert.equal(page.matchingTurnCount, 56);
    assert.equal(page.turns.length, 20);
    assert.ok(page.turns.every((turn) => turn.requests.length === 0 && turn.matchingRequestCount <= 40));
    assert.ok(page.turns.every((turn) => !Object.hasOwn(turn, "callBreakdown")));
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 150000);
    const first = f.service.turns(handle, { turn: "0" }).turns[0];
    const second = f.service.turns(handle, { turn: "0", requestPage: "2" }).turns[0];
    assert.equal(first.requests.length, 25);
    assert.equal(second.requests.length, 15);
    assert.equal(new Set([...first.requests, ...second.requests].map((row) => row.key)).size, 40);
    assert.equal(first.metrics.requests, 40);
    assert.equal(first.callBreakdown.total, 40);
    assert.deepEqual(first.callBreakdown, second.callBreakdown);
    assert.deepEqual(first.callBreakdown.scopes, { primary: 40, subagent: 0, unattributed: 0 });
    assert.deepEqual(first.callBreakdown.endings, [{ reason: "stop", count: 20 }, { reason: "tool_calls", count: 20 }]);
    const filtered = f.service.turns(handle, { model: "gpt-5-mini", turn: "0" }).turns[0];
    assert.equal(filtered.requests.length, 20);
    assert.equal(filtered.matchingUsage.metrics.requests, 20);
    assert.equal(filtered.metrics.requests, 40);
    assert.equal(filtered.callBreakdown.total, 20);
    assert.deepEqual(filtered.callBreakdown.endings, [{ reason: "tool_calls", count: 20 }]);
    assert.doesNotMatch(JSON.stringify(page), /PRIVATE_|synthetic-session/);
    f.db.prepare("UPDATE assistant_usage_events SET turn_index=999 WHERE turn_index=0").run();
    const changed = f.service.detail(handle, { view: "summary" });
    assert.deepEqual(changed.session.metrics, header.session.metrics);
    assert.notEqual(changed.revision, header.revision, "request reassignment invalidates sections even with unchanged whole-session totals");
  });

  it("preserves unavailable filters, unassigned calls, and aggregate-only states", () => {
    const f = fixture();
    const id = f.session();
    f.usage(id, { turn_index: null, output_tokens: null });
    f.usage(id, { turn_index: 7 });
    const handle = f.service.sessions({ timeframe: "all" }).sessions[0].handle;
    assert.equal(f.service.turns(handle, { model: "gpt-5-mini" }).matchingRequestCount, 0);
    const missing = f.service.turns(handle, { assignment: "unassigned", turn: "unassigned" });
    assert.equal(missing.turns.length, 1);
    assert.equal(missing.turns[0].turnIndex, null);
    assert.equal(missing.turns[0].metrics.totalTokens, null);
    assert.equal(f.service.turns(handle, { assignment: "assigned" }).matchingTurnCount, 1);
    const other = f.session("synthetic-empty");
    f.events(other, [event("session.shutdown", { modelMetrics: {
      "gpt-5-mini": { usage: { inputTokens: 10, outputTokens: 5 }, requests: { count: 1 } },
    } })]);
    const aggregate = f.service.sessions({ timeframe: "all" }).sessions.find((row) => row.usageGranularity === "session-model-aggregate");
    assert.equal(f.service.turns(aggregate.handle, {}).status, "aggregate-only");
  });

  it("selects bounded later-session candidates before truncation and excludes the saved session", () => {
    const f = fixture();
    const after = new Date(Date.now() - 3600000).toISOString();
    for (let i = 0; i < 40; i++) {
      const id = f.session(`synthetic-${i}`, { createdAt: i < 15 ? new Date(Date.now() - 7200000).toISOString() : new Date().toISOString() });
      f.usage(id);
    }
    const saved = f.service.sessions({ timeframe: "all" }).sessions[0].handle;
    const rows = f.service.sessions({ timeframe: "all", after, exclude: saved, sort: "later", pageSize: 12 }).sessions;
    assert.equal(rows.length, 12);
    assert.ok(rows.every((row) => row.createdAt > after && row.handle !== saved));
  });

  it("rejects malformed, oversized, unknown, or duplicated pagination and detail selectors", () => {
    const f = fixture();
    f.session(); f.usage();
    const handle = f.service.sessions({ timeframe: "all" }).sessions[0].handle;
    for (const query of [{ page: 0 }, { page: ["1"] }, { pageSize: 101 }, { sort: "arbitrary" }, { after: "bad" }, { sort: "later" }]) {
      assert.throws(() => f.service.sessions(query), UsageRequestError);
    }
    for (const query of [{ turn: -1 }, { turn: ["1"] }, { requestPage: 0 }, { page: 1.2 }, { sort: "recent" }]) {
      assert.throws(() => f.service.turns(handle, query), UsageRequestError);
    }
    assert.throws(() => f.service.detail(handle, { view: "arbitrary" }), UsageRequestError);
    assert.throws(() => f.service.tools(handle, { arbitrary: true }), UsageRequestError);
  });
});
