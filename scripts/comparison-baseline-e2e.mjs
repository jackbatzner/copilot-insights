import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createSyntheticFixture, PRIVACY_CANARY } from "./seed-mock-db.mjs";
import { startServer } from "../server/index.mjs";
import { BASELINE_KEY, SCENARIO_KEY } from "../ui/src/comparison-state.js";

const fixture = createSyntheticFixture();
let server, browser;
try {
  server = await startServer({ ...fixture, port: 0, uiDist: process.env.COPILOT_INSIGHTS_TEST_UI_DIST });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  const errors = [];
  let contentRequests = 0, externalRequests = 0, sessionRequests = 0;
  await page.route("**/content", async (route) => {
    contentRequests++;
    await route.fulfill({ json: { messages: [], contentNotRecorded: true } });
  });
  page.on("pageerror", () => errors.push("Render error"));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== base) externalRequests++;
    if (url.pathname === "/api/sessions") sessionRequests++;
  });
  await page.goto(`${base}/tokens/compare?timeframe=all`);
  await page.getByRole("button", { name: "What-if cost", exact: true }).click();
  await page.getByLabel("Baseline model", { exact: true }).selectOption("gpt-4.1");
  await page.getByLabel("Alternative 1", { exact: true }).selectOption("gpt-6-astra");
  await page.getByRole("button", { name: "Choose for trial: GPT-6 Astra", exact: true }).click();
  await page.getByLabel("Cache treatment").selectOption("cache-included");
  const trial = page.getByRole("complementary", { name: "Model trial" });
  await trial.getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
  await page.goBack();
  await expect(trial).toBeVisible();
  await expect(page.getByLabel("Baseline model", { exact: true })).toHaveValue("gpt-4.1");
  await expect(page.getByLabel("Cache treatment")).toHaveValue("cache-included");
  await page.reload();
  await expect(trial).toContainText("GPT-6 Astra");
  await expect(page.getByRole("button", { name: "What-if cost", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Save local baseline", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saved snapshot", exact: true })).toBeVisible();
  const stored = await page.evaluate((key) => localStorage.getItem(key), BASELINE_KEY);
  for (const marker of [PRIVACY_CANARY, ...fixture.ids, "estimatedUsd", "content", "path"]) assert.ok(!stored.includes(marker));
  assert.equal(JSON.parse(stored).scenario.trial, "gpt-6-astra");
  await page.getByRole("button", { name: "Find later sessions", exact: true }).click();
  await expect(page.getByText("No later recorded sessions found.", { exact: false })).toBeVisible();
  const afterFirstFind = sessionRequests;
  await page.getByRole("button", { name: "Find later sessions", exact: true }).click();
  await expect(page.getByText("No later recorded sessions found.", { exact: false })).toBeVisible();
  assert.equal(sessionRequests, afterFirstFind, "repeated find respects shared cache");
  await page.getByLabel("Usage model", { exact: true }).selectOption("gpt-5-mini");
  await expect(page.getByRole("button", { name: "Observed usage", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(trial).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Saved snapshot", exact: true })).toBeVisible();
  const summary = await (await fetch(`${base}/api/summary?timeframe=all`)).json();
  const eligible = summary.sessions.find((session) => session.metrics.totalTokens > 0);
  await page.route("**/api/sessions?*", async (route) => {
    const date = new Date().toISOString();
    await route.fulfill({ json: { sessions: [{ ...eligible, createdAt: date, updatedAt: date }], models: [], capabilities: {} } });
  });
  await page.getByRole("button", { name: "Check for newer sessions", exact: true }).click();
  await expect(page.getByRole("link", { name: "Compare later session 1", exact: true })).toBeVisible();
  assert.ok(sessionRequests > afterFirstFind, "explicit newer check requests metadata");
  await page.getByRole("link", { name: "Compare later session 1", exact: true }).click();
  const location = new URL(page.url());
  assert.equal(location.searchParams.get("session"), eligible.handle);
  assert.equal(location.searchParams.get("timeframe"), "all");
  for (const filter of ["model", "day", "scope", "source", "includeHidden"]) assert.equal(location.searchParams.has(filter), false);
  await expect(page.getByRole("region", { name: "Recorded baseline comparison" })).toBeVisible();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), BASELINE_KEY), stored);
  await expect(page.getByText(/Differences do not establish savings, quality/)).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`);
  }
  await page.getByRole("button", { name: "Replace local baseline", exact: true }).click();
  const replaced = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), BASELINE_KEY);
  assert.equal(replaced.selection.session, eligible.handle);
  await page.getByRole("button", { name: "Clear local baseline", exact: true }).click();
  await expect(page.getByText("Local baseline cleared.", { exact: true })).toBeVisible();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), BASELINE_KEY), null);

  await page.evaluate(({ baseline, scenario }) => {
    localStorage.setItem(baseline, '{"private":"CORRUPTED_PRIVATE_MARKER"}');
    sessionStorage.setItem(scenario, '{"private":"CORRUPTED_PRIVATE_MARKER"}');
  }, { baseline: BASELINE_KEY, scenario: SCENARIO_KEY });
  await page.reload();
  await expect(page.getByText(/Saved tab scenarios are invalid/)).toBeVisible();
  await expect(page.getByText(/The saved baseline is invalid/)).toBeVisible();
  assert.ok(!(await page.content()).includes("CORRUPTED_PRIVATE_MARKER"));
  await page.getByRole("button", { name: "Reset saved tab scenarios and retry", exact: true }).click();
  await expect(page.getByText(/Saved tab scenarios are invalid/)).toHaveCount(0);
  await page.getByRole("button", { name: "Replace local baseline", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saved snapshot", exact: true })).toBeVisible();

  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Synthetic quota", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, BASELINE_KEY);
  await page.getByRole("button", { name: "Replace local baseline", exact: true }).click();
  await expect(page.getByText(/Local storage is full/)).toBeVisible();
  await page.reload();
  await page.evaluate((keys) => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name) {
      if (keys.includes(name)) throw new DOMException("Synthetic denied", "SecurityError");
      return original.call(this, name);
    };
  }, [BASELINE_KEY, SCENARIO_KEY]);
  await page.getByRole("link", { name: "Back to session", exact: true }).click();
  await page.goBack();
  await expect(page.getByText(/Local baseline storage is unavailable/)).toBeVisible();
  await expect(page.getByText(/Tab scenario storage is unavailable or full/)).toBeVisible();
  await page.goto(`${base}/tokens/compare?timeframe=all&model=CORRUPTED_PRIVATE_MARKER`);
  await expect(page.getByRole("heading", { name: "Invalid comparison selection", exact: true })).toBeVisible();
  assert.ok(!(await page.content()).includes("CORRUPTED_PRIVATE_MARKER"));
  assert.equal(contentRequests, 0);
  assert.equal(externalRequests, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ exactSelectionRestoration: true, reloadAndBack: true, metricOnlyBaseline: true,
    explicitReplacementAndClear: true, noLaterEmptyState: true, cachedAndFreshChooser: true,
    clearedIncompatibleFilters: true, corruptionAndQuotaAndUnavailable: true, responsive: true, noContentRequests: true }));
} finally {
  await browser?.close();
  if (server) await new Promise((done) => { server.close(done); server.closeAllConnections(); });
  await rm(fixture.directory, { recursive: true, force: true });
}
