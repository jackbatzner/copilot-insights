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

  it("result has pillar data or plan structure", () => {
    const result = generateDevPlan({ repo: "org/app" });
    // Should have score fields or opportunities
    const keys = Object.keys(result);
    assert.ok(keys.length > 0, "result should have keys");
  });

  it("handles empty DB gracefully", () => {
    const result = generateDevPlan({ repo: "nonexistent-repo-xyz" });
    assert.ok(result !== null, "should not crash on empty data");
    assert.equal(typeof result, "object");
  });
});

describe("generateProgressCheck", () => {
  it("returns an object", () => {
    const result = generateProgressCheck({ repo: "org/app" });
    assert.ok(result !== null, "result should not be null/undefined");
    assert.equal(typeof result, "object");
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
  });

  it("handles empty DB gracefully", () => {
    const result = generateRetro({ repo: "nonexistent-repo-xyz" });
    assert.ok(result !== null, "should not crash on empty data");
    assert.equal(typeof result, "object");
  });
});
