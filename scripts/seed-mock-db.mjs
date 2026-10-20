#!/usr/bin/env node
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PRIVACY_CANARY = "SYNTHETIC_PRIVATE_CONTENT_DO_NOT_DISPLAY";

// Every invocation creates new synthetic sources outside the checkout and user stores.
export function createSyntheticFixture({ empty = false, extraSessions = 0, withoutExactUsage = false } = {}) {
  if (!Number.isInteger(extraSessions) || extraSessions < 0 || extraSessions > 100) {
    throw new Error("Synthetic extra-session count must be an integer from 0 to 100.");
  }
  const directory = mkdtempSync(join(tmpdir(), "copilot-insights-fixture-"));
  const dbPath = join(directory, "session-store.db");
  const sessionStatePath = join(directory, "session-state");
  const stateDir = join(directory, "app-state");
  mkdirSync(sessionStatePath);
  mkdirSync(stateDir);
  const db = new Database(dbPath);
  const ids = Array.from({ length: 8 + extraSessions }, (_, index) => `synthetic-private-session-${String(index + 1).padStart(2, "0")}`);
  const now = Date.now();
  const time = (days, offset = 0) => new Date(now - days * 86_400_000 + offset).toISOString();
  try {
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, repository TEXT,
        branch TEXT, summary TEXT, cwd TEXT, host_type TEXT
      );
      CREATE TABLE turns (session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT, timestamp TEXT);
      CREATE TABLE assistant_usage_events (
        session_id TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
        turn_index INTEGER, agent_id TEXT, parent_tool_call_id TEXT,
        cache_read_tokens INTEGER, cache_write_tokens INTEGER, total_nano_aiu INTEGER,
        request_multiplier REAL, duration_ms REAL, time_to_first_token_ms REAL,
        output_ttft_ms REAL, inter_token_latency_ms REAL, finish_reason TEXT,
        content_filter_triggered INTEGER, created_at TEXT
      );
    `);
    if (!empty) {
      const insertSession = db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, 'cli')");
      const insertTurn = db.prepare("INSERT INTO turns VALUES (?, 0, ?, ?, ?)");
      ids.forEach((id, index) => {
        const days = index === 5 ? 60 : index % 28 + 1;
        insertSession.run(id, time(days), time(days, 120_000), `${PRIVACY_CANARY}/repository`,
          `${PRIVACY_CANARY}/branch`, PRIVACY_CANARY, `C:\\${PRIVACY_CANARY}`);
        insertTurn.run(id, PRIVACY_CANARY, PRIVACY_CANARY, time(days));
      });
      const insertUsage = db.prepare(`INSERT INTO assistant_usage_events VALUES (
        @session, @model, @input, @output, @turn, @agent, @parent, @cacheRead, @cacheWrite,
        @nano, @multiplier, @duration, @ttft, @outputTtft, @interLatency, @finish, @contentFiltered, @created
      )`);
      const usage = (session, model, input, output, overrides = {}) => insertUsage.run({
        session, model, input, output, turn: 0, agent: null, parent: null, cacheRead: 0, cacheWrite: 0,
        nano: null, multiplier: 1, duration: 1200, ttft: 120, outputTtft: null, interLatency: null,
        finish: "stop", contentFiltered: 0, created: time(1), ...overrides,
      });
      usage(ids[0], "gpt-5.4", 10_000, 1_000, { cacheRead: 4000, nano: 123_456_789 });
      usage(ids[0], "claude-sonnet-4.6", 30_000, 1_000, {
        parent: "synthetic-child-a", cacheRead: 20_000, duration: 4000, multiplier: 2,
        outputTtft: 500, interLatency: 25, contentFiltered: 1, finish: "content_filter",
        created: time(2), turn: 2,
      });
      usage(ids[0], "claude-sonnet-4.6", 19_000, 1_000, {
        parent: "synthetic-child-a", cacheRead: 15_000, ttft: null, interLatency: 15, turn: 2, finish: "tool_calls",
      });
      usage(ids[0], "claude-sonnet-4.6", 700, 100, { agent: "synthetic-unmatched-agent", cacheRead: null, turn: null });
      usage(ids[1], "claude-sonnet-4.6", 8000, 500, { parent: "synthetic-child-b", cacheRead: 7000, finish: "error", created: time(2) });
      usage(ids[2], "claude-sonnet-4.6", 3000, 500, { agent: "synthetic-unmatched-agent", cacheRead: null, duration: null, ttft: null, created: time(3) });
      usage(ids[2], PRIVACY_CANARY, 0, 0, { agent: "synthetic-unmatched-agent", duration: 0, ttft: 0, created: null });
      usage(ids[5], "gpt-4.1", 2000, 200, { created: time(60) });
      if (withoutExactUsage) db.exec("DELETE FROM assistant_usage_events");

      const writeEvents = (index, events) => {
        const path = join(sessionStatePath, ids[index]);
        mkdirSync(path);
        writeFileSync(join(path, "events.jsonl"), events.map((event, i) => JSON.stringify({
          id: `synthetic-event-${index}-${i}`, timestamp: time(index === 5 ? 60 : index + 1, i * 1000),
          ...event,
        })).join("\n") + "\n");
      };
      const start = { type: "session.start", data: { selectedModel: "gpt-5.4", context: { cwd: PRIVACY_CANARY } } };
      const tool = (toolCallId) => ({ type: "tool.execution_start", data: { toolCallId, toolName: "task", arguments: { prompt: PRIVACY_CANARY, command: PRIVACY_CANARY } } });
      const child = (toolCallId) => ({ type: "subagent.started", data: {
        toolCallId, agentType: "explore", agentName: PRIVACY_CANARY, model: "claude-sonnet-4.6", prompt: PRIVACY_CANARY,
      } });
      const skill = { type: "skill.invoked", data: { name: PRIVACY_CANARY } };
      writeEvents(0, [start, tool("synthetic-child-a"), child("synthetic-child-a"), skill, skill,
        { type: "subagent.completed", data: { toolCallId: "synthetic-child-a", durationMs: 4200, result: PRIVACY_CANARY } },
        { type: "assistant.message", data: { content: PRIVACY_CANARY, outputTokens: 999_999 } }]);
      writeEvents(1, [start, tool("synthetic-child-b"), child("synthetic-child-b"),
        { type: "subagent.failed", data: { toolCallId: "synthetic-child-b", durationMs: 2000, error: PRIVACY_CANARY } },
        { type: "session.shutdown", data: {} }]);
      writeEvents(2, [start, { type: "session.shutdown", data: {} }]);
      writeEvents(3, [{ type: "session.start", data: { selectedModel: "gpt-5-mini" } },
        { type: "assistant.message", data: { outputTokens: 420, content: PRIVACY_CANARY } },
        { type: "session.shutdown", data: {} }]);
      writeEvents(5, [{ type: "session.start", data: { selectedModel: "gpt-4.1" } }, { type: "session.shutdown", data: {} }]);
      const shutdown = {
        type: "session.shutdown",
        data: {
          totalApiDurationMs: 2200,
          totalNanoAiu: 16_000_000,
          modelMetrics: {
            "gpt-5-mini": {
              requests: { count: 2, cost: 0.5 },
              usage: { inputTokens: 5000, outputTokens: 420, cacheReadTokens: 3000, cacheWriteTokens: 0 },
              totalNanoAiu: 12_000_000,
              description: PRIVACY_CANARY,
            },
          },
        },
      };
      writeEvents(6, [{ type: "session.start", data: { selectedModel: "gpt-5-mini" } },
        { type: "assistant.message", data: { outputTokens: 420, content: PRIVACY_CANARY } }, shutdown, shutdown]);
      writeEvents(7, [{ type: "session.start", data: { selectedModel: "gpt-5.4-mini" } }, {
        type: "session.shutdown",
        data: {
          totalApiDurationMs: 0,
          modelMetrics: {
            "gpt-5.4-mini": { requests: { count: 2, cost: 0 }, usage: { outputTokens: 345 } },
          },
        },
      }]);
    }
  } finally {
    db.close();
  }
  return {
    directory, dbPath, sessionStatePath, stateDir, ids,
    usageDays: { recent: time(1).slice(0, 10), child: time(2).slice(0, 10), unattributed: time(3).slice(0, 10) },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(createSyntheticFixture(), null, 2));
}
