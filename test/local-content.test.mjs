import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { Buffer } from "node:buffer";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "../server/index.mjs";
import { createUsageService } from "../server/usage-service.mjs";
import { createExtension } from "../src/extension-runtime.mjs";
import { createLocalContentReader } from "../src/local-content.mjs";

const ID = "PRIVATE_SESSION_ID";
const OTHER_ID = "PRIVATE_OTHER_SESSION";
const CHILD = "PRIVATE_CHILD_ID";
const PROMPT = "CONSENTED_USER_CANARY <script>alert('x')</script> C:\\original\\user-path";
const REPLY = "CONSENTED_REPLY_CANARY **original markdown**";
const AGENT = "CONSENTED_AGENT_CANARY";
const SECRET = "NEVER_REVEAL_METADATA_CANARY";
const now = "2026-09-16T12:00:00.000Z";
const fixtures = [];
const turnBody = { consent: true, kind: "turn", turnIndex: 0 };
const event = (type, data) => ({ type, data, timestamp: now });
const childEvents = (prompt = AGENT, callId = CHILD, toolName = "task", argumentsValue = null) => [
  event("subagent.started", { toolCallId: callId, agentName: SECRET, systemPrompt: SECRET }),
  event("tool.execution_start", {
    toolCallId: callId, toolName,
    arguments: argumentsValue ?? { prompt, description: SECRET, command: SECRET, system_prompt: SECRET },
  }),
  event("tool.execution_complete", { toolCallId: callId, result: SECRET, error: SECRET }),
];

async function fixture({ turnColumns = ["session_id", "turn_index", "user_message", "assistant_response"], events = childEvents() } = {}) {
  const root = mkdtempSync(join(process.cwd(), ".local-content-fixture-"));
  const options = { dbPath: join(root, "usage.db"), stateDir: join(root, "preferences"), sessionStatePath: join(root, "sessions") };
  const db = new Database(options.dbPath);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, summary TEXT);
    CREATE TABLE assistant_usage_events (session_id TEXT, turn_index, model TEXT, input_tokens INTEGER,
      output_tokens INTEGER, agent_id TEXT, parent_tool_call_id TEXT);
  `);
  for (const id of [ID, OTHER_ID]) {
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(id, now, now, SECRET);
  }
  db.prepare("INSERT INTO assistant_usage_events VALUES (?, 0, 'gpt-5.4', 10, 5, NULL, NULL)").run(ID);
  db.prepare("INSERT INTO assistant_usage_events VALUES (?, 0, 'gpt-5.4', 10, 5, NULL, ?)").run(ID, CHILD);
  if (turnColumns.length) db.exec(`CREATE TABLE turns (${turnColumns.map((name) => `"${name}"`).join(", ")})`);
  function setEvents(values, id = ID, file = "events.jsonl") {
    const dir = join(options.sessionStatePath, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), values.map((value) => typeof value === "string" ? value : JSON.stringify(value)).join("\n"));
  }
  setEvents(events);
  const service = createUsageService(options);
  const server = await startServer({ service, port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const sessions = (await (await fetch(`${base}/api/sessions?timeframe=all`)).json()).sessions;
  // Labels follow sorted synthetic catalog IDs; the other session sorts first.
  const handle = sessions.find((session) => session.metrics.requests === 2).handle;
  const f = {
    root, options, db, server, service, base, handle, events: setEvents,
    insert(values = {}) {
      const row = { session_id: ID, turn_index: 0, user_message: PROMPT, assistant_response: REPLY, ...values };
      db.prepare(`INSERT INTO turns (${turnColumns.join(", ")}) VALUES (${turnColumns.map(() => "?").join(", ")})`)
        .run(...turnColumns.map((name) => row[name] ?? null));
    },
    async detail() {
      return (await fetch(`${base}/api/sessions/${handle}`)).json();
    },
    async agentBody() {
      const group = (await f.detail()).attribution.find((entry) => entry.scope === "subagent");
      return { consent: true, kind: "agent", attributionKey: group.key };
    },
    request(body = turnBody, extra = {}) {
      return fetch(`${base}/api/sessions/${extra.handle ?? handle}/content${extra.query ?? ""}`, {
        method: extra.method ?? "POST",
        headers: { Origin: base, "Content-Type": "application/json", ...extra.headers },
        ...(extra.method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      });
    },
    async cleanup() {
      await new Promise((done) => { server.close(done); server.closeAllConnections(); });
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
  fixtures.push(f);
  return f;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.cleanup();
});

function assertNoContent(value) {
  assert.doesNotMatch(JSON.stringify(value), /CONSENTED_|NEVER_REVEAL_|PRIVATE_SESSION|PRIVATE_OTHER|PRIVATE_CHILD/);
}

describe("explicit local content reveal boundary", () => {
  it("reveals original text only in consented responses without changing analytics, CLI, state or logs", async (t) => {
    const f = await fixture();
    f.insert();
    const logs = [];
    for (const name of ["log", "warn", "error"]) t.mock.method(console, name, (...args) => logs.push(args));
    const before = await f.detail();
    const stateFile = join(f.options.stateDir, "usage-state.json");
    const stateBefore = readFileSync(stateFile, "utf8");
    const response = await f.request();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
    const body = await response.json();
    assert.deepEqual(body.messages, [{ role: "user", text: PROMPT }, { role: "assistant", text: REPLY }]);
    assert.equal(body.status, "available");
    assert.equal(body.source, "sessiondb");
    assert.equal(body.truncated, false);
    assert.match(body.notice, /not redacted.*sensitive/);
    assert.doesNotMatch(JSON.stringify(body), /NEVER_REVEAL_|PRIVATE_SESSION|PRIVATE_CHILD/);
    const agent = await (await f.request(await f.agentBody())).json();
    assert.deepEqual(agent.messages, [{ role: "agent-prompt", text: AGENT }]);
    assert.equal(agent.status, "available");
    assert.equal(agent.source, "jsonl");
    assert.doesNotMatch(JSON.stringify(agent), /NEVER_REVEAL_|PRIVATE_|command|system_prompt/);
    assert.deepEqual(await f.detail(), before);
    for (const path of ["/api/summary", "/api/sessions", "/api/settings", `/api/sessions/${f.handle}`]) {
      assertNoContent(await (await fetch(`${f.base}${path}`)).json());
    }
    const extension = createExtension(f.options);
    assert.equal(extension.tools.some((tool) => /content/.test(tool.name)), false);
    assertNoContent(await extension.tools.find((tool) => tool.name === "insights_session").handler({ handle: f.handle }));
    assert.equal(readFileSync(stateFile, "utf8"), stateBefore);
    assert.deepEqual(logs, []);
  });

  it("requires exact consent, same-origin POST and JSON on every reveal before reading turn payloads", async (t) => {
    const f = await fixture();
    f.insert();
    const prepare = Database.prototype.prepare;
    const queries = [];
    t.mock.method(Database.prototype, "prepare", function(sql) {
      queries.push(sql);
      return prepare.call(this, sql);
    });
    const missingOrigin = await fetch(`${f.base}/api/sessions/${f.handle}/content`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(turnBody),
    });
    assert.equal(missingOrigin.status, 403);
    assertNoContent(await missingOrigin.json());
    const cases = [
      [turnBody, { method: "GET" }, 405],
      [turnBody, { headers: { Origin: "http://evil.example" } }, 403],
      [turnBody, { headers: { Origin: `${f.base}/` } }, 403],
      [turnBody, { headers: { Origin: "null" } }, 403],
      [turnBody, { headers: { "Sec-Fetch-Site": "cross-site" } }, 403],
      [turnBody, { headers: { "Content-Type": "text/plain" } }, 415],
      [{ kind: "turn", turnIndex: 0 }, {}, 400],
      [{ ...turnBody, consent: false }, {}, 400],
      [{ ...turnBody, consent: "true" }, {}, 400],
      [{ ...turnBody, extra: SECRET }, {}, 400],
      [turnBody, { query: "?consent=true" }, 400],
    ];
    for (const [body, extra, status] of cases) {
      const response = await f.request(body, extra);
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assertNoContent(await response.json());
    }
    assert.equal(queries.some((sql) => /FROM turns/i.test(sql)), false);
    assert.throws(() => f.service.content(f.handle, { ...turnBody, consent: false }), /consent/);
    assert.equal((await f.request()).status, 200);
    assert.equal((await f.request({ kind: "turn", turnIndex: 0 })).status, 400);
  });

  it("rejects duplicates including escaped property names, malformed bodies, raw keys and unknown sessions", async () => {
    const f = await fixture();
    for (const body of [
      '{"consent":false,"consent":true,"kind":"turn","turnIndex":0}',
      '{"consent":true,"con\\u0073ent":true,"kind":"turn","turnIndex":0}',
      '{"consent":true,"kind":"turn","turnIndex":0,"turnIndex":1}',
      '{"consent":true,"kind":"turn","kind":"turn","turnIndex":0}',
      '{"consent":true,',
      'null', '[]', 'true',
      { ...turnBody, turnIndex: -1 },
      { ...turnBody, turnIndex: 0.5 },
      { ...turnBody, turnIndex: Number.MAX_SAFE_INTEGER + 1 },
      { ...turnBody, turnIndex: "0" },
      { ...turnBody, turnIndex: null },
      { ...turnBody, kind: "system" },
      { consent: true, kind: "agent", attributionKey: CHILD },
      { consent: true, kind: "agent", attributionKey: "A".repeat(64) },
      { ...turnBody, path: "C:\\PRIVATE_PATH" },
    ]) {
      const response = await f.request(body);
      assert.equal(response.status, 400);
      assertNoContent(await response.json());
    }
    assert.equal((await f.request({ ...turnBody, extra: "x".repeat(3000) })).status, 413);
    for (const handle of ["0".repeat(64), ID]) {
      const response = await f.request(turnBody, { handle });
      assert.equal(response.status, 404);
      assertNoContent(await response.json());
    }
    const response = await f.request({ consent: true, kind: "agent", attributionKey: "0".repeat(64) });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).messages, []);
  });

  it("selects only the exact session and recorded turn index using a bounded parameterized query", async (t) => {
    const f = await fixture();
    f.insert({ session_id: OTHER_ID, user_message: SECRET, assistant_response: SECRET });
    f.insert({ turn_index: 1, user_message: SECRET, assistant_response: SECRET });
    f.insert();
    const prepare = Database.prototype.prepare;
    const queries = [];
    t.mock.method(Database.prototype, "prepare", function(sql) {
      if (/FROM turns/i.test(sql)) queries.push(sql);
      return prepare.call(this, sql);
    });
    const content = await (await f.request()).json();
    assert.equal(content.messages[0].text, PROMPT);
    assert.doesNotMatch(JSON.stringify(content), /NEVER_REVEAL_/);
    assert.equal(queries.length, 1);
    assert.match(queries[0], /substr\(/);
    assert.match(queries[0], /WHERE session_id = \? AND turn_index = \? LIMIT 3/);
    assert.doesNotMatch(queries[0], /SELECT \*|PRIVATE_/);
    const missing = await (await f.request({ ...turnBody, turnIndex: 500 })).json();
    assert.equal(missing.status, "not-recorded");
    assert.deepEqual(missing.messages, []);
  });

  it("reports missing or incompatible tables and columns without guessing content sources", async () => {
    for (const turnColumns of [[], ["session_id", "user_message"], ["session_id", "turn_index"], ["turn_index", "assistant_response"]]) {
      const f = await fixture({ turnColumns, events: [event("user.message", { content: SECRET, turnIndex: 0 })] });
      const body = await (await f.request()).json();
      assert.equal(body.status, "not-recorded");
      assert.deepEqual(body.messages, []);
      assertNoContent(body);
    }
    const partial = await fixture({ turnColumns: ["session_id", "turn_index", "user_message"] });
    partial.insert();
    const body = await (await partial.request()).json();
    assert.equal(body.status, "partial");
    assert.equal(body.source, "sessiondb");
    assert.deepEqual(body.messages, [{ role: "user", text: PROMPT }]);
    assert.equal(body.truncated, false);
    const nontext = await fixture();
    nontext.insert({ user_message: 123, assistant_response: Buffer.from(SECRET) });
    const absent = await (await nontext.request()).json();
    assert.equal(absent.status, "not-recorded");
    assert.deepEqual(absent.messages, []);
    assertNoContent(absent);
  });

  it("caps each text and the serialized UTF-8 response, reporting all truncation explicitly", async () => {
    for (const text of ["a".repeat(70_000), "😀".repeat(30_000), "\u0001".repeat(30_000)]) {
      const f = await fixture();
      f.insert({ user_message: text, assistant_response: text });
      f.insert({ user_message: text, assistant_response: text });
      f.insert({ user_message: SECRET, assistant_response: SECRET });
      const response = await f.request();
      const serialized = await response.text();
      const body = JSON.parse(serialized);
      assert.equal(body.status, "partial");
      assert.equal(body.truncated, true);
      assert.ok(Buffer.byteLength(serialized, "utf8") <= 64 * 1024);
      assert.ok(body.messages.length <= 4);
      for (const message of body.messages) {
        assert.ok(message.text.length <= 16 * 1024);
        assert.ok(text.startsWith(message.text));
        assert.doesNotMatch(message.text, /[\uD800-\uDBFF]$/);
      }
      assert.doesNotMatch(serialized, /NEVER_REVEAL_/);
    }
    const f = await fixture();
    f.insert({ user_message: `prefix\u0000${SECRET}`, assistant_response: null });
    const body = await (await f.request()).json();
    assert.equal(body.truncated, true);
    assert.equal(body.status, "partial");
  });

  it("requires proven same-session child and task prompt schema, not tool results or arbitrary fields", async () => {
    for (const events of [
      [event("subagent.started", { toolCallId: CHILD }), ...childEvents(SECRET, "PRIVATE_WRONG_CHILD")],
      childEvents(SECRET, CHILD, "powershell"),
      childEvents(SECRET, CHILD, "task", JSON.stringify({ prompt: SECRET })),
      childEvents(SECRET, CHILD, "task", { command: SECRET }),
      childEvents(SECRET, CHILD, "task", { prompt: { content: SECRET } }),
      childEvents(SECRET, CHILD, "task", { prompt: [SECRET] }),
      [event("subagent.started", { toolCallId: CHILD, prompt: SECRET }),
        event("tool.execution_complete", { toolCallId: CHILD, toolName: "task", arguments: { prompt: SECRET }, result: SECRET })],
    ]) {
      const f = await fixture({ events });
      f.events(childEvents(SECRET, CHILD), OTHER_ID);
      const body = await (await f.request(await f.agentBody())).json();
      assert.equal(body.status, "not-recorded");
      assert.deepEqual(body.messages, []);
      assertNoContent(body);
    }
    const f = await fixture({ events: [event("subagent.completed", { toolCallId: CHILD }), ...childEvents(SECRET, "OTHER_CHILD")] });
    const detail = await f.detail();
    const primary = detail.attribution.find((group) => group.scope === "primary");
    const body = await (await f.request({ consent: true, kind: "agent", attributionKey: primary.key })).json();
    assert.equal(body.status, "not-recorded");
    assert.deepEqual(body.messages, []);
  });

  it("uses canonical prompt precedence and fresh content for each consented reveal without caching", async () => {
    const f = await fixture();
    f.events(childEvents(SECRET), ID, "turns.jsonl");
    const body = await f.agentBody();
    assert.equal((await (await f.request(body)).json()).messages[0].text, AGENT);
    f.events(childEvents("CONSENTED_UPDATED_AGENT_CANARY"));
    assert.equal((await (await f.request(body)).json()).messages[0].text, "CONSENTED_UPDATED_AGENT_CANARY");
    f.events([event("tool.execution_start", { toolCallId: CHILD, toolName: "task", arguments: { prompt: SECRET } })]);
    f.events([], ID, "turns.jsonl");
    const removed = await (await f.request(body)).json();
    assert.equal(removed.status, "not-recorded");
    assert.deepEqual(removed.messages, []);
    f.insert();
    assert.equal((await (await f.request()).json()).messages[0].text, PROMPT);
    f.db.prepare("UPDATE turns SET user_message = ?, assistant_response = NULL").run("CONSENTED_UPDATED_USER_CANARY");
    assert.equal((await (await f.request()).json()).messages[0].text, "CONSENTED_UPDATED_USER_CANARY");
  });

  it("bounds JSONL prompts and scans while marking malformed or oversized sources explicitly", async () => {
    const f = await fixture({ events: ["{malformed", ...childEvents("a".repeat(30_000))] });
    const content = await (await f.request(await f.agentBody())).json();
    assert.equal(content.status, "partial");
    assert.equal(content.truncated, true);
    assert.equal(content.messages[0].text.length, 16 * 1024);
    f.events(["x".repeat(4 * 1024 * 1024 + 1), ...childEvents()]);
    const oversized = await (await f.request(await f.agentBody())).json();
    assert.equal(oversized.status, "partial");
    assert.equal(oversized.truncated, true);
    assert.equal(oversized.messages[0].text, AGENT);
    const reader = createLocalContentReader(f.options);
    f.events([(" ".repeat(4 * 1024 * 1024) + "\n").repeat(5), ...childEvents(SECRET)]);
    const bounded = reader.agent(ID, CHILD);
    assert.equal(bounded.status, "not-recorded");
    assert.equal(bounded.truncated, true);
    assert.deepEqual(bounded.messages, []);
  });

  it("rejects path traversal, symlinked session directories and linked JSONL sources", async (t) => {
    const f = await fixture();
    const reader = createLocalContentReader(f.options);
    assert.deepEqual(reader.agent("../PRIVATE", CHILD).messages, []);
    assert.deepEqual(reader.agent("..\\PRIVATE", CHILD).messages, []);
    const linkedSession = join(f.options.sessionStatePath, "linked");
    try {
      symlinkSync(join(f.options.sessionStatePath, ID), linkedSession, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (error.code === "EPERM" || error.code === "EACCES") return t.skip("Symlink creation is unavailable.");
      throw error;
    }
    assert.deepEqual(reader.agent("linked", CHILD).messages, []);
    const linkedRoot = join(f.root, "linked-root");
    symlinkSync(f.options.sessionStatePath, linkedRoot, process.platform === "win32" ? "junction" : "dir");
    assert.deepEqual(createLocalContentReader({ ...f.options, sessionStatePath: linkedRoot }).agent(ID, CHILD).messages, []);
    const fileDir = join(f.options.sessionStatePath, "linked-file");
    mkdirSync(fileDir);
    try {
      symlinkSync(join(f.options.sessionStatePath, ID, "events.jsonl"), join(fileDir, "events.jsonl"), "file");
    } catch (error) {
      if (error.code === "EPERM" || error.code === "EACCES") return;
      throw error;
    }
    assert.deepEqual(reader.agent("linked-file", CHILD).messages, []);
  });
});
