#!/usr/bin/env node
// Captures screenshots and demo GIFs of each dashboard page using Playwright.
// Usage: node scripts/capture-screenshots.mjs [--gif] [--pages practice,overview,live,...]
//
// Flags:
//   --gif           Also record animated GIFs for pages that have interactions
//   --pages <list>  Comma-separated page names to capture (default: all)

import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MOCK_DB = resolve(ROOT, "mock-session-store.db");
const MOCK_SESSION_STATE = resolve(ROOT, "mock-session-state");
const SCREENSHOTS_DIR = resolve(ROOT, "docs", "screenshots");
const PORT = 3099; // avoid clashing with a running dev server

// ── Parse CLI flags ─────────────────────────────────────────────

const args = process.argv.slice(2);
const doGif = args.includes("--gif");
const pagesFlag = args.find((_, i, a) => a[i - 1] === "--pages");
const pageFilter = pagesFlag ? pagesFlag.split(",") : null;

// Resolve ffmpeg from ffmpeg-static (dev dependency)
let ffmpegPath;
try {
  const mod = await import("ffmpeg-static");
  ffmpegPath = mod.default;
} catch {
  if (doGif) {
    console.error("❌ ffmpeg-static not installed. Run: npm install --save-dev ffmpeg-static");
    process.exit(1);
  }
}

// ── 1. Seed the mock database ───────────────────────────────────

console.log("🌱 Seeding mock database…");
const seedResult = await runNode(resolve(__dirname, "seed-mock-db.mjs"));
if (seedResult !== 0) {
  console.error("❌ Seeding failed"); process.exit(1);
}

if (!existsSync(MOCK_DB)) {
  console.error("❌ Mock database not found at", MOCK_DB); process.exit(1);
}

mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// ── 2. Start the server with the mock database ──────────────────

console.log("🚀 Starting server on port", PORT, "…");
const server = spawn(process.execPath, ["index.mjs"], {
  cwd: resolve(ROOT, "server"),
  env: {
    ...process.env,
    COPILOT_SESSION_DB: MOCK_DB,
    COPILOT_SESSION_STATE_PATH: MOCK_SESSION_STATE,
    PORT: String(PORT),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (d) => { serverOutput += d.toString(); });
server.stderr.on("data", (d) => { serverOutput += d.toString(); });

// Wait for the server to be ready
await waitForServer(`http://127.0.0.1:${PORT}/api/sessions`, 20_000);
console.log("✅ Server is ready");

// ── 3. Capture screenshots ─────────────────────────────────────

try {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const baseUrl = `http://127.0.0.1:${PORT}`;

  const allPages = [
    { path: "/welcome",   name: "welcome" },
    { path: "/",          name: "overview" },
    { path: "/learn",     name: "learn" },
    { path: "/sessions",  name: "sessions" },
    { path: "/analytics", name: "analytics" },
    { path: "/coaching",      name: "coaching" },
    { path: "/practice",      name: "practice" },
    { path: "/instructions",  name: "instructions" },
    { path: "/live",          name: "live" },
    { path: "/tokens",        name: "token-usage" },
  ];

  const filtered = pageFilter
    ? allPages.filter((p) => pageFilter.includes(p.name))
    : allPages;

  for (const p of filtered) {
    // Practice page: navigate to Rewrite Challenge with a loaded challenge
    if (p.name === "practice") {
      console.log("📸 Capturing practice (Rewrite Challenge with coaching panel)…");
      await page.goto(`${baseUrl}${p.path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);

      // Click "Rewrite Challenge" tab
      const challengeTab = page.locator("button", { hasText: "Rewrite Challenge" });
      if (await challengeTab.count()) {
        await challengeTab.click();
        await page.waitForTimeout(500);
      }

      // Click "Prompt Library" source button
      const libraryBtn = page.locator("button", { hasText: "Prompt Library" });
      if (await libraryBtn.count()) {
        await libraryBtn.click();
        await page.waitForTimeout(500);
      }

      // Click "Pick Random Challenge" or similar to load a challenge
      const pickBtn = page.locator("button", { hasText: /random|pick|challenge/i });
      if (await pickBtn.count()) {
        await pickBtn.first().click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(2000);
      }

      const outPath = resolve(SCREENSHOTS_DIR, `${p.name}.png`);
      await page.screenshot({ path: outPath, fullPage: false });
      console.log(`   → ${outPath}`);
      continue;
    }

    // Token Usage page: capture Overview tab + Optimization tab
    if (p.name === "token-usage") {
      console.log("📸 Capturing token-usage (Overview tab)…");
      await page.goto(`${baseUrl}${p.path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2500);
      let outPath = resolve(SCREENSHOTS_DIR, "token-usage.png");
      await page.screenshot({ path: outPath, fullPage: false });
      console.log(`   → ${outPath}`);

      // Capture the Optimization tab
      console.log("📸 Capturing token-optimization (Optimization tab)…");
      const optimTab = page.locator("button", { hasText: "Optimization" });
      if (await optimTab.count()) {
        await optimTab.click();
        await page.waitForTimeout(2000);
      }
      outPath = resolve(SCREENSHOTS_DIR, "token-optimization.png");
      await page.screenshot({ path: outPath, fullPage: false });
      console.log(`   → ${outPath}`);

      // Capture the Models tab
      console.log("📸 Capturing token-models (Models tab)…");
      const modelsTab = page.locator("button", { hasText: "Models" });
      if (await modelsTab.count()) {
        await modelsTab.click();
        await page.waitForTimeout(2000);
      }
      outPath = resolve(SCREENSHOTS_DIR, "token-models.png");
      await page.screenshot({ path: outPath, fullPage: false });
      console.log(`   → ${outPath}`);
      continue;
    }

    console.log(`📸 Capturing ${p.name}…`);
    await page.goto(`${baseUrl}${p.path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000); // let charts animate
    const outPath = resolve(SCREENSHOTS_DIR, `${p.name}.png`);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`   → ${outPath}`);
  }

  // Session detail — click first session from the sessions list
  if (!pageFilter || pageFilter.includes("session-detail")) {
    console.log("📸 Capturing session-detail…");
    await page.goto(`${baseUrl}/sessions`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);


    const sessionLink = page.locator("a[href^='/sessions/']").first();
    if (await sessionLink.count()) {
      await sessionLink.click();
      await page.waitForURL(/\/sessions\/.+/);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);
    }
    const detailPath = resolve(SCREENSHOTS_DIR, "session-detail.png");
    await page.screenshot({ path: detailPath, fullPage: false });
    console.log(`   → ${detailPath}`);
  }

  // ── 4. Record full-app demo GIF (optional) ─────────────────────

  if (doGif) {
    console.log("\n🎬 Recording full-app demo GIF…");
    await recordFullDemoGif(browser, baseUrl);
  }

  await browser.close();
  console.log("\n✅ All captures complete");
} finally {
  server.kill();
}

// ── GIF recorder ────────────────────────────────────────────────

/**
 * Record a single full-app demo GIF that walks through the major pages:
 * Overview → Sessions → Session Detail → Coaching → Analytics → Practice
 * (type a prompt) → Live Monitor. Outputs docs/screenshots/demo.gif.
 */
async function recordFullDemoGif(browser, baseUrl) {
  console.log("🎬 Recording demo.gif (full-app walkthrough)…");
  const videoDir = resolve(SCREENSHOTS_DIR, ".video-tmp");
  mkdirSync(videoDir, { recursive: true });

  const gifContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "dark",
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
  });
  const gifPage = await gifContext.newPage();

  // ── Scene 0: Welcome — show onboarding flow ────────────────────
  await gifPage.goto(`${baseUrl}/welcome`, { waitUntil: "networkidle" });
  await gifPage.waitForTimeout(2500);

  // Click through the 3 steps
  for (let i = 0; i < 2; i++) {
    const nextBtn = gifPage.locator("button", { hasText: "Next" }).first();
    if (await nextBtn.count()) {
      await nextBtn.click();
      await gifPage.waitForTimeout(1500);
    }
  }
  await gifPage.waitForTimeout(1000);

  // ── Scene 1: Overview — show the main dashboard ───────────────
  await gifPage.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await gifPage.waitForTimeout(3000);

  // ── Scene 2: Sessions list ────────────────────────────────────
  await gifPage.goto(`${baseUrl}/sessions`, { waitUntil: "networkidle" });
  await gifPage.waitForTimeout(2000);

  // ── Scene 3: Click into a session detail ──────────────────────
  const sessionLink = gifPage.locator("a[href^='/sessions/']").first();
  if (await sessionLink.count()) {
    await sessionLink.click();
    await gifPage.waitForURL(/\/sessions\/.+/);
    await gifPage.waitForLoadState("networkidle");
    await gifPage.waitForTimeout(2500);
  }

  // ── Scene 4: Coaching ─────────────────────────────────────────
  await gifPage.goto(`${baseUrl}/coaching`, { waitUntil: "networkidle" });
  await gifPage.waitForTimeout(2000);

  // ── Scene 5: Analytics ────────────────────────────────────────
  await gifPage.goto(`${baseUrl}/analytics`, { waitUntil: "networkidle" });
  await gifPage.waitForTimeout(2000);

  // ── Scene 6: Practice Lab — type a prompt ─────────────────────
  await gifPage.goto(`${baseUrl}/practice`, { waitUntil: "networkidle" });
  await gifPage.waitForTimeout(1500);

  const textarea = gifPage.locator(".practice-textarea").first();
  try {
    await textarea.waitFor({ state: "visible", timeout: 10_000 });
    await textarea.click();
    await textarea.type("fix the bug", { delay: 60 });
    await gifPage.waitForTimeout(2000);

    await textarea.fill("");
    await gifPage.waitForTimeout(400);
    await textarea.type(
      "The login endpoint POST /api/auth/login returns 401 for valid credentials. " +
      "Debug JWT verification in src/middleware/auth.ts — the token expiry check on " +
      "line 42 compares seconds vs milliseconds. Add a unit test in tests/auth.test.ts.",
      { delay: 20 },
    );
    await gifPage.waitForTimeout(2500);
  } catch {
    console.warn("⚠️  Practice textarea not found — skipping typing scene");
  }

  // ── Scene 7: Token Usage ───────────────────────────────────────
  await gifPage.goto(`${baseUrl}/tokens`, { waitUntil: "networkidle" });
  await gifPage.waitForTimeout(2500);

  // Switch to Optimization tab
  const optimTab = gifPage.locator("button", { hasText: "Optimization" });
  if (await optimTab.count()) {
    await optimTab.click();
    await gifPage.waitForTimeout(2000);
  }

  // ── Scene 8: Live Monitor ─────────────────────────────────────
  await gifPage.goto(`${baseUrl}/live`, { waitUntil: "networkidle" });
  await gifPage.waitForTimeout(3000);

  // ── Finalize ──────────────────────────────────────────────────
  const videoPath = await gifPage.video().path();
  await gifContext.close();

  const gifPath = resolve(SCREENSHOTS_DIR, "demo.gif");
  try {
    execFileSync(ffmpegPath, [
      "-y", "-i", videoPath,
      "-vf", "fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
      "-loop", "0",
      gifPath,
    ], { stdio: "pipe" });
    console.log(`   → ${gifPath}`);
  } catch (err) {
    console.error("⚠️  GIF conversion failed:", err.stderr?.toString().slice(0, 200));
  }

  // Clean up temp video
  try { unlinkSync(videoPath); } catch { /* ignore */ }
  try {
    const { rmSync } = await import("node:fs");
    rmSync(videoDir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// ── Helpers ─────────────────────────────────────────────────────

function runNode(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: "inherit" });
    child.on("close", (code) => resolve(code));
  });
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error("Server output:\n", serverOutput);
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}
