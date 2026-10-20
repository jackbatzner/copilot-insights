import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLocalState, MAX_HIDDEN } from "../server/local-state.mjs";
import { createUsageService } from "../server/usage-service.mjs";
import { createExtension } from "../src/extension-runtime.mjs";
import { startServer } from "../server/index.mjs";
import { createUsageFixture, assertPrivate, RAW_ID, OTHER_ID, CANARY } from "./usage-fixture.mjs";

describe("one-time legacy preference migration", () => {
  it("preserves legacy hiding and explicit VS Code opt-in before the first HTTP or CLI response", async () => {
    const fixture = createUsageFixture();
    const hiddenFile = join(fixture.root, "copilot-insights-hidden.json");
    const settingsFile = join(fixture.root, "copilot-insights-settings.json");
    const hiddenText = JSON.stringify([RAW_ID, RAW_ID]);
    const settingsText = JSON.stringify({ vscodeSessionsEnabled: true });
    writeFileSync(hiddenFile, hiddenText);
    writeFileSync(settingsFile, settingsText);
    const server = await startServer({ ...fixture.options, port: 0 });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const summary = await (await fetch(`${base}/api/summary?timeframe=all`)).json();
      assert.equal(summary.sessionCount, 1);
      assertPrivate(assert, summary);
      const all = await (await fetch(`${base}/api/sessions?timeframe=all&includeHidden=true`)).json();
      const hidden = all.sessions.find((session) => session.hidden);
      assert.ok(hidden);
      assert.match(hidden.handle, /^[a-f0-9]{64}$/);
      const settings = await (await fetch(`${base}/api/settings`)).json();
      assert.equal(settings.enableVSCode, true);
      assert.equal(settings.vscode.status, "unavailable");
      const extension = createExtension(fixture.options);
      const sessions = await extension.tools.find((tool) => tool.name === "insights_sessions").handler({ timeframe: "all" });
      assert.ok(!sessions.includes(hidden.handle));
      const persisted = readFileSync(join(fixture.options.stateDir, "usage-state.json"), "utf8");
      assertPrivate(assert, persisted);
      assert.equal(JSON.parse(persisted).legacyMigrated, true);
      assert.deepEqual(JSON.parse(persisted).hiddenHandles, [hidden.handle]);
      assert.equal(readFileSync(hiddenFile, "utf8"), hiddenText);
      assert.equal(readFileSync(settingsFile, "utf8"), settingsText);
      assert.equal(readFileSync(fixture.coachingFile, "utf8"), CANARY);
    } finally {
      await new Promise((done) => { server.close(done); server.closeAllConnections(); });
      fixture.cleanup();
    }
  });

  it("hashes legacy IDs without requiring source availability, then keeps them hidden on recovery", () => {
    const fixture = createUsageFixture();
    writeFileSync(join(fixture.root, "copilot-insights-hidden.json"), JSON.stringify([RAW_ID]));
    const offline = join(fixture.root, "offline.db");
    renameSync(fixture.options.dbPath, offline);
    const service = createUsageService(fixture.options);
    try {
      assert.equal(service.snapshot({ timeframe: "all" }).sessionCount, 0);
      const persisted = readFileSync(join(fixture.options.stateDir, "usage-state.json"), "utf8");
      assertPrivate(assert, persisted);
      assert.equal(JSON.parse(persisted).hiddenHandles.length, 1);
      renameSync(offline, fixture.options.dbPath);
      assert.equal(service.snapshot({ timeframe: "all" }).sessionCount, 1);
    } finally { service.close(); fixture.cleanup(); }
  });

  it("migrates only once and preserves subsequent unhide/settings choices", () => {
    const fixture = createUsageFixture();
    const hiddenFile = join(fixture.root, "copilot-insights-hidden.json");
    const settingsFile = join(fixture.root, "copilot-insights-settings.json");
    writeFileSync(hiddenFile, JSON.stringify([RAW_ID]));
    writeFileSync(settingsFile, JSON.stringify({ vscodeSessionsEnabled: true }));
    const first = createUsageService(fixture.options);
    try {
      const hidden = first.sessions({ timeframe: "all", includeHidden: true }).sessions.find((session) => session.hidden);
      first.setHidden(hidden.handle, false);
      first.updateSettings({ enableVSCode: false });
    } finally { first.close(); }
    writeFileSync(hiddenFile, `${CANARY} malformed`);
    writeFileSync(settingsFile, `${CANARY} malformed`);
    const restarted = createUsageService(fixture.options);
    try {
      assert.equal(restarted.snapshot({ timeframe: "all" }).sessionCount, 2);
      assert.equal(restarted.settings().enableVSCode, false);
    } finally { restarted.close(); fixture.cleanup(); }
  });

  it("unions hidden choices into an existing new-format state without overriding its settings", () => {
    const fixture = createUsageFixture();
    const local = createLocalState(fixture.options);
    const service = createUsageService(fixture.options);
    try {
      const sessions = service.sessions({ timeframe: "all" }).sessions;
      service.setHidden(sessions.find((session) => session.models.includes("Unknown model")).handle, true);
    } finally { service.close(); }
    const original = local.read();
    const { legacyMigrated: _marker, ...preMigration } = original;
    writeFileSync(join(fixture.options.stateDir, "usage-state.json"), JSON.stringify(preMigration));
    writeFileSync(join(fixture.root, "copilot-insights-hidden.json"), JSON.stringify([RAW_ID, OTHER_ID]));
    writeFileSync(join(fixture.root, "copilot-insights-settings.json"), JSON.stringify({ vscodeSessionsEnabled: true }));
    const migrated = createUsageService(fixture.options);
    try {
      assert.equal(migrated.snapshot({ timeframe: "all" }).sessionCount, 0);
      assert.equal(migrated.settings().enableVSCode, false);
      const state = createLocalState(fixture.options).read();
      assert.equal(state.secret, original.secret);
      assert.equal(state.hiddenHandles.length, 2);
      assert.equal(state.legacyMigrated, true);
    } finally { migrated.close(); fixture.cleanup(); }
  });

  it("fails closed on malformed, invalid, or oversized legacy metadata without leaking or rewriting it", async () => {
    const cases = [
      ["copilot-insights-hidden.json", `${CANARY} malformed`],
      ["copilot-insights-hidden.json", JSON.stringify({ id: RAW_ID })],
      ["copilot-insights-hidden.json", JSON.stringify([RAW_ID, CANARY])],
      ["copilot-insights-hidden.json", JSON.stringify(Array(MAX_HIDDEN + 1).fill(RAW_ID))],
      ["copilot-insights-hidden.json", " ".repeat(256_001)],
      ["copilot-insights-settings.json", JSON.stringify({ vscodeSessionsEnabled: CANARY })],
      ["copilot-insights-settings.json", JSON.stringify({ unknown: CANARY })],
      ["copilot-insights-settings.json", " ".repeat(4097)],
    ];
    for (const [name, content] of cases) {
      const fixture = createUsageFixture();
      const legacyFile = join(fixture.root, name);
      writeFileSync(legacyFile, content);
      try {
        assert.throws(() => createLocalState(fixture.options), {
          message: "Legacy usage preferences could not be migrated.",
        });
        assert.equal(existsSync(join(fixture.options.stateDir, "usage-state.json")), false);
        const extension = createExtension(fixture.options);
        const output = await extension.tools.find((tool) => tool.name === "insights_summary").handler();
        assert.equal(output.resultType, "failure");
        assertPrivate(assert, output);
        assert.equal(readFileSync(legacyFile, "utf8"), content);
        assert.deepEqual(readdirSync(fixture.options.stateDir), []);
      } finally { fixture.cleanup(); }
    }
  });

  it("rejects a non-file legacy source and does not touch existing new-format state on migration failure", () => {
    const fixture = createUsageFixture();
    try {
      const state = createLocalState(fixture.options).read();
      delete state.legacyMigrated;
      const file = join(fixture.options.stateDir, "usage-state.json");
      const original = JSON.stringify(state);
      writeFileSync(file, original);
      mkdirSync(join(fixture.root, "copilot-insights-hidden.json"));
      assert.throws(() => createLocalState(fixture.options), /Legacy usage preferences could not be migrated/);
      assert.equal(readFileSync(file, "utf8"), original);
      assert.deepEqual(readdirSync(fixture.options.stateDir), ["usage-state.json"]);
    } finally { fixture.cleanup(); }
  });

  it("accepts the bounded legacy maximum but rejects a union exceeding the hidden-state bound atomically", () => {
    const fixture = createUsageFixture();
    const ids = Array.from({ length: MAX_HIDDEN }, (_, index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`);
    writeFileSync(join(fixture.root, "copilot-insights-hidden.json"), JSON.stringify(ids));
    try {
      const state = createLocalState(fixture.options).read();
      assert.equal(state.hiddenHandles.length, MAX_HIDDEN);
      assertPrivate(assert, state);
      delete state.legacyMigrated;
      const file = join(fixture.options.stateDir, "usage-state.json");
      const original = JSON.stringify(state);
      writeFileSync(file, original);
      writeFileSync(join(fixture.root, "copilot-insights-hidden.json"), JSON.stringify([RAW_ID]));
      assert.throws(() => createLocalState(fixture.options), /Legacy usage preferences could not be migrated/);
      assert.equal(readFileSync(file, "utf8"), original);
      assert.deepEqual(readdirSync(fixture.options.stateDir), ["usage-state.json"]);
    } finally { fixture.cleanup(); }
  });
});
