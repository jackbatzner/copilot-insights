#!/usr/bin/env node

// CLI entry point — starts the Copilot Insights dashboard server.
// Usage: copilot-insights [link | unlink | --port 3002]

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT } from "../src/defaults.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SERVER_DIR = resolve(ROOT, "server");

// --- Subcommands: link / unlink ---

const subcommand = process.argv[2];

if (subcommand === "link") {
  const { linkExtension } = await import("../src/link.mjs");
  const { message } = linkExtension(ROOT);
  console.log(`🔗 ${message}`);
  process.exit(0);
}

if (subcommand === "unlink") {
  const { unlinkExtension } = await import("../src/link.mjs");
  const { message } = unlinkExtension();
  console.log(`🔗 ${message}`);
  process.exit(0);
}

// --- Default: start the dashboard server ---

const portArg = process.argv.indexOf("--port");
const port = portArg !== -1 ? process.argv[portArg + 1] : process.env.PORT || String(DEFAULT_PORT);

const portNum = Number(port);
if (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
  console.error("❌ Invalid port. Must be an integer between 1024 and 65535.");
  process.exit(1);
}

console.log(`\n💡 Copilot Insights — starting dashboard on http://localhost:${port}\n`);

const server = spawn("node", ["index.mjs"], {
  cwd: SERVER_DIR,
  env: { ...process.env, PORT: String(port) },
  stdio: "inherit",
});

server.on("error", (err) => {
  console.error(`❌ Failed to start: ${err.message}`);
  process.exit(1);
});

process.on("SIGINT", () => {
  server.kill("SIGTERM");
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.kill("SIGTERM");
  process.exit(0);
});
