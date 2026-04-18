// Tests for src/patterns.mjs — redirection pattern matching
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REDIRECTION_CATEGORIES,
  PATTERNS,
  matchPatterns,
} from "../src/patterns.mjs";

describe("REDIRECTION_CATEGORIES", () => {
  const expectedKeys = [
    "explicit_correction",
    "course_change",
    "frustration",
    "repetition",
    "rollback",
  ];

  it("has all 5 expected category keys", () => {
    assert.deepStrictEqual(
      Object.keys(REDIRECTION_CATEGORIES).sort(),
      expectedKeys.sort()
    );
  });

  for (const key of expectedKeys) {
    it(`"${key}" has label, emoji, and description`, () => {
      const cat = REDIRECTION_CATEGORIES[key];
      assert.ok(cat, `Missing category: ${key}`);
      assert.equal(typeof cat.label, "string");
      assert.equal(typeof cat.emoji, "string");
      assert.equal(typeof cat.description, "string");
    });
  }
});

describe("PATTERNS", () => {
  it("is a non-empty array", () => {
    assert.ok(Array.isArray(PATTERNS));
    assert.ok(PATTERNS.length > 0);
  });

  it("every entry has pattern, category, weight, and label", () => {
    for (const p of PATTERNS) {
      assert.ok(p.pattern instanceof RegExp, `pattern should be RegExp: ${p.label}`);
      assert.equal(typeof p.category, "string", `category should be string: ${p.label}`);
      assert.equal(typeof p.weight, "number", `weight should be number: ${p.label}`);
      assert.equal(typeof p.label, "string", `label should be string: ${p.label}`);
    }
  });

  it("every entry has a valid category", () => {
    const validCategories = Object.keys(REDIRECTION_CATEGORIES);
    for (const p of PATTERNS) {
      assert.ok(
        validCategories.includes(p.category),
        `Invalid category "${p.category}" in pattern "${p.label}"`
      );
    }
  });

  it("every entry has weight between 1 and 3", () => {
    for (const p of PATTERNS) {
      assert.ok(
        p.weight >= 1 && p.weight <= 3,
        `Weight ${p.weight} out of range for "${p.label}"`
      );
    }
  });
});

describe("matchPatterns", () => {
  describe("invalid input", () => {
    it("returns empty for null", () => {
      assert.deepStrictEqual(matchPatterns(null), []);
    });

    it("returns empty for undefined", () => {
      assert.deepStrictEqual(matchPatterns(undefined), []);
    });

    it("returns empty for empty string", () => {
      assert.deepStrictEqual(matchPatterns(""), []);
    });

    it("returns empty for non-string input", () => {
      assert.deepStrictEqual(matchPatterns(42), []);
    });
  });

  it("returns empty for innocuous message", () => {
    const result = matchPatterns("Please add a button to the nav");
    assert.deepStrictEqual(result, []);
  });

  it("detects explicit_correction", () => {
    const result = matchPatterns("No, don't use that library");
    assert.ok(result.length > 0, "Should have matches");
    assert.ok(
      result.some((m) => m.category === "explicit_correction"),
      "Should detect explicit_correction"
    );
  });

  it("detects course_change", () => {
    const result = matchPatterns("Actually, let's use React instead");
    assert.ok(result.length > 0, "Should have matches");
    assert.ok(
      result.some((m) => m.category === "course_change"),
      "Should detect course_change"
    );
  });

  it("detects frustration", () => {
    const result = matchPatterns("I already told you to use TypeScript");
    assert.ok(result.length > 0, "Should have matches");
    assert.ok(
      result.some((m) => m.category === "frustration"),
      "Should detect frustration"
    );
  });

  it("detects repetition", () => {
    const result = matchPatterns("Like I said, use the blue theme");
    assert.ok(result.length > 0, "Should have matches");
    assert.ok(
      result.some((m) => m.category === "repetition"),
      "Should detect repetition"
    );
  });

  it("detects rollback", () => {
    const result = matchPatterns("Undo that last change");
    assert.ok(result.length > 0, "Should have matches");
    assert.ok(
      result.some((m) => m.category === "rollback"),
      "Should detect rollback"
    );
  });

  it("strips XML tags before matching", () => {
    const result = matchPatterns(
      "<current_datetime>2024-01-01T00:00:00Z</current_datetime>\nno, that's wrong"
    );
    assert.ok(result.length > 0, "Should match after stripping XML");
    assert.ok(
      result.some((m) => m.category === "explicit_correction"),
      "Should detect explicit_correction after XML strip"
    );
  });

  it("strips cross_session_message before matching", () => {
    const result = matchPatterns(
      "<cross_session_message>No, don't do that. Undo everything.</cross_session_message>"
    );
    assert.deepStrictEqual(result, [], "Should not match on XML content that gets stripped");
  });

  it("returns matchedText in each result", () => {
    const result = matchPatterns("No, don't use that library");
    assert.ok(result.length > 0);
    for (const m of result) {
      assert.equal(typeof m.matchedText, "string");
      assert.ok(m.matchedText.length > 0);
    }
  });

  it("multiple patterns can match same message", () => {
    const result = matchPatterns(
      "No, that's wrong. Actually, let's undo that change and go back to the original version"
    );
    const categories = new Set(result.map((m) => m.category));
    assert.ok(categories.size > 1, `Expected multiple categories, got: ${[...categories]}`);
  });
});
