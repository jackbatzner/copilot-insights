// Tests for src/instructions.mjs — instruction gap analysis
import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb } from "./test-helpers.mjs";

let analyzeInstructionGaps;

const testData = {
  sessions: [
    { id: "inst1", repository: "org/app", created_at: "2025-01-15T10:00:00Z" },
    { id: "inst2", repository: "org/app", created_at: "2025-01-16T10:00:00Z" },
  ],
  turns: [
    { session_id: "inst1", turn_index: 0, user_message: "Create the auth module" },
    { session_id: "inst1", turn_index: 1, user_message: "Always use TypeScript in this project" },
    { session_id: "inst1", turn_index: 2, user_message: "Don't use any class-based components" },
    { session_id: "inst2", turn_index: 0, user_message: "Add tests for the API" },
    { session_id: "inst2", turn_index: 1, user_message: "We always use vitest for testing" },
    // "Put files in ..." matches the file-placement regex (it|that|this|files?)
    { session_id: "inst2", turn_index: 2, user_message: "Put files in test/ directory" },
  ],
};

before(async () => {
  setupTestDb(testData);
  const mod = await import("../src/instructions.mjs");
  analyzeInstructionGaps = mod.analyzeInstructionGaps;
});

after(() => teardownTestDb());

describe("analyzeInstructionGaps", () => {
  it("returns expected shape (totalGaps, totalSignals, categorySummary, gaps, suggestions, repoBreakdown)", () => {
    const result = analyzeInstructionGaps({ repo: "org/app" });
    for (const key of ["totalGaps", "totalSignals", "categorySummary", "gaps", "suggestions", "repoBreakdown"]) {
      assert.ok(key in result, `missing key: ${key}`);
    }
    assert.ok(typeof result.totalGaps === "number");
    assert.ok(typeof result.totalSignals === "number");
    assert.ok(typeof result.categorySummary === "object");
    assert.ok(Array.isArray(result.gaps));
    assert.ok(Array.isArray(result.suggestions));
    assert.ok(Array.isArray(result.repoBreakdown));
  });

  it("detects convention signals ('always use', 'don't use', 'we always use', 'put...in')", () => {
    const result = analyzeInstructionGaps({ repo: "org/app" });
    const labels = result.gaps.map((g) => g.label);
    // "Always use TypeScript" → Style rule
    assert.ok(labels.includes("Style rule"), "should detect 'always use' → Style rule");
    // "Don't use any class-based" → Tool/library preference
    assert.ok(labels.includes("Tool/library preference"), "should detect 'don't use' → Tool/library preference");
    // "We always use vitest" → Team convention
    assert.ok(labels.includes("Team convention"), "should detect 'we always use' → Team convention");
    // "Put files in test/" → File placement rule
    assert.ok(labels.includes("File placement rule"), "should detect 'put...in' → File placement rule");
  });

  it("totalSignals > 0 with seeded data", () => {
    const result = analyzeInstructionGaps({ repo: "org/app" });
    assert.ok(result.totalSignals > 0, `Expected positive totalSignals, got ${result.totalSignals}`);
  });

  it("gaps array entries have category, label, count, examples", () => {
    const result = analyzeInstructionGaps({ repo: "org/app" });
    assert.ok(result.gaps.length > 0, "Should have gaps");
    for (const gap of result.gaps) {
      assert.ok(typeof gap.category === "string", "gap should have string category");
      assert.ok(typeof gap.label === "string", "gap should have string label");
      assert.ok(typeof gap.count === "number" && gap.count > 0, "gap should have positive count");
      assert.ok(Array.isArray(gap.examples), "gap should have examples array");
    }
  });

  it("suggestions generated when gaps found (type 'instruction_file' for repeated)", () => {
    const result = analyzeInstructionGaps({ repo: "org/app" });
    assert.ok(result.suggestions.length > 0, "Should have suggestions");
    // "Style rule" appears 2+ times (from "Always use TypeScript" and "always use vitest")
    // so the instruction_file suggestion should fire
    const instrSuggestion = result.suggestions.find((s) => s.type === "instruction_file");
    assert.ok(instrSuggestion, "Should have instruction_file suggestion for repeated conventions");
    assert.equal(instrSuggestion.priority, "high");
    assert.ok(Array.isArray(instrSuggestion.items));
    assert.ok(instrSuggestion.items.length > 0);
  });

  it("repoBreakdown has repo names from seeded data", () => {
    const result = analyzeInstructionGaps({ repo: "org/app" });
    assert.ok(result.repoBreakdown.length > 0, "Should have repo breakdown entries");
    const repos = result.repoBreakdown.map((r) => r.repo);
    assert.ok(repos.includes("org/app"), "Should include org/app in breakdown");
    for (const entry of result.repoBreakdown) {
      assert.ok(typeof entry.conventionSignals === "number");
      assert.ok(Array.isArray(entry.topCategories));
      assert.ok(entry.topCategories.length > 0);
    }
  });

  it("empty DB returns zero signals with positive suggestion", () => {
    const result = analyzeInstructionGaps({ repo: "nonexistent-repo-xyz" });
    assert.equal(result.totalSignals, 0);
    assert.equal(result.totalGaps, 0);
    assert.ok(Array.isArray(result.suggestions));
    const positive = result.suggestions.find((s) => s.type === "positive");
    assert.ok(positive, "Should have positive suggestion when no gaps found");
    assert.equal(positive.priority, "info");
  });
});
