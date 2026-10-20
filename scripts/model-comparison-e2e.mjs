import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createSyntheticFixture, PRIVACY_CANARY } from "./seed-mock-db.mjs";
import { startServer } from "../server/index.mjs";
import { COPILOT_MODEL_CATALOG, selectableCopilotModels } from "../src/copilot-model-catalog.mjs";

const fixture = createSyntheticFixture();
let server, browser;
try {
  server = await startServer({ ...fixture, port: 0, uiDist: process.env.COPILOT_INSIGHTS_TEST_UI_DIST });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  await page.clock.setFixedTime(new Date("2026-10-15T12:00:00Z"));
  let comparisons = 0, externalRequests = 0;
  const errors = [];
  await page.route("**/content", (route) => route.fulfill({ json: { messages: [], contentNotRecorded: true } }));
  page.on("pageerror", () => errors.push("Render error"));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/comparison") comparisons++;
    if (url.protocol.startsWith("http") && url.origin !== base) externalRequests++;
  });
  await page.goto(`${base}/tokens?timeframe=all`);
  await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Compare models", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Models you actually used" })).toBeVisible();
  assert.equal(comparisons, 0, "comparison should reuse the loaded Token Usage snapshot");
  const observed = page.getByRole("region", { name: "Observed model comparison" });
  await expect(observed.getByRole("columnheader", { name: "Model calls", exact: true })).toBeVisible();
  await expect(observed.getByRole("columnheader", { name: "First-token latency", exact: true })).toBeVisible();
  const gpt41 = observed.getByRole("row").filter({ has: page.getByRole("link", { name: "gpt-4.1", exact: true }) });
  const cost = gpt41.locator('[data-exact="$0.0056"]');
  await expect(cost).toHaveText("<$0.01");
  await cost.focus();
  await expect(page.getByRole("tooltip")).toContainText("Input $0.004; output $0.0016");
  await expect(page.getByRole("tooltip")).toContainText("Checked 2026-09-16");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(observed.getByRole("row").filter({ hasText: "Unknown model" }).getByLabel("Pricing unavailable", { exact: true })).toBeVisible();
  await expect(observed.getByRole("row").filter({ has: page.getByRole("link", { name: "gpt-5-mini", exact: true }) })).toContainText("Partial coverage");
  await page.getByRole("button", { name: "What-if cost", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Same usage, different model prices" })).toBeVisible();
  await page.getByLabel("Baseline model", { exact: true }).selectOption("gpt-4.1");
  await page.getByLabel("Alternative 1", { exact: true }).selectOption("");
  await page.getByLabel("Alternative 2", { exact: true }).selectOption("");
  const optionValues = await page.getByLabel("Alternative 1", { exact: true }).locator("option").evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
  assert.deepEqual(optionValues, selectableCopilotModels("2026-10-15").map((entry) => entry.key));
  assert.ok(!optionValues.includes("gpt-4.1") && !optionValues.includes("gpt-5.4-nano"));
  await expect(page.getByLabel("Baseline model", { exact: true }).locator('option[value="gpt-4.1"]')).toHaveText("gpt-4.1 (historical / not listed for CLI)");
  await expect(page.getByRole("link", { name: "published Copilot CLI model list" })).toHaveAttribute("href", COPILOT_MODEL_CATALOG.source);
  await expect(page.getByText(/this is not a check of your account/)).toBeVisible();
  await page.getByLabel("Alternative 1", { exact: true }).selectOption("gpt-5.4");
  await page.getByLabel("Alternative 2", { exact: true }).selectOption("gpt-5-mini");
  const scenarios = page.getByRole("region", { name: "What-if model comparison" });
  await expect(scenarios.locator('[data-exact="$0.19316"]').first()).toBeVisible();
  await expect(scenarios.locator('[data-exact="$0.028865"]').first()).toBeVisible();
  await expect(page.locator(".comparison-basis")).toContainText("9 of 11");
  await page.getByRole("button", { name: "Choose for trial: GPT-5 mini", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Model trial" })).toContainText("Choose the model manually in Copilot");
  await page.getByRole("button", { name: "Observed usage", exact: true }).click();
  await page.getByRole("button", { name: "What-if cost", exact: true }).click();
  await expect(page.getByLabel("Baseline model", { exact: true })).toHaveValue("gpt-4.1");
  await expect(page.getByRole("complementary", { name: "Model trial" })).toBeVisible();
  await page.getByLabel("Cache treatment").selectOption("cache-included");
  await expect(page.locator(".comparison-basis")).toContainText("7 of 11");
  await expect(scenarios.locator('[data-exact="$0.10746"]').first()).toBeVisible();
  await page.getByLabel("Cache treatment").selectOption("cache-excluded");
  await expect(scenarios.locator('[data-exact="$0.20546"]').first()).toBeVisible();
  await page.getByLabel("Cache treatment").selectOption("uncached");

  await page.getByLabel("Alternative 1", { exact: true }).selectOption("gpt-6-astra");
  await expect(scenarios.getByRole("row").filter({ hasText: "GPT-6 Astra" }).getByLabel("Pricing unavailable", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Choose for trial: GPT-6 Astra", exact: true }).click();
  const trial = page.getByRole("complementary", { name: "Model trial" });
  await expect(trial).toContainText("without a savings estimate");
  await expect(trial.getByRole("link")).toHaveAttribute("href", /model=gpt-6-astra/);
  await page.getByLabel("Alternative 1", { exact: true }).selectOption("listing:fable-5");
  await expect(page.getByText(/Fable models retain prompts and outputs by default/)).toBeVisible();
  await page.getByRole("button", { name: "Choose for trial: Claude Fable 5", exact: true }).click();
  await expect(trial).toContainText("usage identifier is not verified");
  const listingLink = new URL(await trial.getByRole("link", { name: "Browse recorded sessions" }).getAttribute("href"), base);
  assert.equal(listingLink.searchParams.has("model"), false, "unverified listing must not become a model filter");
  for (const entry of selectableCopilotModels("2026-10-15").filter((entry) => entry.model === null)) {
    await page.getByLabel("Alternative 1", { exact: true }).selectOption(entry.key);
    await page.getByRole("button", { name: `Choose for trial: ${entry.label}`, exact: true }).click();
    await expect(trial).toContainText("usage identifier is not verified");
    assert.equal(new URL(await trial.getByRole("link").getAttribute("href"), base).searchParams.has("model"), false);
  }
  for (const entry of selectableCopilotModels("2026-10-15").filter((entry) => entry.identifierSource)) {
    await page.getByLabel("Alternative 1", { exact: true }).selectOption(entry.key);
    await page.getByRole("button", { name: `Choose for trial: ${entry.label}`, exact: true }).click();
    const filteredLink = new URL(await trial.getByRole("link").getAttribute("href"), base);
    assert.equal(filteredLink.searchParams.get("model"), entry.model);
  }
  await page.getByLabel("Alternative 1", { exact: true }).selectOption("claude-sonnet-4.6");
  await expect(page.getByText(/only to individual subscribers on annual Copilot Pro or Pro\+ plans/)).toBeVisible();
  await page.getByLabel("Alternative 1", { exact: true }).selectOption("gpt-6-astra");
  await page.getByRole("button", { name: "Choose for trial: GPT-6 Astra", exact: true }).click();

  if (process.argv[2]) await mkdir(process.argv[2], { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const [name, slug] of [["What-if cost", "what-if"], ["Observed usage", "observed"]]) {
      await page.getByRole("button", { name, exact: true }).click();
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`);
      if (process.argv[2]) await page.screenshot({ path: join(process.argv[2], `comparison-${slug}-${width}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Usage model", { exact: true }).selectOption("gpt-5.4-mini");
  await page.getByRole("button", { name: "What-if cost", exact: true }).click();
  await expect(page.getByText("The baseline cannot be priced for this selection.", { exact: false })).toBeVisible();
  await expect(page.locator(".comparison-basis")).toContainText("0 of 1");
  await expect(page.locator(".comparison-basis")).toContainText("Not recorded");
  await expect(scenarios.getByLabel("No complete eligible usage", { exact: true }).first()).toBeVisible();
  assert.equal(await scenarios.locator('[data-exact="$0.00"]').count(), 0);

  const snapshot = await (await fetch(`${base}/api/summary?timeframe=all`)).json();
  const session = snapshot.sessions.find((row) => row.label === "Session 1");
  await page.goto(`${base}/sessions/${session.handle}?timeframe=all`);
  await expect(page.getByRole("heading", { name: "Whole-session totals (all models)", exact: true })).toBeVisible();
  const beforeDetailComparison = comparisons;
  await page.getByRole("link", { name: "Compare models for this session", exact: true }).click();
  await expect(page.locator(".comparison-context")).toContainText("Session 1");
  await expect(page.getByRole("heading", { name: "Models you actually used" })).toBeVisible();
  assert.equal(comparisons, beforeDetailComparison, "whole-session comparison should reuse loaded detail metadata");
  await page.getByRole("link", { name: "Back to session", exact: true }).click();
  await page.getByRole("link", { name: "Back to Sessions" }).click();
  await page.getByLabel("Model", { exact: true }).selectOption("claude-sonnet-4.6");
  await page.getByLabel("Scope", { exact: true }).selectOption("subagent");
  await page.getByLabel("UTC day", { exact: true }).fill(fixture.usageDays.child);
  await expect(page.getByRole("status")).toContainText("2 matching sessions");
  await page.getByRole("link", { name: "Compare models in this selection", exact: true }).click();
  await expect(page.locator(".comparison-context")).toContainText("2 selected sessions");
  await expect(observed.locator('[data-exact="39,500"]').first()).toHaveText("39.5K");
  await expect(observed.locator('[data-exact="$0.1365"]').first()).toBeVisible();
  assert.ok(!(await page.content()).includes(PRIVACY_CANARY));
  await page.clock.setFixedTime(new Date("2026-10-19T12:00:00Z"));
  await page.goto(`${base}/tokens/compare?timeframe=all`);
  await page.getByRole("button", { name: "What-if cost", exact: true }).click();
  await expect(page.getByText("A selected alternative reached its published retirement date. Choose another model.")).toBeVisible();
  await expect(page.getByLabel("Alternative 2", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Alternative 2", { exact: true }).locator('option[value="gpt-5-mini"]')).toHaveCount(0);
  await page.getByLabel("Baseline model", { exact: true }).selectOption("gpt-5.4");
  await expect(scenarios.getByRole("row").filter({ hasText: "GPT-5.4" })).toContainText("Historical / not listed for CLI");
  await expect(page.getByLabel("Alternative 1", { exact: true }).locator('option[value="grok-4.5"]')).toHaveCount(0);
  const payload = await (await fetch(`${base}/api/comparison?timeframe=all`)).text();
  for (const marker of [PRIVACY_CANARY, ...fixture.ids]) assert.ok(!payload.includes(marker));
  await page.goto(`${base}/tokens/compare?timeframe=all&source=vscode`);
  await expect(page.getByRole("heading", { name: "No comparable usage in this selection" })).toBeVisible();
  assert.equal(await page.getByRole("button", { name: "What-if cost", exact: true }).count(), 0);
  assert.equal(externalRequests, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ observedUsage: true, sameWorkloadEstimates: true, sourceCoverage: true,
    explicitCacheAssumptions: true, preciseCostDisclosure: true, localTrialAction: true,
    copilotAvailability: true, unpricedTrials: true, historicalBaselines: true, scheduledRetirements: true, policyCaveats: true, noGuessedIdentifiers: true,
    cachedEntryPoints: true, combinedFilters: true, emptyAndPartialStates: true, offlineAndPrivate: true, responsive: true }));
} finally {
  await browser?.close();
  if (server) await new Promise((done) => { server.close(done); server.closeAllConnections(); });
  await rm(fixture.directory, { recursive: true, force: true });
}
