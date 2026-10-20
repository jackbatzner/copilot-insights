import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { startServer } from "../server/index.mjs";
import { createUsageFixture, assertPrivate, CANARY, RAW_ID } from "./usage-fixture.mjs";

describe("safe usage HTTP contract", () => {
  let fixture, server, base;
  async function request(path, options) {
    const response = await fetch(`${base}${path}`, options);
    assert.match(response.headers.get("content-type"), /application\/json/);
    const body = await response.json();
    assertPrivate(assert, body);
    return { status: response.status, body };
  }
  before(async () => {
    fixture = createUsageFixture();
    const uiDist = join(fixture.root, "ui");
    mkdirSync(uiDist);
    writeFileSync(join(uiDist, "index.html"), "<!doctype html><title>Synthetic usage UI</title>");
    server = await startServer({ ...fixture.options, uiDist, port: 0 });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((done) => { server.close(done); server.closeAllConnections(); });
    fixture.cleanup();
  });

  it("serves the exact safe summary and sessions shapes from a real SQLite fixture", async () => {
    const { status, body } = await request("/api/summary?timeframe=all");
    assert.equal(status, 200);
    assert.equal(body.sessionCount, 2);
    assert.ok(body.metrics && body.evidence && body.performance && body.recommendation);
    assert.equal(body.capabilities.sessionDb, "available");
    assert.equal(body.capabilities.usageTable, true);
    assert.equal(body.metrics.requests, 3);
    assert.equal(body.metrics.inputTokens, 190);
    assert.equal(body.metrics.outputTokens, 35);
    assert.equal(body.metrics.totalTokens, 225);
    assert.equal(body.metrics.cacheReadTokens, 0);
    assert.equal(body.metrics.durationMs, 1700);
    assert.equal(body.sessions.length, 2);
    for (const session of body.sessions) {
      assert.match(session.handle, /^[a-f0-9]{64}$/);
      assert.match(session.label, /^Session \d+$/);
      assert.equal(session.source, "cli");
      assert.ok("selectedUsage" in session);
      assert.ok("selectedEvidence" in session);
      assert.ok(!("id" in session));
    }
    const list = await request("/api/sessions?timeframe=all");
    assert.equal(list.status, 200);
    assert.deepEqual(Object.keys(list.body).sort(), ["capabilities", "models", "pagination", "sessions"]);
    assert.deepEqual(list.body.pagination, { page: 1, pageSize: 25, pages: 1, total: 2, sort: "tokens" });
    const tokens = await request("/api/tokens/summary?timeframe=all");
    assert.deepEqual(tokens.body.metrics, body.metrics);
  });

  it("filters child-model sessions while preserving whole-session metrics and unfiltered model choices", async () => {
    const { status, body } = await request("/api/sessions?timeframe=all&model=claude-sonnet-4.5");
    assert.equal(status, 200);
    assert.equal(body.sessions.length, 1);
    assert.equal(body.models.length, 3);
    assert.equal(body.sessions[0].metrics.inputTokens, 160);
    assert.equal(body.sessions[0].selectedUsage.inputTokens, 60);
    assert.equal(body.sessions[0].selectedUsage.requests, 1);
    const detail = await request(`/api/sessions/${body.sessions[0].handle}`);
    const child = detail.body.attribution.find((group) => group.scope === "subagent");
    assert.equal(child.correlation, "exact-child");
    assert.equal(child.metrics.inputTokens, 60);
    assert.equal(child.skill, null);
    assert.equal(detail.body.skills[0].category, "skill");
  });

  it("retrieves only opaque-handle session detail and safe unknown errors", async () => {
    const catalog = await request("/api/sessions?timeframe=all");
    const { handle } = catalog.body.sessions[0];
    const detail = await request(`/api/sessions/${handle}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.session.handle, handle);
    assert.equal(detail.body.skillLinkage, "session-only");
    assert.ok(Array.isArray(detail.body.attribution));
    assert.equal((await request(`/api/sessions/${"0".repeat(64)}`)).status, 404);
    assert.equal((await request(`/api/sessions/${RAW_ID}`)).status, 404);
  });

  it("returns empty sessions for a recognized model without matching usage", async () => {
    const catalog = await request("/api/sessions?timeframe=7d");
    const filtered = await request("/api/sessions?timeframe=7d&model=gpt-4.1");
    assert.equal(filtered.status, 200);
    assert.deepEqual(filtered.body.sessions, []);
    assert.deepEqual(filtered.body.models, catalog.body.models);
    const unknown = await request("/api/sessions?timeframe=7d&model=Unknown%20model");
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.sessions.length, 1);
  });

  it("hides and restores sessions through opaque HTTP routes and excludes hidden totals", async () => {
    const catalog = await request("/api/sessions?timeframe=all");
    const session = catalog.body.sessions[0];
    assert.deepEqual((await request(`/api/sessions/${session.handle}/hide`, { method: "POST" })).body, { hidden: true });
    const summary = await request("/api/summary?timeframe=all");
    assert.equal(summary.body.sessionCount, 1);
    assert.equal(summary.body.metrics.requests, 3 - session.metrics.requests);
    const hidden = await request("/api/sessions?timeframe=all&includeHidden=true");
    assert.equal(hidden.body.sessions.length, 2);
    assert.equal(hidden.body.sessions.find((entry) => entry.handle === session.handle).hidden, true);
    assert.deepEqual((await request(`/api/sessions/${session.handle}/hide`, { method: "DELETE" })).body, { hidden: false });
    assert.equal((await request("/api/summary?timeframe=all")).body.metrics.requests, 3);
    assert.equal((await request(`/api/sessions/${RAW_ID}/hide`, { method: "POST" })).status, 404);
    const persisted = readFileSync(join(fixture.options.stateDir, "usage-state.json"), "utf8");
    assertPrivate(assert, persisted);
  });

  it("requires explicit boolean VS Code opt-in and reports unsupported metadata honestly", async () => {
    const initial = await request("/api/settings");
    assert.equal(initial.body.enableVSCode, false);
    assert.equal(initial.body.vscode.status, "disabled");
    const enabled = await request("/api/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enableVSCode: true }),
    });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.body.enableVSCode, true);
    assert.equal(enabled.body.vscode.status, "unavailable");
    assert.match(enabled.body.vscode.message, /usage metadata is unavailable/);
    assert.match(enabled.body.vscode.message, /not read or analyzed/);
    const persisted = JSON.parse(readFileSync(join(fixture.options.stateDir, "usage-state.json"), "utf8"));
    assert.equal(persisted.enableVSCode, true);
    for (const value of [{ enableVSCode: CANARY }, { vscodeSessionsEnabled: true }, { enableVSCode: false, unknown: CANARY }, null]) {
      assert.equal((await request("/api/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
      })).status, 400);
    }
    assert.equal((await request("/api/settings", { method: "POST" })).status, 404);
    assert.equal(readFileSync(fixture.coachingFile, "utf8"), CANARY);
  });

  it("rejects malformed and legacy filters without reflecting values", async () => {
    for (const query of ["timeframe=bad", "timeframe=7d&timeframe=all", `repo=${CANARY}`, `excludeIds=${RAW_ID}`, "includeHidden=yes", `model=${CANARY}`]) {
      assert.equal((await request(`/api/sessions?${query}`)).status, 400);
    }
    const response = await request("/api/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: `{"${CANARY}":`,
    });
    assert.equal(response.status, 400);
    assert.equal((await request("/api/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enableVSCode: CANARY.repeat(200) }),
    })).status, 413);
  });

  it("denies cross-origin and malformed origins before reading or mutating state", async () => {
    for (const origin of ["https://evil.example", "null", CANARY, "http://localhost:9999", `${base}.evil.example`]) {
      for (const [path, method] of [["/api/summary", "GET"], ["/api/refresh", "POST"], ["/api/settings", "PATCH"]]) {
        assert.equal((await request(path, { method, headers: { Origin: origin } })).status, 403);
      }
    }
    assert.equal((await request("/api/summary", { headers: { Origin: base } })).status, 200);
    const hostResponse = await new Promise((done, reject) => {
      const req = httpRequest(`${base}/api/summary`, { headers: { Host: "evil.example" } }, (res) => {
        let text = "";
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => done({ status: res.statusCode, text }));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(hostResponse.status, 403);
    assertPrivate(assert, hostResponse.text);
    assert.equal((await request("/api/summary", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  });

  it("retires content APIs with JSON errors rather than serving the SPA", async () => {
    for (const path of [
      "/api", "/api/patterns", "/api/suggestions", "/api/coach", "/api/coaching", "/api/sessions/hidden",
      "/api%2Fcoach", "/%61pi/coach",
      "/api/instructions", "/api/instruction-failures", "/api/practice", "/api/practice/analyze",
      "/api/challenges", "/api/chronicle", "/api/chronicle/tips", "/api/devplan", "/api/dev-plan",
      "/api/journal", "/api/live", "/api/analytics", "/api/work-style", "/api/replay",
      "/api/vscode/summary", "/api/vscode/sessions", "/api/tokens/summary/progressive",
      `/api/sessions/${RAW_ID}/replay`, `/api/sessions/${RAW_ID}/turns`,
    ]) {
      for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
        assert.equal((await request(path, { method })).status, 404, `${method} ${path}`);
      }
    }
    const page = await fetch(`${base}/sessions`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Synthetic usage UI/);
  });

  it("refresh reloads sources without changing handles", async () => {
    const before = await request("/api/sessions?timeframe=all");
    assert.deepEqual((await request("/api/refresh", { method: "POST" })).body, { ok: true });
    const after = await request("/api/sessions?timeframe=all");
    assert.deepEqual(after.body.sessions.map((s) => s.handle), before.body.sessions.map((s) => s.handle));
  });
});
