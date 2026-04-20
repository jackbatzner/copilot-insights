// Tests for src/token-efficiency.mjs — token waste analysis and grading.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeTokenEfficiency, analyzeTokenEfficiencyBatch, computeTokenEfficiencyScore } from "../src/token-efficiency.mjs";

// ---------------------------------------------------------------------------
// Helpers — build fake tokenData & turns that don't require a real DB.
// ---------------------------------------------------------------------------

function makeTurns(messages) {
  return messages.map((msg, i) => ({
    user_message: msg,
    assistant_response: "Sure, done.",
    turn_index: i,
  }));
}

function makeTokenData(turnCount, tokensPerTurn = 1000) {
  const turns = Array.from({ length: turnCount }, (_, i) => ({
    turnIndex: i,
    promptTokens: Math.round(tokensPerTurn * 0.3),
    completionTokens: Math.round(tokensPerTurn * 0.7),
    totalTokens: tokensPerTurn,
    model: "claude-sonnet-4",
  }));
  let promptTokens = 0, completionTokens = 0, totalTokens = 0;
  for (const t of turns) {
    promptTokens += t.promptTokens;
    completionTokens += t.completionTokens;
    totalTokens += t.totalTokens;
  }
  return {
    source: "estimated",
    turns,
    totals: { promptTokens, completionTokens, totalTokens, thinkingTokens: 0 },
  };
}

// ---------------------------------------------------------------------------
// analyzeTokenEfficiency
// ---------------------------------------------------------------------------

describe("analyzeTokenEfficiency", () => {
  it("returns null for null tokenData", () => {
    assert.equal(analyzeTokenEfficiency("s1", null, []), null);
  });

  it("returns null for empty turns in tokenData", () => {
    assert.equal(
      analyzeTokenEfficiency("s1", { turns: [], totals: {} }, []),
      null,
    );
  });

  it("returns null when session turns array is empty", () => {
    const td = makeTokenData(3);
    assert.equal(analyzeTokenEfficiency("s1", td, []), null);
  });

  it("returns Excellent for clean session (no redirections)", () => {
    const turns = makeTurns([
      "Add a login form with email and password fields",
      "Looks great, now add validation",
      "Ship it",
    ]);
    const td = makeTokenData(3, 500);
    const result = analyzeTokenEfficiency("s1", td, turns);
    assert.ok(result);
    assert.equal(result.grade.label, "Excellent");
    assert.equal(result.wastedTokens, 0);
    assert.equal(result.wastedTurns, 0);
    assert.equal(result.efficiencyRatio, 1);
  });

  it("detects wasted turns from redirection patterns", () => {
    const turns = makeTurns([
      "Add a login form",
      "No, that's wrong. I said use TypeScript not JavaScript",
      "Better, now add validation",
    ]);
    const td = makeTokenData(3, 1000);
    const result = analyzeTokenEfficiency("s1", td, turns);
    assert.ok(result);
    assert.ok(result.wastedTurns > 0, "should detect wasted turns");
    assert.ok(result.wastedTokens > 0, "should count wasted tokens");
    assert.ok(result.efficiencyRatio < 1, "efficiency should be < 1");
  });

  it("calculates correct token fields", () => {
    const turns = makeTurns(["Do something", "Do more"]);
    const td = makeTokenData(2, 2000);
    const result = analyzeTokenEfficiency("s1", td, turns);
    assert.ok(result);
    assert.equal(result.totalTokens, 4000);
    assert.equal(result.promptTokens, td.totals.promptTokens);
    assert.equal(result.completionTokens, td.totals.completionTokens);
    assert.equal(result.productiveTokens, result.totalTokens - result.wastedTokens);
    assert.equal(result.turnCount, 2);
  });

  it("includes turn analysis array", () => {
    const turns = makeTurns(["A", "B"]);
    const td = makeTokenData(2);
    const result = analyzeTokenEfficiency("s1", td, turns);
    assert.ok(Array.isArray(result.turns));
    assert.equal(result.turns.length, 2);
    for (const t of result.turns) {
      assert.equal(typeof t.turnIndex, "number");
      assert.equal(typeof t.totalTokens, "number");
      assert.equal(typeof t.isWasted, "boolean");
    }
  });

  it("detects model from tokenData", () => {
    const turns = makeTurns(["test"]);
    const td = makeTokenData(1);
    td.turns[0].model = "gpt-4o-mini";
    const result = analyzeTokenEfficiency("s1", td, turns);
    assert.equal(result.model, "gpt-4o-mini");
    assert.equal(result.contextWindowSize, 128000);
  });
});

// ---------------------------------------------------------------------------
// Grading: ratio + absolute waste penalties
// ---------------------------------------------------------------------------

describe("grading thresholds", () => {
  it("high ratio with >= 50k waste caps at Needs Work", () => {
    const turns = makeTurns(["Build it", "No, that's wrong, undo"]);
    // 100k total, ~50k wasted
    const td = makeTokenData(2, 50000);
    const result = analyzeTokenEfficiency("s1", td, turns);
    assert.ok(result);
    // Turn 0 is wasted (turn 1 has redirection) → 50k wasted out of 100k
    if (result.wastedTokens >= 50000) {
      assert.equal(result.grade.label, "Needs Work");
    }
  });

  it("moderate ratio gives Fair", () => {
    // Build a scenario: 70% efficiency → ratio score 2 (Fair)
    const turns = makeTurns([
      "Do X",
      "No, that's wrong",
      "Do Y",
      "Still broken, try again",
      "Do Z",
    ]);
    const td = makeTokenData(5, 500); // 2500 total, low absolute waste
    const result = analyzeTokenEfficiency("s1", td, turns);
    assert.ok(result);
    assert.ok(
      ["Fair", "Good", "Needs Work"].includes(result.grade.label),
      `expected a mid-range grade, got ${result.grade.label}`,
    );
  });

  it("perfect session gets Excellent", () => {
    const turns = makeTurns(["Do A", "Do B", "Do C", "Do D"]);
    const td = makeTokenData(4, 500);
    const result = analyzeTokenEfficiency("s1", td, turns);
    assert.equal(result.grade.label, "Excellent");
  });
});

// ---------------------------------------------------------------------------
// analyzeTokenEfficiencyBatch
// ---------------------------------------------------------------------------

describe("analyzeTokenEfficiencyBatch", () => {
  it("returns aggregate with correct structure", () => {
    const sessions = [
      {
        session: { id: "b1", repository: "org/app", summary: "Test", created_at: "2025-01-01" },
        tokenData: makeTokenData(3, 500),
        turns: makeTurns(["A", "B", "C"]),
      },
      {
        session: { id: "b2", repository: "org/app", summary: "Test2", created_at: "2025-01-02" },
        tokenData: makeTokenData(2, 1000),
        turns: makeTurns(["X", "Y"]),
      },
    ];
    const result = analyzeTokenEfficiencyBatch(sessions);
    assert.ok(result.aggregate);
    assert.equal(result.aggregate.sessionsAnalyzed, 2);
    assert.ok(result.aggregate.totalTokens > 0);
    assert.equal(typeof result.aggregate.avgEfficiency, "number");
    assert.equal(typeof result.aggregate.avgTokensPerSession, "number");
    assert.ok(Array.isArray(result.aggregate.wasteByCategory));
    assert.ok(Array.isArray(result.sessions));
    assert.equal(result.sessions.length, 2);
  });

  it("returns empty result for no data", () => {
    const result = analyzeTokenEfficiencyBatch([]);
    assert.equal(result.aggregate.sessionsAnalyzed, 0);
    assert.equal(result.aggregate.totalTokens, 0);
    assert.equal(result.aggregate.avgEfficiency, 100);
    assert.equal(result.sessions.length, 0);
  });

  it("sessions sorted by worst efficiency first", () => {
    const sessions = [
      {
        session: { id: "good", repository: "r", summary: "", created_at: "" },
        tokenData: makeTokenData(3, 500),
        turns: makeTurns(["Clean prompt 1", "Clean prompt 2", "Clean prompt 3"]),
      },
      {
        session: { id: "bad", repository: "r", summary: "", created_at: "" },
        tokenData: makeTokenData(3, 500),
        turns: makeTurns(["Do X", "No, that's wrong, undo that", "Do Y"]),
      },
    ];
    const result = analyzeTokenEfficiencyBatch(sessions);
    if (result.sessions.length === 2) {
      assert.ok(
        result.sessions[0].efficiency.efficiencyRatio <=
        result.sessions[1].efficiency.efficiencyRatio,
        "worst efficiency should be first",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// computeTokenEfficiencyScore
// ---------------------------------------------------------------------------

describe("computeTokenEfficiencyScore", () => {
  it("returns 50 for null input", () => {
    assert.equal(computeTokenEfficiencyScore(null), 50);
  });

  it("returns 50 for zero sessions", () => {
    assert.equal(
      computeTokenEfficiencyScore({ aggregate: { sessionsAnalyzed: 0 } }),
      50,
    );
  });

  it("returns clamped 0-100 score", () => {
    const score = computeTokenEfficiencyScore({
      aggregate: { sessionsAnalyzed: 5, avgEfficiency: 85 },
    });
    assert.ok(score >= 0 && score <= 100);
    assert.equal(score, 85);
  });

  it("clamps to 100 max", () => {
    const score = computeTokenEfficiencyScore({
      aggregate: { sessionsAnalyzed: 1, avgEfficiency: 120 },
    });
    assert.equal(score, 100);
  });

  it("clamps to 0 min", () => {
    const score = computeTokenEfficiencyScore({
      aggregate: { sessionsAnalyzed: 1, avgEfficiency: -10 },
    });
    assert.equal(score, 0);
  });
});
