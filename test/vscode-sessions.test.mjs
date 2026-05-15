import { before, after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  analyzeVSCodeSession,
  discoverVSCodeWorkspaces,
  readVSCodeSessions,
  summarizeVSCodeSessions,
} from "../src/vscode-sessions.mjs";

const INTERACTIVE_SESSION_KEY = "memento/interactive-session";
let appDataRoot;
let originalAppData;
let originalXdgConfigHome;

function getWorkspaceBase() {
  if (process.platform === "linux") {
    return process.env.XDG_CONFIG_HOME || join(appDataRoot, ".config");
  }

  if (process.platform === "darwin") {
    return join(appDataRoot, "Library", "Application Support");
  }

  return appDataRoot;
}

function workspaceRoot(edition, workspaceId) {
  const productDir = edition === "stable" ? "Code" : "Code - Insiders";
  return join(getWorkspaceBase(), productDir, "User", "workspaceStorage", workspaceId);
}

function seedWorkspace({ edition, workspaceId, sessionData, schema = "normal" }) {
  const root = workspaceRoot(edition, workspaceId);
  mkdirSync(root, { recursive: true });
  const dbPath = join(root, "state.vscdb");
  const db = new Database(dbPath);

  if (schema === "normal") {
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
    if (sessionData !== undefined) {
      db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
        INTERACTIVE_SESSION_KEY,
        typeof sessionData === "string" ? sessionData : JSON.stringify(sessionData)
      );
    }
  } else {
    db.exec("CREATE TABLE OtherTable (id INTEGER PRIMARY KEY, value TEXT)");
  }

  db.close();
}

before(() => {
  originalAppData = process.env.APPDATA;
  originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  appDataRoot = mkdtempSync(join(tmpdir(), "copilot-insights-vscode-sessions-"));
  process.env.APPDATA = appDataRoot;
  process.env.XDG_CONFIG_HOME = appDataRoot;
});

after(() => {
  if (originalAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = originalAppData;

  if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;

  if (existsSync(appDataRoot)) {
    rmSync(appDataRoot, { recursive: true, force: true });
  }
});

beforeEach(() => {
  if (existsSync(appDataRoot)) {
    rmSync(appDataRoot, { recursive: true, force: true });
  }
});

describe("discoverVSCodeWorkspaces", () => {
  it("finds stable and insiders workspace databases", () => {
    seedWorkspace({ edition: "stable", workspaceId: "stable-abc", sessionData: { history: { copilot: [] } } });
    seedWorkspace({ edition: "insiders", workspaceId: "insiders-xyz", sessionData: { history: { copilot: [] } } });

    const workspaces = discoverVSCodeWorkspaces();
    assert.equal(workspaces.length, 2);
    assert.deepEqual(
      workspaces.map((workspace) => ({ workspaceId: workspace.workspaceId, vscodeEdition: workspace.vscodeEdition })),
      [
        { workspaceId: "insiders-xyz", vscodeEdition: "insiders" },
        { workspaceId: "stable-abc", vscodeEdition: "stable" },
      ]
    );
  });
});

describe("readVSCodeSessions", () => {
  it("reads and normalizes Copilot Chat turns across workspaces", () => {
    seedWorkspace({
      edition: "stable",
      workspaceId: "stable-1",
      sessionData: {
        history: {
          copilot: [
            {
              inputText: "Create src/vscode-sessions.mjs and keep the API stable.",
              attachments: [],
              mode: { id: "agent", kind: "agent" },
              selectedModel: {
                identifier: "copilot/claude-opus-4.6",
                metadata: { name: "Claude Opus 4.6" },
              },
            },
            {
              inputText: "What models are available here?",
              attachments: [{ id: 1 }],
              mode: { id: "chat", kind: "chat" },
              selectedModel: {
                identifier: "copilot/gpt-4.1",
                metadata: { name: "GPT-4.1" },
              },
            },
          ],
        },
      },
    });

    seedWorkspace({
      edition: "insiders",
      workspaceId: "insiders-1",
      sessionData: {
        history: {
          copilot: [
            {
              inputText: "Add a dashboard filter.",
              attachments: [],
              mode: { id: "agent", kind: "agent" },
              selectedModel: {
                identifier: "copilot/claude-opus-4.6",
                metadata: { name: "Claude Opus 4.6" },
              },
            },
          ],
        },
      },
    });

    seedWorkspace({ edition: "stable", workspaceId: "bad-json", sessionData: "not-json" });
    seedWorkspace({ edition: "stable", workspaceId: "wrong-schema", schema: "other" });

    const sessions = readVSCodeSessions();
    assert.equal(sessions.length, 2);

    const stableSession = sessions.find((session) => session.workspaceId === "stable-1");
    assert.ok(stableSession);
    assert.equal(stableSession.source, "vscode");
    assert.equal(stableSession.host_type, "vscode");
    assert.equal(stableSession.turnCount, 2);
    assert.deepEqual(stableSession.models, ["Claude Opus 4.6", "GPT-4.1"]);
    assert.deepEqual(stableSession.modes, ["agent", "chat"]);
    assert.equal(stableSession.turns[1].hasAttachments, true);
    assert.equal(stableSession.turns[1].modelId, "copilot/gpt-4.1");
  });

  it("summarizes aggregate VS Code stats", () => {
    seedWorkspace({
      edition: "stable",
      workspaceId: "stable-1",
      sessionData: {
        history: {
          copilot: [
            {
              inputText: "Create the endpoint.",
              attachments: [],
              mode: { id: "agent", kind: "agent" },
              selectedModel: { identifier: "copilot/claude-opus-4.6", metadata: { name: "Claude Opus 4.6" } },
            },
          ],
        },
      },
    });

    seedWorkspace({
      edition: "insiders",
      workspaceId: "insiders-1",
      sessionData: {
        history: {
          copilot: [
            {
              inputText: "Explain the bug.",
              attachments: [{ id: 1 }],
              mode: { id: "chat", kind: "chat" },
              selectedModel: { identifier: "copilot/gpt-4.1", metadata: { name: "GPT-4.1" } },
            },
            {
              inputText: "Now implement the fix.",
              attachments: [],
              mode: { id: "agent", kind: "agent" },
              selectedModel: { identifier: "copilot/gpt-4.1", metadata: { name: "GPT-4.1" } },
            },
          ],
        },
      },
    });

    const summary = summarizeVSCodeSessions();
    const sessions = readVSCodeSessions();
    const analyses = sessions.map((session) => analyzeVSCodeSession(session));
    const avg = (values) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);

    assert.equal(summary.totalSessions, 2);
    assert.equal(summary.totalTurns, 3);
    assert.equal(summary.avgTurnsPerSession, 1.5);
    assert.equal(summary.sessionsWithAttachments, 1);
    assert.deepEqual(summary.editions, { stable: 1, insiders: 1 });
    assert.deepEqual(summary.models[0], { name: "GPT-4.1", count: 2 });
    assert.deepEqual(summary.modes[0], { name: "agent", count: 2 });
    assert.deepEqual(summary.pillarScores, {
      intent: avg(analyses.map((analysis) => analysis.specification.score)),
      workDesign: null,
      qualityControl: avg(analyses.map((analysis) => analysis.judgment.avgScore)),
      evaluation: avg(analyses.map((analysis) => analysis.efficiency.aggregate.avgEfficiency)),
    });
  });
});

describe("analyzeVSCodeSession", () => {
  it("scores clarity, delegation, quality control, and evaluation heuristics", () => {
    seedWorkspace({
      edition: "insiders",
      workspaceId: "analysis-1",
      sessionData: {
        history: {
          copilot: [
            {
              inputText: "Create src/api/routes.mjs and ensure the endpoint validates input without changing existing auth middleware.",
              attachments: [],
              mode: { id: "agent", kind: "agent" },
              selectedModel: { identifier: "copilot/claude-opus-4.6", metadata: { name: "Claude Opus 4.6" } },
            },
            {
              inputText: "What edge cases should we test?",
              attachments: [],
              mode: { id: "chat", kind: "chat" },
              selectedModel: { identifier: "copilot/claude-opus-4.6", metadata: { name: "Claude Opus 4.6" } },
            },
            {
              inputText: "Actually, fix the validation bug instead.",
              attachments: [],
              mode: { id: "agent", kind: "agent" },
              selectedModel: { identifier: "copilot/claude-opus-4.6", metadata: { name: "Claude Opus 4.6" } },
            },
            {
              inputText: "Also add one more test for empty payloads.",
              attachments: [],
              mode: { id: "chat", kind: "chat" },
              selectedModel: { identifier: "copilot/claude-opus-4.6", metadata: { name: "Claude Opus 4.6" } },
            },
          ],
        },
      },
    });

    const session = readVSCodeSessions()[0];
    const analysis = analyzeVSCodeSession(session);

    assert.equal(analysis.turnCount, 4);
    assert.ok(analysis.specification.score > 40);
    assert.equal(analysis.delegation.turns[0].type, "delegation");
    assert.equal(analysis.delegation.turns[1].type, "question");
    assert.equal(analysis.delegation.counts.delegation, 2);
    assert.equal(analysis.delegation.counts.question, 1);
    assert.deepEqual(analysis.judgment, {
      avgScore: 75,
      catches: 1,
      rubberStamps: 0,
      rubberStampRate: 0,
      criticalThinking: 0,
      totalLateCatches: 0,
      suggestions: [],
    });
    assert.deepEqual(analysis.efficiency, {
      aggregate: {
        avgEfficiency: 67,
        totalDripFeeds: 1,
        totalSkimSignals: 0,
        totalRedirections: 1,
      },
    });
  });
});

describe("negative/malformed input", () => {
  it("summarizeVSCodeSessions handles empty session array", () => {
    const summary = summarizeVSCodeSessions([]);
    assert.equal(summary.totalSessions, 0);
    assert.equal(summary.totalTurns, 0);
  });

  it("analyzeVSCodeSession handles session with empty turns", () => {
    const analysis = analyzeVSCodeSession({ turns: [], turnCount: 0, models: [], modes: [] });
    assert.ok(analysis, "should not crash on empty turns");
  });

  it("analyzeVSCodeSession handles session with null messages", () => {
    const analysis = analyzeVSCodeSession({
      turns: [{ turnIndex: 0, userMessage: null, model: "gpt-4", mode: "ask" }],
      turnCount: 1,
      models: ["gpt-4"],
      modes: ["ask"],
    });
    assert.ok(analysis, "should not crash on null messages");
  });

  it("readVSCodeSessions handles corrupted JSON in state DB", () => {
    seedWorkspace({
      edition: "stable",
      workspaceId: "corrupt-json-ws",
      sessionData: "this is {not valid json",
    });
    const sessions = readVSCodeSessions();
    // Should not throw — corrupted workspaces are skipped
    assert.ok(Array.isArray(sessions));
  });

  it("readVSCodeSessions handles missing state table", () => {
    seedWorkspace({
      edition: "stable",
      workspaceId: "missing-table-ws",
      sessionData: undefined,
      schema: "other",
    });
    const sessions = readVSCodeSessions();
    assert.ok(Array.isArray(sessions));
  });
});
