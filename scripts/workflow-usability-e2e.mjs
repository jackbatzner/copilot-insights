import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createSyntheticFixture, PRIVACY_CANARY } from "./seed-mock-db.mjs";
import { startServer } from "../server/index.mjs";

const fixture = createSyntheticFixture();
const empty = createSyntheticFixture({ empty: true });
const key = "copilot-insights.presentation.v1";
let server, emptyServer, browser;
const close = (value) => value && new Promise((done) => { value.close(done); value.closeAllConnections(); });
try {
  const uiDist = process.env.COPILOT_INSIGHTS_TEST_UI_DIST;
  server = await startServer({ ...fixture, port: 0, uiDist });
  emptyServer = await startServer({ ...empty, port: 0, uiDist });
  const base = `http://127.0.0.1:${server.address().port}`;
  const emptyBase = `http://127.0.0.1:${emptyServer.address().port}`;
  const snapshot = await (await fetch(`${base}/api/summary?timeframe=all`)).json();
  const session = snapshot.sessions.find((entry) => entry.label === "Session 1");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  let contentReads = 0, external = 0;
  const errors = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base && url.origin !== emptyBase) { external++; return route.abort(); }
    if (url.pathname.endsWith("/content")) {
      contentReads++;
      return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Blocked by synthetic test"}' });
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", () => errors.push("Render error"));
  await page.goto(`${base}/?timeframe=30d`);
  await expect(page.locator(".primary-insight .button-link")).toBeInViewport();
  await expect(page.locator(".timeframe-context")).toContainText("Sessions active in");
  await expect(page.locator(".timeframe-context")).toContainText("whole recorded history");
  await expect(page.locator(".secondary-insights")).not.toHaveAttribute("open");
  await page.getByRole("button", { name: "Presentation mode: Off", exact: true }).click();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), "on");
  if (process.argv[2]) await mkdir(process.argv[2], { recursive: true });
  const capture = async (name) => {
    assert.ok(!(await page.content()).includes(PRIVACY_CANARY));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.argv[2]) {
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await page.screenshot({ path: join(process.argv[2], `${name}.png`), fullPage: true });
    }
  };
  const filters = `timeframe=30d&model=claude-sonnet-4.6&scope=subagent&day=${fixture.usageDays.child}`;
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(`${base}/?timeframe=30d`);
    await expect(page.locator(".primary-insight")).toBeVisible();
    await capture(`overview-${width}`);
    await page.goto(`${base}/sessions?${filters}`);
    await expect(page.getByRole("link", { name: "Session 1", exact: true })).toBeVisible();
    await capture(`sessions-${width}`);
    await page.getByRole("link", { name: "Session 1", exact: true }).click();
    await expect(page.getByRole("region", { name: "Matching usage totals" }).locator('[data-exact="31,000"]')).toHaveText("31K");
    await expect(page.getByRole("button", { name: "Show text", exact: true })).toBeVisible();
    await expect(page.locator(".local-content-preview")).toHaveCount(0);
    await expect(page.getByLabel("Session diagnostic")).not.toHaveAttribute("open");
    await capture(`detail-${width}`);
    await page.goto(`${emptyBase}/?timeframe=30d`);
    await expect(page.getByRole("heading", { name: "No recorded sessions yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Check Data Sources", exact: true })).toBeInViewport();
    await expect(page.locator(".usage-insights, .share-chart-grid")).toHaveCount(0);
    await capture(`empty-${width}`);
  }
  assert.equal(contentReads, 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/sessions/${session.handle}`);
  await page.reload();
  await expect(page.getByRole("button", { name: "Show text", exact: true })).toBeVisible();
  assert.equal(contentReads, 0);
  // Another tab's preference update immediately changes this mounted viewer.
  const sibling = await context.newPage();
  await sibling.goto(`${base}/settings`);
  await sibling.evaluate((key) => localStorage.setItem(key, "off"), key);
  await expect(page.getByRole("button", { name: "Hide all text", exact: true })).toBeVisible();
  await expect.poll(() => contentReads).toBeGreaterThan(0);
  await sibling.evaluate((key) => localStorage.setItem(key, "on"), key);
  await expect(page.getByRole("button", { name: "Show text", exact: true })).toBeVisible();
  await expect(page.locator(".local-content-preview")).toHaveCount(0);
  await sibling.close();
  // Corrupt and unreadable storage must not briefly fetch text before showing an error.
  await page.evaluate((key) => localStorage.setItem(key, "invalid"), key);
  const readsBefore = contentReads;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("saved presentation preference is invalid");
  await expect(page.getByRole("button", { name: "Show text", exact: true })).toBeVisible();
  assert.equal(contentReads, readsBefore);
  const deniedContext = await browser.newContext();
  await deniedContext.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Unavailable", "SecurityError"); } });
  });
  await deniedContext.route("**/content", (route) => { contentReads++; return route.abort(); });
  const denied = await deniedContext.newPage();
  await denied.goto(`${base}/sessions/${session.handle}`);
  await expect(denied.getByRole("alert")).toContainText("presentation preference could not be read");
  assert.equal(contentReads, readsBefore);
  await denied.getByRole("button", { name: "Presentation mode: On", exact: true }).click();
  await expect(denied.getByRole("alert").first()).toContainText("could not be saved");
  await deniedContext.close();
  await page.goto(`${base}/tokens/compare?model=PRIVATE_QUERY_CANARY&session=PRIVATE_QUERY_CANARY&scope=PRIVATE_QUERY_CANARY&day=PRIVATE_QUERY_CANARY`);
  await expect(page.locator("#main-content")).toContainText(/invalid/i);
  assert.ok(!(await page.content()).includes("PRIVATE_QUERY_CANARY"));
  assert.equal(external, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ decisionAboveFold: true, explicitScope: true, emptySetup: true,
    presentationAcrossNavigationReloadAndTabs: true, invalidStorageFailClosed: true, storageErrorsVisible: true,
    syntheticOnly: true, externalRequests: external, desktopAndMobile: true }));
} finally {
  await browser?.close();
  await close(server);
  await close(emptyServer);
  await rm(fixture.directory, { recursive: true, force: true });
  await rm(empty.directory, { recursive: true, force: true });
}
