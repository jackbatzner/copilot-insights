import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createGalleryFixture } from "./gallery-fixture.mjs";
import { assertCaptureSafe, captureRequestPolicy, GALLERY_LABEL } from "./gallery-contract.mjs";
import { startServer } from "../server/index.mjs";

const fixture = createGalleryFixture();
let server, browser;
const contrast = (a, b) => {
  const luminance = (color) => {
    const channels = color.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number).map((value) => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const [first, second] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (first + 0.05) / (second + 0.05);
};
try {
  server = await startServer({ ...fixture, port: 0, uiDist: process.env.COPILOT_INSIGHTS_TEST_UI_DIST });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light", locale: "en-US", serviceWorkers: "block" });
  await context.addInitScript((origin) => {
    if (location.origin === origin) localStorage.setItem("copilot-insights.presentation.v1", "on");
  }, base);
  let blocked = 0;
  const errors = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (captureRequestPolicy(request.url(), request.method(), new Set([base])) !== "allow") {
      blocked++; return route.abort();
    }
    if (!new URL(request.url()).pathname.startsWith("/api/")) return route.continue();
    const response = await route.fetch({ maxRedirects: 0, timeout: 30000 });
    assert.equal(response.status(), 200);
    assertCaptureSafe(await response.text(), fixture.privateMarkers);
    return route.fulfill({ response });
  });
  await context.routeWebSocket("**/*", (socket) => { blocked++; socket.close(); });
  const page = await context.newPage();
  page.on("pageerror", () => errors.push("render-error"));
  const safe = async () => {
    assertCaptureSafe(await page.content(), fixture.privateMarkers);
    await expect(page.locator(".local-content-preview,.local-content-text,pre")).toHaveCount(0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  };
  const screenshot = async (name) => {
    await safe();
    if (!process.argv[2]) return;
    await mkdir(process.argv[2], { recursive: true });
    await page.evaluate((label) => {
      const banner = document.createElement("p");
      banner.dataset.captureLabel = "";
      banner.textContent = label;
      document.querySelector("main").prepend(banner);
    }, GALLERY_LABEL);
    await page.screenshot({ path: join(process.argv[2], name + ".png"), fullPage: true });
    await page.locator("[data-capture-label]").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  };
  await page.goto(`${base}/?timeframe=30d`);
  await expect(page.locator(".share-chart-grid")).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      localStorage.setItem("copilot-insights-theme", value);
    }, theme);
    await page.reload();
    await expect(page.locator(".share-chart-grid")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const colors = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const resolve = (variable) => {
        const probe = document.createElement("span");
        probe.style.color = root.getPropertyValue(variable);
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      return Object.fromEntries(["--cp-bg", "--cp-surface", "--cp-surface-soft", "--cp-text", "--cp-text-soft",
        "--cp-accent", "--cp-chart-primary", "--cp-chart-subagent", "--cp-chart-unattributed", "--cp-chart-fg"]
        .map((name) => [name, resolve(name)]));
    });
    for (const background of ["--cp-bg", "--cp-surface", "--cp-surface-soft"]) {
      for (const foreground of ["--cp-text", "--cp-text-soft", "--cp-accent"]) {
        assert.ok(contrast(colors[foreground], colors[background]) >= 4.5, `${theme}: ${foreground} on ${background}`);
      }
    }
    for (const color of ["--cp-chart-primary", "--cp-chart-subagent", "--cp-chart-unattributed"]) {
      assert.ok(contrast(colors[color], colors["--cp-surface"]) >= 3, `${theme}: graphical contrast`);
      assert.ok(contrast(colors[color], colors["--cp-chart-fg"]) >= 4.5, `${theme}: chart text contrast`);
    }
    await screenshot(`overview-${theme}-1440`);
  }
  await page.getByLabel("Daily metric", { exact: true }).selectOption("requests");
  await expect(page.getByRole("group", { name: "Daily recorded model calls", exact: true })).toBeVisible();
  await page.locator(".primary-insight .button-link").click();
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("claude-sonnet-4.6");
  await page.getByLabel("Scope", { exact: true }).selectOption("subagent");
  await page.getByLabel("UTC day", { exact: true }).fill(fixture.usageDays.child);
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "Session 1", exact: true }) });
  await expect(row.locator('[data-exact="31,000"]')).toBeVisible();
  await expect(row.locator('[data-exact="62,800"]')).toBeVisible();
  await row.getByRole("link", { name: "Session 1", exact: true }).click();
  await page.getByRole("button", { name: "Tool activity", exact: true }).click();
  const toolSection = page.getByRole("region", { name: "Tool activity", exact: true });
  await expect(toolSection.getByLabel("Tool category", { exact: true })).toBeVisible();
  const countBefore = await toolSection.locator("p").first().innerText();
  await toolSection.getByLabel("Tool category", { exact: true }).selectOption("mcp");
  await expect(toolSection.getByRole("status")).toContainText("1 MCP calls in this view");
  assert.equal(await toolSection.locator("p").first().innerText(), countBefore, "category filtering must not change totals");
  await expect(toolSection).toContainText("not individual turns or token costs");
  await toolSection.getByRole("link", { name: /inspect agent activity/ }).click();
  const child = page.locator(".attribution-group[open]").filter({ hasText: "Exact child linkage" });
  await expect(child).toContainText("MCP");
  await expect(child).toContainText("1 failed");
  await child.locator(".model-attribution > summary").click();
  await expect(child.locator(".model-attribution")).toContainText("51K");
  await page.getByRole("button", { name: "Turns", exact: true }).click();
  const turn = page.locator(".usage-turn");
  await page.getByRole("button", { name: "Inspect Turn 2", exact: true }).click();
  await turn.locator(".request-list-row").first().click();
  await expect(turn).toContainText("31K");
  await expect(turn.locator(".request-context")).toContainText("Exact child linkage");
  await page.getByRole("button", { name: "Agents & models", exact: true }).click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const table = child.locator(".tool-breakdown table");
    await expect(table).toHaveCSS("display", "block");
    assert.ok(await table.evaluate((element) => element.scrollWidth <= element.clientWidth + 1));
    const mcp = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "MCP", exact: true }) });
    await expect(mcp.locator('[data-label="Calls"]')).toHaveText("1");
    await expect(mcp.locator('[data-label="Outcomes"]')).toContainText("1 failed");
    await safe();
    if (width === 390) await screenshot("detail-dark-390");
  }
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.getByRole("link", { name: /Compare models for this session/ }).click();
  await expect(page.getByRole("heading", { name: "Models you actually used", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "What-if cost", exact: true }).click();
  await expect(page.getByRole("region", { name: "What-if model comparison", exact: true })).toContainText("not recorded spend");
  await safe();
  assert.deepEqual(errors, []);
  assert.equal(blocked, 0);
  console.log(JSON.stringify({ synthetic: true, spendInvestigation: true, selectedVsWhole: true, turnsAndCalls: true,
    mcpCategoryFilter: true, childAttribution: true, modelScenarioCaveat: true, lightDarkContrast: true,
    mobileToolTables: [320, 390], forcedColors: true, contentBlockedByPolicy: true }));
} finally {
  await browser?.close();
  if (server) await new Promise((done) => { server.close(done); server.closeAllConnections(); });
  await rm(fixture.directory, { recursive: true, force: true });
}
