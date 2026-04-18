import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb } from "./test-helpers.mjs";

let analyzeDelegation;

const testData = {
  sessions: [
    { id: "sess-d1", repository: "org/test-app", branch: "feat-auth", summary: "Auth module", created_at: "2025-01-15T10:00:00Z" },
    { id: "sess-d2", repository: "org/test-app", branch: "fix-config", summary: "Config fix", created_at: "2025-01-16T10:00:00Z" },
  ],
  turns: [
    // sess-d1: delegation-heavy (3 turns, high agent output)
    { session_id: "sess-d1", turn_index: 0, user_message: "Create a complete auth module with JWT support", assistant_response: "I'll build the full auth module with JWT token generation, validation middleware, and refresh token support. " + "x".repeat(500) },
    { session_id: "sess-d1", turn_index: 1, user_message: "Add rate limiting to the auth endpoints", assistant_response: "Adding rate limiting with express-rate-limit. " + "x".repeat(300) },
    { session_id: "sess-d1", turn_index: 2, user_message: "Looks good, ship it", assistant_response: "Done! Everything is ready to ship." },
    // sess-d2: guided-style (3 turns, fewer file ops)
    { session_id: "sess-d2", turn_index: 0, user_message: "Step 1: Open config.json. Step 2: Change the port to 3000. Step 3: Save it.", assistant_response: "Following your steps. " + "x".repeat(100) },
    { session_id: "sess-d2", turn_index: 1, user_message: "Now update the readme to mention the new port", assistant_response: "Updating readme. " + "x".repeat(100) },
    { session_id: "sess-d2", turn_index: 2, user_message: "OK perfect", assistant_response: "All done!" },
  ],
  files: [
    // sess-d1: 5 file ops → higher productivity
    { session_id: "sess-d1", file_path: "src/auth/index.js", tool_name: "create", turn_index: 0 },
    { session_id: "sess-d1", file_path: "src/auth/jwt.js", tool_name: "create", turn_index: 0 },
    { session_id: "sess-d1", file_path: "src/auth/middleware.js", tool_name: "create", turn_index: 0 },
    { session_id: "sess-d1", file_path: "src/auth/rate-limit.js", tool_name: "create", turn_index: 1 },
    { session_id: "sess-d1", file_path: "src/auth/index.js", tool_name: "edit", turn_index: 1 },
    // sess-d2: 2 file ops → lower productivity
    { session_id: "sess-d2", file_path: "config.json", tool_name: "edit", turn_index: 0 },
    { session_id: "sess-d2", file_path: "README.md", tool_name: "edit", turn_index: 1 },
  ],
  refs: [
    { session_id: "sess-d1", ref_type: "commit", ref_value: "abc123", turn_index: 2 },
    { session_id: "sess-d1", ref_type: "pr", ref_value: "42", turn_index: 2 },
  ],
};

before(async () => {
  setupTestDb(testData);
  const mod = await import("../src/delegation.mjs");
  analyzeDelegation = mod.analyzeDelegation;
});

after(() => teardownTestDb());

describe("analyzeDelegation", () => {
  it("returns an object with expected overall stats keys", () => {
    const result = analyzeDelegation({ repo: "org/test-app" });
    assert.ok(typeof result === "object");
    for (const key of [
      "overallDelegationRatio", "overallLeverage", "totalUserTurns",
      "totalFileOps", "sessionsAnalyzed", "sessionsWithFiles",
      "sessionsWithCommits", "sessionsWithPRs", "agentOutputKB",
      "userInputKB", "turnTypeBreakdown", "styleDistribution",
      "topDelegated", "styleCounts",
    ]) {
      assert.ok(key in result, `missing key: ${key}`);
    }
  });

  it("analyzes both seeded sessions", () => {
    const result = analyzeDelegation({ repo: "org/test-app" });
    assert.equal(result.sessionsAnalyzed, 2);
    assert.ok(result.totalUserTurns >= 6);
    assert.ok(result.totalFileOps >= 7);
    assert.ok(result.sessionsWithFiles >= 2);
    assert.ok(result.sessionsWithCommits >= 1);
    assert.ok(result.sessionsWithPRs >= 1);
  });

  it("session with more file ops has higher delegation productivity", () => {
    const result = analyzeDelegation({ repo: "org/test-app" });
    const d1 = result.topDelegated.find((s) => s.sessionId === "sess-d1");
    const d2 = result.topDelegated.find((s) => s.sessionId === "sess-d2");
    assert.ok(d1, "sess-d1 should appear in topDelegated");
    assert.ok(d2, "sess-d2 should appear in topDelegated");
    assert.ok(
      d1.productivity > d2.productivity,
      `sess-d1 productivity (${d1.productivity}) should exceed sess-d2 (${d2.productivity})`
    );
  });

  it("returns zero/safe defaults for non-matching repo", () => {
    const result = analyzeDelegation({ repo: "nonexistent-repo-xyz" });
    assert.equal(result.sessionsAnalyzed, 0);
    assert.equal(result.overallDelegationRatio, 0);
    assert.equal(result.overallLeverage, 0);
    assert.equal(result.totalUserTurns, 0);
    assert.equal(result.totalFileOps, 0);
    assert.ok(Array.isArray(result.turnTypeBreakdown));
    assert.ok(Array.isArray(result.styleDistribution));
    assert.ok(Array.isArray(result.topDelegated));
    assert.equal(result.topDelegated.length, 0);
  });
});
