import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb } from "./test-helpers.mjs";

let generateSuggestions;

const testData = {
  sessions: [
    { id: "sug1", repository: "org/app", created_at: "2025-01-15T10:00:00Z" },
  ],
  turns: [
    { session_id: "sug1", turn_index: 0, user_message: "Create the auth module" },
    { session_id: "sug1", turn_index: 1, user_message: "No, that's wrong. Use bcrypt" },
    { session_id: "sug1", turn_index: 2, user_message: "Actually, use a different approach entirely" },
    { session_id: "sug1", turn_index: 3, user_message: "Still not working, why does it fail?" },
    { session_id: "sug1", turn_index: 4, user_message: "Undo that last change" },
  ],
};

before(async () => {
  setupTestDb(testData);
  const mod = await import("../src/suggestions.mjs");
  generateSuggestions = mod.generateSuggestions;
});

after(() => teardownTestDb());

describe("generateSuggestions", () => {
  it("returns an array", () => {
    const result = generateSuggestions({ repo: "org/app" });
    assert.ok(Array.isArray(result));
  });

  it("each entry has required fields", () => {
    const result = generateSuggestions({ repo: "org/app" });
    for (const entry of result) {
      assert.ok(typeof entry.category === "string", "missing category");
      assert.ok(typeof entry.categoryLabel === "string", "missing categoryLabel");
      assert.ok(typeof entry.principle === "string", "missing principle");
      assert.ok(Array.isArray(entry.tips), "tips should be an array");
      assert.ok(typeof entry.count === "number", "missing count");
      assert.ok(Array.isArray(entry.rewrites), "rewrites should be an array");
    }
  });

  it("with redirect-heavy data returns at least 1 suggestion", () => {
    const result = generateSuggestions({ repo: "org/app" });
    assert.ok(result.length >= 1, `expected >= 1 suggestion, got ${result.length}`);
  });

  it("rewrites have before/after/why fields", () => {
    const result = generateSuggestions({ repo: "org/app" });
    const withRewrites = result.filter((r) => r.rewrites.length > 0);
    assert.ok(withRewrites.length > 0, "expected at least one entry with rewrites");
    for (const entry of withRewrites) {
      for (const rw of entry.rewrites) {
        assert.ok(typeof rw.before === "string", "rewrite missing before");
        assert.ok(typeof rw.after === "string", "rewrite missing after");
        assert.ok(typeof rw.why === "string", "rewrite missing why");
      }
    }
  });

  it("empty DB returns empty array", () => {
    const result = generateSuggestions({ repo: "nonexistent-repo-xyz" });
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });
});
