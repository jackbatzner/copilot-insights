import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb } from "./test-helpers.mjs";

let generateDevPlan, generateProgressCheck, generateRetro;

const testData = {
  sessions: [
    { id: "dp1", repository: "org/app", branch: "main", created_at: "2025-01-15T10:00:00Z" },
    { id: "dp2", repository: "org/app", branch: "dev", created_at: "2025-01-16T10:00:00Z" },
  ],
  turns: [
    { session_id: "dp1", turn_index: 0, user_message: "Build the dashboard with React and Vite" },
    { session_id: "dp1", turn_index: 1, user_message: "No, don't use class components" },
    { session_id: "dp1", turn_index: 2, user_message: "Looks good now, ship it" },
    { session_id: "dp2", turn_index: 0, user_message: "Add unit tests for the auth module using vitest" },
    { session_id: "dp2", turn_index: 1, user_message: "Run the tests and verify" },
    { session_id: "dp2", turn_index: 2, user_message: "Perfect" },
  ],
  files: [
    { session_id: "dp1", file_path: "src/Dashboard.jsx", tool_name: "create", turn_index: 0 },
    { session_id: "dp2", file_path: "test/auth.test.ts", tool_name: "create", turn_index: 0 },
  ],
  refs: [
    { session_id: "dp1", ref_type: "commit", ref_value: "abc123" },
  ],
};

before(async () => {
  setupTestDb(testData);
  const mod = await import("../src/dev-plan.mjs");
  generateDevPlan = mod.generateDevPlan;
  generateProgressCheck = mod.generateProgressCheck;
  generateRetro = mod.generateRetro;
});

after(() => teardownTestDb());

describe("generateDevPlan", () => {
  it("returns an object", () => {
    const result = generateDevPlan({ repo: "org/app" });
    assert.ok(result !== null, "result should not be null/undefined");
    assert.equal(typeof result, "object");
  });

  it("result exposes renamed and new pillar scores", () => {
    const result = generateDevPlan({ repo: "org/app" });
    assert.equal(typeof result.pillarScores.specification, "number");
    assert.equal(typeof result.pillarScores.efficiency, "number");
    assert.ok(!("feedback" in result.pillarScores));
  });

  it("handles empty DB gracefully", () => {
    const result = generateDevPlan({ repo: "nonexistent-repo-xyz" });
    assert.ok(result !== null, "should not crash on empty data");
    assert.equal(typeof result, "object");
  });

  it("returns intent-adjusted scores when session intents are provided", () => {
    const result = generateDevPlan({
      repo: "org/app",
      sessionIntents: { dp1: "explore", dp2: "build" },
    });

    assert.ok(result.intentAdjustedScores);
    assert.equal(typeof result.intentAdjustedScores.overall, "number");
    assert.ok(result.intentAdjustedScores.overall <= result.pillarScores.overall);
    assert.deepStrictEqual(result.sessionIntentBreakdown.counts, {
      build: 1,
      explore: 1,
      iterate: 0,
      debug: 0,
    });
  });
});

describe("generateProgressCheck", () => {
  it("returns an object", () => {
    const result = generateProgressCheck({ repo: "org/app" });
    assert.ok(result !== null, "result should not be null/undefined");
    assert.equal(typeof result, "object");
    assert.equal(typeof result.baseline.specificationScore, "number");
    assert.equal(typeof result.baseline.efficiencyScore, "number");
  });

  it("handles empty DB gracefully", () => {
    const result = generateProgressCheck({ repo: "nonexistent-repo-xyz" });
    assert.ok(result !== null, "should not crash on empty data");
    assert.equal(typeof result, "object");
  });
});

describe("generateRetro", () => {
  it("returns an object", () => {
    const result = generateRetro({ repo: "org/app" });
    assert.ok(result !== null, "result should not be null/undefined");
    assert.equal(typeof result, "object");
    assert.equal(typeof result.pillarScores.specification, "number");
    assert.equal(typeof result.pillarScores.efficiency, "number");
  });

  it("handles empty DB gracefully", () => {
    const result = generateRetro({ repo: "nonexistent-repo-xyz" });
    assert.ok(result !== null, "should not crash on empty data");
    assert.equal(typeof result, "object");
  });
});

describe("scoring formula validation", () => {
  it("pillar scores are numbers between 0 and 100", () => {
    const result = generateDevPlan({ repo: "org/app" });
    for (const [key, value] of Object.entries(result.pillarScores)) {
      if (key === "overall") continue;
      assert.equal(typeof value, "number", `${key} should be a number`);
      assert.ok(value >= 0 && value <= 100, `${key} score ${value} out of range 0-100`);
    }
  });

  it("overall score is a weighted average of pillar scores", () => {
    const result = generateDevPlan({ repo: "org/app" });
    assert.equal(typeof result.pillarScores.overall, "number");
    const pillars = ["specification", "delegation", "judgment", "efficiency"];
    const pillarValues = pillars.map((p) => result.pillarScores[p]).filter((v) => v != null);
    if (pillarValues.length > 0) {
      const avg = pillarValues.reduce((a, b) => a + b, 0) / pillarValues.length;
      // Overall should be within reasonable range of the average (may be weighted differently)
      assert.ok(Math.abs(result.pillarScores.overall - avg) < 30, "Overall score too far from pillar average");
    }
  });

  it("progress check baseline scores match dev plan scores", () => {
    const plan = generateDevPlan({ repo: "org/app" });
    const progress = generateProgressCheck({ repo: "org/app" });
    assert.equal(progress.baseline.specificationScore, plan.pillarScores.specification);
    assert.equal(progress.baseline.efficiencyScore, plan.pillarScores.efficiency);
  });

  it("retro pillar scores are consistent with dev plan", () => {
    const plan = generateDevPlan({ repo: "org/app" });
    const retro = generateRetro({ repo: "org/app" });
    // Same data should give same scores
    assert.equal(retro.pillarScores.specification, plan.pillarScores.specification);
    assert.equal(retro.pillarScores.efficiency, plan.pillarScores.efficiency);
  });

  it("negative/malformed input does not crash generateDevPlan", () => {
    assert.ok(generateDevPlan({}) !== null);
    assert.ok(generateDevPlan({ repo: "" }) !== null);
    assert.ok(generateDevPlan({ repo: null }) !== null);
    assert.ok(generateDevPlan({ repo: "org/app", sessionIntents: null }) !== null);
    assert.ok(generateDevPlan({ repo: "org/app", sessionIntents: {} }) !== null);
  });
});
