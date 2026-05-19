import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const cliPath = path.resolve("bin", "cli.mjs");

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
  });
}

describe("copilot-insights CLI help", () => {
  it("shows help for --help without starting the server", () => {
    const result = runCli(["--help"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /copilot-insights link/);
    assert.match(result.stdout, /--port/);
    assert.doesNotMatch(result.stdout, /starting dashboard/i);
  });

  it("returns a usage error for unknown commands", () => {
    const result = runCli(["unknown-command"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown command/);
    assert.match(result.stdout, /Usage:/);
  });
});
