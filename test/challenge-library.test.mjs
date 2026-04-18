// Tests for src/challenge-library.mjs — curated bad prompt library
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import CHALLENGE_LIBRARY from "../src/challenge-library.mjs";

const VALID_TAGS = new Set([
  "vague", "no-files", "no-context", "no-constraints", "no-criteria",
  "no-examples", "no-format", "no-steps", "correction", "frustration", "rollback",
]);

describe("CHALLENGE_LIBRARY", () => {
  it("exports a non-empty array", () => {
    assert.ok(Array.isArray(CHALLENGE_LIBRARY));
    assert.ok(CHALLENGE_LIBRARY.length >= 80, `Expected ≥ 80 prompts, got ${CHALLENGE_LIBRARY.length}`);
  });

  it("every entry has required fields", () => {
    for (const entry of CHALLENGE_LIBRARY) {
      assert.ok(typeof entry.prompt === "string" && entry.prompt.length > 0, `Missing prompt: ${JSON.stringify(entry)}`);
      assert.ok(Array.isArray(entry.tags) && entry.tags.length > 0, `Missing tags for: "${entry.prompt}"`);
      assert.ok(typeof entry.hint === "string" && entry.hint.length > 0, `Missing hint for: "${entry.prompt}"`);
    }
  });

  it("all tags are from the valid set", () => {
    for (const entry of CHALLENGE_LIBRARY) {
      for (const tag of entry.tags) {
        assert.ok(VALID_TAGS.has(tag), `Invalid tag "${tag}" in prompt: "${entry.prompt}"`);
      }
    }
  });

  it("has no duplicate prompts", () => {
    const seen = new Set();
    for (const entry of CHALLENGE_LIBRARY) {
      const normalized = entry.prompt.toLowerCase().trim();
      assert.ok(!seen.has(normalized), `Duplicate prompt: "${entry.prompt}"`);
      seen.add(normalized);
    }
  });

  it("covers all tag categories", () => {
    const usedTags = new Set();
    for (const entry of CHALLENGE_LIBRARY) {
      for (const tag of entry.tags) usedTags.add(tag);
    }
    for (const tag of VALID_TAGS) {
      assert.ok(usedTags.has(tag), `Tag "${tag}" has no prompts in the library`);
    }
  });
});
