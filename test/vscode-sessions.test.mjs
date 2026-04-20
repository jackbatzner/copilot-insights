// Tests for src/vscode-sessions.mjs — VSCode Copilot Chat session discovery.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Create a temp directory structure that mimics VSCode workspaceStorage.
const TEST_STORAGE_DIR = join(tmpdir(), `ci-vscode-test-${Date.now()}`);

// Set env override BEFORE importing the module.
process.env.VSCODE_STORAGE_PATH = TEST_STORAGE_DIR;

let mod;

const SAMPLE_SESSION = {
  id: "vsc-session-001",
  createdAt: "2025-01-15T10:00:00Z",
  updatedAt: "2025-01-15T11:00:00Z",
  title: "Test VSCode session",
  workspace: {
    resource: "file:///home/dev/projects/org/my-app",
  },
  messages: [
    { role: "user", content: "Add a login form", timestamp: "2025-01-15T10:00:00Z" },
    { role: "assistant", content: "Here's the login form component.", timestamp: "2025-01-15T10:01:00Z" },
    { role: "user", content: "Now add validation", timestamp: "2025-01-15T10:05:00Z" },
    { role: "assistant", content: "Added validation with error messages.", timestamp: "2025-01-15T10:06:00Z" },
  ],
};

const SAMPLE_SESSION_2 = {
  id: "vsc-session-002",
  createdAt: "2025-01-16T10:00:00Z",
  updatedAt: "2025-01-16T12:00:00Z",
  title: "Another session",
  workspace: {
    resource: "file:///home/dev/github/org/api-service",
  },
  messages: [
    { role: "user", content: "Create REST endpoints", timestamp: "2025-01-16T10:00:00Z" },
    { role: "assistant", content: "Created the endpoints.", timestamp: "2025-01-16T10:05:00Z" },
  ],
};

before(async () => {
  // Build a fake workspaceStorage layout:
  // TEST_STORAGE_DIR/
  //   workspace-hash-1/github.copilot-chat/chatSessions/session1.json
  //   workspace-hash-2/github.copilot-chat/chatSessions/session2.json
  const ws1 = join(TEST_STORAGE_DIR, "abc123", "github.copilot-chat", "chatSessions");
  const ws2 = join(TEST_STORAGE_DIR, "def456", "github.copilot-chat", "chatSessions");
  mkdirSync(ws1, { recursive: true });
  mkdirSync(ws2, { recursive: true });

  writeFileSync(
    join(ws1, "sessions.json"),
    JSON.stringify({ sessions: [SAMPLE_SESSION] }),
  );
  writeFileSync(
    join(ws2, "sessions.json"),
    JSON.stringify({ sessions: [SAMPLE_SESSION_2] }),
  );

  mod = await import("../src/vscode-sessions.mjs");
});

after(() => {
  if (existsSync(TEST_STORAGE_DIR)) {
    rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
  }
  delete process.env.VSCODE_STORAGE_PATH;
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("SOURCE_VSCODE", () => {
  it("is the string 'vscode'", () => {
    assert.equal(mod.SOURCE_VSCODE, "vscode");
  });
});

// ---------------------------------------------------------------------------
// discoverVscodePaths
// ---------------------------------------------------------------------------

describe("discoverVscodePaths", () => {
  it("returns array of file paths", () => {
    const paths = mod.discoverVscodePaths();
    assert.ok(Array.isArray(paths));
    assert.ok(paths.length >= 2, `expected at least 2 paths, got ${paths.length}`);
  });

  it("all paths end with .json", () => {
    const paths = mod.discoverVscodePaths();
    for (const p of paths) {
      assert.ok(p.endsWith(".json"), `expected .json path, got ${p}`);
    }
  });
});

// ---------------------------------------------------------------------------
// parseVscodeSessionFile
// ---------------------------------------------------------------------------

describe("parseVscodeSessionFile", () => {
  it("returns empty array for nonexistent file", () => {
    const result = mod.parseVscodeSessionFile("/nonexistent/path.json");
    assert.deepStrictEqual(result, []);
  });

  it("parses sessions from { sessions: [...] } wrapper", () => {
    const filePath = join(TEST_STORAGE_DIR, "abc123", "github.copilot-chat", "chatSessions", "sessions.json");
    const result = mod.parseVscodeSessionFile(filePath);
    assert.ok(result.length >= 1);
    assert.equal(result[0].id, "vsc-session-001");
  });

  it("attaches _sourceFile to each session", () => {
    const filePath = join(TEST_STORAGE_DIR, "abc123", "github.copilot-chat", "chatSessions", "sessions.json");
    const result = mod.parseVscodeSessionFile(filePath);
    assert.equal(result[0]._sourceFile, filePath);
  });
});

// ---------------------------------------------------------------------------
// listVscodeSessions
// ---------------------------------------------------------------------------

describe("listVscodeSessions", () => {
  it("returns normalized session objects", () => {
    const sessions = mod.listVscodeSessions();
    assert.ok(sessions.length >= 2, `expected >= 2, got ${sessions.length}`);
    for (const s of sessions) {
      assert.equal(s.source, "vscode");
      assert.equal(s.host_type, "vscode");
      assert.equal(typeof s.id, "string");
      assert.ok(s.summary, "should have a summary");
    }
  });

  it("sorted by updated_at descending", () => {
    const sessions = mod.listVscodeSessions();
    for (let i = 1; i < sessions.length; i++) {
      assert.ok(
        (sessions[i - 1].updated_at || "") >= (sessions[i].updated_at || ""),
        "sessions should be sorted newest first",
      );
    }
  });

  it("respects limit option", () => {
    const sessions = mod.listVscodeSessions({ limit: 1 });
    assert.equal(sessions.length, 1);
  });

  it("respects since filter", () => {
    const sessions = mod.listVscodeSessions({ since: "2025-01-16T00:00:00Z" });
    for (const s of sessions) {
      assert.ok(s.created_at >= "2025-01-16T00:00:00Z");
    }
  });

  it("extracts repository from workspace URI", () => {
    const sessions = mod.listVscodeSessions();
    const s1 = sessions.find((s) => s.id === "vsc-session-001");
    assert.ok(s1);
    assert.ok(s1.repository, "should extract repository from workspace URI");
  });

  it("extracts cwd from workspace URI", () => {
    const sessions = mod.listVscodeSessions();
    const s1 = sessions.find((s) => s.id === "vsc-session-001");
    assert.ok(s1.cwd, "should extract cwd from workspace URI");
  });
});

// ---------------------------------------------------------------------------
// getVscodeSessionTurns
// ---------------------------------------------------------------------------

describe("getVscodeSessionTurns", () => {
  it("returns empty array for unknown session", () => {
    const turns = mod.getVscodeSessionTurns("nonexistent-id");
    assert.deepStrictEqual(turns, []);
  });

  it("returns paired turns from messages", () => {
    const turns = mod.getVscodeSessionTurns("vsc-session-001");
    assert.equal(turns.length, 2);
    assert.equal(turns[0].user_message, "Add a login form");
    assert.equal(turns[0].assistant_response, "Here's the login form component.");
    assert.equal(turns[0].turn_index, 0);
    assert.equal(turns[1].turn_index, 1);
  });

  it("includes timestamps", () => {
    const turns = mod.getVscodeSessionTurns("vsc-session-001");
    assert.ok(turns[0].timestamp, "should have a timestamp");
  });
});

// ---------------------------------------------------------------------------
// getVscodeSession
// ---------------------------------------------------------------------------

describe("getVscodeSession", () => {
  it("returns undefined for unknown session", () => {
    assert.equal(mod.getVscodeSession("nonexistent-id"), undefined);
  });

  it("returns normalized session metadata", () => {
    const session = mod.getVscodeSession("vsc-session-001");
    assert.ok(session);
    assert.equal(session.id, "vsc-session-001");
    assert.equal(session.source, "vscode");
    assert.equal(session.host_type, "vscode");
    assert.equal(session.summary, "Test VSCode session");
    assert.equal(session.turn_count, 2);
  });
});
