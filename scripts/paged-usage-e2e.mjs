import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { chromium, expect } from "@playwright/test";
import { createSyntheticFixture, PRIVACY_CANARY } from "./seed-mock-db.mjs";
import { captureRequestPolicy, assertCaptureSafe } from "./gallery-contract.mjs";
import { startServer } from "../server/index.mjs";

const fixture = createSyntheticFixture({ extraSessions: 40 });
const db = new Database(fixture.dbPath);
try {
  const insert = db.prepare(`INSERT INTO assistant_usage_events
    (session_id,model,input_tokens,output_tokens,turn_index,created_at)
    VALUES (?, 'gpt-5.4', 100, 10, 0, ?)`);
  db.transaction(() => { for (let i = 0; i < 1500; i++) insert.run(fixture.ids[0], new Date().toISOString()); })();
} finally { db.close(); }

let server, browser, release;
try {
  server = await startServer({ ...fixture, port: 0, uiDist: process.env.COPILOT_INSIGHTS_TEST_UI_DIST });
  const base = `http://127.0.0.1:${server.address().port}`;
  const snapshot = await (await fetch(`${base}/api/summary?timeframe=all`)).json();
  assert.equal(snapshot.sessions.length, 25);
  assert.equal(snapshot.pagination.total, 48);
  const handle = snapshot.sessions.find((row) => row.label === "Session 1").handle;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  await context.addInitScript(() => localStorage.setItem("copilot-insights.presentation.v1", "on"));
  let blocked = 0;
  const evidence = [], errors = [];
  const turnGate = new Promise((done) => { release = done; });
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (captureRequestPolicy(request.url(), request.method(), new Set([base])) !== "allow") {
      blocked++; return route.abort();
    }
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname.endsWith("/turns") && !url.searchParams.has("turn")) await turnGate;
    const response = await route.fetch({ maxRedirects: 0, timeout: 30000 });
    const body = await response.text();
    assertCaptureSafe(body, [PRIVACY_CANARY, ...fixture.ids]);
    assert.equal(response.status(), 200);
    const value = JSON.parse(body);
    const kind = url.pathname.endsWith("/turns") ? url.searchParams.has("turn") ? "requests" : "turns"
      : url.pathname.endsWith(handle) ? "detail" : url.pathname === "/api/sessions" ? "sessions" : "other";
    evidence.push({ kind, bytes: Buffer.byteLength(body), page: kind === "requests" ? value.turns?.[0]?.requestPagination?.page : value.pagination?.page,
      rows: value.sessions?.length ?? value.turns?.[0]?.requests?.length ?? null });
    return route.fulfill({ response });
  });
  await context.routeWebSocket("**/*", (socket) => { blocked++; socket.close(); });
  const page = await context.newPage();
  page.on("pageerror", () => errors.push("render-error"));
  await page.goto(`${base}/sessions/${handle}?timeframe=all`);
  await expect(page.getByRole("heading", { name: "Turns & model calls", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Whole-session totals (all models)", exact: true })).toBeVisible();
  assert.equal(evidence.filter((row) => row.kind === "turns").length, 0);
  assert.equal(evidence.filter((row) => row.kind === "requests").length, 0);
  release();
  await expect(page.locator(".turn-coverage")).toContainText("1,504 recorded model calls");
  assert.ok(evidence.filter((row) => ["detail", "turns"].includes(row.kind)).every((row) => row.bytes < 150000));
  const turn = page.locator(".usage-turn");
  await page.getByRole("button", { name: "Inspect Turn 0", exact: true }).click();
  await expect(turn.locator(".request-list-row")).toHaveCount(25);
  await turn.getByRole("button", { name: "Next model calls", exact: true }).click();
  await expect.poll(() => evidence.some((row) => row.kind === "requests" && row.page === 2)).toBe(true);
  await expect(turn.locator(".request-list-row")).toHaveCount(25);
  assert.ok(evidence.filter((row) => row.kind === "requests").every((row) => row.bytes < 150000 && row.rows <= 25));
  await page.goto(`${base}/sessions?timeframe=all&page=2`);
  await expect(page.locator(".session-table tbody tr")).toHaveCount(23);
  await expect(page.locator(".pagination")).toContainText("Page 2 of 2");
  assert.ok(evidence.filter((row) => row.kind === "sessions").every((row) => row.rows <= 25));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assertCaptureSafe(await page.content(), [PRIVACY_CANARY, ...fixture.ids]);
    if (process.argv[2]) {
      await mkdir(process.argv[2], { recursive: true });
      await page.screenshot({ path: join(process.argv[2], `paged-sessions-${width}.png`), fullPage: true });
    }
  }
  assert.equal(blocked, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ headerBeforeTurns: true, requestEvidenceOnExpansionOnly: true,
    sessionPageSize: 25, requestPageSize: 25, boundedPayloads: true, desktopAndMobile: true, evidence }));
} finally {
  release?.();
  await browser?.close();
  if (server) await new Promise((done) => { server.close(done); server.closeAllConnections(); });
  await rm(fixture.directory, { recursive: true, force: true });
}
