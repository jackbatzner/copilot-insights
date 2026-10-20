import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createSyntheticFixture, PRIVACY_CANARY } from "./seed-mock-db.mjs";
import { assertCaptureSafe } from "./gallery-contract.mjs";
import { PRESENTATION_KEY } from "../ui/src/presentation-preference.js";
import { startServer } from "../server/index.mjs";

const fixture = createSyntheticFixture();
const forbidden = [PRIVACY_CANARY, fixture.directory, ...fixture.ids];
const completed = [];
let server, browser;
let forbiddenRequests = 0;
try {
  server = await startServer({ ...fixture, port: 0, uiDist: process.env.COPILOT_INSIGHTS_TEST_UI_DIST });
  const base = `http://127.0.0.1:${server.address().port}`;
  const snapshot = await (await fetch(`${base}/api/summary?timeframe=all`)).json();
  const first = snapshot.sessions.find((session) => session.label === "Session 1");
  const second = snapshot.sessions.find((session) => session.label === "Session 2");
  assert.ok(first && second);
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const scenario = async (name, run, { chunkFailure = false } = {}) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 }, serviceWorkers: "block",
    });
    const errors = [];
    try {
      await context.addInitScript(({ key, origin }) => {
        if (globalThis.location.origin === origin) globalThis.localStorage.setItem(key, "on");
      }, { key: PRESENTATION_KEY, origin: base });
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== base || url.pathname.endsWith("/content")) {
          forbiddenRequests++;
          return route.abort();
        }
        return route.continue();
      });
      await context.routeWebSocket("**/*", (socket) => { forbiddenRequests++; socket.close(); });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      page.on("pageerror", (error) => {
        if (!chunkFailure || !/Failed to fetch dynamically imported module|Importing a module script failed/.test(error.message)) {
          errors.push("Unexpected render error");
        }
      });
      await run(page, context);
      await expect(page.locator(".usage-loading")).toHaveCount(0);
      await expect(page.locator(".local-content-preview,.local-content-text,pre")).toHaveCount(0);
      assertCaptureSafe(await page.content(), forbidden);
      assertCaptureSafe(await page.evaluate(() => JSON.stringify({
        local: { ...globalThis.localStorage }, session: { ...globalThis.sessionStorage },
      })), forbidden);
      assert.deepEqual(errors, []);
      completed.push(name);
      console.log(`Passed: ${name}`);
    } finally {
      await context.close();
    }
  };
  const sessionsReady = async (page) => {
    await expect(page.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Session 1", exact: true })).toBeVisible();
  };

  await scenario("missing session deep link and back navigation", async (page) => {
    const query = "timeframe=all&model=claude-sonnet-4.6&scope=subagent";
    await page.goto(`${base}/sessions/${"f".repeat(64)}?${query}`);
    await expect(page.getByRole("alert")).toHaveText("Usage data is unavailable. Try again.Retry");
    await expect(page.locator(".session-explorer")).toHaveCount(0);
    await page.getByRole("link", { name: "Back to Sessions" }).click();
    await sessionsReady(page);
    assert.deepEqual(Object.fromEntries(new URL(page.url()).searchParams), {
      timeframe: "all", model: "claude-sonnet-4.6", scope: "subagent", sort: "tokens", page: "1",
    });
  });

  for (const failure of ["invalid-json", "connection-reset"]) {
    await scenario(`${failure} recovers through Retry`, async (page) => {
      let failing = true;
      await page.route("**/api/sessions?*", (route) => {
        if (!failing) return route.fallback();
        return failure === "invalid-json"
          ? route.fulfill({ status: 200, contentType: "application/json", body: PRIVACY_CANARY })
          : route.abort("connectionreset");
      });
      await page.goto(`${base}/sessions?timeframe=all`);
      await expect(page.getByRole("alert")).toHaveText("Usage data is unavailable. Try again.Retry");
      assertCaptureSafe(await page.content(), forbidden);
      failing = false;
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await sessionsReady(page);
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
  }

  await scenario("failed lazy module reload preserves filters", async (page) => {
    let failed = false;
    await page.route("**/assets/Sessions-*.js", (route) => {
      if (failed) return route.fallback();
      failed = true;
      return route.abort("failed");
    });
    await page.goto(`${base}/sessions?timeframe=all&model=claude-sonnet-4.6&scope=subagent`);
    await expect(page.getByRole("heading", { name: "This view could not be displayed" })).toBeVisible();
    const before = page.url();
    await page.getByRole("button", { name: "Reload app", exact: true }).click();
    await sessionsReady(page);
    assert.equal(page.url(), before);
    assert.equal(failed, true);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }, { chunkFailure: true });

  await scenario("late turn response cannot replace another session", async (page) => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    let started = false;
    await page.route(`**/api/sessions/${first.handle}/turns?*`, async (route) => {
      const response = await route.fetch();
      assertCaptureSafe(await response.text(), forbidden);
      started = true;
      await pending;
      await route.fulfill({ response });
    });
    try {
      await page.goto(`${base}/sessions/${first.handle}?timeframe=all`);
      await expect.poll(() => started).toBe(true);
      await page.getByRole("link", { name: "Back to Sessions" }).click();
      await sessionsReady(page);
      await page.getByRole("link", { name: "Session 2", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Session 2", exact: true })).toBeVisible();
      release();
      await page.unrouteAll({ behavior: "wait" });
      await expect(page.locator(".usage-loading")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Session 2", exact: true })).toBeVisible();
      const total = page.getByRole("region", { name: "Whole-session totals" });
      await expect(total.locator(`[data-exact="${second.metrics.totalTokens.toLocaleString("en-US")}"]`)).toBeVisible();
      await expect(page.getByRole("heading", { name: "Session 1", exact: true })).toHaveCount(0);
    } finally {
      release();
    }
  });

  await scenario("failed visibility write preserves state then succeeds", async (page) => {
    let failing = true;
    await page.route(`**/api/sessions/${first.handle}/hide`, (route) => failing
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: PRIVACY_CANARY }) })
      : route.fallback());
    await page.goto(`${base}/sessions/${first.handle}?timeframe=all`);
    await page.getByRole("button", { name: "Hide session", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Session visibility could not be changed");
    await expect(page.getByRole("button", { name: "Hide session", exact: true })).toBeEnabled();
    assertCaptureSafe(await page.content(), forbidden);
    failing = false;
    await page.getByRole("button", { name: "Hide session", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unhide session", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Unhide session", exact: true }).click();
    await expect(page.getByRole("button", { name: "Hide session", exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("link", { name: "Back to Sessions" }).click();
    await sessionsReady(page);
  });

  await scenario("offline refresh recovers without losing selection", async (page, context) => {
    await page.goto(`${base}/sessions?timeframe=all&model=claude-sonnet-4.6`);
    await sessionsReady(page);
    const before = page.url();
    await context.setOffline(true);
    await page.getByRole("button", { name: "Refresh data", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Usage could not be refreshed");
    await context.setOffline(false);
    await page.getByRole("button", { name: "Retry refresh", exact: true }).click();
    await sessionsReady(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh data", exact: true })).toBeEnabled();
    assert.equal(page.url(), before);
  });

  assert.equal(forbiddenRequests, 0);
  console.log(JSON.stringify({ synthetic: true, scenarios: completed, forbiddenRequests }));
} finally {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
  await rm(fixture.directory, { recursive: true, force: true });
}
