// Tests for src/clarity.mjs — first-turn clarity scoring
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreClarity, analyzeFirstTurnClarity } from "../src/clarity.mjs";

describe("scoreClarity", () => {
  describe("invalid input", () => {
    it("returns score 0 for null", () => {
      const r = scoreClarity(null);
      assert.equal(r.score, 0);
    });

    it("returns score 0 for empty string", () => {
      const r = scoreClarity("");
      assert.equal(r.score, 0);
    });

    it("returns score 0 for non-string", () => {
      const r = scoreClarity(123);
      assert.equal(r.score, 0);
    });
  });

  it("vague prompt gets low score with negative signals", () => {
    const r = scoreClarity("fix it");
    assert.ok(r.score < 30, `Expected low score, got ${r.score}`);
    assert.ok(
      r.signals.some((s) => !s.positive),
      "Should have negative signals"
    );
  });

  it("short prompt gets tooShort penalty", () => {
    const r = scoreClarity("do X");
    assert.ok(
      r.signals.some((s) => s.key === "tooShort"),
      "Should have tooShort signal"
    );
  });

  it("detailed prompt with file paths, requirements, and context gets high score", () => {
    const r = scoreClarity(
      "Refactor the validation logic in src/middleware/validate.ts to reject requests " +
        "without an Authorization header. It should return 401 with a JSON error body. " +
        "Because the current middleware silently passes unauthenticated requests through, " +
        "we're seeing unauthorized data access in production. " +
        "For example, a request to /api/users without a token should return { error: 'Unauthorized' }. " +
        "Don't change the existing role-based checks."
    );
    assert.ok(r.score >= 60, `Expected score >= 60, got ${r.score}`);
  });

  it("score is clamped between 0 and 100", () => {
    // Very vague — test lower clamp
    const low = scoreClarity("fix it");
    assert.ok(low.score >= 0);
    assert.ok(low.score <= 100);

    // Very detailed — test upper clamp
    const high = scoreClarity(
      "Refactor src/auth/login.ts to use refresh tokens. Add POST /api/auth/refresh endpoint. " +
        "Store refresh tokens in the sessions table. Return { accessToken, expiresIn }. " +
        "For example, a valid refresh request returns 200. Don't modify the existing login flow. " +
        "Ensure all existing tests pass. Because we're moving to short-lived access tokens."
    );
    assert.ok(high.score >= 0);
    assert.ok(high.score <= 100);
  });

  it("signals include key, label, points, and positive boolean", () => {
    const r = scoreClarity(
      "Fix the bug in src/auth.ts where JWT tokens expire too early"
    );
    assert.ok(r.signals.length > 0, "Should have signals");
    for (const s of r.signals) {
      assert.equal(typeof s.key, "string");
      assert.equal(typeof s.label, "string");
      assert.equal(typeof s.points, "number");
      assert.equal(typeof s.positive, "boolean");
    }
  });

  it("tips suggest missing elements", () => {
    const r = scoreClarity("Add some error handling to the API");
    assert.ok(Array.isArray(r.tips));
    assert.ok(r.tips.length > 0, "Should suggest improvements");
    // Tips should be strings mentioning actionable advice
    for (const tip of r.tips) {
      assert.equal(typeof tip, "string");
    }
  });
});

describe("analyzeFirstTurnClarity", () => {
  it("returns sorted results (worst first)", () => {
    const sessions = [
      { id: "a", repository: "r", branch: "b", summary: "s", created_at: "d" },
      { id: "b", repository: "r", branch: "b", summary: "s", created_at: "d" },
    ];
    const getTurnsFn = (id) => {
      if (id === "a")
        return [
          {
            user_message:
              "Refactor src/auth.ts to add refresh tokens. The endpoint should return JSON. Because we need short-lived tokens.",
          },
        ];
      return [{ user_message: "fix it" }];
    };

    const result = analyzeFirstTurnClarity(sessions, getTurnsFn);
    // Worst first means the low-score session comes first
    assert.ok(result.sessions.length === 2);
    assert.ok(
      result.sessions[0].clarity.score <= result.sessions[1].clarity.score,
      "Should be sorted worst-first"
    );
  });

  it("computes correct distribution", () => {
    const sessions = [
      { id: "poor", repository: "r", branch: "b", summary: "s", created_at: "d" },
      { id: "good", repository: "r", branch: "b", summary: "s", created_at: "d" },
    ];
    const getTurnsFn = (id) => {
      if (id === "poor") return [{ user_message: "fix it" }];
      return [
        {
          user_message:
            "Refactor src/auth.ts to add refresh tokens. It should return JSON with accessToken. " +
            "Because we need short-lived tokens. For example, POST /api/refresh returns 200. " +
            "Don't modify the login endpoint.",
        },
      ];
    };

    const result = analyzeFirstTurnClarity(sessions, getTurnsFn);
    const { distribution } = result;
    assert.equal(typeof distribution.excellent, "number");
    assert.equal(typeof distribution.good, "number");
    assert.equal(typeof distribution.fair, "number");
    assert.equal(typeof distribution.poor, "number");
    const total =
      distribution.excellent + distribution.good + distribution.fair + distribution.poor;
    assert.equal(total, 2, "Distribution should account for all sessions");
  });

  it("returns topTips", () => {
    const sessions = [
      { id: "a", repository: "r", branch: "b", summary: "s", created_at: "d" },
    ];
    const getTurnsFn = () => [{ user_message: "Add error handling to the API" }];

    const result = analyzeFirstTurnClarity(sessions, getTurnsFn);
    assert.ok(Array.isArray(result.topTips));
    for (const t of result.topTips) {
      assert.equal(typeof t.tip, "string");
      assert.equal(typeof t.count, "number");
      assert.equal(typeof t.pct, "number");
    }
  });

  it("handles empty sessions array", () => {
    const result = analyzeFirstTurnClarity([], () => []);
    assert.equal(result.sessions.length, 0);
    assert.equal(result.avgScore, 0);
    assert.deepStrictEqual(result.distribution, {
      excellent: 0,
      good: 0,
      fair: 0,
      poor: 0,
    });
  });
});
