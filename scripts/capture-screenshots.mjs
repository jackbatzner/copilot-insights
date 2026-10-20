#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { startServer } from "../server/index.mjs";
import { createSyntheticFixture } from "./seed-mock-db.mjs";
import { createGalleryFixture } from "./gallery-fixture.mjs";
import { assertCaptureSafe, captureRequestPolicy, GALLERY_IMAGES, GALLERY_LABEL } from "./gallery-contract.mjs";
import { PRESENTATION_KEY } from "../ui/src/presentation-preference.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDirectory = join(root, "docs", "screenshots");
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--output")) {
  throw new Error("Usage: node scripts/capture-screenshots.mjs [--output <directory>]");
}
const requestedOutput = args[1] ? resolve(args[1]) : null;
const publish = requestedOutput === docsDirectory;
if (requestedOutput && !publish) {
  const path = relative(root, requestedOutput);
  if (!path || (!path.startsWith("..") && !isAbsolute(path))) throw new Error("Capture output must be outside the repository or exactly docs/screenshots.");
}
const output = await mkdtemp(join(tmpdir(), "copilot-insights-gallery-"));
const fixture = createGalleryFixture();
const empty = createSyntheticFixture({ empty: true });
const forbidden = [...fixture.privateMarkers, empty.directory, ...empty.ids];
const counts = { contentBlocked: 0, externalBlocked: 0, mutationBlocked: 0, unknownApiBlocked: 0, inspectedApiResponses: 0, screenshots: 0 };
const errors = [];
const checks = [];
let scene = "initialization";
let server, emptyServer, browser;
let succeeded = false;
const close = (value) => value && new Promise((done, reject) => {
  value.close((error) => error ? reject(error) : done());
  value.closeAllConnections();
});
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
try {
  const uiDist = resolve(process.env.COPILOT_INSIGHTS_TEST_UI_DIST || join(root, "ui", "dist"));
  const buildHash = sha(await readFile(join(uiDist, "index.html")));
  // Explicit synthetic sources and state prevent fallback to any host session store.
  server = await startServer({ ...fixture, port: 0, uiDist });
  emptyServer = await startServer({ ...empty, port: 0, uiDist });
  const base = `http://127.0.0.1:${server.address().port}`;
  const emptyBase = `http://127.0.0.1:${emptyServer.address().port}`;
  const origins = new Set([base, emptyBase]);
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1180 }, colorScheme: "dark", timezoneId: "UTC", locale: "en-US", serviceWorkers: "block",
  });
  await context.addInitScript(({ key, allowed }) => {
    if (allowed.includes(location.origin)) localStorage.setItem(key, "on");
  }, { key: PRESENTATION_KEY, allowed: [...origins] });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const policy = captureRequestPolicy(request.url(), request.method(), origins);
    if (policy !== "allow") {
      counts[{ content: "contentBlocked", external: "externalBlocked", mutation: "mutationBlocked", "unknown-api": "unknownApiBlocked" }[policy]]++;
      return route.abort();
    }
    return route.continue();
  });
  await context.routeWebSocket("**/*", (socket) => { counts.externalBlocked++; socket.close(); });
  context.on("page", (page) => page.on("pageerror", (error) => {
    const category = ["removeChild", "insertBefore", "ResizeObserver", "Failed to fetch", "Unexpected token"].find((value) => error.message.includes(value)) || "unclassified";
    errors.push({ scene, category });
  }));
  const page = await context.newPage();
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/")) checks.push((async () => {
      if (!response.ok()) throw new Error("Gallery API returned an unsuccessful response.");
      assertCaptureSafe(await response.text(), forbidden);
      counts.inspectedApiResponses++;
    })().catch(() => {
      errors.push({ scene, category: "API response privacy check failed" });
    }));
  });
  const goto = async (path, origin = base) => {
    await Promise.all(checks);
    assert.deepEqual(errors, [], "Gallery checks must finish successfully before navigation.");
    scene = "navigation";
    await page.goto(origin + path);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator(".usage-loading")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await Promise.all(checks);
    assert.deepEqual(errors, [], "Gallery response checks failed.");
  };
  const shot = async (name, locator, through) => {
    scene = name;
    const viewport = page.viewportSize();
    assert.ok(GALLERY_IMAGES.includes(name), "Screenshot is not in the publication allowlist.");
    await expect(page.locator(".local-content-preview, .local-content-text, pre")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(0, 0);
    await Promise.all(checks);
    assert.deepEqual(errors, [], "Gallery checks must finish successfully before capture.");
    assertCaptureSafe(await page.content(), forbidden);
    assertCaptureSafe(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })), forbidden);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Capture has page overflow.");
    // The only capture decoration is a provenance label, never replacement product data.
    if (locator) {
      await locator.evaluate((node, label) => {
        const banner = document.createElement("p");
        banner.dataset.captureLabel = "true";
        banner.textContent = label;
        banner.style.cssText = "position:relative;z-index:10000;color:var(--text);background:var(--bg-card);border:1px solid var(--border);padding:8px 12px;margin-bottom:12px;font:600 13px 'Segoe UI',sans-serif;";
        node.prepend(banner);
      }, GALLERY_LABEL);
      await locator.screenshot({ path: join(output, name), animations: "disabled" });
    } else {
      if (through) {
        await page.evaluate(() => window.scrollTo(0, 0));
        const box = await through.boundingBox();
        assert.ok(box, "Capture extent is unavailable.");
        await page.setViewportSize({ width: viewport.width, height: Math.max(720, Math.ceil(box.y + box.height + 48)) });
      }
      await page.evaluate((label) => {
        window.scrollTo(0, 0);
        const banner = document.createElement("div");
        banner.dataset.captureLabel = "true";
        banner.textContent = label;
        banner.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:10000;color:var(--text);background:var(--bg-card);border:1px solid var(--border);padding:8px 12px;font:600 13px 'Segoe UI',sans-serif;";
        document.body.append(banner);
      }, GALLERY_LABEL);
      await page.screenshot({ path: join(output, name), animations: "disabled" });
    }
    await page.locator("[data-capture-label]").evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
    await page.setViewportSize(viewport);
    counts.screenshots++;
  };

  await goto("/?timeframe=30d");
  await expect(page.locator(".primary-insight .button-link")).toBeInViewport();
  await expect(page.locator(".share-chart-grid")).toBeVisible();
  await shot("overview.png", null, page.locator(".share-chart-grid"));
  await page.getByRole("button", { name: "Switch to light mode", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await shot("overview-light.png", null, page.locator(".share-chart-grid"));
  await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
  await shot("overview-daily.png", page.locator(".trend-card"));
  await page.locator(".primary-insight .button-link").click();
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue("claude-sonnet-4.6");
  await page.getByLabel("Scope", { exact: true }).selectOption("subagent");
  await page.getByLabel("UTC day", { exact: true }).fill(fixture.usageDays.child);
  await expect(page.getByRole("status")).toContainText("2 matching sessions");
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "Session 1", exact: true }) });
  await expect(row.locator('[data-exact="31,000"]').first()).toBeVisible();
  await expect(row.locator('[data-exact="62,800"]').first()).toBeVisible();
  await shot("sessions.png", null, page.locator(".pagination"));
  await page.setViewportSize({ width: 390, height: 1180 });
  await shot("sessions-mobile.png", page.locator("main"));
  await page.setViewportSize({ width: 1440, height: 1180 });
  await page.getByRole("link", { name: "Session 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show text", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Matching usage totals" }).locator('[data-exact="31,000"]')).toHaveText("31K");
  const turn = page.locator(".usage-turn");
  await page.getByRole("button", { name: "Inspect Turn 2", exact: true }).click();
  await expect(turn.locator(".call-summary")).toContainText("matching call");
  await expect(turn.locator(".request-list-row").first()).toContainText("Ending:");
  await shot("turn-summary-desktop.png", page.locator(".turn-explorer"));
  await page.setViewportSize({ width: 390, height: 1180 });
  await expect(turn.getByRole("button", { name: "Back to turns", exact: true })).toBeVisible();
  await shot("turn-summary-mobile.png", page.locator(".turn-explorer"));
  await page.setViewportSize({ width: 1440, height: 1180 });
  await turn.locator(".request-list-row").first().click();
  await expect(turn.locator(".usage-request")).toContainText("Exact child linkage");
  await shot("turn-requests-desktop.png", page.locator(".turn-explorer"));
  await turn.getByRole("link", { name: /Inspect .* attribution/ }).first().click();
  const child = page.locator(".attribution-group[open]").filter({ hasText: "Exact child linkage" });
  await expect(child).toContainText("File reads");
  await expect(child).toContainText("Search");
  await child.locator(".model-attribution > summary").click();
  await shot("session-detail.png", page.locator('section[aria-labelledby="attribution-heading"]'));
  await page.setViewportSize({ width: 390, height: 1180 });
  await shot("tool-activity-mobile.png", child.getByRole("region", { name: "Subagent 1 tool activity", exact: true }));
  await page.setViewportSize({ width: 1440, height: 1180 });
  const primaryHandle = new URL(page.url()).pathname.split("/").at(-1);

  await goto("/tokens?timeframe=30d");
  await page.locator(".performance-group > summary").filter({ hasText: "Child invocations" }).click();
  await shot("token-usage.png", null, page.locator("#performance"));
  await shot("token-models.png", page.locator("#models"));
  await page.getByRole("link", { name: "Compare models", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Models you actually used", exact: true })).toBeVisible();
  await shot("comparison-observed.png", null, page.locator('section[aria-labelledby="observed-heading"]'));
  await page.getByRole("button", { name: "What-if cost", exact: true }).click();
  await page.getByLabel("Baseline model", { exact: true }).selectOption("gpt-5.4");
  await page.getByLabel("Alternative 2", { exact: true }).selectOption("");
  await page.getByLabel("Alternative 1", { exact: true }).selectOption("claude-haiku-4.5");
  await page.getByLabel("Alternative 2", { exact: true }).selectOption("gpt-6-astra");
  await expect(page.getByRole("region", { name: "What-if model comparison" })).toContainText("Baseline scenario, not recorded spend");
  await shot("comparison-what-if.png", page.locator('section[aria-labelledby="what-if-heading"]'));

  await goto(`/tokens/compare?timeframe=all&session=${primaryHandle}`);
  await page.getByRole("button", { name: "What-if cost", exact: true }).click();
  await page.getByLabel("Alternative 2", { exact: true }).selectOption("");
  await page.getByLabel("Alternative 1", { exact: true }).selectOption("claude-haiku-4.5");
  await page.getByRole("button", { name: "Choose for trial: Claude Haiku 4.5", exact: true }).click();
  await page.getByRole("button", { name: "Save local baseline", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saved snapshot", exact: true })).toBeVisible();
  forbidden.push(fixture.addLaterSession());
  await page.getByRole("button", { name: "Check for newer sessions", exact: true }).click();
  await page.getByRole("link", { name: "Compare later session 1", exact: true }).click();
  await expect(page.getByRole("region", { name: "Recorded baseline comparison" })).toContainText("13.5K");
  await expect(page.getByText(/Differences do not establish savings, quality/)).toBeVisible();
  await shot("comparison-baseline.png", page.locator(".comparison-baseline"));
  await goto("/settings");
  await expect(page.getByRole("checkbox", { name: "Enable VS Code" })).not.toBeChecked();
  await expect(page.locator("main").getByRole("button", { name: "Presentation mode: On", exact: true })).toBeVisible();
  await shot("settings.png", null, page.locator("main > .card").last());
  await goto("/?timeframe=30d", emptyBase);
  await expect(page.getByRole("link", { name: "Check Data Sources", exact: true })).toBeInViewport();
  await shot("empty-overview.png", null, page.locator(".source-coverage"));

  await Promise.all(checks);
  assert.deepEqual(errors, []);
  assert.deepEqual({ ...counts, inspectedApiResponses: 0, screenshots: 0 }, {
    contentBlocked: 0, externalBlocked: 0, mutationBlocked: 0, unknownApiBlocked: 0, inspectedApiResponses: 0, screenshots: 0,
  }, "Unexpected blocked requests during normal gallery flow.");
  assert.equal(counts.screenshots, GALLERY_IMAGES.length);
  // Exercise the guards after capture; these synthetic probes must never reach a server.
  const reached = [];
  const record = (request) => reached.push({ url: request.url, method: request.method });
  server.on("request", record);
  await goto("/?timeframe=all");
  await page.evaluate(async () => {
    const requests = [
      ["/api/sessions/" + "a".repeat(64) + "/content", { method: "POST", body: "{}" }],
      ["https://example.invalid/capture-guard", {}],
      ["/api/settings", { method: "PATCH", body: "{}" }],
    ];
    await Promise.all(requests.map(async ([url, options]) => {
      try { await fetch(url, options); throw new Error("Capture guard allowed a forbidden request."); }
      catch (error) { if (error.message === "Capture guard allowed a forbidden request.") throw error; }
    }));
  });
  server.off("request", record);
  assert.ok(!reached.some((request) => request.url?.includes("/content") || request.method !== "GET"));
  assert.equal(counts.contentBlocked, 1);
  assert.equal(counts.externalBlocked, 1);
  assert.equal(counts.mutationBlocked, 1);
  await Promise.all(checks);
  assert.deepEqual(errors, []);
  const images = await Promise.all(GALLERY_IMAGES.map(async (name) => {
    const buffer = await readFile(join(output, name));
    assert.equal(buffer.subarray(1, 4).toString(), "PNG");
    return { name, sha256: sha(buffer), bytes: buffer.length, width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }));
  const manifest = {
    generatedAt: new Date().toISOString(), source: "Isolated synthetic SessionDB and session-state JSONL only",
    label: GALLERY_LABEL, browser: "Microsoft Edge isolated context", uiIndexSha256: buildHash,
    presentationMode: true, ...counts, blockedRequestsArePostCaptureGuardProbes: true,
    realSourceReads: 0, contentOrRawIdentifiersRendered: false,
    baseline: "Saved via UI; a new fabricated session is then inserted into the same synthetic database, selected via fresh metadata",
    images,
  };
  const destination = requestedOutput || output;
  if (destination !== output) {
    await mkdir(destination, { recursive: true });
    if (publish) {
      const unexpected = (await readdir(destination)).filter((name) => !GALLERY_IMAGES.includes(name));
      assert.deepEqual(unexpected, [], "Review obsolete gallery assets before publication; nothing is silently deleted.");
    }
    for (const name of GALLERY_IMAGES) await copyFile(join(output, name), join(destination, name));
  }
  await writeFile(join(output, "gallery-validation.json"), JSON.stringify(manifest, null, 2) + "\n");
  if (!publish && destination !== output) {
    await copyFile(join(output, "gallery-validation.json"), join(destination, "gallery-validation.json"));
    await rm(output, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ status: "passed", gallery: destination, manifest: join(publish ? output : destination, "gallery-validation.json"), ...counts }));
  succeeded = true;
} finally {
  await browser?.close();
  await close(server);
  await close(emptyServer);
  await rm(fixture.directory, { recursive: true, force: true });
  await rm(empty.directory, { recursive: true, force: true });
  if (!succeeded) await rm(output, { recursive: true, force: true });
}
