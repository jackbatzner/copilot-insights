import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { chromium, expect } from "@playwright/test";
import { createSyntheticFixture, PRIVACY_CANARY } from "./seed-mock-db.mjs";
import { startServer } from "../server/index.mjs";

export async function runTurnFlow({ uiDist = process.env.COPILOT_INSIGHTS_TEST_UI_DIST, outputDir } = {}) {
  const fixture = createSyntheticFixture();
  const stress = createSyntheticFixture();
  const stressDb = new Database(stress.dbPath);
  try {
    const insert = stressDb.prepare(`INSERT INTO assistant_usage_events
      (session_id, model, input_tokens, output_tokens, turn_index, created_at)
      VALUES (?, 'gpt-5.4', 1, 1, ?, '2026-09-16T12:00:00Z')`);
    for (let index = 0; index < 51; index++) insert.run(stress.ids[0], 100);
    for (let index = 3; index < 25; index++) insert.run(stress.ids[0], index);
  } finally {
    stressDb.close();
  }
  let server;
  let stressServer;
  let browser;
  const close = (value) => value && new Promise((done, reject) => {
    value.close((error) => error ? reject(error) : done());
    value.closeAllConnections();
  });
  const json = async (url) => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    server = await startServer({ ...fixture, uiDist, port: 0 });
    stressServer = await startServer({ ...stress, uiDist, port: 0 });
    const base = `http://127.0.0.1:${server.address().port}`;
    const stressBase = `http://127.0.0.1:${stressServer.address().port}`;
    const snapshot = await json(`${base}/api/summary?timeframe=all`);
    const primary = snapshot.sessions.find((session) => session.label === "Session 1");
    const detail = await json(`${base}/api/sessions/${primary.handle}`);
    assert.equal(detail.turnUsage.status, "available");
    assert.equal(detail.turnUsage.requestCount, 4);
    assert.equal(detail.turnUsage.assignedRequestCount, 3);
    assert.equal(detail.turnUsage.unassignedRequestCount, 1);
    assert.equal(detail.turnUsage.turnCount, 2);
    assert.equal(detail.turnUsage.metrics.totalTokens, primary.metrics.totalTokens);
    assert.equal(detail.turnUsage.turns.find((turn) => turn.turnIndex === 2).metrics.totalTokens, 51_000);
    assert.ok(snapshot.sessions.every((session) => !Object.hasOwn(session, "turnUsage")));
    const payload = JSON.stringify(detail);
    for (const value of [PRIVACY_CANARY, ...fixture.ids, "synthetic-child-a", "synthetic-unmatched-agent"]) {
      assert.ok(!payload.includes(value));
    }
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, colorScheme: "dark" });
    const errors = [];
    page.on("pageerror", () => errors.push("Render error"));
    await page.goto(`${base}/sessions/${primary.handle}?timeframe=30d`);
    const explorer = page.locator(".turn-explorer");
    await expect(page.getByRole("heading", { name: "Turns & model calls", exact: true })).toBeVisible();
    await expect(explorer).toContainText("4 recorded model calls");
    await expect(explorer.locator(".turn-list-row")).toHaveCount(3);
    await expect(page.getByRole("heading", { name: "Select a turn", exact: true })).toBeVisible();
    await expect(explorer.locator(".request-list-row")).toHaveCount(0);
    const turn = explorer.locator(".usage-turn");
    await page.getByRole("button", { name: "Inspect Turn 2", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(turn.locator(".request-list-row")).toHaveCount(2);
    const callSummary = turn.locator(".call-summary");
    await expect(callSummary).toHaveText("2 matching calls · 2 subagent");
    await expect(explorer.getByRole("region", { name: "Why these calls?", exact: true })).toHaveCount(0);
    await expect(turn.locator(".request-list-row").first()).toContainText("Ending: Content filter");
    await expect(turn.locator(".request-list-row").nth(1)).toContainText("Ending: Tools requested");
    await expect(turn.locator('.inspector-total [data-exact="51,000"]')).toHaveText("51K");
    if (outputDir) {
      await mkdir(outputDir, { recursive: true });
      await explorer.screenshot({ path: join(outputDir, "turn-summary-desktop.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      await explorer.screenshot({ path: join(outputDir, "turn-summary-mobile.png") });
      await page.setViewportSize({ width: 1440, height: 1050 });
    }
    const request = turn.locator(".usage-request").first();
    await turn.locator(".request-list-row").first().click();
    await expect(request).toContainText("Exact child linkage");
    await expect(request).toContainText("Recorded model");
    await expect(request).toContainText("SessionDB");
    await expect(request.getByRole("region", { name: "Call explanation" })).toContainText("Ending: Content filter");
    await expect(request).toContainText("parent LLM call that triggered the invocation is not identified");
    await expect(request).not.toContainText(PRIVACY_CANARY);
    await expect(request.getByRole("heading", { name: /^Model call / })).toBeFocused();
    await request.getByRole("button", { name: "Back to turn", exact: true }).click();
    await expect(turn.locator(".request-list-row").first()).toBeFocused();
    await turn.locator(".request-list-row").nth(1).click();
    await expect(request.getByRole("region", { name: "Call explanation" })).toContainText("Ending: Tools requested");
    await expect(request).toContainText("specific tools and next call are not linked");
    await request.getByRole("button", { name: "Back to turn", exact: true }).click();
    await expect(turn.locator(".request-list-row").nth(1)).toBeFocused();
    await turn.locator(".request-list-row").first().click();
    assert.ok(await page.locator(".turn-inspector").evaluate((element) =>
      element.getBoundingClientRect().left > document.querySelector(".turn-list").getBoundingClientRect().right));
    if (outputDir) {
      await explorer.screenshot({ path: join(outputDir, "turn-requests-desktop.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      await explorer.screenshot({ path: join(outputDir, "turn-requests-mobile.png") });
      await page.setViewportSize({ width: 1440, height: 1050 });
    }
    await request.getByRole("link", { name: /Inspect .* attribution/ }).click();
    const attribution = page.locator(".attribution-group").filter({ hasText: "Exact child linkage" });
    await expect(attribution).toHaveAttribute("open", "");
    await expect(attribution.locator(":scope > summary")).toBeFocused();
    await attribution.getByRole("button", { name: "Return to model call or tool link" }).click();
    await expect(request.getByRole("link", { name: /Inspect .* attribution/ })).toBeFocused();

    await explorer.getByRole("combobox", { name: "Model call scope", exact: true }).selectOption("subagent");
    await explorer.getByLabel("Model call UTC day", { exact: true }).fill(fixture.usageDays.child);
    await expect(explorer.getByRole("status")).toContainText("1 matching model call in 1 group");
    await explorer.locator(".turn-list-row").click();
    await expect(explorer.locator(".request-list-row")).toHaveCount(1);
    await expect(callSummary).toHaveText("1 matching call · 1 subagent");
    await expect(explorer.locator('.request-list-row [data-exact="31,000"]')).toHaveText("31K");
    await expect(explorer.locator('.turn-list-row [data-exact="51,000"]')).toHaveText("51K");
    await expect(explorer.locator('.turn-list-row .matching-total [data-exact="31,000"]')).toHaveText("31K");
    await explorer.getByRole("combobox", { name: "Model call model", exact: true }).selectOption("gpt-5.4");
    await expect(explorer).toContainText("No model calls match these filters.");
    await explorer.getByRole("button", { name: "Clear model call filters", exact: true }).click();
    await explorer.getByRole("combobox", { name: "Turn assignment", exact: true }).selectOption("unassigned");
    await expect(explorer.locator(".turn-list-row")).toHaveCount(1);
    await expect(explorer.locator(".turn-list-row")).toContainText("Unassigned");
    await explorer.locator(".turn-list-row").click();
    await expect(callSummary).toHaveText("1 matching call · 1 unattributed");
    await explorer.locator(".request-list-row").click();
    await expect(explorer).toContainText("800 tokens");
    await expect(explorer).not.toContainText("Exact child linkage");
    await explorer.getByRole("button", { name: "Clear model call filters", exact: true }).click();
    await explorer.getByRole("combobox", { name: "Turn order", exact: true }).selectOption("tokens");
    await expect(explorer.locator(".turn-list-row").first()).toContainText("Turn 2");

    const filters = new URLSearchParams({ timeframe: "30d", model: "claude-sonnet-4.6", scope: "subagent", day: fixture.usageDays.child, page: "2" });
    await page.goto(`${base}/sessions/${primary.handle}?${filters}`);
    await expect(page.locator(".turn-explorer").getByRole("status")).toContainText("1 matching model call in 1 group");
    await expect(page.getByRole("region", { name: "Matching usage totals" }).locator('[data-exact="31,000"]')).toHaveText("31K");
    await page.getByRole("link", { name: "Back to Sessions" }).click();
    for (const [key, value] of filters) assert.equal(new URL(page.url()).searchParams.get(key), value);
    for (const [label, status] of [["Session 7", "aggregate-only"], ["Session 8", "aggregate-only"], ["Session 4", "unavailable"], ["Session 5", "unavailable"]]) {
      const session = snapshot.sessions.find((value) => value.label === label);
      const unavailable = await json(`${base}/api/sessions/${session.handle}`);
      assert.equal(unavailable.turnUsage.status, status);
      assert.equal(unavailable.turnUsage.turns.length, 0);
      await page.goto(`${base}/sessions/${session.handle}`);
      await expect(page.locator(".turn-explorer").getByRole("note")).toBeVisible();
      await expect(page.locator(".usage-request")).toHaveCount(0);
      await expect(page.locator(".usage-turn")).toHaveCount(0);
    }
    const stressSnapshot = await json(`${stressBase}/api/summary?timeframe=all`);
    const stressSession = stressSnapshot.sessions.find((value) => value.label === "Session 1");
    const previewTurns = new Set();
    page.on("request", (request) => {
      if (request.url() === `${stressBase}/api/sessions/${stressSession.handle}/content`) {
        const body = request.postDataJSON();
        if (body.kind === "turn") previewTurns.add(body.turnIndex);
      }
    });
    await page.goto(`${stressBase}/sessions/${stressSession.handle}`);
    const stressExplorer = page.locator(".turn-explorer");
    await expect(stressExplorer.locator(".turn-list-row")).toHaveCount(20);
    await expect.poll(() => previewTurns.size).toBe(20);
    assert.ok(!previewTurns.has(100));
    await stressExplorer.getByRole("button", { name: "Next turns", exact: true }).click();
    await expect.poll(() => previewTurns.size).toBe(25);
    const many = stressExplorer.locator(".usage-turn");
    await page.getByRole("button", { name: "Inspect Turn 100", exact: true }).click();
    await expect(many.locator(".request-list-row")).toHaveCount(25);
    await expect(many.locator(".call-summary")).toHaveText("51 matching calls · 51 primary");
    await many.getByRole("button", { name: "Next model calls", exact: true }).click();
    await expect(many.locator(".request-list-row")).toHaveCount(25);
    await many.getByRole("button", { name: "Next model calls", exact: true }).click();
    await expect(many.locator(".request-list-row")).toHaveCount(1);
    await expect(many.locator(".call-summary")).toHaveText("51 matching calls · 51 primary");
    await expect(many.getByRole("button", { name: "Next model calls", exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await many.locator(".request-list-row").click();
    await expect(many.getByRole("region", { name: "Call explanation" })).toContainText("Ending: Ending unknown");
    await expect(many).toContainText("No recognized call-ending marker");
    await expect(stressExplorer.locator(".turn-list")).toBeHidden();
    await expect(stressExplorer.locator(".turn-inspector")).toBeVisible();
    await many.getByRole("button", { name: "Back to turn", exact: true }).click();
    await expect(many.locator(".request-list-row")).toHaveCount(1);
    await many.getByRole("button", { name: "Back to turns", exact: true }).click();
    await expect(page.getByRole("button", { name: "Inspect Turn 100", exact: true })).toBeFocused();
    await expect(stressExplorer.locator(".turn-inspector")).toBeHidden();
    await page.getByRole("button", { name: "Inspect Turn 100", exact: true }).click();
    await expect(many.locator(".request-list-row")).toHaveCount(1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Close menu", exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const rendered = await page.evaluate(() => {
      const copy = document.documentElement.cloneNode(true);
      copy.querySelectorAll(".local-content-preview, .local-content-panel").forEach((node) => node.remove());
      return copy.outerHTML;
    });
    for (const value of [PRIVACY_CANARY, ...stress.ids]) assert.ok(!rendered.includes(value));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ turnExplorer: "passed", browser: "msedge", reconciliation: true, requestFilters: true,
      pagination: true, noContentOrRawIds: true, splitInspector: true, callBackFocus: true, mobileBackFocus: true,
      selectionAndPagePreserved: true, callEndings: true, unknownTriggersExplicit: true, breakdownAcrossPages: true }));
    return { screenshots: outputDir ? ["turn-summary-desktop.png", "turn-summary-mobile.png", "turn-requests-desktop.png", "turn-requests-mobile.png"].map((name) => join(outputDir, name)) : [] };
  } finally {
    await browser?.close();
    await close(server);
    await close(stressServer);
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(stress.directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runTurnFlow({ outputDir: process.argv[2] });
}
