import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createSyntheticFixture, PRIVACY_CANARY } from "./seed-mock-db.mjs";
import { captureRequestPolicy, assertCaptureSafe } from "./gallery-contract.mjs";
import { startServer } from "../server/index.mjs";

const fixture = createSyntheticFixture({ extraSessions: 40 });
let server, browser;
const releases = [];
const errors = [];
let blocked = 0;
try {
  server = await startServer({ ...fixture, port: 0, uiDist: process.env.COPILOT_INSIGHTS_TEST_UI_DIST });
  const base = `http://127.0.0.1:${server.address().port}`;
  const snapshot = await (await fetch(`${base}/api/summary?timeframe=all`)).json();
  const handle = snapshot.sessions.find((row) => row.label === "Session 1").handle;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  await context.addInitScript((origin) => {
    if (location.origin === origin) localStorage.setItem("copilot-insights.presentation.v1", "on");
  }, base);
  const controls = new Map();
  const gate = (page, match) => {
    let release;
    const pending = new Promise((done) => { release = done; });
    releases.push(release);
    controls.set(page, { match, pending });
    return release;
  };
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (captureRequestPolicy(request.url(), request.method(), new Set([base])) !== "allow") {
      blocked++; return route.abort();
    }
    const url = new URL(request.url());
    const control = controls.get(request.frame().page());
    if (control?.match(url)) {
      await control.pending;
      if (control.fail) return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Unavailable"}' });
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const response = await route.fetch({ maxRedirects: 0, timeout: 30_000 });
    assertCaptureSafe(await response.text(), [PRIVACY_CANARY, ...fixture.ids]);
    return route.fulfill({ response });
  });
  await context.routeWebSocket("**/*", (socket) => { blocked++; socket.close(); });
  context.on("page", (page) => page.on("pageerror", (error) => {
    assertCaptureSafe(error.message, [PRIVACY_CANARY, ...fixture.ids]);
    errors.push(error.message);
  }));
  const capture = async (page, name) => {
    assertCaptureSafe(await page.content(), [PRIVACY_CANARY, ...fixture.ids]);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.argv[2]) {
      await mkdir(process.argv[2], { recursive: true });
      await page.screenshot({ path: join(process.argv[2], `${name}.png`), fullPage: true });
    }
  };

  for (const [path, variant, label] of [
    ["/", "overview", "Loading Overview..."],
    ["/sessions", "sessions", "Loading matching sessions..."],
    ["/tokens", "tokens", "Loading Token Usage..."],
    ["/tokens/compare", "comparison", "Loading model comparison..."],
    [`/sessions/${handle}`, "detail", "Loading session totals and attribution..."],
  ]) {
    const page = await context.newPage();
    await page.clock.install();
    const release = gate(page, (url) => url.pathname.startsWith("/api/") && url.pathname !== "/api/settings");
    await page.goto(`${base}${path}?timeframe=all`);
    const skeleton = page.locator(`.usage-loading-${variant}`);
    await expect(skeleton.getByRole("status")).toContainText(label);
    await expect(skeleton.locator(".skeleton-line").first()).toBeVisible();
    await expect(skeleton.locator(".usage-skeleton")).toHaveAttribute("aria-hidden", "true");
    await expect(skeleton.locator("button,input,a,[tabindex]")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    assert.equal(await skeleton.locator(".skeleton-line").first().evaluate((node) =>
      getComputedStyle(node).backgroundColor === "rgba(0, 0, 0, 0)"), false);
    if (variant === "overview") {
      await expect(skeleton.locator(".skeleton-chart")).toBeVisible();
      await expect(page.locator(".daily-chart,.trend-bar,.metric dd")).toHaveCount(0);
      await page.clock.runFor(10_100);
      await expect(skeleton.getByRole("status")).toContainText("Still loading local usage");
      await capture(page, "loading-overview-light-1440");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => document.documentElement.dataset.theme = "dark");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(skeleton.locator(".skeleton-line").first()).toHaveCSS("animation-name", "none");
      await capture(page, "loading-overview-dark-390");
      await page.emulateMedia({ forcedColors: "active" });
      await expect(skeleton.locator(".skeleton-line").first()).toHaveCSS("opacity", "1");
    }
    if (variant === "sessions") {
      await capture(page, "loading-sessions-1440");
      await page.getByLabel("Scope", { exact: true }).selectOption("subagent");
      await expect(page).toHaveURL(/scope=subagent/);
      await expect(page.locator(".session-table tbody tr")).toHaveCount(0);
      await expect(skeleton).toBeVisible();
    }
    release();
    await expect(page.locator(".usage-loading")).toHaveCount(0);
    if (variant === "sessions") {
      const nextPage = gate(page, (url) => url.pathname === "/api/sessions");
      await page.getByLabel("Scope", { exact: true }).selectOption("");
      await expect(page.locator(".usage-loading-sessions")).toBeVisible();
      await expect(page.locator(".session-table")).toHaveCount(0);
      nextPage();
      await expect(page.locator(".session-table tbody tr")).toHaveCount(25);
      const releasePage = gate(page, (url) => url.pathname === "/api/sessions");
      await page.getByRole("button", { name: "Next page", exact: true }).click();
      await expect(page.locator(".usage-loading-sessions")).toBeVisible();
      await expect(page.locator(".session-table")).toHaveCount(0);
      releasePage();
      await expect(page.locator(".pagination")).toContainText("Page 2 of 2");
    }
    await page.close();
  }

  const detail = await context.newPage();
  const releaseSections = gate(detail, (url) => /\/(turns|tools)$/.test(url.pathname));
  await detail.goto(`${base}/sessions/${handle}?timeframe=all`);
  await expect(detail.getByRole("heading", { name: "Whole-session totals (all models)", exact: true })).toBeVisible();
  await expect(detail.getByRole("status").filter({ hasText: "Loading turns..." })).toBeVisible();
  await detail.getByRole("button", { name: "Tool activity", exact: true }).click();
  await expect(detail.getByRole("status").filter({ hasText: "Loading tool activity..." })).toBeVisible();
  await detail.getByRole("button", { name: "Turns", exact: true }).click();
  releaseSections();
  await expect(detail.locator(".usage-loading")).toHaveCount(0);
  const releaseCalls = gate(detail, (url) => url.pathname.endsWith("/turns") && url.searchParams.has("turn"));
  await detail.locator(".turn-list-row").first().click();
  await expect(detail.getByRole("status").filter({ hasText: "Loading model calls..." })).toBeVisible();
  await expect(detail.locator(".usage-request")).toHaveCount(0);
  releaseCalls();
  await expect(detail.locator(".request-list-row").first()).toBeVisible();
  await detail.close();

  const lazy = await context.newPage();
  const releaseView = gate(lazy, (url) => /\/assets\/Overview-[^/]+\.js$/.test(url.pathname));
  await lazy.goto(`${base}/?timeframe=all`, { waitUntil: "domcontentloaded" });
  await expect(lazy.getByRole("status")).toContainText("Loading view...");
  await expect(lazy.locator(".skeleton-chart")).toBeVisible();
  releaseView();
  await expect(lazy.getByRole("heading", { name: "Recorded local usage", exact: true })).toBeVisible();
  await lazy.close();

  const recovery = await context.newPage();
  const releaseFailure = gate(recovery, (url) => url.pathname === "/api/summary");
  controls.get(recovery).fail = true;
  await recovery.goto(`${base}/?timeframe=all`);
  await expect(recovery.locator(".usage-loading-overview")).toBeVisible();
  releaseFailure();
  await expect(recovery.getByRole("alert")).toContainText("Usage data is unavailable");
  await expect(recovery.locator(".usage-loading")).toHaveCount(0);
  const releaseRetry = gate(recovery, (url) => url.pathname === "/api/summary");
  await recovery.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(recovery.locator(".usage-loading-overview")).toBeVisible();
  releaseRetry();
  await expect(recovery.getByRole("heading", { name: "Recorded local usage", exact: true })).toBeVisible();
  await expect(recovery.locator(".usage-loading")).toHaveCount(0);
  await recovery.close();
  assert.deepEqual(errors, []);
  assert.equal(blocked, 0);
  console.log(JSON.stringify({ visibleSkeletons: true, longWaitStatus: true, filtersAndPagination: true,
    independentDetailSections: true, requestExpansion: true, failureRetry: true, reducedMotion: true,
    forcedColors: true, lightDarkResponsive: true, noPrivateContent: true }));
} finally {
  releases.forEach((release) => release());
  await browser?.close();
  if (server) await new Promise((done) => { server.close(done); server.closeAllConnections(); });
  await rm(fixture.directory, { recursive: true, force: true });
}
