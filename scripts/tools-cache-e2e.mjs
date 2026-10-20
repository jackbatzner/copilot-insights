import assert from "node:assert/strict";
import { appendFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createSyntheticFixture, PRIVACY_CANARY } from "./seed-mock-db.mjs";
import { startServer } from "../server/index.mjs";

const fixture = createSyntheticFixture();
const rawToolIds = ["private-read-call", "private-edit-call", "private-shell-call"];
const timestamp = Date.now() - 86_400_000;
const events = [
  { type: "tool.execution_start", data: { toolCallId: rawToolIds[0], parentToolCallId: "synthetic-child-a",
    toolName: "view", model: "gpt-5.4", turnId: "2", arguments: { path: PRIVACY_CANARY } } },
  { type: "tool.execution_complete", data: { toolCallId: rawToolIds[0], parentToolCallId: "synthetic-child-a",
    success: true, result: PRIVACY_CANARY } },
  { type: "tool.execution_start", data: { toolCallId: rawToolIds[1], parentToolCallId: "synthetic-child-a",
    toolName: "apply_patch", arguments: PRIVACY_CANARY } },
  { type: "tool.execution_complete", data: { toolCallId: rawToolIds[1], success: false, error: PRIVACY_CANARY } },
  { type: "tool.execution_start", data: { toolCallId: rawToolIds[2], toolName: "powershell",
    arguments: { command: PRIVACY_CANARY } } },
  { type: "session.shutdown", data: {} },
].map((event, index) => ({ id: `private-tool-event-${index}`, timestamp: new Date(timestamp + 50_000 + index * 100).toISOString(), ...event }));
await appendFile(join(fixture.sessionStatePath, fixture.ids[0], "events.jsonl"), `${events.map(JSON.stringify).join("\n")}\n`);

let server, browser;
try {
  server = await startServer({ ...fixture, port: 0, uiDist: process.env.COPILOT_INSIGHTS_TEST_UI_DIST });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark" });
  await page.clock.install({ time: new Date() });
  const calls = new Map(), errors = [];
  page.on("pageerror", () => errors.push("Render error"));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") && request.method() === "GET") {
      const key = url.pathname + url.search;
      calls.set(key, (calls.get(key) || 0) + 1);
    }
  });
  const navigate = async (name) => {
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name: name === "Overview" ? "Recorded local usage" : name, exact: true })).toBeVisible();
  };
  await page.goto(`${base}/?timeframe=all`);
  await expect(page.getByRole("heading", { name: "Daily usage", exact: true })).toBeVisible();
  await page.clock.fastForward(70_000);
  await navigate("Token Usage");
  await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible();
  await navigate("Sessions");
  await expect(page.getByRole("link", { name: "Session 1", exact: true })).toBeVisible();
  assert.equal(calls.get("/api/summary?timeframe=all"), 1);
  assert.equal(calls.get("/api/tokens/summary?timeframe=all") || 0, 0);
  assert.equal(calls.get("/api/sessions?timeframe=all") || 0, 0);
  await page.getByRole("link", { name: "Session 1", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Turns & model calls", exact: true })).toBeVisible();
  const handle = new URL(page.url()).pathname.split("/").at(-1);
  const detailPath = `/api/sessions/${handle}`;
  await page.getByRole("button", { name: "Hide all text", exact: true }).click();
  await page.getByRole("button", { name: "Tool activity", exact: true }).click();
  const toolSection = page.getByRole("region", { name: "Tool activity", exact: true });
  await expect(toolSection).toContainText("4 observed calls");
  await expect(toolSection).toContainText("2 linked to child agents");
  await expect(toolSection).toContainText("2 session or unlinked");
  await page.getByRole("button", { name: "Turns", exact: true }).click();
  const turn = page.locator(".usage-turn");
  await page.getByRole("button", { name: "Inspect Turn 2", exact: true }).click();
  await expect(turn.getByRole("group", { name: "Associated child tool activity" })).toBeVisible();
  await expect(turn.locator(".turn-tool-links")).toContainText("Invocation-wide tools, not assigned to this turn");
  await turn.getByRole("button", { name: /Inspect Subagent \d+ tools/ }).click();
  const child = page.locator(".attribution-group[open]").filter({ hasText: "Exact child linkage" });
  await expect(child.getByRole("heading", { name: "Tool activity", exact: true })).toBeVisible();
  const table = child.locator(".tool-breakdown");
  await expect(table).toContainText("File reads");
  await expect(table).toContainText("File edits");
  await expect(table).toContainText("1 succeeded");
  await expect(table).toContainText("1 failed");
  await expect(table).toContainText("gpt-5.4");
  await expect(child.locator("pre")).toHaveCount(0);
  await page.getByRole("button", { name: "Tool activity", exact: true }).click();
  await expect(toolSection.locator("table")).toHaveCount(1);
  await expect(toolSection.locator("table")).not.toBeVisible();
  await toolSection.locator("details > summary").click();
  await expect(toolSection.locator("table")).toContainText("Shell");
  assert.ok(!(await page.content()).includes(PRIVACY_CANARY));
  if (process.argv[2]) await mkdir(process.argv[2], { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    if (process.argv[2]) {
      await page.getByRole("button", { name: "Agents & models", exact: true }).click();
      await child.screenshot({ path: join(process.argv[2], `tool-attribution-${width}.png`) });
      await page.getByRole("button", { name: "Tool activity", exact: true }).click();
      await toolSection.screenshot({ path: join(process.argv[2], `tool-overview-${width}.png`) });
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Viewport overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "Back to Sessions" }).click();
  await page.getByRole("link", { name: "Session 1", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Turns & model calls", exact: true })).toBeVisible();
  assert.equal(calls.get(`${detailPath}?view=summary`), 1);
  await navigate("Overview");
  await navigate("Token Usage");
  assert.equal(calls.get("/api/summary?timeframe=all"), 1);
  assert.equal(calls.get("/api/tokens/summary?timeframe=all") || 0, 0);
  await page.locator('#models a[href^="/sessions?"][href*="model=claude-sonnet-4.6"]').first().click();
  await expect(page.getByRole("link", { name: "Session 1", exact: true })).toBeVisible();
  const filteredPath = "/api/sessions?timeframe=all&model=claude-sonnet-4.6";
  assert.equal(calls.get(filteredPath), 1);
  await navigate("Token Usage");
  await page.locator('#models a[href^="/sessions?"][href*="model=claude-sonnet-4.6"]').first().click();
  await expect(page.getByRole("link", { name: "Session 1", exact: true })).toBeVisible();
  assert.equal(calls.get(filteredPath), 1);
  await navigate("Overview");
  await page.getByRole("button", { name: "Refresh data", exact: true }).click();
  await expect.poll(() => calls.get("/api/summary?timeframe=all")).toBe(2);
  await expect(page.getByRole("heading", { name: "Daily usage", exact: true })).toBeVisible();

  const detail = await (await fetch(base + detailPath)).json();
  assert.equal(detail.toolUsage.count, detail.diagnostic.toolCount);
  assert.equal(detail.toolUsage.linkedCount + detail.toolUsage.unlinkedCount, detail.toolUsage.count);
  const serialized = JSON.stringify(detail);
  for (const canary of [PRIVACY_CANARY, ...fixture.ids, ...rawToolIds]) assert.ok(!serialized.includes(canary));
  const snapshot = await (await fetch(`${base}/api/summary?timeframe=all`)).json();
  const absent = snapshot.sessions.find((session) => session.label === "Session 5");
  await page.goto(`${base}/sessions/${absent.handle}?timeframe=all`);
  await page.getByRole("button", { name: "Tool activity", exact: true }).click();
  await expect(page.getByText("Tool activity is not recorded in the available local execution metadata.", { exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ lifetimeBeyond60s: true, summaryToSessionsReuse: true, detailReuse: true,
    filteredReuse: true, explicitRefresh: true, toolDrilldown: true, noTurnAllocation: true, noContentLeak: true, responsive: true }));
} finally {
  await browser?.close();
  if (server) await new Promise((done) => { server.close(done); server.closeAllConnections(); });
  await rm(fixture.directory, { recursive: true, force: true });
}
