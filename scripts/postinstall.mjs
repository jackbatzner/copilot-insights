#!/usr/bin/env node

// Cross-platform postinstall: installs server deps, UI deps, and builds the UI.

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function run(cmd, cwd) {
  console.log(`[postinstall] ${cwd}: ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

run("npm install --omit=dev", resolve(ROOT, "server"));
run("npm install --include=dev", resolve(ROOT, "ui"));
run("npm run build", resolve(ROOT, "ui"));
