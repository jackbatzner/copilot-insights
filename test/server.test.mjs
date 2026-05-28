// Integration tests for the Express API server routes.
// Sets up an in-memory test DB, starts the server on a test port,
// and validates every major API endpoint.

import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupTestDb, teardownTestDb, FIXTURES } from "./test-helpers.mjs";

const TEST_PORT = 3099;
const BASE = `http://127.0.0.1:${TEST_PORT}`;
let testHomeDir = null;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

// Merge all fixtures for comprehensive API testing
const testData = {
  sessions: [
    ...FIXTURES.redirectionSession.sessions,
    ...FIXTURES.cleanSession.sessions,
    ...FIXTURES.mixedAutoSession.sessions,
    ...FIXTURES.dripFeedSession.sessions,
  ],
  turns: [
    ...FIXTURES.redirectionSession.turns,
    ...FIXTURES.cleanSession.turns,
    ...FIXTURES.mixedAutoSession.turns,
    ...FIXTURES.dripFeedSession.turns,
  ],
  files: [
    ...(FIXTURES.redirectionSession.files || []),
    ...(FIXTURES.cleanSession.files || []),
  ],
  refs: [
    ...(FIXTURES.cleanSession.refs || []),
  ],
};

/** Poll until the server accepts connections. */
async function waitForServer(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await fetch(`${BASE}/api/summary`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Server did not start on port ${TEST_PORT}`);
}

// ── Setup / Teardown ────────────────────────────────────────────

before(async () => {
  testHomeDir = mkdtempSync(join(tmpdir(), "copilot-insights-home-"));
  process.env.HOME = testHomeDir;
  process.env.USERPROFILE = testHomeDir;
  setupTestDb(testData);
  process.env.PORT = String(TEST_PORT);
  await import("../server/index.mjs");
  await waitForServer();
});

after(() => {
  // Close the Express server so the process can exit cleanly
  for (const h of process._getActiveHandles()) {
    if (typeof h.close === "function" && typeof h.address === "function") {
      try {
        const addr = h.address();
        if (addr && addr.port === TEST_PORT) h.close();
      } catch { /* ignore */ }
    }
  }
  teardownTestDb();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (testHomeDir) {
    rmSync(testHomeDir, { recursive: true, force: true });
  }
});

// ── Helpers ─────────────────────────────────────────────────────

async function getJSON(path) {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

async function postJSON(path, data) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

async function patchJSON(path, data) {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function waitFor(checkFn, { attempts = 20, delayMs = 50 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await checkFn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error("Condition was not met in time");
}

// ── Tests ───────────────────────────────────────────────────────

describe("GET /api/summary", () => {
  it("returns 200 with aggregate stats", async () => {
    const { status, body } = await getJSON("/api/summary");
    assert.equal(status, 200);
    assert.ok("sessionsAnalyzed" in body, "missing sessionsAnalyzed");
    assert.ok("sessionsWithRedirections" in body, "missing sessionsWithRedirections");
    assert.ok("totalRedirections" in body, "missing totalRedirections");
    assert.equal(typeof body.sessionsAnalyzed, "number");
  });
});

describe("GET /api/tokens/summary/progressive", () => {
  it("returns partial progress first and completes after chunk processing", async () => {
    const initial = await getJSON("/api/tokens/summary/progressive?timeframe=all");
    assert.equal(initial.status, 200);
    assert.equal(initial.body.progress.complete, false);
    assert.equal(initial.body.progress.processedSessions, 0);
    assert.equal(typeof initial.body.estimatedCost, "number");

    const completed = await waitFor(async () => {
      const next = await getJSON("/api/tokens/summary/progressive?timeframe=all");
      return next.body.progress.complete ? next : null;
    });

    assert.equal(completed.status, 200);
    assert.equal(completed.body.progress.complete, true);
    assert.ok(completed.body.sessionsAnalyzed >= testData.sessions.length);
    assert.equal(typeof completed.body.estimatedCost, "number");
  });
});

describe("Settings API", () => {
  it("returns default settings with VS Code loading disabled", async () => {
    const { status, body } = await getJSON("/api/settings");
    assert.equal(status, 200);
    assert.deepEqual(body, { vscodeSessionsEnabled: false });
  });

  it("updates and persists VS Code loading settings", async () => {
    const { status, body } = await patchJSON("/api/settings", { vscodeSessionsEnabled: true });
    assert.equal(status, 200);
    assert.equal(body.vscodeSessionsEnabled, true);

    const settingsFile = join(testHomeDir, ".copilot", "copilot-insights-settings.json");
    assert.equal(existsSync(settingsFile), true);
    const persisted = JSON.parse(readFileSync(settingsFile, "utf-8"));
    assert.equal(persisted.vscodeSessionsEnabled, true);
  });

  it("rejects unknown setting keys", async () => {
    const { status, body } = await patchJSON("/api/settings", { unknownSetting: true });
    assert.equal(status, 400);
    assert.match(body.error, /Unknown setting keys/);
  });

  it("rejects non-boolean VS Code loading values", async () => {
    const { status, body } = await patchJSON("/api/settings", { vscodeSessionsEnabled: "yes" });
    assert.equal(status, 400);
    assert.equal(body.error, "vscodeSessionsEnabled must be a boolean");
  });
});

describe("VS Code settings gating", () => {
  it("returns disabled payloads when VS Code loading is off", async () => {
    await patchJSON("/api/settings", { vscodeSessionsEnabled: false });

    const { status: summaryStatus, body: summaryBody } = await getJSON("/api/vscode/summary");
    const { status: sessionsStatus, body: sessionsBody } = await getJSON("/api/vscode/sessions");
    const disabledSessionResponse = await fetch(`${BASE}/api/vscode/sessions/workspace-123`);

    assert.equal(summaryStatus, 200);
    assert.equal(summaryBody.enabled, false);
    assert.equal(summaryBody.totalSessions, 0);

    assert.equal(sessionsStatus, 200);
    assert.deepEqual(sessionsBody, { enabled: false, sessions: [] });

    assert.equal(disabledSessionResponse.status, 403);
  });

  it("returns enabled payloads after opting in", async () => {
    await patchJSON("/api/settings", { vscodeSessionsEnabled: true });

    const { status: summaryStatus, body: summaryBody } = await getJSON("/api/vscode/summary");
    const { status: sessionsStatus, body: sessionsBody } = await getJSON("/api/vscode/sessions");

    assert.equal(summaryStatus, 200);
    assert.equal(summaryBody.enabled, true);
    assert.ok(Array.isArray(summaryBody.models));

    assert.equal(sessionsStatus, 200);
    assert.equal(sessionsBody.enabled, true);
    assert.ok(Array.isArray(sessionsBody.sessions));
  });
});

describe("GET /api/sessions", () => {
  it("returns 200 with session list and aggregate", async () => {
    const { status, body } = await getJSON("/api/sessions");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.sessions), "sessions should be an array");
    assert.ok("aggregate" in body, "missing aggregate");
  });

  it("each session has expected fields", async () => {
    const { body } = await getJSON("/api/sessions");
    for (const s of body.sessions) {
      assert.ok("id" in s, "missing id");
      assert.ok("redirectionCount" in s, "missing redirectionCount");
      assert.ok("redirectionRate" in s, "missing redirectionRate");
    }
  });
});

describe("GET /api/sessions/catalog", () => {
  it("returns 200 with a metadata-only session list", async () => {
    const { status, body } = await getJSON("/api/sessions/catalog");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.sessions), "sessions should be an array");
    assert.ok(body.sessions.length >= testData.sessions.length, "should include all test sessions");
    assert.ok("id" in body.sessions[0], "missing id");
    assert.ok("createdAt" in body.sessions[0], "missing createdAt");
  });
});

describe("GET /api/sessions/:id", () => {
  it("returns 200 with session detail for a known session", async () => {
    const { status, body } = await getJSON("/api/sessions/sess-redirect-1");
    assert.equal(status, 200);
    assert.ok("session" in body, "missing session");
    assert.ok("stats" in body, "missing stats");
    assert.ok("redirections" in body, "missing redirections");
    assert.ok("telemetry" in body, "missing telemetry field");
    assert.equal(body.session.id, "sess-redirect-1");
  });

  it("returns 404 for an unknown session", async () => {
    const { status, body } = await getJSON("/api/sessions/nonexistent-id");
    assert.equal(status, 404);
    assert.ok("error" in body);
  });
});

describe("GET /api/sessions/:id/replay", () => {
  it("returns 200 with annotated turns and summary", async () => {
    const { status, body } = await getJSON("/api/sessions/sess-redirect-1/replay");
    assert.equal(status, 200);
    assert.ok("sessionId" in body, "missing sessionId");
    assert.ok(Array.isArray(body.turns), "turns should be an array");
    assert.ok("summary" in body, "missing summary");
    assert.equal(body.sessionId, "sess-redirect-1");
    assert.ok(body.summary.totalTurns > 0, "should have turns");
  });
});

describe("GET /api/sessions/:id/efficiency", () => {
  it("returns 200 for a session with enough turns", async () => {
    const { status, body } = await getJSON("/api/sessions/sess-redirect-1/efficiency");
    assert.equal(status, 200);
    // May return efficiency data or a null-message envelope
    if (body.efficiency === null) {
      assert.ok("message" in body, "null result should include message");
    } else {
      assert.ok("turnEfficiency" in body || "efficiency" in body || "grade" in body || "score" in body,
        "should contain efficiency data");
    }
  });

  it("returns 200 for session with few turns (may be null)", async () => {
    const { status } = await getJSON("/api/sessions/sess-clean-1/efficiency");
    assert.equal(status, 200);
  });
});

describe("GET /api/patterns", () => {
  it("returns 200 with patterns array", async () => {
    const { status, body } = await getJSON("/api/patterns");
    assert.equal(status, 200);
    assert.ok("patterns" in body, "missing patterns");
    assert.ok(Array.isArray(body.patterns), "patterns should be an array");
  });
});

describe("POST /api/practice/analyze", () => {
  it("returns 200 with analysis for a valid prompt", async () => {
    const { status, body } = await postJSON("/api/practice/analyze", {
      text: "Create a React component for user login with email and password fields",
    });
    assert.equal(status, 200);
    assert.ok("score" in body, "missing score");
    assert.ok("grade" in body, "missing grade");
  });

  it("includes heuristics in response", async () => {
    const { status, body } = await postJSON("/api/practice/analyze", {
      text: "Create a React component for user login with email and password fields",
    });
    assert.equal(status, 200);
    assert.ok("heuristics" in body, "missing heuristics");
    assert.ok(Array.isArray(body.heuristics?.details), "heuristics.details should be an array");
  });

  it("returns 400 when text is missing", async () => {
    const { status, body } = await postJSON("/api/practice/analyze", {});
    assert.equal(status, 400);
    assert.ok("error" in body);
  });

  it("returns 400 when text is too long", async () => {
    const { status, body } = await postJSON("/api/practice/analyze", {
      text: "x".repeat(10001),
    });
    assert.equal(status, 400);
    assert.ok("error" in body);
  });
});

describe("GET /api/practice/library", () => {
  it("returns 200 with challenges array", async () => {
    const { status, body } = await getJSON("/api/practice/library");
    assert.equal(status, 200);
    assert.ok("challenges" in body, "missing challenges");
    assert.ok(Array.isArray(body.challenges), "challenges should be an array");
    assert.ok("total" in body, "missing total");
  });

  it("supports tag filtering", async () => {
    const { status, body } = await getJSON("/api/practice/library?tag=vague");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.challenges), "should return array");
  });

  it("supports random mode", async () => {
    const { status, body } = await getJSON("/api/practice/library?random=1");
    assert.equal(status, 200);
    // Returns either a challenge object or null
    assert.ok("total" in body, "missing total");
  });

  it("includes heuristics in random challenge response", async () => {
    const { status, body } = await getJSON("/api/practice/library?random=1");
    assert.equal(status, 200);
    if (body.challenge) {
      assert.ok("heuristics" in body.challenge, "challenge should include heuristics");
      assert.ok(Array.isArray(body.challenge.heuristics?.details), "heuristics.details should be an array");
    }
  });
});

describe("GET /api/chronicle/tips", () => {
  it("returns 200 with a tips array", async () => {
    const { status, body } = await getJSON("/api/chronicle/tips");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body), "tips response should be an array");
  });
});

describe("GET /api/chronicle/improve/:sessionId", () => {
  it("returns 200 with improve suggestions for a known session", async () => {
    const { status, body } = await getJSON("/api/chronicle/improve/sess-redirect-1");
    assert.equal(status, 200);
    assert.equal(body.sessionId, "sess-redirect-1");
    assert.ok(Array.isArray(body.suggestions), "suggestions should be an array");
    assert.equal(typeof body.overallAdvice, "string");
  });

  it("returns 404 for an unknown session", async () => {
    const { status, body } = await getJSON("/api/chronicle/improve/does-not-exist");
    assert.equal(status, 404);
    assert.ok("error" in body);
  });
});

describe("POST /api/devplan/goals — concurrent writes", () => {
  it("handles concurrent goal additions without data loss", async () => {
    // Use unique suffix to avoid conflicts with prior runs
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    // Fire 5 concurrent goal additions
    const promises = Array.from({ length: 5 }, (_, i) =>
      postJSON("/api/devplan/goals", {
        pillar: "intent",
        title: `Concurrent Goal ${i}-${suffix}`,
        description: `Test goal ${i}`,
        source: "test",
      })
    );
    const results = await Promise.allSettled(promises);
    const successes = results.filter((r) => r.status === "fulfilled" && r.value.status === 201);
    // Some may be 409 (duplicate) but none should fail with 500
    const serverErrors = results.filter((r) => r.status === "fulfilled" && r.value.status >= 500);
    assert.equal(serverErrors.length, 0, "No server errors during concurrent writes");
    assert.ok(successes.length >= 1, "At least one goal should be created");
  });

  it("handles concurrent goal status updates", async () => {
    // First create a goal
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { body: created } = await postJSON("/api/devplan/goals", {
      pillar: "workDesign",
      title: `Status Update Test-${suffix}`,
      description: "Testing concurrent updates",
      source: "test",
    });
    if (!created?.id) return; // skip if creation failed
    const goalId = created.id;
    // Fire concurrent status updates
    const promises = [
      fetch(`${BASE}/api/devplan/goals/${goalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "sufficient" }),
      }),
      fetch(`${BASE}/api/devplan/goals/${goalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      }),
    ];
    const results = await Promise.allSettled(promises);
    const serverErrors = results.filter(
      (r) => r.status === "fulfilled" && r.value.status >= 500
    );
    assert.equal(serverErrors.length, 0, "No server errors during concurrent updates");
  });
});
