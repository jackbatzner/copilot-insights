import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CANARY = "PRIVATE_CANARY_DO_NOT_SERIALIZE";
export const RAW_ID = "11111111-2222-4333-8444-555555555555";
export const OTHER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

export function createUsageFixture() {
  const root = mkdtempSync(join(tmpdir(), "usage-delivery-"));
  const dbPath = join(root, "synthetic.db");
  const stateDir = join(root, "preferences");
  const sessionStatePath = join(root, "sessions");
  mkdirSync(sessionStatePath);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, repository TEXT, branch TEXT, summary TEXT,
      created_at TEXT, updated_at TEXT, host_type TEXT, cwd TEXT
    );
    CREATE TABLE assistant_usage_events (
      session_id TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
      turn_index INTEGER, agent_id TEXT, parent_tool_call_id TEXT,
      cache_read_tokens INTEGER, cache_write_tokens INTEGER, total_nano_aiu INTEGER,
      request_multiplier REAL, duration_ms INTEGER, time_to_first_token_ms INTEGER,
      output_ttft_ms INTEGER, inter_token_latency_ms INTEGER, finish_reason TEXT,
      content_filter_triggered INTEGER, created_at TEXT
    );
    CREATE TABLE turns (session_id TEXT, user_message TEXT, assistant_response TEXT);
    CREATE TABLE session_files (session_id TEXT, file_path TEXT, tool_name TEXT);
    CREATE TABLE checkpoints (session_id TEXT, title TEXT, overview TEXT);
  `);
  const now = new Date().toISOString();
  const insert = db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  insert.run(RAW_ID, CANARY, CANARY, CANARY, now, now, "cli", CANARY);
  insert.run(OTHER_ID, CANARY, CANARY, CANARY, now, now, "cli", CANARY);
  const usage = db.prepare("INSERT INTO assistant_usage_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  usage.run(RAW_ID, "gpt-5", 100, 20, 0, null, null, 0, 0, 500, 1, 1000, 20, null, null, "stop", 0, now);
  usage.run(RAW_ID, "claude-sonnet-4.5", 60, 10, 0, CANARY, CANARY, 0, 0, 250, 1, 500, 10, null, null, "stop", 0, now);
  usage.run(OTHER_ID, CANARY, 30, 5, 0, null, null, 0, 0, 100, 1, 200, 10, null, null, CANARY, 0, now);
  db.prepare("INSERT INTO turns VALUES (?, ?, ?)").run(RAW_ID, CANARY, CANARY);
  db.prepare("INSERT INTO session_files VALUES (?, ?, ?)").run(RAW_ID, CANARY, CANARY);
  db.prepare("INSERT INTO checkpoints VALUES (?, ?, ?)").run(RAW_ID, CANARY, CANARY);
  db.close();
  mkdirSync(join(sessionStatePath, RAW_ID));
  writeFileSync(join(sessionStatePath, RAW_ID, "events.jsonl"), [
    { type: "session.start", data: { selectedModel: "gpt-5", name: CANARY, cwd: CANARY } },
    { type: "subagent.started", data: { toolCallId: CANARY, agentType: CANARY, model: "claude-sonnet-4.5", description: CANARY, prompt: CANARY } },
    { type: "user.message", data: { content: CANARY } },
    { type: "assistant.message", data: { content: CANARY } },
    { type: "tool.execution_start", data: { toolCallId: CANARY, toolName: CANARY, arguments: { command: CANARY } } },
    { type: "tool.execution_complete", data: { toolCallId: CANARY, success: false, result: CANARY, error: CANARY } },
    { type: "subagent.completed", data: { toolCallId: CANARY, durationMs: 700, result: CANARY } },
    { type: "skill.invoked", data: { name: CANARY, path: CANARY, content: CANARY } },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n");
  const coachingFile = join(root, "copilot-insights-journal.json");
  writeFileSync(coachingFile, CANARY);
  return {
    root, options: { dbPath, stateDir, sessionStatePath }, coachingFile,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function assertPrivate(assert, value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const forbidden of [CANARY, RAW_ID, OTHER_ID, "SELECT ", "SQLITE_", "synthetic.db", "events.jsonl"]) {
    assert.ok(!text.includes(forbidden), `Private marker leaked: ${forbidden}`);
  }
}
