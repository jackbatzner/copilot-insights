import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { setupTestDb, teardownTestDb } from "./test-helpers.mjs";

let sessionStateRoot = null;
let moduleCounter = 0;

async function importFresh(modulePath) {
  moduleCounter += 1;
  return import(`${modulePath}?test=${moduleCounter}`);
}

afterEach(() => {
  teardownTestDb();
  delete process.env.COPILOT_SESSION_DB;
  delete process.env.COPILOT_SESSION_STATE_PATH;

  if (sessionStateRoot && existsSync(sessionStateRoot)) {
    rmSync(sessionStateRoot, { recursive: true, force: true });
  }
  sessionStateRoot = null;
});

describe("scanJsonlFile", () => {
  it("parses only matching lines", async () => {
    sessionStateRoot = mkdtempSync(join(tmpdir(), "copilot-insights-jsonl-"));
    const filePath = join(sessionStateRoot, "events.jsonl");
    writeFileSync(
      filePath,
      [
        JSON.stringify({ type: "session.start", data: { selectedModel: "gpt-5.4" } }),
        JSON.stringify({ type: "assistant.message", data: { outputTokens: 42 } }),
        JSON.stringify({ type: "assistant.message", data: { text: "no tokens here" } }),
      ].join("\n"),
      "utf-8"
    );

    process.env.COPILOT_SESSION_STATE_PATH = sessionStateRoot;
    const { scanJsonlFile } = await importFresh("../src/session-state.mjs");
    const parsed = [];
    scanJsonlFile(
      filePath,
      (line) => line.includes("\"assistant.message\"") && line.includes("\"outputTokens\""),
      (obj) => parsed.push(obj.type)
    );

    assert.deepEqual(parsed, ["assistant.message"]);
  });
});

describe("analyzeSessionTokens", () => {
  it("keeps JSONL-backed output token totals and model changes", async () => {
    setupTestDb({
      sessions: [
        {
          id: "sess-jsonl-1",
          repository: "jackbatzner/copilot-insights",
          branch: "jb/jsonl-fast-path",
          summary: "Investigate token costs",
          created_at: "2026-05-20T12:00:00Z",
          updated_at: "2026-05-20T12:05:00Z",
        },
      ],
      turns: [
        {
          session_id: "sess-jsonl-1",
          turn_index: 0,
          user_message: "Analyze the cost discrepancy",
          assistant_response: "Checking the token usage now.",
          timestamp: "2026-05-20T12:00:00Z",
        },
        {
          session_id: "sess-jsonl-1",
          turn_index: 1,
          user_message: "Now optimize the JSONL path",
          assistant_response: "I found a better parsing strategy.",
          timestamp: "2026-05-20T12:02:00Z",
        },
      ],
    });

    sessionStateRoot = mkdtempSync(join(tmpdir(), "copilot-insights-session-state-"));
    process.env.COPILOT_SESSION_STATE_PATH = sessionStateRoot;

    const sessionDir = join(sessionStateRoot, "sess-jsonl-1");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "events.jsonl"),
      [
        JSON.stringify({ type: "session.start", data: { selectedModel: "gpt-5.4-mini" } }),
        JSON.stringify({ type: "tool.execution_start", data: { toolName: "view" } }),
        JSON.stringify({ type: "session.model_change", data: { newModel: "claude-sonnet-4.6" } }),
        JSON.stringify({ type: "assistant.message", data: { outputTokens: 1200 } }),
        JSON.stringify({ type: "assistant.message", data: { outputTokens: 800 } }),
        JSON.stringify({ type: "assistant.message", data: { text: "missing output tokens" } }),
      ].join("\n"),
      "utf-8"
    );

    const { analyzeSessionTokens } = await importFresh("../src/tokens.mjs");
    const result = analyzeSessionTokens("sess-jsonl-1");

    assert.ok(result);
    assert.equal(result.source, "jsonl");
    assert.equal(result.model, "claude-sonnet-4.6");
    assert.equal(result.tokens.output, 2000);
    assert.equal(result.turnCount, 2);
    assert.equal(result.perTurn.length, 2);
    assert.equal(result.perTurn[0].outputTokens, 1200);
    assert.equal(result.perTurn[1].outputTokens, 800);
  });
});
