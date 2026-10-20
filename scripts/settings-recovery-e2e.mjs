import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { createSyntheticFixture, PRIVACY_CANARY } from "./seed-mock-db.mjs";
import { startServer } from "../server/index.mjs";

const fixture = createSyntheticFixture();
let server, browser;
try {
  server = await startServer({ ...fixture, port: 0, uiDist: process.env.COPILOT_INSIGHTS_TEST_UI_DIST });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  await page.route("**/assets/Settings-*.js", (route) => route.fulfill({ status: 404, body: "Not found" }));
  await page.goto(`${base}/?timeframe=30d&model=gpt-5.4`);
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "This view could not be displayed", exact: true })).toBeVisible();
  await page.unrouteAll();
  const address = page.url();
  await page.getByRole("button", { name: "Reload app", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Data Sources", exact: true })).toBeVisible();
  assert.equal(page.url(), address);
  const preference = page.getByRole("checkbox", { name: "Enable VS Code", exact: true });
  await expect(preference).not.toBeChecked();
  await preference.check();
  await expect(preference).toBeChecked();
  await expect(page.getByText("Usage metadata unavailable", { exact: true })).toBeVisible();
  await page.reload();
  await expect(preference).toBeChecked();
  await preference.uncheck();
  await expect(preference).not.toBeChecked();
  await expect(preference).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  let releaseWrite;
  const pending = new Promise((resolve) => { releaseWrite = resolve; });
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PATCH") await pending;
    await route.continue();
  });
  await preference.check();
  await expect(preference).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Saving preference...");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect(preference).toBeChecked();
  releaseWrite();
  await expect(preference).toBeEnabled();
  await expect(preference).toBeChecked();
  await page.unrouteAll();
  await page.route("**/api/settings", (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: PRIVACY_CANARY }) })
    : route.continue());
  await preference.uncheck();
  await expect(page.getByRole("alert")).toContainText("The setting could not be confirmed");
  await expect(preference).toBeChecked();
  await page.unrouteAll();
  await page.getByRole("button", { name: "Retry settings", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(preference).toBeChecked();
  assert.ok(!(await page.content()).includes(PRIVACY_CANARY));
  console.log(JSON.stringify({ staleSettingsRecovery: true, filtersPreserved: true, preferenceSaveReload: true, pendingWriteRefresh: true, failedWriteRecovery: true }));
} finally {
  await browser?.close();
  if (server) await new Promise((done) => { server.close(done); server.closeAllConnections(); });
  await rm(fixture.directory, { recursive: true, force: true });
}
