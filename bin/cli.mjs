#!/usr/bin/env node

// CLI entry point — starts the Copilot Insights dashboard server.
// Usage: copilot-insights [--port 3002]

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = resolve(__dirname, "..", "server");

const portArg = process.argv.indexOf("--port");
const port = portArg !== -1 ? process.argv[portArg + 1] : process.env.PORT || "3002";

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
