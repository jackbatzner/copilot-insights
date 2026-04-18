import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb } from "./test-helpers.mjs";

const testData = {
  sessions: [
    { id: "s1", repository: "org/app", branch: "main", summary: "Fix auth", created_at: "2025-01-15T10:00:00Z" },
    { id: "s2", repository: "org/api", branch: "dev", summary: "Add API", created_at: "2025-01-16T14:00:00Z" },
  ],
  turns: [
    { session_id: "s1", turn_index: 0, user_message: "Create auth module in src/auth.ts", timestamp: "2025-01-15T10:30:00Z" },
    { session_id: "s1", turn_index: 1, user_message: "No, that's wrong. Use bcrypt not argon2", timestamp: "2025-01-15T11:00:00Z" },
    { session_id: "s1", turn_index: 2, user_message: "Looks good now", timestamp: "2025-01-15T11:30:00Z" },
    { session_id: "s2", turn_index: 0, user_message: "Build the REST API endpoints", timestamp: "2025-01-16T14:00:00Z" },
    { session_id: "s2", turn_index: 1, user_message: "Add pagination support", timestamp: "2025-01-16T14:30:00Z" },
    { session_id: "s2", turn_index: 2, user_message: "Looks good", timestamp: "2025-01-16T15:00:00Z" },
  ],
  files: [
    { session_id: "s1", file_path: "src/auth/index.ts", tool_name: "create", turn_index: 0 },
    { session_id: "s1", file_path: "src/auth/index.ts", tool_name: "edit", turn_index: 1 },
    { session_id: "s2", file_path: "src/api/routes.ts", tool_name: "create", turn_index: 0 },
    { session_id: "s2", file_path: "src/api/routes.ts", tool_name: "edit", turn_index: 1 },
  ],
};

let mod;

before(() => {
  setupTestDb(testData);
  // Dynamic import AFTER env is set
  return import("../src/analytics.mjs").then((m) => { mod = m; });
});

after(() => teardownTestDb());

describe("hourlyProductivity", () => {
  it("returns 24 buckets", () => {
    const result = mod.hourlyProductivity({ repo: "org/app" });
    assert.equal(result.length, 24);
  });

  it("each bucket has hour, totalTurns, redirectionTurns, redirectionRate", () => {
    const result = mod.hourlyProductivity({ repo: "org/app" });
    for (const bucket of result) {
      assert.equal(typeof bucket.hour, "number");
      assert.equal(typeof bucket.totalTurns, "number");
      assert.equal(typeof bucket.redirectionTurns, "number");
      assert.equal(typeof bucket.redirectionRate, "number");
    }
  });
});

describe("promptLengthAnalysis", () => {
  it("returns 5 buckets", () => {
    const result = mod.promptLengthAnalysis({ repo: "org/app" });
    assert.equal(result.length, 5);
  });

  it("buckets have labels and totals populated from seed data", () => {
    const result = mod.promptLengthAnalysis({ repo: "org/app" });
    for (const bucket of result) {
      assert.equal(typeof bucket.label, "string");
      assert.equal(typeof bucket.total, "number");
      assert.equal(typeof bucket.redirected, "number");
      assert.equal(typeof bucket.rate, "number");
    }
    const totalMessages = result.reduce((sum, b) => sum + b.total, 0);
    assert.ok(totalMessages > 0, "seed data should produce at least one counted message");
  });
});

describe("repoHealth", () => {
  it("returns repos sorted by sessions descending", () => {
    const result = mod.repoHealth({});
    assert.ok(result.length >= 2, "should include both seeded repos");
    // Each repo has 1 session, so sorted alphabetically or by insertion isn't guaranteed,
    // but sessions count should be >= the next one
    for (let i = 1; i < result.length; i++) {
      assert.ok(result[i - 1].sessions >= result[i].sessions);
    }
  });

  it("includes both seeded repos", () => {
    const result = mod.repoHealth({});
    const names = result.map((r) => r.name);
    assert.ok(names.includes("org/app"), "should include org/app");
    assert.ok(names.includes("org/api"), "should include org/api");
  });
});

describe("hotFiles", () => {
  it("returns file entries with shortPath field", () => {
    const result = mod.hotFiles({ repo: "org/app" });
    assert.ok(result.length > 0, "should have file entries from seed data");
    for (const entry of result) {
      assert.equal(typeof entry.file_path, "string");
      assert.equal(typeof entry.sessions, "number");
      assert.equal(typeof entry.total_touches, "number");
      assert.equal(typeof entry.tool_name, "string");
      assert.equal(typeof entry.shortPath, "string");
    }
  });
});

describe("sessionDepth", () => {
  it("returns total matching session count", () => {
    const result = mod.sessionDepth({ repo: "org/app" });
    assert.equal(typeof result.total, "number");
    assert.equal(result.total, 1);
  });

  it("returns buckets array", () => {
    const result = mod.sessionDepth({ repo: "org/app" });
    assert.ok(Array.isArray(result.buckets));
    assert.ok(result.buckets.length > 0);
  });

  it("returns avgTurns as a number", () => {
    const result = mod.sessionDepth({ repo: "org/app" });
    assert.equal(typeof result.avgTurns, "number");
  });
});

describe("toolUsage", () => {
  it("returns create and edit entries", () => {
    const result = mod.toolUsage({});
    const toolNames = result.map((r) => r.tool_name);
    assert.ok(toolNames.includes("create"), "should include create");
    assert.ok(toolNames.includes("edit"), "should include edit");
    for (const entry of result) {
      assert.equal(typeof entry.cnt, "number");
      assert.ok(entry.cnt > 0);
    }
  });
});
