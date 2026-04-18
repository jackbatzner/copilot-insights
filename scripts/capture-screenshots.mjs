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
    { path: "/",          name: "overview" },
    { path: "/learn",     name: "learn" },
    { path: "/sessions",  name: "sessions" },
    { path: "/analytics", name: "analytics" },
    { path: "/coaching",  name: "coaching" },
    { path: "/practice",  name: "practice" },
    { path: "/live",      name: "live" },
  ];

  const filtered = pageFilter
    ? allPages.filter((p) => pageFilter.includes(p.name))
    : allPages;

  for (const p of filtered) {
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

  // ── 4. Record GIFs (optional) ─────────────────────────────────

  if (doGif) {
    console.log("\n🎬 Recording demo GIFs…");

    // Practice Lab demo — type a prompt and watch the score update
    if (!pageFilter || pageFilter.includes("practice")) {
      await recordPracticeGif(browser, baseUrl);
    }

    // Live Monitor demo
    if (!pageFilter || pageFilter.includes("live")) {
      await recordLiveGif(page, baseUrl);
    }
  }

  await browser.close();
  console.log("\n✅ All captures complete");
} finally {
  server.kill();
}

// ── GIF recorders ───────────────────────────────────────────────

async function recordPracticeGif(browser, baseUrl) {
  console.log("🎬 Recording practice-demo.gif…");
  const videoDir = resolve(SCREENSHOTS_DIR, ".video-tmp");
  mkdirSync(videoDir, { recursive: true });

  const gifContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: "dark",
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
  });
  const gifPage = await gifContext.newPage();

  // Navigate to Practice Lab
  await gifPage.goto(`${baseUrl}/practice`, { waitUntil: "networkidle" });
  await gifPage.waitForTimeout(2000);

  const textarea = gifPage.locator(".practice-textarea").first();
  try {
    await textarea.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    console.warn("⚠️  Practice textarea not found — skipping GIF (SPA may not have hydrated)");
    await gifContext.close();
    return;
  }

  // ── Scene 1: Type a vague prompt → low score ──────────────────
  await textarea.click();
  await textarea.type("fix the bug in the auth module", { delay: 60 });
  await gifPage.waitForTimeout(2500); // let analysis + gauge animate

  // ── Scene 2: Clear and type a well-structured prompt → high score
  await textarea.fill("");
  await gifPage.waitForTimeout(600);
  const goodPrompt =
    "The login endpoint POST /api/auth/login returns 401 for valid credentials. " +
    "Debug the JWT verification in src/middleware/auth.ts — the token expiry " +
    "check on line 42 compares seconds vs milliseconds. Add a unit test for " +
    "the fix in tests/auth.test.ts.";
  await textarea.type(goodPrompt, { delay: 25 });
  await gifPage.waitForTimeout(3000); // let the high score render

  // ── Scene 3: Switch to Challenge tab briefly ──────────────────
  const challengeTab = gifPage.locator("button", { hasText: "Rewrite Challenge" });
  if (await challengeTab.count()) {
    await challengeTab.click();
    await gifPage.waitForTimeout(3000); // show the challenge UI
  }

  // Close context to finalize video
  const videoPath = await gifPage.video().path();
  await gifContext.close();

  // Convert webm → gif with ffmpeg-static
  const gifPath = resolve(SCREENSHOTS_DIR, "practice-demo.gif");
  try {
    execFileSync(ffmpegPath, [
      "-y", "-i", videoPath,
      "-vf", "fps=12,scale=960:-1:flags=lanczos",
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

/**
 * Record ~8 seconds of the Live Monitor page, showing the real-time feed
 * updating with pattern badges and coaching alerts. Outputs a GIF.
 */
async function recordLiveGif(page, baseUrl) {
  console.log("🎥 Recording Live Monitor GIF…");

  const webmPath = resolve(SCREENSHOTS_DIR, "live-demo.webm");
  const gifPath = resolve(SCREENSHOTS_DIR, "live-demo.gif");

  // Navigate to the live page and let it poll
  await page.goto(`${baseUrl}/live`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000); // let initial data load

  // Start screen recording
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.startScreencast", { format: "png", maxWidth: 1280, maxHeight: 800 });

  // Collect frames for ~8 seconds
  const frames = [];
  cdp.on("Page.screencastFrame", async (params) => {
    frames.push(Buffer.from(params.data, "base64"));
    await cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId });
  });

  await page.waitForTimeout(8000);
  await cdp.send("Page.stopScreencast");

  if (frames.length === 0) {
    console.warn("⚠ No frames captured, skipping GIF generation");
    return;
  }

  // Write frames as individual PNGs and convert to GIF via ffmpeg
  const framesDir = resolve(SCREENSHOTS_DIR, "_frames");
  mkdirSync(framesDir, { recursive: true });

  for (let i = 0; i < frames.length; i++) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(resolve(framesDir, `frame-${String(i).padStart(4, "0")}.png`), frames[i]);
  }

  // Find ffmpeg binary
  let ffmpegBin;
  try {
    const ffmpegStaticPath = resolve(ROOT, "node_modules", "ffmpeg-static", "index.js");
    if (existsSync(ffmpegStaticPath)) {
      const mod = await import(`file://${ffmpegStaticPath.replace(/\\/g, "/")}`);
      ffmpegBin = mod.default || mod;
    }
  } catch { /* fall through */ }

  if (!ffmpegBin || !existsSync(ffmpegBin)) {
    // Try system ffmpeg
    ffmpegBin = "ffmpeg";
  }

  try {
    console.log(`   Converting ${frames.length} frames to GIF…`);
    execFileSync(ffmpegBin, [
      "-y",
      "-framerate", "10",
      "-i", resolve(framesDir, "frame-%04d.png"),
      "-vf", "fps=10,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
      gifPath,
    ], { stdio: "pipe" });
    console.log(`   → ${gifPath}`);
  } catch (err) {
    console.warn("⚠ ffmpeg conversion failed:", err.message);
    console.warn("   Install ffmpeg-static: npm install --save-dev ffmpeg-static");
  }

  // Clean up frames
  const { readdirSync } = await import("node:fs");
  for (const f of readdirSync(framesDir)) {
    unlinkSync(resolve(framesDir, f));
  }
  const { rmdirSync } = await import("node:fs");
  rmdirSync(framesDir);

  // Also clean up webm if it was created
  if (existsSync(webmPath)) unlinkSync(webmPath);
}
