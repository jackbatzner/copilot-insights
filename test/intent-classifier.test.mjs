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
});
