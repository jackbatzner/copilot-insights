import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { chromium, expect } from "@playwright/test";
import { createGalleryFixture } from "./gallery-fixture.mjs";
import { assertCaptureSafe, captureRequestPolicy } from "./gallery-contract.mjs";
import { startServer } from "../server/index.mjs";
import { PRESENTATION_KEY } from "../ui/src/presentation-preference.js";

const fixture = createGalleryFixture();
let server, browser;
try {
  server = await startServer({ ...fixture, port: 0, uiDist: process.env.COPILOT_INSIGHTS_TEST_UI_DIST });
  const base = `http://127.0.0.1:${server.address().port}`;
  const snapshot = await (await fetch(`${base}/api/summary?timeframe=all`)).json();
  const handle = snapshot.sessions.find((session) => session.label === "Session 1").handle;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 }, colorScheme: "dark", serviceWorkers: "block",
  });
  let blocked = 0, detailReads = 0, selectedReads = 0;
  const errors = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (captureRequestPolicy(request.url(), request.method(), new Set([base])) !== "allow") {
      blocked++; return route.abort();
    }
    const url = new URL(request.url());
    if (url.pathname === `/api/sessions/${handle}`) detailReads++;
    if (url.pathname === "/api/sessions" && url.searchParams.has("model")) selectedReads++;
    if (url.pathname.startsWith("/api/")) {
      const response = await route.fetch({ maxRedirects: 0, timeout: 15_000 });
      assert.equal(response.status(), url.searchParams.get("model") === "invalid-model" ? 400 : 200);
      assertCaptureSafe(await response.text(), fixture.privateMarkers);
      return route.fulfill({ response });
    }
    return route.continue();
  });
  await context.routeWebSocket("**/*", (socket) => { blocked++; socket.close(); });
  await context.addInitScript(({ key, origin }) => {
    if (location.origin === origin) localStorage.setItem(key, "on");
  }, { key: PRESENTATION_KEY, origin: base });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", () => errors.push("Render error"));
  const capture = async (name) => {
    assertCaptureSafe(await page.content(), fixture.privateMarkers);
    await expect(page.locator(".local-content-preview,.local-content-text,pre")).toHaveCount(0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.argv[2]) {
      await mkdir(process.argv[2], { recursive: true });
      await page.screenshot({ path: join(process.argv[2], name + ".png"), fullPage: true });
    }
  };
  const filters = `timeframe=all&model=claude-sonnet-4.6&scope=subagent&day=${fixture.usageDays.child}`;
  await page.clock.install();
  await page.goto(`${base}/sessions/${handle}?${filters}`);
  const selected = page.getByRole("region", { name: "Matching usage totals" });
  await expect(selected.locator('[data-exact="31,000"]')).toHaveText("31K");
  const db = new Database(fixture.dbPath);
  try {
    db.prepare(`UPDATE assistant_usage_events SET input_tokens=input_tokens+1000
      WHERE session_id=? AND model='claude-sonnet-4.6' AND substr(created_at,1,10)=?`)
      .run(fixture.ids[0], fixture.usageDays.child);
    db.prepare("UPDATE sessions SET updated_at=? WHERE id=?").run(new Date().toISOString(), fixture.ids[0]);
  } finally { db.close(); }
  await page.clock.runFor(15_100);
  await expect.poll(() => detailReads).toBeGreaterThan(1);
  await expect(selected.locator('[data-exact="32,000"]')).toHaveText("32K");
  await expect(page.locator('[data-exact="63,800"]').first()).toHaveText("63.8K");
  assert.ok(selectedReads >= 2, "matching selection must reload with the fresh detail snapshot");
  await capture("live-selected-totals");
  await page.clock.resume();
  console.log("Verified active detail and matching totals refresh");

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/sessions/${handle}?timeframe=all&model=gpt-5-mini`);
    await expect(selected).toContainText("No recorded usage matches");
    const selector = page.getByRole("combobox", { name: "Model call model", exact: true });
    await expect(selector).toHaveValue("gpt-5-mini");
    await expect(selector.locator("option:checked")).toHaveText("Selected model (not recorded)");
    await expect(page.locator(".turn-explorer [role=status]")).toContainText("0 matching model calls");
    await expect(page.locator(".turn-list-row")).toHaveCount(0);
    await capture(`unavailable-model-${width}`);
    console.log(`Verified missing-model state at ${width}px`);
    await page.getByRole("button", { name: "Clear model call filters", exact: true }).click();
    await expect(page.locator(".turn-list-row")).not.toHaveCount(0);
    await expect(selector).toHaveValue("");
    console.log(`Verified explicit filter clear at ${width}px`);
  }
  await page.goto(`${base}/sessions/${handle}?timeframe=all&model=PRIVATE_QUERY_CANARY`);
  await expect(page.getByRole("combobox", { name: "Model call model", exact: true })).toHaveValue("invalid-model");
  await expect(page.locator(".turn-explorer [role=status]")).toContainText("0 matching model calls");
  assert.ok(!(await page.content()).includes("PRIVATE_QUERY_CANARY"));
  console.log("Verified invalid query is not echoed");
  assert.equal(blocked, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    matchingTotalsRefreshWithDetail: true, absentModelPreserved: true, explicitClearRestoresCalls: true,
    invalidModelNotEchoed: true, desktopAndMobile: true, detailReads, selectedReads, blockedRequests: blocked,
  }));
} finally {
  await browser?.close();
  if (server) await new Promise((done, reject) => {
    server.close((error) => error ? reject(error) : done()); server.closeAllConnections();
  });
  await rm(fixture.directory, { recursive: true, force: true });
}
