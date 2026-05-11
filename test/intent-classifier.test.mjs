import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb } from "./test-helpers.mjs";

let classifySessionIntent;

before(async () => {
  setupTestDb({
    sessions: [
      { id: "ic-build", repository: "org/app", created_at: "2025-01-15T10:00:00Z" },
      { id: "ic-explore", repository: "org/app", created_at: "2025-01-16T10:00:00Z" },
      { id: "ic-debug", repository: "org/app", created_at: "2025-01-17T10:00:00Z" },
      { id: "ic-single", repository: "org/app", created_at: "2025-01-18T10:00:00Z" },
      { id: "ic-ambiguous", repository: "org/app", created_at: "2025-01-19T10:00:00Z" },
      { id: "ic-mixed", repository: "org/app", created_at: "2025-01-20T10:00:00Z" },
      { id: "ic-empty-files", repository: "org/app", created_at: "2025-01-21T10:00:00Z" },
      { id: "ic-missing", repository: "org/app", created_at: "2025-01-22T10:00:00Z" },
    ],
    turns: [
      { session_id: "ic-build", turn_index: 0, user_message: "Build the dashboard and add charts" },
      { session_id: "ic-build", turn_index: 1, user_message: "Looks good, ship it" },
      { session_id: "ic-explore", turn_index: 0, user_message: "What is the best way to structure this?" },
      { session_id: "ic-explore", turn_index: 1, user_message: "Can you explain the options?" },
      { session_id: "ic-explore", turn_index: 2, user_message: "Help me understand the tradeoffs" },
      { session_id: "ic-debug", turn_index: 0, user_message: "The app crashes with a TypeError" },
      { session_id: "ic-debug", turn_index: 1, user_message: "Please debug the failing auth flow" },
      { session_id: "ic-debug", turn_index: 2, user_message: "Investigate this error and fix it" },
      // Single-turn session
      { session_id: "ic-single", turn_index: 0, user_message: "Hello" },
      // Ambiguous session: mix of build + debug signals
      { session_id: "ic-ambiguous", turn_index: 0, user_message: "Build the auth module" },
      { session_id: "ic-ambiguous", turn_index: 1, user_message: "It crashes with TypeError, debug it" },
      { session_id: "ic-ambiguous", turn_index: 2, user_message: "Fix this broken test" },
      // Mixed-intent: build + explore + iterate
      { session_id: "ic-mixed", turn_index: 0, user_message: "Create a new API endpoint for users" },
      { session_id: "ic-mixed", turn_index: 1, user_message: "What is the best way to handle auth?" },
      { session_id: "ic-mixed", turn_index: 2, user_message: "Revise the approach to use JWT tokens" },
      { session_id: "ic-mixed", turn_index: 3, user_message: "Try again with a different pattern" },
      // Session with turns but no file ops
      { session_id: "ic-empty-files", turn_index: 0, user_message: "Create the login page" },
      { session_id: "ic-empty-files", turn_index: 1, user_message: "Add form validation" },
    ],
    files: [
      { session_id: "ic-build", file_path: "src/dashboard.jsx", tool_name: "create", turn_index: 0 },
    ],
    refs: [
      { session_id: "ic-build", ref_type: "commit", ref_value: "abc123" },
    ],
  });
  ({ classifySessionIntent } = await import("../src/intent-classifier.mjs"));
});

after(() => teardownTestDb());

describe("classifySessionIntent", () => {
  it("classifies build-oriented sessions", () => {
    const result = classifySessionIntent("ic-build");
    assert.equal(result.intent, "build");
    assert.ok(result.signals.some((signal) => signal.includes("commits/PRs")));
  });

  it("classifies research-oriented sessions", () => {
    const result = classifySessionIntent("ic-explore");
    assert.equal(result.intent, "explore");
    assert.ok(result.signals.some((signal) => signal.includes("question") || signal.includes("research")));
  });

  it("classifies debugging sessions", () => {
    const result = classifySessionIntent("ic-debug");
    assert.equal(result.intent, "debug");
    assert.notEqual(result.confidence, "low");
  });

  it("handles single-turn sessions gracefully", () => {
    const result = classifySessionIntent("ic-single");
    assert.ok(["build", "explore", "iterate", "debug"].includes(result.intent));
    assert.ok(result.signals.length > 0);
  });

  it("classifies ambiguous sessions (build + debug signals)", () => {
    const result = classifySessionIntent("ic-ambiguous");
    assert.ok(["build", "debug"].includes(result.intent), `Expected build or debug, got ${result.intent}`);
    assert.ok(result.signals.length > 0);
  });

  it("classifies mixed-intent sessions", () => {
    const result = classifySessionIntent("ic-mixed");
    assert.ok(["build", "explore", "iterate"].includes(result.intent));
    assert.ok(result.signals.length > 0);
  });

  it("handles sessions with no file operations", () => {
    const result = classifySessionIntent("ic-empty-files");
    assert.ok(result.intent);
    assert.ok(result.confidence);
    assert.ok(Array.isArray(result.signals));
  });

  it("handles non-existent session IDs", () => {
    const result = classifySessionIntent("totally-missing-session");
    assert.equal(result.intent, "build");
    assert.equal(result.confidence, "low");
  });

  it("returns valid confidence levels", () => {
    for (const id of ["ic-build", "ic-explore", "ic-debug", "ic-single"]) {
      const result = classifySessionIntent(id);
      assert.ok(["high", "medium", "low"].includes(result.confidence), `Invalid confidence: ${result.confidence}`);
    }
  });
});
