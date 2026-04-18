// Tests for src/formatter.mjs — markdown report formatting
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatSessionReport,
  formatSummaryReport,
  formatTopPatterns,
} from "../src/formatter.mjs";

describe("formatSessionReport", () => {
  it("returns error message for null input", () => {
    const result = formatSessionReport(null);
    assert.ok(result.includes("not found"), `Expected error message, got: ${result}`);
  });

  it("includes session ID, repo, branch, and summary in output", () => {
    const report = {
      session: {
        id: "abc12345-full-id",
        repository: "owner/repo",
        branch: "feature-branch",
        summary: "Fix authentication bug",
        turnCount: 10,
        createdAt: "2024-01-15",
      },
      stats: {
        totalRedirections: 2,
        redirectionRate: 0.2,
        totalWeight: 5,
      },
      categoryBreakdown: {},
      redirections: [],
      thrashedFiles: [],
    };

    const result = formatSessionReport(report);
    assert.ok(result.includes("abc12345"), "Should include session ID prefix");
    assert.ok(result.includes("owner/repo"), "Should include repo");
    assert.ok(result.includes("feature-branch"), "Should include branch");
    assert.ok(result.includes("Fix authentication bug"), "Should include summary");
  });

  it("includes category breakdown table when redirections exist", () => {
    const report = {
      session: {
        id: "abc12345-full-id",
        repository: "owner/repo",
        branch: "main",
        summary: "Test",
        turnCount: 5,
        createdAt: "2024-01-15",
      },
      stats: { totalRedirections: 3, redirectionRate: 0.3, totalWeight: 7 },
      categoryBreakdown: {
        explicit_correction: { count: 2, weight: 6 },
        course_change: { count: 1, weight: 2 },
      },
      redirections: [],
      thrashedFiles: [],
    };

    const result = formatSessionReport(report);
    assert.ok(result.includes("By Category"), "Should include category section");
    assert.ok(result.includes("Explicit Correction"), "Should include category label");
    assert.ok(result.includes("Course Change"), "Should include course change label");
  });

  it("includes redirection timeline", () => {
    const report = {
      session: {
        id: "abc12345-full-id",
        repository: "owner/repo",
        branch: "main",
        summary: "Test",
        turnCount: 5,
        createdAt: "2024-01-15",
      },
      stats: { totalRedirections: 1, redirectionRate: 0.2, totalWeight: 3 },
      categoryBreakdown: {},
      redirections: [
        {
          turnIndex: 3,
          message: "No, that's wrong",
          matches: [
            { category: "explicit_correction", label: "Direct rejection" },
          ],
        },
      ],
      thrashedFiles: [],
    };

    const result = formatSessionReport(report);
    assert.ok(result.includes("Redirection Timeline"), "Should include timeline");
    assert.ok(result.includes("Turn 3"), "Should include turn index");
  });
});

describe("formatSummaryReport", () => {
  it("includes aggregate stats", () => {
    const data = {
      aggregate: {
        sessionsAnalyzed: 5,
        sessionsWithRedirections: 3,
        totalRedirections: 12,
        avgRedirectionRate: 0.25,
        categoryTotals: {},
      },
      sessions: [],
    };

    const result = formatSummaryReport(data);
    assert.ok(result.includes("5"), "Should include sessions analyzed count");
    assert.ok(result.includes("3"), "Should include sessions with redirections");
    assert.ok(result.includes("12"), "Should include total redirections");
    assert.ok(result.includes("25.0%"), "Should include avg redirection rate");
  });

  it("includes sessions table (up to 10)", () => {
    // IDs are truncated to 8 chars by the formatter, so use distinguishable prefixes
    const sessions = Array.from({ length: 12 }, (_, i) => ({
      session: {
        id: `s${String(i).padStart(7, "0")}-extra-long-id`,
        repository: `repo-${i}`,
      },
      stats: {
        totalRedirections: i + 1,
        redirectionRate: 0.1 * (i + 1),
        totalWeight: (i + 1) * 2,
      },
    }));

    const data = {
      aggregate: {
        sessionsAnalyzed: 12,
        sessionsWithRedirections: 12,
        totalRedirections: 78,
        avgRedirectionRate: 0.5,
        categoryTotals: {},
      },
      sessions,
    };

    const result = formatSummaryReport(data);
    assert.ok(result.includes("Sessions Ranked"), "Should include sessions table header");
    // Formatter shows up to 10 sessions; ID is substring(0,8)
    assert.ok(result.includes("s0000000"), "Should include first session");
    assert.ok(result.includes("s0000009"), "Should include 10th session");
    assert.ok(!result.includes("s0000010"), "Should not include 11th session");
  });
});

describe("formatTopPatterns", () => {
  it('returns "no patterns found" for empty array', () => {
    const result = formatTopPatterns([]);
    assert.ok(
      result.toLowerCase().includes("no") && result.toLowerCase().includes("pattern"),
      `Expected no-patterns message, got: ${result}`
    );
  });

  it("includes pattern table with label, category, and occurrences", () => {
    const patterns = [
      {
        label: "Direct rejection",
        category: "explicit_correction",
        count: 5,
        examples: [{ message: "No, that's wrong" }],
      },
      {
        label: "Mid-course pivot",
        category: "course_change",
        count: 3,
        examples: [{ message: "Actually, let's try something else" }],
      },
    ];

    const result = formatTopPatterns(patterns);
    assert.ok(result.includes("Direct rejection"), "Should include pattern label");
    assert.ok(result.includes("Explicit Correction"), "Should include category name");
    assert.ok(result.includes("5"), "Should include occurrence count");
    assert.ok(result.includes("Mid-course pivot"), "Should include second pattern");
  });
});
