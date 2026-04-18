import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb } from "./test-helpers.mjs";

let analyzeJudgment;

const testData = {
  sessions: [
    { id: "sess-j1", repository: "org/test-app", branch: "feat-auth", summary: "Auth module", created_at: "2025-01-15T10:00:00Z" },
  ],
  turns: [
    // 4 turns (>= 3 required). Mix of approvals + a quality catch.
    { session_id: "sess-j1", turn_index: 0, user_message: "Create a login form component with email and password fields", assistant_response: "I'll create the login form with validation..." },
    { session_id: "sess-j1", turn_index: 1, user_message: "Looks good", assistant_response: "Great, the form is ready." },
    { session_id: "sess-j1", turn_index: 2, user_message: "Wait, there's a bug in the validation logic", assistant_response: "Let me fix the validation..." },
    { session_id: "sess-j1", turn_index: 3, user_message: "Ship it", assistant_response: "Done and deployed!" },
  ],
  files: [
    { session_id: "sess-j1", file_path: "src/login.js", tool_name: "create", turn_index: 0 },
    { session_id: "sess-j1", file_path: "src/login.js", tool_name: "edit", turn_index: 2 },
  ],
};

before(async () => {
  setupTestDb(testData);
  const mod = await import("../src/judgment.mjs");
  analyzeJudgment = mod.analyzeJudgment;
});

after(() => teardownTestDb());

describe("analyzeJudgment", () => {
  it("returns an object with judgment metrics", () => {
    const result = analyzeJudgment({ repo: "org/test-app" });
    assert.ok(typeof result === "object");
    for (const key of [
      "avgScore", "sessionsAnalyzed", "totalApprovals", "totalCatches",
      "totalLateCatches", "totalApprovalsBeforeCorrection",
      "rubberStampRate", "totalThrashedFiles", "scoreBuckets",
      "worstJudgment", "allThrashed", "suggestions",
    ]) {
      assert.ok(key in result, `missing key: ${key}`);
    }
  });

  it("detects approval patterns", () => {
    const result = analyzeJudgment({ repo: "org/test-app" });
    // "Looks good" and "Ship it" are approval turns
    assert.ok(result.totalApprovals >= 2, `expected >= 2 approvals, got ${result.totalApprovals}`);
  });

  it("detects quality catches", () => {
    const result = analyzeJudgment({ repo: "org/test-app" });
    // "Wait, there's a bug in..." triggers both isCatch and matchPatterns
    assert.ok(result.totalCatches >= 1, `expected >= 1 catches, got ${result.totalCatches}`);
  });

  it("score buckets cover the full range", () => {
    const result = analyzeJudgment({ repo: "org/test-app" });
    assert.ok(Array.isArray(result.scoreBuckets));
    assert.equal(result.scoreBuckets.length, 4);
    const labels = result.scoreBuckets.map((b) => b.label);
    assert.ok(labels.some((l) => l.includes("Excellent")));
    assert.ok(labels.some((l) => l.includes("Poor")));
  });

  it("returns safe defaults for non-matching repo", () => {
    const result = analyzeJudgment({ repo: "nonexistent-repo-xyz" });
    assert.equal(result.sessionsAnalyzed, 0);
    assert.equal(result.avgScore, 0);
    assert.equal(result.totalApprovals, 0);
    assert.equal(result.totalCatches, 0);
    assert.equal(result.totalLateCatches, 0);
    assert.ok(Array.isArray(result.suggestions));
  });
});
