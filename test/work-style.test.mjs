import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb } from "./test-helpers.mjs";

let analyzeWorkStyle;

const testData = {
  sessions: [
    { id: "ws-struct", repository: "org/app", created_at: "2025-01-15T10:00:00Z" },
    { id: "ws-vibe", repository: "org/app", created_at: "2025-01-16T10:00:00Z" },
  ],
  turns: [
    // Structured: plans first, files later
    { session_id: "ws-struct", turn_index: 0, user_message: "Let's plan the approach for the auth module" },
    { session_id: "ws-struct", turn_index: 1, user_message: "Let me think about the architecture and design" },
    { session_id: "ws-struct", turn_index: 2, user_message: "Good plan, now let's consider the strategy for testing" },
    { session_id: "ws-struct", turn_index: 3, user_message: "Create the auth module now", assistant_response: "Creating..." },
    { session_id: "ws-struct", turn_index: 4, user_message: "Looks good, verify it works", assistant_response: "Tests pass" },
    // Vibe: files immediately
    { session_id: "ws-vibe", turn_index: 0, user_message: "Fix the bug", assistant_response: "Fixed!" },
    { session_id: "ws-vibe", turn_index: 1, user_message: "Ship it" },
  ],
  files: [
    { session_id: "ws-struct", file_path: "src/auth/index.ts", tool_name: "create", turn_index: 3 },
    { session_id: "ws-vibe", file_path: "src/bug.ts", tool_name: "edit", turn_index: 0 },
  ],
};

before(async () => {
  setupTestDb(testData);
  const mod = await import("../src/work-style.mjs");
  analyzeWorkStyle = mod.analyzeWorkStyle;
});

after(() => teardownTestDb());

describe("analyzeWorkStyle", () => {
  it("returns expected shape (summary, coachingTip, sessions)", () => {
    const result = analyzeWorkStyle({ repo: "org/app" });
    assert.ok(result.summary, "missing summary");
    assert.ok(typeof result.coachingTip === "string", "missing coachingTip");
    assert.ok(Array.isArray(result.sessions), "sessions should be an array");
    assert.ok("planExecution" in result, "missing planExecution");
  });

  it("summary.total matches number of sessions with turns", () => {
    const result = analyzeWorkStyle({ repo: "org/app" });
    assert.equal(result.summary.total, 2);
  });

  it("summary.styleCounts has structured/iterative/vibe/mixed keys", () => {
    const result = analyzeWorkStyle({ repo: "org/app" });
    const counts = result.summary.styleCounts;
    for (const key of ["structured", "iterative", "vibe", "mixed"]) {
      assert.ok(key in counts, `missing styleCounts.${key}`);
    }
  });

  it("summary has vibeRate and structuredRate as numbers", () => {
    const result = analyzeWorkStyle({ repo: "org/app" });
    assert.equal(typeof result.summary.vibeRate, "number");
    assert.equal(typeof result.summary.structuredRate, "number");
  });

  it("summary.dominantStyle is a string", () => {
    const result = analyzeWorkStyle({ repo: "org/app" });
    assert.equal(typeof result.summary.dominantStyle, "string");
  });

  it("sessions array has style/emoji/description per session", () => {
    const result = analyzeWorkStyle({ repo: "org/app" });
    for (const s of result.sessions) {
      assert.ok(typeof s.style === "string", "missing style");
      assert.ok(typeof s.emoji === "string", "missing emoji");
      assert.ok(typeof s.description === "string", "missing description");
    }
  });

  it("structured session classified as 'structured'", () => {
    const result = analyzeWorkStyle({ repo: "org/app" });
    const struct = result.sessions.find((s) => s.sessionId === "ws-struct");
    assert.ok(struct, "ws-struct session not found");
    assert.equal(struct.style, "structured");
    assert.ok(struct.firstFileTurn >= 3, `firstFileTurn should be >= 3, got ${struct.firstFileTurn}`);
  });

  it("vibe session classified as 'vibe'", () => {
    const result = analyzeWorkStyle({ repo: "org/app" });
    const vibe = result.sessions.find((s) => s.sessionId === "ws-vibe");
    assert.ok(vibe, "ws-vibe session not found");
    assert.equal(vibe.style, "vibe");
    assert.ok(vibe.firstFileTurn <= 1, `firstFileTurn should be <= 1, got ${vibe.firstFileTurn}`);
  });

  it("coachingTip is a non-empty string", () => {
    const result = analyzeWorkStyle({ repo: "org/app" });
    assert.ok(result.coachingTip.length > 0, "coachingTip should be non-empty");
  });
});
