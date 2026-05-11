import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { setupTestDb, teardownTestDb } from "./test-helpers.mjs";

let analyzeContextHygiene;
let analyzeToolSelection;
let generateTips;
let generateImprove;
let cleanMessage;

const hugeQuestion = `<context>${"A".repeat(5200)}</context> What should I investigate about this migration?`;

const testData = {
  sessions: [
    {
      id: "sess-home-no-repo",
      repository: null,
      branch: "main",
      summary: "Home directory auth session",
      created_at: "2025-01-10T10:00:00Z",
      cwd: homedir(),
    },
    {
      id: "sess-exploratory",
      repository: "org/research-app",
      branch: "main",
      summary: "Exploratory migration questions",
      created_at: "2025-01-11T10:00:00Z",
      cwd: "C:\\Users\\tester\\research-app",
    },
    {
      id: "sess-improve",
      repository: "org/app",
      branch: "feat-auth",
      summary: "Fix auth flow",
      created_at: "2025-01-12T10:00:00Z",
      cwd: "C:\\Users\\tester\\app",
    },
  ],
  turns: [
    { session_id: "sess-home-no-repo", turn_index: 0, user_message: "help", assistant_response: "Starting..." },
    { session_id: "sess-home-no-repo", turn_index: 1, user_message: "No, don't touch the tests", assistant_response: "Okay" },
    { session_id: "sess-home-no-repo", turn_index: 2, user_message: "Add login validation", assistant_response: "Done" },
    { session_id: "sess-home-no-repo", turn_index: 3, user_message: "Actually, use src/auth.js", assistant_response: "Done" },
    { session_id: "sess-home-no-repo", turn_index: 4, user_message: "Add token parsing", assistant_response: "Done" },
    { session_id: "sess-home-no-repo", turn_index: 5, user_message: "That's wrong, the function should return a token", assistant_response: "Done" },
    { session_id: "sess-home-no-repo", turn_index: 6, user_message: "Keep the route handlers small", assistant_response: "Done" },
    { session_id: "sess-home-no-repo", turn_index: 7, user_message: "Wait, use bcrypt instead", assistant_response: "Done" },
    { session_id: "sess-home-no-repo", turn_index: 8, user_message: "Add middleware coverage", assistant_response: "Done" },
    { session_id: "sess-home-no-repo", turn_index: 9, user_message: "Go back and keep the old API route", assistant_response: "Done" },
    { session_id: "sess-home-no-repo", turn_index: 10, user_message: "Add stricter null checks", assistant_response: "Done" },
    { session_id: "sess-home-no-repo", turn_index: 11, user_message: "No, don't rename the middleware", assistant_response: "Done" },
    { session_id: "sess-home-no-repo", turn_index: 12, user_message: "Make the login errors clearer", assistant_response: "Done" },
    { session_id: "sess-home-no-repo", turn_index: 13, user_message: "Instead, keep the current response shape", assistant_response: "Done" },
    { session_id: "sess-home-no-repo", turn_index: 14, user_message: "Add missing unit tests", assistant_response: "Done" },
    { session_id: "sess-home-no-repo", turn_index: 15, user_message: "No, let the helper stay synchronous", assistant_response: "Done" },
    { session_id: "sess-home-no-repo", turn_index: 16, user_message: "Document the behavior", assistant_response: "Done" },
    { session_id: "sess-home-no-repo", turn_index: 17, user_message: "Ship it", assistant_response: "Done" },

    { session_id: "sess-exploratory", turn_index: 0, user_message: hugeQuestion, assistant_response: "Let's investigate." },
    { session_id: "sess-exploratory", turn_index: 1, user_message: "What is the safest rollout plan for the migration?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 2, user_message: "How should we compare the old and new data models?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 3, user_message: "Why might the background jobs fail after the cutover?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 4, user_message: "Where should we add observability for the migration?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 5, user_message: "When should we freeze writes during the switchover?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 6, user_message: "Can we validate the backfill before switching traffic?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 7, user_message: "Could we stage the migration by tenant?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 8, user_message: "Should we use feature flags during the rollout?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 9, user_message: "What dashboards should we watch during the migration?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 10, user_message: "How do we test the rollback path?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 11, user_message: "Why would we keep the legacy queue around?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 12, user_message: "Can we dry-run the data validation first?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 13, user_message: "Should we compare sample records before and after the move?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 14, user_message: "What alerts should page the team during cutover?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 15, user_message: "How should we communicate the migration freeze to customers?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 16, user_message: "Can we automate the verification checklist?", assistant_response: "Answer" },
    { session_id: "sess-exploratory", turn_index: 17, user_message: "Should we archive the legacy tables immediately?", assistant_response: "Answer" },

    { session_id: "sess-improve", turn_index: 0, user_message: "fix auth", assistant_response: "Starting..." },
    { session_id: "sess-improve", turn_index: 1, user_message: "Use JWT access tokens for the login flow", assistant_response: "Done" },
    { session_id: "sess-improve", turn_index: 2, user_message: "No, use bcrypt for passwords", assistant_response: "Done" },
    { session_id: "sess-improve", turn_index: 3, user_message: "Actually, keep the existing route names", assistant_response: "Done" },
    { session_id: "sess-improve", turn_index: 4, user_message: "Oh and also add refresh tokens", assistant_response: "Done" },
    { session_id: "sess-improve", turn_index: 5, user_message: "Add login tests too", assistant_response: "Done" },
    { session_id: "sess-improve", turn_index: 6, user_message: "That's wrong, the expiry should be 1 hour", assistant_response: "Done" },
    { session_id: "sess-improve", turn_index: 7, user_message: "Wait, keep the existing cookie names", assistant_response: "Done" },
    { session_id: "sess-improve", turn_index: 8, user_message: "What font should the dashboard header use?", assistant_response: "Done" },
    { session_id: "sess-improve", turn_index: 9, user_message: "Instead, put the token helpers in a separate module", assistant_response: "Done" },
    { session_id: "sess-improve", turn_index: 10, user_message: "Add middleware coverage", assistant_response: "Done" },
    { session_id: "sess-improve", turn_index: 11, user_message: "Go back and fix the schema from the start", assistant_response: "Done" },
    { session_id: "sess-improve", turn_index: 12, user_message: "No, don't remove the audit fields", assistant_response: "Done" },
    { session_id: "sess-improve", turn_index: 13, user_message: "Keep the login controller small", assistant_response: "Done" },
    { session_id: "sess-improve", turn_index: 14, user_message: "Wait, use the existing env var names", assistant_response: "Done" },
    { session_id: "sess-improve", turn_index: 15, user_message: "Document the final flow", assistant_response: "Done" },
  ],
  files: [
    { session_id: "sess-improve", file_path: "src/auth.mjs", tool_name: "edit", turn_index: 1 },
    { session_id: "sess-improve", file_path: "src/auth.mjs", tool_name: "edit", turn_index: 2 },
  ],
};

before(async () => {
  setupTestDb(testData);
  const mod = await import("../src/chronicle.mjs");
  analyzeContextHygiene = mod.analyzeContextHygiene;
  analyzeToolSelection = mod.analyzeToolSelection;
  generateTips = mod.generateTips;
  generateImprove = mod.generateImprove;
  cleanMessage = mod.cleanMessage;
});

after(() => teardownTestDb());

describe("analyzeContextHygiene", () => {
  it("counts no-repo, oversized prompts, and home-directory sessions", () => {
    const result = analyzeContextHygiene();
    assert.equal(result.totalSessions, 3);
    assert.equal(result.noRepoCount, 1);
    assert.equal(result.oversizedPromptCount, 1);
    assert.equal(result.homeDirectoryCount, 1);
    assert.ok(result.score >= 0 && result.score <= 100);
  });
});

describe("analyzeToolSelection", () => {
  it("finds research-heavy sessions and tangential turns", () => {
    const result = analyzeToolSelection();
    assert.equal(result.exploratorySessionCount, 1);
    assert.deepEqual(result.exploratorySessionIds, ["sess-exploratory"]);
    assert.equal(result.tangentialTurnCount, 1);
    assert.ok(result.suggestions.length >= 2);
  });
});

describe("generateTips", () => {
  it("returns up to five chronicle-style tips", () => {
    const tips = generateTips();
    assert.ok(Array.isArray(tips));
    assert.ok(tips.length > 0 && tips.length <= 5);
    const ids = tips.map((tip) => tip.id);
    assert.ok(ids.includes("no-repo-context"));
    assert.ok(ids.includes("oversized-prompts"));
    assert.ok(ids.includes("too-many-turns"));
    assert.ok(ids.includes("short-opening-prompts"));
    assert.ok(ids.includes("high-correction-rate") || ids.includes("no-commits"));
  });
});

describe("generateImprove", () => {
  it("returns session-specific improvement suggestions", () => {
    const result = generateImprove("sess-improve");
    assert.equal(result.sessionId, "sess-improve");
    assert.equal(typeof result.overallAdvice, "string");
    const issues = result.suggestions.map((suggestion) => suggestion.issue);
    assert.ok(issues.includes("Vague opening prompt"));
    assert.ok(issues.includes("Multiple corrections"));
    assert.ok(issues.includes("Drip-feeding context"));
    assert.ok(issues.includes("Late catch"));
    assert.ok(issues.includes("Long session without a commit"));
  });

  it("returns null for unknown sessions", () => {
    assert.equal(generateImprove("missing-session"), null);
  });
});

describe("cleanMessage", () => {
  it("returns empty string for null/undefined", () => {
    assert.equal(cleanMessage(null), "");
    assert.equal(cleanMessage(undefined), "");
    assert.equal(cleanMessage(""), "");
  });

  it("strips cross_session_message XML blocks", () => {
    const msg = "Hello <cross_session_message>secret stuff</cross_session_message> world";
    assert.equal(cleanMessage(msg), "Hello world");
  });

  it("strips skill-context XML blocks", () => {
    const msg = '<skill-context name="test">data</skill-context> Fix the bug';
    assert.equal(cleanMessage(msg), "Fix the bug");
  });

  it("strips system_notification XML blocks", () => {
    const msg = "Before <system_notification>notif</system_notification> after";
    assert.equal(cleanMessage(msg), "Before after");
  });

  it("strips nested/generic XML tags", () => {
    const msg = "Please <b>fix</b> the <code>auth</code> module";
    assert.equal(cleanMessage(msg), "Please fix the auth module");
  });

  it("collapses whitespace after stripping", () => {
    const msg = "  too   much   space  ";
    assert.equal(cleanMessage(msg), "too much space");
  });

  it("handles multiline XML blocks", () => {
    const msg = "Start\n<cross_session_message>\nline1\nline2\n</cross_session_message>\nEnd";
    assert.equal(cleanMessage(msg), "Start End");
  });

  it("handles whitespace-only input", () => {
    assert.equal(cleanMessage("   "), "");
    assert.equal(cleanMessage("\n\t"), "");
  });
});
