import { before, after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, rmSync } from "node:fs";
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

function workspaceRoot(edition, workspaceId) {
  const productDir = edition === "stable" ? "Code" : "Code - Insiders";
  return join(appDataRoot, productDir, "User", "workspaceStorage", workspaceId);
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
  appDataRoot = join(process.cwd(), "test-artifacts", `vscode-sessions-${process.pid}`);
  process.env.APPDATA = appDataRoot;
});

after(() => {
  if (originalAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = originalAppData;

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
    assert.equal(summary.totalSessions, 2);
    assert.equal(summary.totalTurns, 3);
    assert.equal(summary.avgTurnsPerSession, 1.5);
    assert.equal(summary.sessionsWithAttachments, 1);
    assert.deepEqual(summary.editions, { stable: 1, insiders: 1 });
    assert.deepEqual(summary.models[0], { name: "GPT-4.1", count: 2 });
    assert.deepEqual(summary.modes[0], { name: "agent", count: 2 });
  });
});

describe("analyzeVSCodeSession", () => {
  it("scores first-turn clarity and classifies delegation patterns", () => {
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
          ],
        },
      },
    });

    const session = readVSCodeSessions()[0];
    const analysis = analyzeVSCodeSession(session);

    assert.equal(analysis.judgment, null);
    assert.equal(analysis.efficiency, null);
    assert.equal(analysis.turnCount, 2);
    assert.ok(analysis.specification.score > 40);
    assert.equal(analysis.delegation.turns[0].type, "delegation");
    assert.equal(analysis.delegation.turns[1].type, "question");
    assert.equal(analysis.delegation.counts.delegation, 1);
    assert.equal(analysis.delegation.counts.question, 1);
  });
});
