import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb } from "./test-helpers.mjs";

const testData = {
  sessions: [
    { id: "tw1", repository: "org/app", created_at: "2025-01-06T10:00:00Z" },  // Week 2
    { id: "tw2", repository: "org/app", created_at: "2025-01-13T10:00:00Z" },  // Week 3
  ],
  turns: [
    { session_id: "tw1", turn_index: 0, user_message: "Build the auth system for src/auth.ts" },
    { session_id: "tw1", turn_index: 1, user_message: "Looks good" },
    { session_id: "tw2", turn_index: 0, user_message: "Create API endpoints" },
    { session_id: "tw2", turn_index: 1, user_message: "Run the tests to verify" },
  ],
};

let mod;

before(() => {
  setupTestDb(testData);
  return import("../src/trends.mjs").then((m) => { mod = m; });
});

after(() => teardownTestDb());

describe("computePillarTrends", () => {
  it("returns weeks array with correct fields", () => {
    const result = mod.computePillarTrends({ repo: "org/app" });
    assert.ok(Array.isArray(result.weeks));
    assert.ok(result.weeks.length >= 2, "should have at least 2 weeks from seed data");
    for (const w of result.weeks) {
      assert.equal(typeof w.week, "string");
      assert.equal(typeof w.startDate, "string");
      assert.equal(typeof w.endDate, "string");
      assert.equal(typeof w.delegation, "number");
      assert.equal(typeof w.judgment, "number");
      assert.equal(typeof w.specification, "number");
      assert.equal(typeof w.overall, "number");
      assert.equal(typeof w.sessionCount, "number");
    }
  });

  it("returns trend object with delegation/judgment/specification", () => {
    const result = mod.computePillarTrends({ repo: "org/app" });
    assert.ok(result.trend);
    const validTrends = ["stable", "improving", "declining"];
    assert.ok(validTrends.includes(result.trend.delegation), `delegation trend should be one of ${validTrends}`);
    assert.ok(validTrends.includes(result.trend.judgment), `judgment trend should be one of ${validTrends}`);
    assert.ok(validTrends.includes(result.trend.specification), `specification trend should be one of ${validTrends}`);
  });

  it("each week's scores are 0-100", () => {
    const result = mod.computePillarTrends({ repo: "org/app" });
    for (const w of result.weeks) {
      for (const field of ["delegation", "judgment", "specification", "overall"]) {
        assert.ok(w[field] >= 0 && w[field] <= 100, `${field} should be 0-100, got ${w[field]}`);
      }
    }
  });

  it("sessionCount matches seeded data", () => {
    const result = mod.computePillarTrends({ repo: "org/app" });
    const totalSessions = result.weeks.reduce((sum, w) => sum + w.sessionCount, 0);
    assert.equal(totalSessions, 2, "total sessions across weeks should match seed data");
  });

  it("empty DB returns empty weeks array", () => {
    // Query for a repo that doesn't exist
    const result = mod.computePillarTrends({ repo: "nonexistent/repo" });
    assert.deepStrictEqual(result.weeks, []);
  });
});
