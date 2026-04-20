// Integration tests for the Express API server routes.
// Sets up an in-memory test DB, starts the server on a test port,
// and validates every major API endpoint.

import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, teardownTestDb, FIXTURES } from "./test-helpers.mjs";

const TEST_PORT = 3099;
const BASE = `http://127.0.0.1:${TEST_PORT}`;

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

describe("GET /api/sessions/:id", () => {
  it("returns 200 with session detail for a known session", async () => {
    const { status, body } = await getJSON("/api/sessions/sess-redirect-1");
    assert.equal(status, 200);
    assert.ok("session" in body, "missing session");
    assert.ok("stats" in body, "missing stats");
    assert.ok("redirections" in body, "missing redirections");
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
