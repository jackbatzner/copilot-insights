import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("packages every local usage runtime dependency without retired content modules", () => {
  const output = execSync("npm pack --dry-run --ignore-scripts --json", {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  const [pack] = JSON.parse(output);
  const paths = new Set(pack.files.map((file) => file.path));
  for (const path of [
    "bin/cli.mjs",
    ".github/extensions/copilot-insights/extension.mjs",
    "server/index.mjs",
    "server/package.json",
    "server/local-state.mjs",
    "server/usage-service.mjs",
    "src/runtime-telemetry.mjs",
    "src/usage-metrics.mjs",
    "src/db.mjs",
    "src/session-state.mjs",
    "src/extension-runtime.mjs",
    "src/formatter.mjs",
  ]) {
    assert.ok(paths.has(path), `Missing packaged runtime file: ${path}`);
  }
  for (const path of [
    "src/instructions.mjs",
    "src/instruction-failures.mjs",
    "src/practice.mjs",
    "src/dev-plan.mjs",
    "src/chronicle.mjs",
    "src/replay.mjs",
  ]) {
    assert.ok(!paths.has(path), `Retired content module is packaged: ${path}`);
  }
});
