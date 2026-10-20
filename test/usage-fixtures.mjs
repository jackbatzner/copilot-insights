import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USAGE_COLUMNS } from "../src/db.mjs";
import { createUsageStore } from "../src/runtime-telemetry.mjs";

export function usageFixture({ omit = [], usageTable = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "copilot-usage-synthetic-"));
  const dbPath = join(root, "fixture.db");
  const sessionStatePath = join(root, "state");
  mkdirSync(sessionStatePath);
  const db = new Database(dbPath);
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, summary TEXT, cwd TEXT)");
  const columns = USAGE_COLUMNS.filter((column) => !omit.includes(column));
  const text = new Set(["session_id", "model", "agent_id", "parent_tool_call_id", "finish_reason", "created_at"]);
  if (usageTable) db.exec(`CREATE TABLE assistant_usage_events (${columns.map((column) => `${column} ${text.has(column) ? "TEXT" : "REAL"}`).join(", ")})`);
  return {
    root, db, dbPath, sessionStatePath,
    session(id = "synthetic-session", values = {}) {
      db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)").run(
        id, values.createdAt ?? new Date().toISOString(), values.updatedAt ?? new Date().toISOString(),
        values.summary ?? "PRIVATE_PROMPT_CANARY", values.cwd ?? "C:\\PRIVATE_PATH_CANARY",
      );
      return id;
    },
    usage(sessionId = "synthetic-session", values = {}) {
      const row = {
        session_id: sessionId, model: "gpt-5.4", input_tokens: 10, output_tokens: 5,
        turn_index: 0, agent_id: null, parent_tool_call_id: null,
        cache_read_tokens: 0, cache_write_tokens: 0, total_nano_aiu: 100,
        request_multiplier: 1, duration_ms: 100, time_to_first_token_ms: 10,
        output_ttft_ms: 11, inter_token_latency_ms: 2, finish_reason: "stop",
        content_filter_triggered: 0, created_at: new Date().toISOString(), ...values,
      };
      db.prepare(`INSERT INTO assistant_usage_events (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...columns.map((column) => row[column]));
    },
    events(id, events, file = "events.jsonl") {
      const dir = join(sessionStatePath, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, file), events.map((event) => typeof event === "string" ? event : JSON.stringify(event)).join("\n"));
    },
    store(values = {}) {
      return createUsageStore({ dbPath, sessionStatePath, handleSecret: "synthetic-fixed-secret", ...values });
    },
    cleanup() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function event(type, data = {}, id) {
  return { type, data, ...(id ? { id } : {}), timestamp: "2026-09-01T12:00:00.000Z" };
}
