#!/usr/bin/env node
// Captures screenshots of each dashboard page using Playwright.
// Usage: node scripts/capture-screenshots.mjs

import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MOCK_DB = resolve(ROOT, "mock-session-store.db");
const SCREENSHOTS_DIR = resolve(ROOT, "docs", "screenshots");
const PORT = 3099; // avoid clashing with a running dev server

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

  const pages = [
    { path: "/",          name: "overview" },
    { path: "/learn",     name: "learn" },
    { path: "/sessions",  name: "sessions" },
    { path: "/analytics", name: "analytics" },
    { path: "/coaching",  name: "coaching" },
  ];

  for (const p of pages) {
    console.log(`📸 Capturing ${p.name}…`);
    await page.goto(`${baseUrl}${p.path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000); // let charts animate
    const outPath = resolve(SCREENSHOTS_DIR, `${p.name}.png`);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`   → ${outPath}`);
  }

  // Session detail — click first session from the sessions list
  console.log("📸 Capturing session-detail…");
  await page.goto(`${baseUrl}/sessions`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Click the first session link/row
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

  await browser.close();
  console.log("✅ All screenshots captured");
} finally {
  server.kill();
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
