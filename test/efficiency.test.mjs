// Tests for src/efficiency.mjs — turn efficiency, recovery, drip-feed, skimming, completion.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeEfficiency, analyzeEfficiencyBatch } from "../src/efficiency.mjs";

/** Helper to create a turn object. */
function makeTurn(index, userMsg, assistantResp) {
  return {
    turn_index: index,
    user_message: userMsg,
    assistant_response: assistantResp ?? `Response ${index}`,
    timestamp: new Date(Date.now() + index * 60_000).toISOString(),
  };
}

// ── analyzeEfficiency ────────────────────────────────────────────────────────

describe("analyzeEfficiency", () => {
  it("returns null for less than 2 user turns", () => {
    const turns = [makeTurn(0, "Hello", "Hi there")];
    assert.equal(analyzeEfficiency(turns), null);
  });

  it("all productive turns → efficiencyRatio 1.0 and Excellent grade", () => {
    const turns = [
      makeTurn(0, "Create a utils module", "Creating..."),
      makeTurn(1, "Add a formatDate function", "Adding..."),
      makeTurn(2, "Now add tests for it", "Adding tests..."),
    ];
    const result = analyzeEfficiency(turns);
    assert.equal(result.efficiencyRatio, 1.0);
    assert.equal(result.grade.label, "Excellent");
    assert.equal(result.productiveTurns, 3);
    assert.equal(result.redirectionTurns, 0);
  });

  it("mix of redirections yields correct ratio (3 productive + 2 redirect = 0.6)", () => {
    const turns = [
      makeTurn(0, "Create an auth module", "Creating..."),
      makeTurn(1, "No, don't use passport", "Switching..."),        // redirection
      makeTurn(2, "Add token validation", "Adding..."),
      makeTurn(3, "Actually, use a different library", "Switching..."), // redirection
      makeTurn(4, "Ship it", "Done!"),
    ];
    const result = analyzeEfficiency(turns);
    assert.equal(result.efficiencyRatio, 0.6);
    assert.equal(result.productiveTurns, 3);
    assert.equal(result.redirectionTurns, 2);
  });

  it("recovery speed: 1 redirection then recovery → recoveries array has correct length", () => {
    const turns = [
      makeTurn(0, "Create a module", "Creating..."),
      makeTurn(1, "No, don't do it that way", "Fixing..."),     // redirection
      makeTurn(2, "Looks good now, please add tests", "Adding tests..."), // recovery
    ];
    const result = analyzeEfficiency(turns);
    assert.equal(result.recoverySpeed.recoveries.length, 1);
    assert.equal(result.recoverySpeed.incidents, 1);
  });

  // ── Drip-feed detection ──────────────────────────────────────

  describe("drip-feed detection", () => {
    it("detects 'oh and also add X'", () => {
      const turns = [
        makeTurn(0, "Create a dashboard page", "Creating..."),
        makeTurn(1, "Oh and also add a sidebar", "Adding sidebar..."),
        makeTurn(2, "Looks good, thanks", "Done!"),
      ];
      const result = analyzeEfficiency(turns);
      assert.equal(result.dripFeeding.count, 1);
      assert.equal(result.dripFeeding.instances[0].turnIndex, 1);
    });

    it("detects 'I forgot to mention...'", () => {
      const turns = [
        makeTurn(0, "Build the login page", "Building..."),
        makeTurn(1, "I forgot to mention it needs dark mode", "Adding dark mode..."),
        makeTurn(2, "Looks great", "Done!"),
      ];
      const result = analyzeEfficiency(turns);
      assert.ok(result.dripFeeding.count >= 1);
    });

    it("detects 'btw the header...'", () => {
      const turns = [
        makeTurn(0, "Create the layout component", "Creating..."),
        makeTurn(1, "btw the header should be sticky", "Making header sticky..."),
        makeTurn(2, "Thanks", "You're welcome!"),
      ];
      const result = analyzeEfficiency(turns);
      assert.ok(result.dripFeeding.count >= 1);
    });
  });

  // ── Response skimming ────────────────────────────────────────

  it("detects response skimming (long response + short redirect)", () => {
    const longResponse = "A".repeat(600);
    const turns = [
      makeTurn(0, "Explain the auth flow in detail", longResponse),
      makeTurn(1, "that's wrong", "Fixing..."),  // short redirect after long response
      makeTurn(2, "Thanks for fixing that", "Welcome!"),
    ];
    const result = analyzeEfficiency(turns);
    assert.equal(result.responseSkimming.count, 1);
    assert.equal(result.responseSkimming.instances[0].turnIndex, 1);
  });

  // ── Completion status ────────────────────────────────────────

  describe("completion status", () => {
    it("with PR ref → PR Created", () => {
      const turns = [
        makeTurn(0, "Create the feature module", "Creating..."),
        makeTurn(1, "Add unit tests for it", "Adding..."),
        makeTurn(2, "Ship it", "Done!"),
      ];
      const refs = [{ ref_type: "pr", ref_value: "42" }];
      const result = analyzeEfficiency(turns, refs);
      assert.equal(result.completion.label, "PR Created");
      assert.equal(result.completion.emoji, "🎉");
    });

    it("with commit ref → Committed", () => {
      const turns = [
        makeTurn(0, "Fix the null pointer bug", "Fixing..."),
        makeTurn(1, "Add a regression test", "Adding..."),
        makeTurn(2, "Commit the changes", "Done!"),
      ];
      const refs = [{ ref_type: "commit", ref_value: "abc123" }];
      const result = analyzeEfficiency(turns, refs);
      assert.equal(result.completion.label, "Committed");
      assert.equal(result.completion.emoji, "✅");
    });

    it("no refs, few turns → Brief", () => {
      const turns = [
        makeTurn(0, "Quick question about auth", "Here is the answer..."),
        makeTurn(1, "Thanks, got it!", "You're welcome!"),
      ];
      const result = analyzeEfficiency(turns, []);
      assert.equal(result.completion.label, "Brief");
      assert.equal(result.completion.emoji, "💨");
    });
  });

  // ── Auto-generated exclusion ─────────────────────────────────

  it("auto-generated turns are excluded from user turn count", () => {
    const turns = [
      makeTurn(0, "Create the auth module", "Creating..."),
      makeTurn(1, "<system_notification>Build complete</system_notification>", "Noted."),
      makeTurn(2, "Add input validation", "Adding..."),
      makeTurn(3, "Run the tests", "All pass!"),
    ];
    const result = analyzeEfficiency(turns);
    // The system_notification turn should be excluded — only 3 human turns
    assert.equal(result.turnCount, 3);
  });

  // ── Grade boundaries ─────────────────────────────────────────

  describe("grade boundaries", () => {
    it("ratio >= 0.9 is Excellent", () => {
      // 10 turns, 1 redirection → 9/10 = 0.9
      const turns = [
        makeTurn(0, "Create the module", "..."),
        makeTurn(1, "Add validation logic", "..."),
        makeTurn(2, "Write integration tests", "..."),
        makeTurn(3, "No, don't use that library", "..."),  // redirection
        makeTurn(4, "Add error handling", "..."),
        makeTurn(5, "Optimize the query", "..."),
        makeTurn(6, "Set up logging", "..."),
        makeTurn(7, "Configure the pipeline", "..."),
        makeTurn(8, "Update the docs", "..."),
        makeTurn(9, "Deploy it", "..."),
      ];
      const result = analyzeEfficiency(turns);
      assert.equal(result.efficiencyRatio, 0.9);
      assert.equal(result.grade.label, "Excellent");
    });

    it("ratio >= 0.75 is Good", () => {
      // 4 turns, 1 redirection → 3/4 = 0.75
      const turns = [
        makeTurn(0, "Create the module", "..."),
        makeTurn(1, "No, don't use that approach", "..."),  // redirection
        makeTurn(2, "Add unit tests", "..."),
        makeTurn(3, "Deploy it", "..."),
      ];
      const result = analyzeEfficiency(turns);
      assert.equal(result.efficiencyRatio, 0.75);
      assert.equal(result.grade.label, "Good");
    });

    it("ratio >= 0.6 is Fair", () => {
      // 5 turns, 2 redirections → 3/5 = 0.6
      const turns = [
        makeTurn(0, "Create the module", "..."),
        makeTurn(1, "No, don't use that library", "..."),            // redirection
        makeTurn(2, "Add unit tests", "..."),
        makeTurn(3, "Actually, use a different framework", "..."),    // redirection
        makeTurn(4, "Deploy it", "..."),
      ];
      const result = analyzeEfficiency(turns);
      assert.equal(result.efficiencyRatio, 0.6);
      assert.equal(result.grade.label, "Fair");
    });

    it("ratio < 0.6 is Needs Work", () => {
      // 5 turns, 3 redirections → 2/5 = 0.4
      const turns = [
        makeTurn(0, "Create the module", "..."),
        makeTurn(1, "No, don't use that library", "..."),            // redirection
        makeTurn(2, "Actually, use Express instead", "..."),          // redirection
        makeTurn(3, "That's wrong, fix the return type", "..."),      // redirection
        makeTurn(4, "Deploy it", "..."),
      ];
      const result = analyzeEfficiency(turns);
      assert.ok(result.efficiencyRatio < 0.6);
      assert.equal(result.grade.label, "Needs Work");
    });
  });
});

// ── analyzeEfficiencyBatch ───────────────────────────────────────────────────

describe("analyzeEfficiencyBatch", () => {
  /** Helper to create a minimal session object. */
  function makeSession(id, extra = {}) {
    return {
      id,
      repository: extra.repository ?? "org/repo",
      branch: extra.branch ?? "main",
      summary: extra.summary ?? `Session ${id}`,
      created_at: extra.created_at ?? "2025-01-15T10:00:00Z",
    };
  }

  it("returns aggregate with correct avgEfficiency", () => {
    const sessionsData = [
      {
        session: makeSession("s1"),
        turns: [
          makeTurn(0, "Create module", "..."),
          makeTurn(1, "Add tests", "..."),
          makeTurn(2, "Run the linter", "..."),
        ],
        refs: [],
      },
      {
        session: makeSession("s2"),
        turns: [
          makeTurn(0, "Build the feature", "..."),
          makeTurn(1, "No, don't use that", "..."),  // redirection
          makeTurn(2, "Add validation", "..."),
          makeTurn(3, "Ship it", "..."),
        ],
        refs: [],
      },
    ];
    const result = analyzeEfficiencyBatch(sessionsData);
    // s1: 3/3 = 1.0, s2: 3/4 = 0.75
    // avg = (1.0 + 0.75) / 2 = 0.875 → Math.round(87.5) = 88
    assert.equal(result.aggregate.sessionsAnalyzed, 2);
    assert.equal(result.aggregate.avgEfficiency, 88);
  });

  it("sorts sessions by efficiency ascending", () => {
    const sessionsData = [
      {
        session: makeSession("high"),
        turns: [
          makeTurn(0, "Do task A", "..."),
          makeTurn(1, "Do task B", "..."),
        ],
        refs: [],
      },
      {
        session: makeSession("low"),
        turns: [
          makeTurn(0, "Do task X", "..."),
          makeTurn(1, "No, don't do that", "..."),    // redirection
          makeTurn(2, "That's wrong", "..."),          // redirection
        ],
        refs: [],
      },
    ];
    const result = analyzeEfficiencyBatch(sessionsData);
    // high: 1.0, low: 1/3 ≈ 0.33 — ascending puts low first
    assert.equal(result.sessions[0].sessionId, "low");
    assert.equal(result.sessions[1].sessionId, "high");
  });

  it("counts completion breakdown correctly", () => {
    const sessionsData = [
      {
        session: makeSession("pr-sess"),
        turns: [
          makeTurn(0, "Build the feature", "..."),
          makeTurn(1, "Finalize it", "..."),
        ],
        refs: [{ ref_type: "pr", ref_value: "42" }],
      },
      {
        session: makeSession("commit-sess"),
        turns: [
          makeTurn(0, "Fix the bug", "..."),
          makeTurn(1, "Ship the fix", "..."),
        ],
        refs: [{ ref_type: "commit", ref_value: "abc123" }],
      },
    ];
    const result = analyzeEfficiencyBatch(sessionsData);
    assert.equal(result.aggregate.completionBreakdown["PR Created"], 1);
    assert.equal(result.aggregate.completionBreakdown["Committed"], 1);
  });

  it("handles empty input", () => {
    const result = analyzeEfficiencyBatch([]);
    assert.equal(result.aggregate.sessionsAnalyzed, 0);
    assert.equal(result.aggregate.avgEfficiency, 0);
    assert.deepEqual(result.sessions, []);
  });
});
