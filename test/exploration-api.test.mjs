import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startServer } from "../server/index.mjs";
import { createLocalState } from "../server/local-state.mjs";
import { usageFixture, event } from "./usage-fixtures.mjs";

const DAY = "2026-09-10";
const NEXT_DAY = "2026-09-11T12:00:00.000Z";
const CANARY = "PRIVATE_EXPLORATION_CANARY";
const IDS = ["graph-private-a", "graph-private-b", "graph-private-c", "graph-private-d"];

describe("graph exploration Sessions API", () => {
  let fixture, server, base;
  async function request(path, options) {
    const response = await fetch(`${base}${path}`, options);
    assert.match(response.headers.get("content-type"), /application\/json/);
    const body = await response.json();
    const serialized = JSON.stringify(body);
    for (const forbidden of [CANARY, ...IDS, "PRIVATE_PROMPT_CANARY", "PRIVATE_PATH_CANARY", "SELECT ", "SQLITE_"]) {
      assert.ok(!serialized.includes(forbidden), `Unexpected private data: ${forbidden}`);
    }
    return { status: response.status, body };
  }
  before(async () => {
    fixture = usageFixture();
    for (const id of IDS) fixture.session(id, { createdAt: `${DAY}T00:00:00.000Z`, updatedAt: NEXT_DAY });
    const [a, b, c, d] = IDS;
    for (const id of [a, b]) {
      fixture.events(id, [
        event("session.start", { selectedModel: "gpt-5.4", name: CANARY }),
        event("subagent.started", { toolCallId: `${CANARY}-child`, model: "claude-sonnet-4.5", agentType: "task", prompt: CANARY }),
        event("user.message", { content: CANARY }),
      ]);
    }
    const row = (id, input, values = {}) => fixture.usage(id, {
      input_tokens: input, output_tokens: input / 10, created_at: `${DAY}T12:00:00.000Z`, ...values,
    });
    const child = { parent_tool_call_id: `${CANARY}-child`, agent_id: CANARY, model: "claude-sonnet-4.5" };
    row(a, 10);
    row(a, 20, child);
    row(a, 40, { ...child, created_at: NEXT_DAY });
    row(a, 80, { parent_tool_call_id: `${CANARY}-orphan`, agent_id: CANARY });
    row(a, 160, { ...child, created_at: null });
    row(b, 30, { model: "claude-sonnet-4.5" });
    row(b, 60, { ...child, created_at: NEXT_DAY });
    row(b, 120, { ...child, model: "gpt-5.4" });
    row(c, 7, { output_tokens: 1, created_at: "2026-09-09T23:30:00-02:00" });
    row(d, 99, { output_tokens: 9, created_at: null });
    server = await startServer({
      dbPath: fixture.dbPath, sessionStatePath: fixture.sessionStatePath,
      stateDir: join(fixture.root, "preferences"), port: 0,
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise((done) => { server.close(done); server.closeAllConnections(); });
    fixture?.cleanup();
  });

  it("intersects day, scope, and model on the same record while keeping whole-session metrics", async () => {
    const catalog = await request("/api/sessions?timeframe=all");
    const result = await request(`/api/sessions?timeframe=all&day=${DAY}&scope=subagent&model=claude-sonnet-4.5`);
    assert.equal(result.status, 200);
    assert.equal(result.body.sessions.length, 1, "Separate records satisfying separate filters must not match.");
    const session = result.body.sessions[0];
    assert.equal(session.metrics.inputTokens, 310);
    assert.equal(session.metrics.requests, 5);
    assert.equal(session.selectedUsage.inputTokens, 20);
    assert.equal(session.selectedUsage.requests, 1);
    assert.ok(session.selectedEvidence);
    assert.equal(session.performance.childTokens, 242);
    assert.equal(session.performance.childRequests, 3);
    assert.equal(session.performance.childCount, 1);
    assert.deepEqual(result.body.models, catalog.body.models);
    assert.match(session.handle, /^[a-f0-9]{64}$/);
  });

  it("applies day and scope independently and uses recorded UTC dates, never catalog timestamps", async () => {
    const byDay = await request(`/api/sessions?timeframe=all&day=${DAY}`);
    assert.equal(byDay.status, 200);
    assert.equal(byDay.body.sessions.length, 3);
    assert.deepEqual(byDay.body.sessions.map((session) => session.selectedUsage.inputTokens).sort((a, b) => a - b), [7, 110, 150]);
    const primary = await request(`/api/sessions?timeframe=all&day=${DAY}&scope=primary&model=gpt-5.4`);
    assert.equal(primary.status, 200);
    assert.deepEqual(primary.body.sessions.map((session) => session.selectedUsage.inputTokens).sort((a, b) => a - b), [7, 10]);
    const unattributed = await request("/api/sessions?timeframe=all&scope=unattributed");
    assert.equal(unattributed.status, 200);
    assert.equal(unattributed.body.sessions.length, 1);
    assert.equal(unattributed.body.sessions[0].selectedUsage.inputTokens, 80);
  });

  it("keeps hidden sessions excluded from combined filters unless explicitly included", async () => {
    const path = `/api/sessions?timeframe=all&day=${DAY}&scope=subagent&model=claude-sonnet-4.5`;
    const original = await request(path);
    const handle = original.body.sessions[0].handle;
    assert.equal((await request(`/api/sessions/${handle}/hide`, { method: "POST" })).status, 200);
    try {
      assert.deepEqual((await request(path)).body.sessions, []);
      const included = await request(`${path}&includeHidden=true`);
      assert.equal(included.status, 200);
      assert.equal(included.body.sessions.length, 1);
      assert.equal(included.body.sessions[0].hidden, true);
      assert.equal(included.body.sessions[0].selectedUsage.inputTokens, 20);
    } finally {
      assert.equal((await request(`/api/sessions/${handle}/hide`, { method: "DELETE" })).status, 200);
    }
  });

  it("accepts real leap days and unmatched valid combinations as empty results", async () => {
    for (const query of [
      "day=2024-02-29", "day=2000-02-29", "day=2026-09-12&scope=primary&model=gpt-5.4",
      `day=${DAY}&scope=unattributed&model=claude-sonnet-4.5`,
    ]) {
      const result = await request(`/api/sessions?timeframe=all&${query}`);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.sessions, []);
    }
  });

  it("passes the additive exploration DTO unchanged through both summary routes", async () => {
    const { secret } = createLocalState({ stateDir: join(fixture.root, "preferences") }).read();
    const source = fixture.store({ handleSecret: secret });
    let expected;
    try { expected = source.snapshot({ timeframe: "all" }).exploration; }
    finally { source.close(); }
    assert.ok(expected && typeof expected === "object", "The runtime exploration DTO must be available.");
    for (const path of ["/api/summary?timeframe=all", "/api/tokens/summary?timeframe=all"]) {
      const result = await request(path);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.exploration, expected);
    }
  });

  it("rejects impossible, malformed, repeated, and arbitrary filters without echoing input", async () => {
    const invalidDays = [
      "", "2026-02-29", "1900-02-29", "2026-04-31", "2026-00-10", "2026-13-10",
      "2026-09-00", "2026-09-32", "2026-9-10", "2026-09-10T00:00:00Z", `${DAY}Z`, CANARY,
    ];
    for (const day of invalidDays) {
      const result = await request(`/api/sessions?timeframe=all&day=${encodeURIComponent(day)}`);
      assert.equal(result.status, 400);
      assert.deepEqual(result.body, { error: "Invalid day." });
    }
    for (const scope of ["", "all", "Primary", "child", CANARY]) {
      const result = await request(`/api/sessions?scope=${encodeURIComponent(scope)}`);
      assert.equal(result.status, 400);
      assert.deepEqual(result.body, { error: "Invalid scope." });
    }
    for (const query of [
      `day=${DAY}&day=${DAY}`, "scope=primary&scope=subagent",
      `day[content]=${CANARY}`, `scope[content]=${CANARY}`, `rawId=${IDS[0]}`,
    ]) {
      assert.equal((await request(`/api/sessions?${query}`)).status, 400);
    }
  });
});
