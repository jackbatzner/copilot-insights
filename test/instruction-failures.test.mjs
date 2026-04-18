// Tests for src/instruction-failures.mjs — instruction failure analysis
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb } from "./test-helpers.mjs";

let analyzeInstructionFailures;

const testData = {
  sessions: [
    { id: "fail1", repository: "org/app", created_at: "2025-01-15T10:00:00Z" },
  ],
  turns: [
    { session_id: "fail1", turn_index: 0, user_message: "Create an auth module using JWT tokens in src/auth/" },
    { session_id: "fail1", turn_index: 1, user_message: "I already told you to use bcrypt for hashing", assistant_response: "Sorry about that..." },
    { session_id: "fail1", turn_index: 2, user_message: "No, that's still wrong. Check my instructions file", assistant_response: "Let me check..." },
    { session_id: "fail1", turn_index: 3, user_message: "Why do you keep using argon2? I said bcrypt", assistant_response: "Switching to bcrypt..." },
    { session_id: "fail1", turn_index: 4, user_message: "Finally, looks correct now" },
  ],
};

before(async () => {
  setupTestDb(testData);
  const mod = await import("../src/instruction-failures.mjs");
  analyzeInstructionFailures = mod.analyzeInstructionFailures;
});

after(() => teardownTestDb());

describe("analyzeInstructionFailures", () => {
  it("returns expected shape", () => {
    const result = analyzeInstructionFailures({ repo: "org/app" });
    for (const key of [
      "totalFailureSignals", "totalIntraRepetitions", "totalImmediateCorrections",
      "totalFailures", "sessionsWithFailures", "sessionsAnalyzed",
      "severityCounts", "topSignals", "worstSessions", "repoBreakdown",
      "examples", "suggestions",
    ]) {
      assert.ok(key in result, `missing key: ${key}`);
    }
  });

  it("detects failure signals ('I already told you' → 'Agent forgot prior instruction')", () => {
    const result = analyzeInstructionFailures({ repo: "org/app" });
    const labels = result.topSignals.map((s) => s.label);
    assert.ok(
      labels.includes("Agent forgot prior instruction"),
      `Should detect 'I already told you' signal, got: ${labels.join(", ")}`
    );
  });

  it("detects immediate corrections ('No, that's still wrong' starts with 'no')", () => {
    const result = analyzeInstructionFailures({ repo: "org/app" });
    assert.ok(
      result.totalImmediateCorrections > 0,
      "Should detect immediate correction starting with 'No,'"
    );
  });

  it("totalFailures > 0 with seeded data", () => {
    const result = analyzeInstructionFailures({ repo: "org/app" });
    assert.ok(
      result.totalFailures > 0,
      `Expected positive totalFailures, got ${result.totalFailures}`
    );
  });

  it("sessionsWithFailures counts correctly", () => {
    const result = analyzeInstructionFailures({ repo: "org/app" });
    assert.equal(result.sessionsWithFailures, 1);
    assert.equal(result.sessionsAnalyzed, 1);
  });

  it("severityCounts has high/medium keys", () => {
    const result = analyzeInstructionFailures({ repo: "org/app" });
    assert.ok("high" in result.severityCounts, "Should have 'high' severity count");
    assert.ok("medium" in result.severityCounts, "Should have 'medium' severity count");
    assert.ok(result.severityCounts.high > 0, "Should have high-severity signals");
    assert.ok(result.severityCounts.medium > 0, "Should have medium-severity signals");
  });

  it("topSignals sorted by count descending", () => {
    const result = analyzeInstructionFailures({ repo: "org/app" });
    assert.ok(Array.isArray(result.topSignals));
    assert.ok(result.topSignals.length > 0, "Should have top signals");
    for (let i = 1; i < result.topSignals.length; i++) {
      assert.ok(
        result.topSignals[i - 1].count >= result.topSignals[i].count,
        `topSignals not sorted: index ${i - 1} (${result.topSignals[i - 1].count}) < index ${i} (${result.topSignals[i].count})`
      );
    }
  });

  it("suggestions generated for high failure counts", () => {
    const result = analyzeInstructionFailures({ repo: "org/app" });
    assert.ok(result.suggestions.length > 0, "Should have suggestions");
    // "Agent forgot prior instruction" triggers "Persistent Agent Failures"
    // 100% failure rate triggers "Widespread Failures"
    const titles = result.suggestions.map((s) => s.title);
    assert.ok(
      titles.some((t) => t.includes("Persistent") || t.includes("Widespread") || t.includes("Failure")),
      `Should have failure-related suggestion, got: ${titles.join(", ")}`
    );
  });

  it("empty DB returns zero failures", () => {
    const result = analyzeInstructionFailures({ repo: "nonexistent-repo-xyz" });
    assert.equal(result.totalFailures, 0);
    assert.equal(result.totalFailureSignals, 0);
    assert.equal(result.totalImmediateCorrections, 0);
    assert.equal(result.totalIntraRepetitions, 0);
    assert.equal(result.sessionsWithFailures, 0);
    const noFailure = result.suggestions.find((s) => s.title === "No Failures Detected");
    assert.ok(noFailure, "Should have 'No Failures Detected' suggestion for empty results");
  });
});
