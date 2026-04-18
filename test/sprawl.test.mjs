import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb } from "./test-helpers.mjs";

let analyzeSprawl;

const testData = {
  sessions: [
    { id: "sess-focus", repository: "org/test-app" },
    { id: "sess-sprawl", repository: "org/test-app" },
  ],
  turns: [
    // Focused session — consistent topic (authentication middleware), shared keywords
    { session_id: "sess-focus", turn_index: 0, user_message: "Create the authentication middleware for validating JWT tokens", assistant_response: "Creating auth middleware...", timestamp: "2025-01-15T10:00:00Z" },
    { session_id: "sess-focus", turn_index: 1, user_message: "Update the authentication middleware to support token refresh", assistant_response: "Adding refresh support...", timestamp: "2025-01-15T10:05:00Z" },
    { session_id: "sess-focus", turn_index: 2, user_message: "Add error handling to the authentication middleware for expired tokens", assistant_response: "Adding error handling...", timestamp: "2025-01-15T10:10:00Z" },

    // Sprawling session — scope creep patterns, different topics each turn
    { session_id: "sess-sprawl", turn_index: 0, user_message: "Create the user registration endpoint for the application", assistant_response: "Creating registration endpoint...", timestamp: "2025-01-16T10:00:00Z" },
    { session_id: "sess-sprawl", turn_index: 1, user_message: "Oh and also fix the CSS styling on the dashboard page", assistant_response: "Fixing dashboard CSS...", timestamp: "2025-01-16T10:05:00Z" },
    { session_id: "sess-sprawl", turn_index: 2, user_message: "Can you also update the database migration scripts for production", assistant_response: "Updating migrations...", timestamp: "2025-01-16T10:10:00Z" },
    { session_id: "sess-sprawl", turn_index: 3, user_message: "One more thing, the email notification templates need updating", assistant_response: "Updating email templates...", timestamp: "2025-01-16T10:15:00Z" },
    { session_id: "sess-sprawl", turn_index: 4, user_message: "While you're at it, refactor the logging configuration entirely", assistant_response: "Refactoring logging config...", timestamp: "2025-01-16T10:20:00Z" },
  ],
  files: [
    // Focused: all in same directory
    { session_id: "sess-focus", file_path: "src/auth/middleware.js", tool_name: "create" },
    { session_id: "sess-focus", file_path: "src/auth/middleware.js", tool_name: "edit" },
    // Sprawling: spread across many top-level directories
    { session_id: "sess-sprawl", file_path: "src/api/register.js", tool_name: "create" },
    { session_id: "sess-sprawl", file_path: "ui/dashboard/styles.css", tool_name: "edit" },
    { session_id: "sess-sprawl", file_path: "db/migrations/001.sql", tool_name: "create" },
    { session_id: "sess-sprawl", file_path: "templates/email/welcome.html", tool_name: "edit" },
    { session_id: "sess-sprawl", file_path: "config/logging.json", tool_name: "edit" },
    { session_id: "sess-sprawl", file_path: "scripts/deploy.sh", tool_name: "edit" },
  ],
};

before(async () => {
  setupTestDb(testData);
  const mod = await import("../src/sprawl.mjs");
  analyzeSprawl = mod.analyzeSprawl;
});

after(() => teardownTestDb());

describe("analyzeSprawl", () => {
  it("returns null for non-existent session", () => {
    const result = analyzeSprawl("nonexistent-session-id");
    assert.equal(result, null);
  });

  it("focused session gets low sprawl score", () => {
    const result = analyzeSprawl("sess-focus");
    assert.ok(result !== null);
    assert.ok(result.sprawlScore < 15, `expected sprawlScore < 15, got ${result.sprawlScore}`);
    assert.equal(result.level.label, "Focused");
  });

  it("sprawling session gets higher sprawl score", () => {
    const result = analyzeSprawl("sess-sprawl");
    assert.ok(result !== null);
    assert.ok(result.sprawlScore >= 40, `expected sprawlScore >= 40, got ${result.sprawlScore}`);
    assert.ok(result.scopeAdditions.length > 0, "should detect scope additions");
    assert.ok(result.fileSpread.directories >= 5, `expected >= 5 dirs, got ${result.fileSpread.directories}`);
  });

  it("returns expected shape with sprawlScore, level, and details", () => {
    const result = analyzeSprawl("sess-focus");
    assert.ok("sprawlScore" in result);
    assert.ok("level" in result);
    assert.ok("turnCount" in result);
    assert.ok("durationMinutes" in result);
    assert.ok("scopeAdditions" in result);
    assert.ok("topicShifts" in result);
    assert.ok("fileSpread" in result);
    assert.ok("summary" in result);
    // Level sub-shape
    assert.ok("label" in result.level);
    assert.ok("emoji" in result.level);
    assert.ok("color" in result.level);
    // FileSpread sub-shape
    assert.ok("directories" in result.fileSpread);
    assert.ok("files" in result.fileSpread);
    assert.ok("topDirs" in result.fileSpread);
  });
});
