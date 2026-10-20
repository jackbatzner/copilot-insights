import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { createSyntheticFixture, PRIVACY_CANARY } from "./seed-mock-db.mjs";
import { startServer } from "../server/index.mjs";

const output = process.argv[2];
const fixtureRoot = resolve(`.mobile-help-fixtures-${randomUUID()}`);
await mkdir(fixtureRoot);
const previousTemp = { TEMP: process.env.TEMP, TMP: process.env.TMP };
process.env.TEMP = fixtureRoot;
process.env.TMP = fixtureRoot;
let fixture, server, browser;
const errors = [];
let contentAttempts = 0;
try {
  fixture = createSyntheticFixture();
  if (output) await mkdir(output, { recursive: true });
  server = await startServer({ ...fixture, port: 0, uiDist: process.env.COPILOT_INSIGHTS_TEST_UI_DIST });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  const protect = async (ctx) => {
    await ctx.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/content")) {
        contentAttempts++;
        return route.abort();
      }
      return url.origin === base ? route.continue() : route.abort();
    });
    ctx.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  };
  await protect(context);
  const page = await context.newPage();
  const checkDisclosure = async (target, expected) => {
    await target.focus();
    await expect(page.getByRole("tooltip")).toContainText(expected);
    const box = await page.getByRole("tooltip").boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= page.viewportSize().width + 1 &&
      box.y + box.height <= page.viewportSize().height + 1, "help must fit the viewport");
    await expect(target).not.toHaveAttribute("title");
    await expect(target).toHaveAttribute("aria-describedby", /.+/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.waitForTimeout(200);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tooltip")).toContainText(expected);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Space");
    await expect(page.getByRole("tooltip")).toContainText(expected);
    await page.keyboard.press("Escape");
  };
  const checkTableFits = async (table) => {
    await expect(table).toBeVisible();
    assert.ok(await table.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), "table must not require sideways discovery");
    const bounds = await table.locator("tbody > tr > :is(td, th)").evaluateAll((cells) =>
      cells.map((cell) => { const rect = cell.getBoundingClientRect(); return { left: rect.left, right: rect.right }; }));
    for (const box of bounds) assert.ok(box.left >= 0 && box.right <= page.viewportSize().width + 1, "all fields fit the mobile viewport");
  };

  await page.goto(`${base}/sessions?timeframe=all&model=gpt-5.4`);
  const explanation = page.locator("details.table-explanation");
  await expect(explanation).not.toHaveAttribute("open");
  await explanation.getByText("How to read session metrics", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(explanation).toHaveAttribute("open", "");
  await expect(explanation).toContainText("whole-session usage stays unchanged");
  await expect(explanation).toContainText("not recorded, not zero");
  await page.keyboard.press("Enter");
  await expect(explanation).not.toHaveAttribute("open");
  const table = page.getByRole("table", { name: "Recorded sessions", exact: true });
  const row = table.getByRole("row").filter({ has: page.getByRole("link", { name: "Session 1", exact: true }) });
  const whole = row.locator('[data-label="Whole-session usage"]');
  const selected = row.locator('[data-label="Selected usage"]');
  await expect(whole.locator('[data-exact="62,800"]')).toHaveText("62.8K");
  await expect(selected).toBeVisible();
  assert.notEqual(await selected.innerText(), await whole.innerText(), "selected and whole-session values differ");
  const values = await row.locator("td").allTextContents();
  await expect(table).toHaveCSS("display", "table");
  if (output) await table.screenshot({ path: join(output, "sessions-1440.png") });
  await checkDisclosure(whole.locator(".compact-number"), "62,800");
  await table.getByRole("button", { name: "Sort by selected usage", exact: true }).click();
  await expect(page).toHaveURL(/sort=tokens/);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await checkTableFits(table);
    assert.deepEqual(await row.locator("td").allTextContents(), values, "responsive layout must preserve every value");
    await expect(table.getByRole("columnheader", { name: "Selected usage", exact: true })).toHaveCount(1);
    await expect(page.getByLabel("Sort by", { exact: true })).toBeVisible();
    await expect(whole).toHaveAttribute("data-label", "Whole-session usage");
    assert.equal(await selected.evaluate((cell) => getComputedStyle(cell, "::before").content), '"Selected usage"');
    if (output) await table.screenshot({ path: join(output, `sessions-${width}.png`) });
  }
  await row.getByRole("link", { name: "Session 1", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sessions\/[^?]+/);
  const help = page.getByRole("region", { name: "Matching usage totals" }).locator(".metric .help-disclosure").first();
  await checkDisclosure(help, await help.getAttribute("aria-label"));
  await help.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.getByRole("tooltip").hover();
  await page.waitForTimeout(200);
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto(`${base}/?timeframe=all`);
  await expect(page.locator(".share-bars a .compact-number, .scope-legend a .compact-number").first()).toBeVisible();
  assert.equal(await page.locator(".share-bars a .compact-number[tabindex], .scope-legend a .compact-number[tabindex]").count(), 0);
  assert.equal(await page.locator(".share-bars a .compact-number[role=button], .scope-legend a .compact-number[role=button]").count(), 0);

  await page.goto(`${base}/tokens/compare?timeframe=all`);
  const observed = page.getByRole("region", { name: "Observed model comparison", exact: true });
  const missing = observed.getByRole("button", { name: "Pricing unavailable", exact: true }).first();
  await checkDisclosure(missing, "Pricing unavailable");
  await checkTableFits(observed.locator("table"));
  const cost = observed.locator('[data-exact="$0.0056"]').first();
  await checkDisclosure(cost, "Input $0.004; output $0.0016");
  await page.getByRole("button", { name: "What-if cost", exact: true }).click();
  const scenarios = page.getByRole("region", { name: "What-if model comparison", exact: true });
  await checkTableFits(scenarios.locator("table"));
  const action = scenarios.getByRole("button", { name: /^Choose for trial:/ }).first();
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: "Model trial", exact: true })).toBeVisible();
  if (output) await scenarios.screenshot({ path: join(output, "what-if-320.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(scenarios.locator("table")).toHaveCSS("display", "table");

  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await protect(touch);
  const touchPage = await touch.newPage();
  await touchPage.goto(`${base}/tokens/compare?timeframe=all`);
  const touchHelp = touchPage.getByRole("button", { name: "Pricing unavailable", exact: true }).first();
  await touchHelp.tap();
  await expect(touchPage.getByRole("tooltip")).toHaveText("Pricing unavailable");
  assert.ok((await touchHelp.boundingBox()).height >= 44);
  await touchPage.keyboard.press("Escape");
  await expect(touchPage.getByRole("tooltip")).toHaveCount(0);
  await touchPage.goto(`${base}/sessions?timeframe=all`);
  const touchTotal = touchPage.locator('[data-exact="62,800"]').first();
  await touchTotal.tap();
  await expect(touchPage.getByRole("tooltip")).toHaveText("62,800");
  await touchPage.getByRole("link", { name: "Session 1", exact: true }).click();
  const touchMetric = touchPage.locator(".metric .help-disclosure").first();
  await touchMetric.tap();
  await expect(touchPage.getByRole("tooltip")).toHaveText(await touchMetric.getAttribute("aria-label"));
  assert.ok(!(await touchPage.content()).includes(PRIVACY_CANARY));
  await touch.close();
  assert.deepEqual(errors, []);
  const result = { mobileWidths: [320, 390], desktop: 1440, unchangedTableValues: true,
    selectedVsWholeSession: true, keyboardSortAndNavigation: true, focusHoverTouchEscape: true,
    preciseCostBreakdown: true, chartLinksWithoutNestedTabstops: true,
    trialAction: true, contentEndpointsBlocked: true, contentAttempts, renderErrors: errors };
  if (output) await writeFile(join(output, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  if (server) await new Promise((done) => { server.close(done); server.closeAllConnections(); });
  for (const [name, value] of Object.entries(previousTemp)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await rm(fixtureRoot, { recursive: true, force: true });
}
