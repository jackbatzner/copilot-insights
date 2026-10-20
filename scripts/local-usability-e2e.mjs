import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import Database from "better-sqlite3";
import { createSyntheticFixture, PRIVACY_CANARY } from "./seed-mock-db.mjs";
import { startServer } from "../server/index.mjs";

const fixture = createSyntheticFixture();
const TURN_PREVIEW = "Compare this session's recorded model calls";
const fixtureDb = new Database(fixture.dbPath);
try {
  fixtureDb.prepare("UPDATE turns SET user_message = ? WHERE session_id = ? AND turn_index = 0")
    .run(`${TURN_PREVIEW}\n${PRIVACY_CANARY}`, fixture.ids[0]);
} finally { fixtureDb.close(); }
let server, browser;
try {
  server = await startServer({ ...fixture, port: 0, uiDist: process.env.COPILOT_INSIGHTS_TEST_UI_DIST });
  const base = `http://127.0.0.1:${server.address().port}`;
  const snapshot = await (await fetch(`${base}/api/summary?timeframe=all`)).json();
  const session = snapshot.sessions.find((value) => value.label === "Session 1");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  const errors = [];
  let reads = 0, details = 0;
  page.on("pageerror", () => errors.push("Render error"));
  page.on("request", (request) => {
    if (request.url().endsWith("/content")) reads++;
    if (request.url() === `${base}/api/sessions/${session.handle}?view=summary`) details++;
  });
  await page.goto(`${base}/sessions/${session.handle}?timeframe=all`);
  const hideAll = page.getByRole("button", { name: "Hide all text", exact: true });
  await expect(hideAll).toBeVisible();
  const turn = page.locator(".usage-turn");
  const row = page.getByRole("button", { name: "Inspect Turn 0", exact: true });
  await expect(row.locator(".local-content-preview")).toContainText(TURN_PREVIEW);
  await expect(row.locator(".local-content-preview")).not.toContainText(PRIVACY_CANARY);
  await expect(page.getByRole("button", { name: "Inspect Turn 2", exact: true }).locator(".local-content-preview")).toContainText("Text not recorded");
  await expect(page.locator("pre")).toHaveCount(0);
  assert.equal(reads, 2);
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(turn.locator(".request-list-row")).toHaveCount(1);
  await expect(turn.locator("pre")).toHaveCount(2);
  await expect(turn.locator("pre").first()).toContainText(PRIVACY_CANARY);
  assert.equal(reads, 2);
  if (process.argv[2]) {
    await mkdir(process.argv[2], { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.locator(".turn-explorer").screenshot({ path: join(process.argv[2], `turn-preview-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await turn.getByRole("button", { name: "Hide turn text", exact: true }).click();
  assert.ok(!(await page.content()).includes(PRIVACY_CANARY));
  await turn.getByRole("button", { name: "Show turn text", exact: true }).click();
  await expect(turn.locator("pre")).toHaveCount(2);
  await turn.getByRole("button", { name: "Back to turns", exact: true }).click();
  await expect(page.locator("pre")).toHaveCount(0);
  await expect(row.locator(".local-content-preview")).toContainText(TURN_PREVIEW);
  await page.getByRole("button", { name: "Agents & models", exact: true }).click();
  const child = page.locator(".attribution-group").filter({ hasText: "Exact child linkage" });
  await child.locator(":scope > summary").focus();
  await page.keyboard.press("Enter");
  await expect(child.locator("pre")).toHaveText(PRIVACY_CANARY);
  await hideAll.click();
  await expect(page.locator("pre")).toHaveCount(0);
  await expect(page.locator(".local-content-preview")).toHaveCount(0);
  assert.ok(!(await page.content()).includes(PRIVACY_CANARY));

  // Reopening the same detail from Sessions uses the shared, sanitized cache.
  const initialDetails = details;
  const previousReads = reads;
  await page.getByRole("link", { name: "Back to Sessions" }).click();
  await page.getByRole("link", { name: "Session 1", exact: true }).click();
  await expect(page.locator("pre")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show text", exact: true })).toBeVisible();
  assert.equal(details, initialDetails);
  await expect(page.locator(".local-content-preview")).toHaveCount(0);
  assert.equal(reads, previousReads);
  await page.reload();
  await expect(page.getByRole("button", { name: "Show text", exact: true })).toBeVisible();
  assert.equal(reads, previousReads);
  await page.getByRole("button", { name: "Show text", exact: true }).click();
  await expect(row.locator(".local-content-preview")).toContainText(TURN_PREVIEW);
  assert.ok(reads > previousReads);
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(turn.locator("pre")).toHaveCount(2);
  await hideAll.click();
  const beforeRefresh = reads;
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(page.locator("pre")).toHaveCount(0);
  await expect.poll(() => details).toBeGreaterThan(initialDetails);
  await expect(page.getByRole("button", { name: "Show text", exact: true })).toBeVisible();
  assert.equal(reads, beforeRefresh);

  // A late response cannot paint after all text is hidden.
  let release;
  const waiting = new Promise((done) => { release = done; });
  await page.route("**/content", async (route) => {
    await waiting;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      status: "available", source: "sessiondb", truncated: false,
      messages: [{ role: "user", text: PRIVACY_CANARY }],
    }) });
  });
  await row.click();
  await page.getByRole("button", { name: "Show text", exact: true }).click();
  await expect(turn.getByRole("status")).toBeVisible();
  await hideAll.click();
  release();
  await page.unrouteAll({ behavior: "wait" });
  await expect(page.locator("pre")).toHaveCount(0);
  assert.ok(!(await page.content()).includes(PRIVACY_CANARY));

  // Missing turn text is explicit; it is not reconstructed from adjacent turns.
  const missing = page.locator(".usage-turn");
  await page.getByRole("button", { name: "Show text", exact: true }).click();
  await page.getByRole("button", { name: "Inspect Turn 2", exact: true }).click();
  await expect(missing).toContainText("No matching text is recorded");
  await hideAll.click();
  await page.route("**/content", (route) => route.fulfill({
    status: 503, contentType: "application/json", body: JSON.stringify({ error: PRIVACY_CANARY }),
  }));
  await page.getByRole("button", { name: "Show text", exact: true }).click();
  await expect(missing.getByRole("alert")).toHaveText("Local text could not be loaded. Retry or hide this panel.");
  assert.ok(!(await page.content()).includes(PRIVACY_CANARY));
  await page.unrouteAll();
  const literalMarkup = `<img src="https://invalid.example/${PRIVACY_CANARY}"><script>throw Error('never execute')</script>`;
  await page.route("**/content", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      status: "partial", source: "sessiondb", truncated: true, messages: [{ role: "user", text: literalMarkup }],
    }),
  }));
  await missing.getByRole("button", { name: "Retry turn text", exact: true }).click();
  await expect(missing.locator("pre")).toHaveText(literalMarkup);
  await expect(missing.locator(".local-content-text img, .local-content-text script")).toHaveCount(0);
  await expect(missing.getByRole("note")).toContainText("Text is partial");
  await hideAll.click();
  await page.unrouteAll();
  const total = page.locator('.metric [data-exact="62,800"]').first();
  await expect(total).toHaveText("62.8K");
  await total.hover();
  await expect(page.getByRole("tooltip")).toHaveText("62,800");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await total.focus();
  await expect(page.getByRole("tooltip")).toHaveText("62,800");
  await page.keyboard.press("Escape");
  await total.click();
  await expect(page.getByRole("tooltip")).toHaveText("62,800");
  await page.keyboard.press("Escape");

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await total.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.argv[2]) {
      await mkdir(process.argv[2], { recursive: true });
      await page.screenshot({ path: join(process.argv[2], `usability-${width}.png`) });
    }
  }
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
  await page.getByRole("button", { name: "Close menu", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const touchPage = await touch.newPage();
  await touchPage.goto(`${base}/sessions/${session.handle}`);
  await touchPage.locator('.metric [data-exact="62,800"]').first().tap();
  await expect(touchPage.getByRole("tooltip")).toHaveText("62,800");
  await touch.close();
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  assert.ok(!storage.includes(PRIVACY_CANARY));
  for (const path of ["/api/summary?timeframe=all", `/api/sessions/${session.handle}`]) {
    const response = await (await fetch(base + path)).text();
    for (const value of [PRIVACY_CANARY, ...fixture.ids]) assert.ok(!response.includes(value));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ localTextConsent: true, turnAndAgentReveal: true, clearingAndLateResponse: true,
    sharedDetailCache: true, refreshInvalidation: true, compactExactHoverFocusTap: true, automaticTurnPreviews: true, analyticsPrivacy: true, responsive: true }));
} finally {
  await browser?.close();
  if (server) await new Promise((done) => { server.close(done); server.closeAllConnections(); });
  await rm(fixture.directory, { recursive: true, force: true });
}
