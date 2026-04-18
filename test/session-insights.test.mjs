import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb } from "./test-helpers.mjs";

let computeSessionComplexity, computeCreateEditRatio, computeFileTypeDiversity;

const testData = {
  sessions: [
    { id: "sess-cx1", repository: "org/test-app", branch: "feat-build", summary: "Full build", created_at: "2025-01-15T10:00:00Z", updated_at: "2025-01-15T11:00:00Z" },
  ],
  turns: [
    { session_id: "sess-cx1", turn_index: 0, user_message: "Build the app", assistant_response: "Building..." },
    { session_id: "sess-cx1", turn_index: 1, user_message: "Add tests", assistant_response: "Adding tests..." },
    { session_id: "sess-cx1", turn_index: 2, user_message: "Deploy", assistant_response: "Deploying..." },
  ],
  files: [
    // JS files (4 ops)
    { session_id: "sess-cx1", file_path: "src/app.js", tool_name: "create" },
    { session_id: "sess-cx1", file_path: "src/utils.js", tool_name: "create" },
    { session_id: "sess-cx1", file_path: "src/app.js", tool_name: "edit" },
    { session_id: "sess-cx1", file_path: "test/app.test.js", tool_name: "create" },
    // TS files (3 ops)
    { session_id: "sess-cx1", file_path: "src/index.ts", tool_name: "create" },
    { session_id: "sess-cx1", file_path: "src/types.ts", tool_name: "create" },
    { session_id: "sess-cx1", file_path: "src/config.ts", tool_name: "create" },
    // CSS files (3 ops)
    { session_id: "sess-cx1", file_path: "src/styles.css", tool_name: "create" },
    { session_id: "sess-cx1", file_path: "src/theme.css", tool_name: "create" },
    { session_id: "sess-cx1", file_path: "src/layout.css", tool_name: "create" },
    // MD file (1 op)
    { session_id: "sess-cx1", file_path: "docs/README.md", tool_name: "create" },
  ],
  checkpoints: [
    { session_id: "sess-cx1", checkpoint_number: 1, title: "Initial setup", overview: "Set up the project" },
  ],
};

before(async () => {
  setupTestDb(testData);
  const mod = await import("../src/session-insights.mjs");
  computeSessionComplexity = mod.computeSessionComplexity;
  computeCreateEditRatio = mod.computeCreateEditRatio;
  computeFileTypeDiversity = mod.computeFileTypeDiversity;
});

after(() => teardownTestDb());

describe("computeSessionComplexity", () => {
  it("returns correct shape (score, tier, breakdown, hasCheckpoints)", () => {
    const result = computeSessionComplexity("sess-cx1");
    assert.ok(typeof result.score === "number");
    assert.ok(typeof result.tier === "string");
    assert.ok(typeof result.breakdown === "object");
    assert.ok(typeof result.breakdown.fileOps === "number");
    assert.ok(typeof result.breakdown.uniqueFiles === "number");
    assert.ok(typeof result.breakdown.turns === "number");
    assert.ok(typeof result.breakdown.durationMin === "number");
    assert.ok(typeof result.hasCheckpoints === "boolean");
  });

  it("computes plausible values for seeded session", () => {
    const result = computeSessionComplexity("sess-cx1");
    assert.equal(result.breakdown.turns, 3);
    assert.equal(result.breakdown.fileOps, 11);
    assert.equal(result.breakdown.uniqueFiles, 10);
    assert.equal(result.hasCheckpoints, true);
    assert.ok(result.score > 0);
    assert.ok(["lightweight", "moderate", "complex", "epic"].includes(result.tier));
  });

  it("throws for non-existent session", () => {
    assert.throws(
      () => computeSessionComplexity("nonexistent-session-id"),
      { message: /Session not found/ }
    );
  });
});

describe("computeCreateEditRatio", () => {
  it("returns ratio data with overall and perSession", () => {
    const result = computeCreateEditRatio({ repo: "org/test-app" });
    assert.ok(typeof result.overall === "object");
    assert.ok(typeof result.overall.creates === "number");
    assert.ok(typeof result.overall.edits === "number");
    assert.ok(typeof result.overall.ratio === "number");
    assert.ok(typeof result.overall.label === "string");
    assert.ok(Array.isArray(result.perSession));
    assert.ok(typeof result.insight === "string");
  });

  it("counts creates and edits correctly", () => {
    const result = computeCreateEditRatio({ repo: "org/test-app" });
    // 10 creates, 1 edit
    assert.equal(result.overall.creates, 10);
    assert.equal(result.overall.edits, 1);
    assert.ok(result.overall.ratio > 1, "ratio should reflect more creates than edits");
  });
});

describe("computeFileTypeDiversity", () => {
  it("returns extension data with polyglotScore", () => {
    const result = computeFileTypeDiversity({ repo: "org/test-app" });
    assert.ok(Array.isArray(result.extensions));
    assert.ok(typeof result.polyglotScore === "number");
    assert.ok(typeof result.primaryLanguage === "string");
    assert.ok(typeof result.totalExtensions === "number");
    assert.ok(typeof result.insight === "string");
  });

  it("identifies primary language and extension counts", () => {
    const result = computeFileTypeDiversity({ repo: "org/test-app" });
    // .js has 4 ops, .ts has 3, .css has 3, .md has 1
    assert.equal(result.primaryLanguage, ".js");
    assert.ok(result.totalExtensions >= 4);
    // 3 extensions with count >= 3 → polyglotScore = 45
    assert.ok(result.polyglotScore > 0);
  });
});
