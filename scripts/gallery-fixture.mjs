import Database from "better-sqlite3";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createSyntheticFixture, PRIVACY_CANARY } from "./seed-mock-db.mjs";

export function createGalleryFixture() {
  const fixture = createSyntheticFixture();
  const toolIds = ["synthetic-gallery-read", "synthetic-gallery-search", "synthetic-gallery-mcp"];
  const events = toolIds.flatMap((toolCallId, index) => [
    { type: "tool.execution_start", data: { toolCallId, parentToolCallId: "synthetic-child-a",
      toolName: ["view", "rg", PRIVACY_CANARY][index],
      ...(index === 2 ? { mcpServerName: PRIVACY_CANARY, mcpToolName: PRIVACY_CANARY } : {}),
      model: "claude-sonnet-4.6", arguments: { path: PRIVACY_CANARY } } },
    { type: "tool.execution_complete", data: { toolCallId, parentToolCallId: "synthetic-child-a", success: index !== 2, result: PRIVACY_CANARY } },
  ]);
  appendFileSync(join(fixture.sessionStatePath, fixture.ids[0], "events.jsonl"), events.map((event, index) => JSON.stringify({
    ...event, id: `synthetic-gallery-event-${index}`, timestamp: new Date(Date.now() - 86_400_000 + index * 100).toISOString(),
  })).join("\n") + "\n");
  return {
    ...fixture,
    privateMarkers: [...fixture.ids, ...toolIds, "synthetic-child-a", "synthetic-child-b", "synthetic-unmatched-agent", PRIVACY_CANARY,
      fixture.directory, fixture.dbPath, fixture.sessionStatePath, fixture.stateDir],
    addLaterSession() {
      const db = new Database(fixture.dbPath);
      try {
        const id = "synthetic-gallery-later-session";
        const timestamp = new Date().toISOString();
        db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, 'cli')")
          .run(id, timestamp, timestamp, PRIVACY_CANARY, PRIVACY_CANARY, PRIVACY_CANARY, PRIVACY_CANARY);
        db.prepare("INSERT INTO turns VALUES (?, 0, ?, ?, ?)").run(id, PRIVACY_CANARY, PRIVACY_CANARY, timestamp);
        db.prepare(`INSERT INTO assistant_usage_events
          (session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
           turn_index, duration_ms, time_to_first_token_ms, finish_reason, created_at)
          VALUES (?, 'claude-haiku-4.5', 12000, 1500, 6000, 0, 0, 1600, 180, 'stop', ?)`).run(id, timestamp);
        return id;
      } finally { db.close(); }
    },
  };
}
