#!/usr/bin/env node
// Focused executable flow, deliberately outside the Node unit-test glob.
import { chromium, expect } from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createSyntheticFixture, PRIVACY_CANARY } from "./seed-mock-db.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function waitForReady(baseUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/summary?timeframe=all`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        const data = await response.json();
        if (data.metrics && Array.isArray(data.sessions)) return data;
      }
    } catch {
      // Bounded readiness retry; a failure is surfaced below.
    }
    await delay(200);
  }
  throw new Error("The isolated synthetic backend did not become ready within 30 seconds.");
}

async function verifyExplorationApi(baseUrl, snapshot, fixture) {
  const trend = snapshot.exploration.trend;
  expect(trend.basis).toBe("sessiondb-request-timestamp");
  expect(trend.windowDays).toBe(90);
  expect(trend.days.find((bucket) => bucket.day === fixture.usageDays.child).metrics.totalTokens).toBe(39_500);
  expect(trend.days.find((bucket) => bucket.day === fixture.usageDays.child).metrics.requests).toBe(2);
  expect(trend.undatedRequests).toBe(1);
  expect(trend.excludedAggregateSessions).toBe(2);
  const query = new URLSearchParams({
    timeframe: "30d", model: "claude-sonnet-4.6", scope: "subagent", day: fixture.usageDays.child,
  });
  const response = await fetch(`${baseUrl}/api/sessions?${query}`);
  expect(response.status).toBe(200);
  const filtered = await response.json();
  expect(filtered.sessions).toHaveLength(2);
  const primary = filtered.sessions.find((session) => session.label === "Session 1");
  expect(primary.selectedUsage.totalTokens).toBe(31_000);
  expect(primary.metrics.totalTokens).toBe(62_800);
  expect(primary.performance.childTokens).toBe(51_000);
  query.set("day", fixture.usageDays.recent);
  query.set("scope", "primary");
  const unmatched = await (await fetch(`${baseUrl}/api/sessions?${query}`)).json();
  expect(unmatched.sessions).toHaveLength(0);
  for (const payload of [snapshot, filtered, unmatched]) {
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(PRIVACY_CANARY);
    for (const id of fixture.ids) expect(serialized).not.toContain(id);
  }
}

async function verifyExplorationNavigation(page, baseUrl, fixture) {
  for (const name of ["Daily usage", "Model share", "Usage by scope", "Usage insights", "Sessions to inspect"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  const dayLink = page.locator(`a[href*="day=${fixture.usageDays.child}"]`).first();
  await expect(dayLink).toBeVisible();
  await dayLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`day=${fixture.usageDays.child}`));
  await expect(page.getByRole("status")).toContainText(/^2 matching sessions\b/);
  const filters = new URLSearchParams({
    timeframe: "30d", day: fixture.usageDays.child, scope: "subagent", model: "claude-sonnet-4.6",
  });
  await page.goto(`${baseUrl}/sessions?${filters}`);
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "Session 1", exact: true }) });
  await expect(row.locator('[data-exact="31,000"]').first()).toHaveText("31K");
  await expect(row.locator('[data-exact="62,800"]').first()).toHaveText("62.8K");
  await row.getByRole("link", { name: "Session 1", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Turns & model calls", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to Sessions" }).click();
  for (const [key, value] of filters) expect(new URL(page.url()).searchParams.get(key)).toBe(value);
  filters.set("scope", "primary");
  await page.goto(`${baseUrl}/sessions?${filters}`);
  await expect(page.getByRole("heading", { name: "No sessions match these filters" })).toBeVisible();
  await page.goto(`${baseUrl}/?timeframe=30d`);
  const childLink = page.locator('a[href*="scope=subagent"]').first();
  await expect(childLink).toBeVisible();
  await childLink.click();
  await expect(page).toHaveURL(/scope=subagent/);
  await expect(page.getByRole("status")).toContainText(/^2 matching sessions\b/);
  await page.goto(`${baseUrl}/?timeframe=30d`);
  await expect(page.getByRole("heading", { name: "Recorded local usage", exact: true })).toBeVisible();
}

export async function runUsageFlow({ capture = false, outputDir, uiDist = process.env.COPILOT_INSIGHTS_TEST_UI_DIST } = {}) {
  if (outputDir) {
    const path = relative(ROOT, resolve(outputDir));
    if (!path || (!path.startsWith("..") && !isAbsolute(path))) {
      throw new Error("Capture output must be outside the repository. The coordinator owns documentation assets.");
    }
  }
  const fixture = createSyntheticFixture();
  const emptyFixture = createSyntheticFixture({ empty: true });
  const largeFixture = createSyntheticFixture({ extraSessions: 30 });
  const aggregateFixture = createSyntheticFixture({ withoutExactUsage: true });
  const privateIds = [...new Set([...fixture.ids, ...largeFixture.ids, ...aggregateFixture.ids])];
  const screenshots = capture ? resolve(outputDir || await mkdtemp(join(tmpdir(), "copilot-insights-captures-"))) : null;
  if (screenshots) {
    await mkdir(screenshots, { recursive: true });
    console.log(`Synthetic capture directory: ${screenshots}`);
  }
  let server;
  let emptyServer;
  let unavailableServer;
  let largeServer;
  let aggregateServer;
  let browser;
  const pageErrors = [];
  const captured = [];
  const closeServer = (instance) => instance && new Promise((done, reject) => {
    instance.close((error) => error ? reject(error) : done());
    instance.closeAllConnections();
  });
  try {
    const { startServer } = await import("../server/index.mjs");
    // Explicit source paths, app state, and OS-assigned loopback ports never touch user data.
    server = await startServer({ ...fixture, uiDist, port: 0 });
    emptyServer = await startServer({ ...emptyFixture, uiDist, port: 0 });
    largeServer = await startServer({ ...largeFixture, uiDist, port: 0 });
    aggregateServer = await startServer({ ...aggregateFixture, uiDist, port: 0 });
    unavailableServer = await startServer({
      dbPath: join(emptyFixture.directory, "absent.db"),
      sessionStatePath: join(emptyFixture.directory, "absent-state"),
      stateDir: join(emptyFixture.directory, "unavailable-app-state"), uiDist, port: 0,
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const emptyUrl = `http://127.0.0.1:${emptyServer.address().port}`;
    const unavailableUrl = `http://127.0.0.1:${unavailableServer.address().port}`;
    const largeUrl = `http://127.0.0.1:${largeServer.address().port}`;
    const aggregateUrl = `http://127.0.0.1:${aggregateServer.address().port}`;
    const snapshot = await waitForReady(baseUrl);
    await waitForReady(emptyUrl);
    await waitForReady(unavailableUrl);
    expect(snapshot.sessions).toHaveLength(8);
    expect(JSON.stringify(snapshot)).not.toContain(PRIVACY_CANARY);
    const primary = snapshot.sessions.find((session) => session.label === "Session 1");
    expect(primary.metrics.totalTokens).toBe(62_800);
    expect(primary.metrics.totalNanoAiu).toBe(123_456_789);
    expect(primary.metrics.localCredits).toBeNull();
    await verifyExplorationApi(baseUrl, snapshot, fixture);
    const matched = await (await fetch(`${baseUrl}/api/sessions?timeframe=30d&model=claude-sonnet-4.6`)).json();
    expect(matched.sessions).toHaveLength(3);
    expect(matched.sessions.find((session) => session.handle === primary.handle).selectedUsage.totalTokens).toBe(51_800);
    const detail = await (await fetch(`${baseUrl}/api/sessions/${primary.handle}`)).json();
    for (const payload of [snapshot, matched, detail]) {
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain(PRIVACY_CANARY);
      for (const id of fixture.ids) expect(serialized).not.toContain(id);
    }

    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
    const page = await context.newPage();
    await page.clock.install();
    page.on("pageerror", () => pageErrors.push("Unexpected browser error"));
    let activeRequests = 0;
    page.on("request", (request) => {
      if (request.url() === `${baseUrl}/api/sessions/${primary.handle}?view=summary`) activeRequests += 1;
    });
    const assertPrivate = async () => {
      const html = await page.evaluate(() => {
        const copy = document.documentElement.cloneNode(true);
        copy.querySelectorAll(".local-content-preview, .local-content-panel").forEach((node) => node.remove());
        return copy.outerHTML;
      });
      expect(html).not.toContain(PRIVACY_CANARY);
      for (const id of privateIds) {
        expect(html).not.toContain(id);
        expect(page.url()).not.toContain(id);
      }
      const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
      expect(storage).not.toContain(PRIVACY_CANARY);
      expect(await page.locator("#main-navigation a").allTextContents())
        .toEqual(["◈Overview", "▤Sessions", "◷Token Usage", "⚙Settings"]);
    };
    const shot = async (name, region) => {
      await assertPrivate();
      if (screenshots) {
        await page.evaluate(() => {
          document.activeElement?.blur();
          window.scrollTo(0, 0);
        });
        const path = join(screenshots, `${name}.png`);
        if (region) await region.screenshot({ path });
        else await page.screenshot({ path, fullPage: true });
        captured.push(path);
      }
    };
    await page.goto(`${baseUrl}/?timeframe=30d`);
    await expect(page.getByRole("heading", { name: "Recorded local usage" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Last 30 days" })).toBeChecked();
    await expect(page.locator(".metric dt").filter({ hasText: /^Local credits\b/ })).toHaveCount(0);
    await expect(page.getByText("Only available measurements are shown;", { exact: false })).toHaveCount(1);
    await expect(page.locator(".metric dd").filter({ hasText: /^Not recorded$/ })).toHaveCount(0);
    await shot("overview");
    await verifyExplorationNavigation(page, baseUrl, fixture);
    await page.getByRole("link", { name: "Explore Token Usage" }).click();
    await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible();
    const performanceEntry = page.locator('a[href$="#performance"]').first();
    await expect(performanceEntry).toBeInViewport();
    await performanceEntry.click();
    await expect(page).toHaveURL(/#performance$/);
    await expect(page.getByRole("heading", { name: "Agent & Skill Performance", exact: true })).toBeInViewport();
    await page.goto(`${baseUrl}/tokens?timeframe=30d`);
    await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible();
    await shot("token-usage");
    await shot("token-models", page.locator("section[aria-labelledby='models-heading']"));
    await page.getByRole("link", { name: "claude-sonnet-4.6", exact: true }).click();
    await expect(page).toHaveURL(/\/sessions\?.*model=claude-sonnet-4.6/);
    await expect(page.getByRole("combobox", { name: "Model", exact: true })).toHaveValue("claude-sonnet-4.6");
    await expect(page.getByRole("status")).toContainText(/^3 matching sessions\b/);
    const mixed = page.getByRole("row").filter({ has: page.getByRole("link", { name: "Session 1", exact: true }) });
    await expect(mixed.locator('[data-exact="51,800"]').first()).toHaveText("51.8K");
    await expect(mixed.locator('[data-exact="62,800"]').first()).toHaveText("62.8K");
    await shot("sessions");
    await page.getByRole("link", { name: "Session 1", exact: true }).click();
    await page.getByRole("button", { name: "Agents & models", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Usage attribution" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Whole-session totals (all models)", exact: true })).toBeVisible();
    await expect(page.getByText("Selected model: claude-sonnet-4.6", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/sessions/${primary.handle}\\?`));
    const child = page.locator(".attribution-group").filter({ hasText: "Exact child linkage" });
    await child.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await expect(child).toHaveAttribute("open", "");
    const childModel = child.locator(".model-attribution").first();
    await childModel.locator(":scope > summary").click();
    await expect(childModel.locator('[data-exact="51,000"]').first()).toHaveText("51K");
    await expect(childModel).toContainText("Selected model");
    await expect(childModel).toContainText("1 / 2 observations");
    await expect(childModel.locator(".advanced-metrics")).not.toHaveAttribute("open");
    await childModel.locator(".advanced-metrics > summary").click();
    const metric = (label) => childModel.locator(".metric").filter({ has: page.locator("dt", { hasText: label }) });
    await expect(metric("Mean request multiplier").locator("dd")).toHaveText("1.5×");
    await expect(metric("Output first-token latency").locator("dd")).toHaveText("500 ms");
    await expect(metric("Output first-token latency")).toContainText("1 / 2 observations");
    await expect(metric("Mean inter-token latency").locator("dd")).toHaveText("20 ms");
    await expect(metric("Content-filtered requests").locator("dd")).toHaveText("1");
    await expect(page.getByText("Independent session-level invocation counts.", { exact: false })).toBeVisible();
    await expect(page.getByLabel("Session diagnostic")).toContainText("Recorded open lifecycle");
    await expect(page.getByLabel("Session diagnostic")).toContainText("Not verified live; history may be incomplete.");
    const coaching = page.locator(".coaching");
    await expect(coaching).not.toHaveAttribute("open");
    await coaching.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(coaching).toHaveAttribute("open", "");
    await expect(coaching).toContainText("Compare afterward");
    await expect(coaching).toContainText("does not write Copilot configuration");
    await shot("session-detail");
    const beforePoll = activeRequests;
    await page.clock.fastForward(16_000);
    await expect.poll(() => activeRequests).toBeGreaterThan(beforePoll);
    await page.getByRole("button", { name: "Hide session", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unhide session", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to Sessions" }).click();
    await expect(page.getByRole("status")).toContainText(/^2 matching sessions\b/);
    const afterNavigation = activeRequests;
    await page.clock.fastForward(31_000);
    expect(activeRequests).toBe(afterNavigation);
    await expect(page.getByRole("radio", { name: "Last 30 days" })).toBeChecked();
    await page.getByRole("checkbox", { name: "Include hidden" }).click();
    await expect(page.getByRole("checkbox", { name: "Include hidden" })).toBeChecked();
    await page.getByRole("combobox", { name: "Source", exact: true }).selectOption("cli");
    await page.getByRole("link", { name: "Token Usage", exact: true }).click();
    await page.getByRole("link", { name: "claude-sonnet-4.6", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Source", exact: true })).toHaveValue("cli");
    await expect(page.getByRole("checkbox", { name: "Include hidden" })).toBeChecked();
    await expect(page.getByRole("status")).toContainText(/^3 matching sessions\b/);
    await page.getByRole("link", { name: "Session 1", exact: true }).click();
    await page.getByRole("button", { name: "Unhide session", exact: true }).click();
    await expect(page.getByRole("button", { name: "Hide session", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("combobox", { name: "Model", exact: true })).toHaveValue("claude-sonnet-4.6");
    await expect(page.getByRole("checkbox", { name: "Include hidden" })).toBeChecked();
    await page.getByRole("button", { name: "Clear model filter" }).click();
    await page.getByRole("combobox", { name: "Model", exact: true }).selectOption("gpt-5-mini");
    await expect(page.getByRole("status")).toContainText(/^2 matching sessions\b/);
    await page.getByRole("link", { name: "Session 4", exact: true }).click();
    await page.getByRole("button", { name: "Agents & models", exact: true }).click();
    await expect(page.getByLabel("Session diagnostic")).toContainText("Recorded closed lifecycle");
    const unattributed = page.locator(".attribution-group").filter({ hasText: "No exact linkage recorded" });
    await unattributed.locator(":scope > summary").click();
    await unattributed.locator(".model-attribution > summary").click();
    await expect(unattributed).toContainText("420");
    await expect(unattributed.locator(".metric")).toHaveCount(1);
    await expect(unattributed.locator(".metric dt")).toContainText("Output tokens");
    await expect(unattributed.locator(".metric dd")).toHaveText("420");
    await expect(unattributed).toContainText("420 output tokens (partial)");
    await expect(unattributed).not.toContainText("Not recorded tokens");
    await shot("session-partial");
    const shutdownSession = snapshot.sessions.find((session) => session.label === "Session 7");
    expect(shutdownSession.metrics.totalTokens).toBe(5420);
    expect(shutdownSession.metrics.requests).toBe(2);
    expect(shutdownSession.metrics.requestCost).toBe(0.5);
    expect(shutdownSession.metrics.localCredits).toBeNull();
    expect(shutdownSession.metrics.apiDurationMs).toBe(2200);
    expect(shutdownSession.metrics.totalNanoAiu).toBe(16_000_000);
    expect(shutdownSession.evidence.totalNanoAiu.scope).toBe("session");
    expect(shutdownSession.evidence.totalTokens.source).toBe("jsonl-shutdown");
    await page.goto(`${baseUrl}/sessions/${shutdownSession.handle}?timeframe=30d`);
    await expect(page.getByRole("heading", { name: "Session 7", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Agents & models", exact: true }).click();
    const shutdownGroup = page.locator(".attribution-group").filter({ hasText: "No exact linkage recorded" });
    await shutdownGroup.locator(":scope > summary").click();
    await shutdownGroup.locator(".model-attribution > summary").click();
    await expect(shutdownGroup.locator('[data-exact="5,420"]').first()).toHaveText("5.4K");
    await expect(shutdownGroup).toContainText("Shutdown aggregate");
    await expect(shutdownGroup).toContainText("Individual request and child attribution are unavailable");
    await shutdownGroup.locator(".advanced-metrics > summary").click();
    await page.getByLabel("Session diagnostic").locator(":scope > summary").click();
    await expect(page.locator(".metric dt").filter({ hasText: /^Local credits\b/ })).toHaveCount(0);
    await expect(shutdownGroup.locator(".metric").filter({ has: page.locator("dt", { hasText: "Recorded request cost" }) }).locator("dd")).toHaveText("0.5");
    await expect(shutdownGroup.locator(".metric").filter({ has: page.locator("dt", { hasText: "Cache write tokens" }) }).locator("dd")).toHaveText("0");
    await expect(page.getByLabel("Session diagnostic").locator('[data-exact="2,200 ms"]')).toHaveText("2.2 s");
    await expect(page.getByLabel("Session diagnostic").locator('[data-exact="16,000,000"]')).toHaveText("16M");
    await expect(page.getByLabel("Session diagnostic")).toContainText("Session-wide");
    await expect(shutdownGroup.locator('[data-exact="12,000,000"]')).toHaveText("12M");
    await expect(shutdownGroup.locator('[data-exact="16,000,000"]')).toHaveCount(0);
    await expect(shutdownGroup.locator('[data-exact="2,200 ms"]')).toHaveCount(0);
    await shot("session-shutdown");
    const partialShutdown = snapshot.sessions.find((session) => session.label === "Session 8");
    await page.goto(`${baseUrl}/sessions/${partialShutdown.handle}?timeframe=30d`);
    await expect(page.getByRole("heading", { name: "Session 8", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Agents & models", exact: true }).click();
    const partialGroup = page.locator(".attribution-group").first();
    await partialGroup.locator(":scope > summary").click();
    await partialGroup.locator(".model-attribution > summary").click();
    await expect(partialGroup).toContainText("345 output tokens (partial)");
    await expect(partialGroup.locator(".metric").filter({ has: page.locator("dt", { hasText: "Input tokens" }) })).toHaveCount(0);
    await expect(partialGroup.locator(".metric").filter({ has: page.locator("dt", { hasText: "Recorded request cost" }) }).locator("dd")).toHaveText("0");
    await expect(page.getByLabel("Session diagnostic")).toContainText("0 ms");
    const noUsage = snapshot.sessions.find((session) => session.label === "Session 5");
    await page.goto(`${baseUrl}/sessions/${noUsage.handle}?timeframe=30d`);
    await expect(page.getByRole("heading", { name: "Session 5", exact: true })).toBeVisible();
    await expect(page.locator(".metric")).toHaveCount(0);
    await expect(page.getByText("No usage measurements available.", { exact: true })).toHaveCount(1);
    await expect(page.locator(".evidence").filter({ hasText: "Not recorded" })).toHaveCount(0);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Data Sources", exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "Enable VS Code" }).click();
    await expect(page.getByRole("checkbox", { name: "Enable VS Code" })).toBeChecked();
    await expect(page.getByText("Usage metadata unavailable", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Enable VS Code" })).toBeChecked();
    await shot("settings");
    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await shot("settings-light");

    // Retry must not render arbitrary response bodies, and must recover without a reload.
    await page.route("**/api/tokens/summary?*", (route) => route.fulfill({
      status: 503, contentType: "application/json", body: JSON.stringify({ error: PRIVACY_CANARY }),
    }));
    await page.getByRole("link", { name: "Token Usage", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await assertPrivate();
    await page.unroute("**/api/tokens/summary?*");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible();

    // Keyboard timeframe navigation and browser history preserve shared state.
    await page.getByRole("radio", { name: "Last 30 days" }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("radio", { name: "Last 7 days" })).toBeChecked();
    await page.goBack();
    await expect(page.getByRole("radio", { name: "Last 30 days" })).toBeChecked();
    await page.goto(`${baseUrl}/sessions?timeframe=30d&source=vscode`);
    await expect(page.getByRole("heading", { name: "No sessions match these filters" })).toBeVisible();
    await page.goto(`${baseUrl}/sessions?timeframe=all&model=gpt-4.1`);
    await expect(page.getByRole("link", { name: "Session 6", exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Last 30 days" }).click();
    await expect(page.getByRole("heading", { name: "No sessions match these filters" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Model", exact: true })).toHaveValue("gpt-4.1");
    await page.goto(`${baseUrl}/sessions?timeframe=7d&model=gpt-5.5`);
    await expect(page.getByRole("heading", { name: "No sessions match these filters" })).toBeVisible();
    await page.goto(`${baseUrl}/sessions?timeframe=30d&model=Unknown+model`);
    await page.getByRole("link", { name: "Session 3", exact: true }).click();
    await page.getByRole("button", { name: "Agents & models", exact: true }).click();
    const unknown = page.locator(".attribution-group").filter({ hasText: "No exact linkage recorded" });
    await unknown.locator(":scope > summary").click();
    const unknownModel = unknown.locator(".model-attribution").filter({ hasText: "Unknown model" });
    await unknownModel.locator(":scope > summary").click();
    await expect(unknownModel.locator(".metric").filter({ has: page.locator("dt", { hasText: "Total tokens" }) }).locator("dd")).toHaveText("0");

    await page.goto(`${largeUrl}/sessions?timeframe=all`);
    const sessionTable = page.getByRole("table");
    await expect(sessionTable.getByRole("row")).toHaveCount(26);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    expect(new URL(page.url()).searchParams.get("page")).toBe("2");
    await expect(sessionTable.getByRole("row")).toHaveCount(14);
    await sessionTable.getByRole("row").nth(1).getByRole("link").first().click();
    await expect(page.getByRole("heading", { name: "Turns & model calls", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Back to Sessions" }).click();
    expect(new URL(page.url()).searchParams.get("page")).toBe("2");
    await page.getByRole("combobox", { name: "Sort by", exact: true }).selectOption("duration");
    await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
    await expect(page.getByRole("table").getByRole("row").nth(1).getByRole("link", { name: "Session 1", exact: true })).toBeVisible();
    await assertPrivate();
    await page.goto(`${aggregateUrl}/?timeframe=30d`);
    await expect(page.getByRole("heading", { name: "Recorded local usage", exact: true })).toBeVisible();
    await expect(page.locator('a[href*="day="]')).toHaveCount(0);
    await expect(page.locator('a[href*="model=gpt-5-mini"]').first()).toBeVisible();
    const aggregateData = await (await fetch(`${aggregateUrl}/api/summary?timeframe=30d`)).json();
    expect(aggregateData.exploration.trend.recordedRequests).toBe(0);
    expect(aggregateData.sessions.find((session) => session.label === "Session 7").metrics.totalTokens).toBe(5420);
    await shot("overview-aggregate-only");

    await page.setViewportSize({ width: 390, height: 844 });
    // Numeric display boundary only; accounting is verified against real fixtures above.
    await page.route("**/api/summary?*", async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.metrics.totalTokens = 4_234_173_612;
      payload.metrics.cacheReadTokens = 3_935_268_917;
      await route.fulfill({ response, json: payload });
    });
    await page.goto(`${baseUrl}/?timeframe=90d`);
    await expect(page.getByRole("heading", { name: "Recorded local usage" })).toBeVisible();
    for (const label of ["Total tokens", "Cache read tokens"]) {
      const value = page.locator(".metric").filter({ has: page.locator("dt").filter({ hasText: new RegExp(`^${label}\\b`) }) }).locator("dd");
      expect(await value.evaluate((element) =>
        element.getBoundingClientRect().height <= parseFloat(getComputedStyle(element).lineHeight) * 1.1)).toBe(true);
    }
    await page.unroute("**/api/summary?*");
    await page.goto(`${baseUrl}/?timeframe=30d`);
    await expect(page.getByRole("heading", { name: "Recorded local usage" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).not.toBeVisible();
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("link", { name: "Sessions", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot("sessions-mobile");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
    await page.goto(`${emptyUrl}/?timeframe=all`);
    await expect(page.getByRole("heading", { name: "No recorded sessions yet" })).toBeVisible();
    await expect(page.getByLabel("Advisory optimization")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Check Data Sources", exact: true })).toBeInViewport();
    await page.goto(`${emptyUrl}/tokens?timeframe=all`);
    await expect(page.getByRole("heading", { name: "Agent & Skill Performance", exact: true })).toBeVisible();
    await expect(page.locator(".performance-group")).toHaveCount(0);
    await expect(page.getByText("No scope-level usage available.", { exact: true })).toBeVisible();
    await expect(page.locator(".metric")).toHaveCount(0);
    await page.goto(`${unavailableUrl}/?timeframe=all`);
    await expect(page.getByRole("heading", { name: "No recorded sessions yet" })).toBeVisible();
    await expect(page.locator(".source-status")).toContainText("SessionDB Unavailable");
    await expect(page.locator(".metric")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Check Data Sources", exact: true })).toBeVisible();
    await page.goto(`${baseUrl}/practice`);
    await expect(page).toHaveURL(`${baseUrl}/`);
    expect(pageErrors).toEqual([]);
    console.log(JSON.stringify({ status: "passed", browser: "headless msedge", synthetic: true, screenshots: captured }, null, 2));
    return { screenshots: captured };
  } finally {
    await browser?.close();
    await closeServer(server);
    await closeServer(emptyServer);
    await closeServer(unavailableServer);
    await closeServer(largeServer);
    await closeServer(aggregateServer);
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(emptyFixture.directory, { recursive: true, force: true });
    await rm(largeFixture.directory, { recursive: true, force: true });
    await rm(aggregateFixture.directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runUsageFlow();
}
