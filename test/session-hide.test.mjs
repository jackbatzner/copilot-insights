import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFileSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { startServer } from "../server/index.mjs";
import { createUsageService } from "../server/usage-service.mjs";
import { createLocalState, MAX_HIDDEN } from "../server/local-state.mjs";
import { createUsageFixture, assertPrivate, RAW_ID } from "./usage-fixture.mjs";

describe("opaque session hiding persistence", () => {
  it("shares stable handles and hide preferences across independent server/CLI services and refresh", () => {
    const fixture = createUsageFixture();
    const first = createUsageService(fixture.options);
    const second = createUsageService(fixture.options);
    try {
      const sessions = first.sessions({ timeframe: "all" }).sessions;
      const handle = sessions[0].handle;
      assert.deepEqual(second.sessions({ timeframe: "all" }).sessions.map((s) => s.handle), sessions.map((s) => s.handle));
      assert.deepEqual(first.setHidden(handle, true), { hidden: true });
      assert.equal(second.sessions({ timeframe: "all" }).sessions.length, 1);
      assert.equal(first.snapshot({ timeframe: "all" }).sessionCount, 1);
      const hidden = second.sessions({ timeframe: "all", includeHidden: true }).sessions.find((s) => s.handle === handle);
      assert.equal(hidden.hidden, true);
      assert.equal(second.detail(handle).session.hidden, true);
      const restarted = createUsageService(fixture.options);
      try {
        assert.equal(restarted.detail(handle).session.hidden, true);
        assert.equal(restarted.snapshot({ timeframe: "all" }).sessionCount, 1);
      } finally { restarted.close(); }
      first.refresh();
      assert.equal(first.detail(handle).session.hidden, true);
      const persisted = readFileSync(join(fixture.options.stateDir, "usage-state.json"), "utf8");
      assertPrivate(assert, persisted);
      assert.deepEqual(JSON.parse(persisted).hiddenHandles, [handle]);
      assert.deepEqual(second.setHidden(handle, false), { hidden: false });
      assert.equal(first.sessions({ timeframe: "all" }).sessions.length, 2);
      assert.throws(() => first.setHidden(RAW_ID, true), /Invalid session handle/);
      assert.throws(() => first.setHidden("0".repeat(64), true), /Session not found/);
      assert.deepEqual(readdirSync(fixture.options.stateDir), ["usage-state.json"]);
    } finally {
      first.close();
      second.close();
      fixture.cleanup();
    }
  });

  it("rejects invalid and oversized state rather than silently unhiding sessions", () => {
    const fixture = createUsageFixture();
    try {
      const state = createLocalState(fixture.options);
      const original = state.read();
      const file = join(fixture.options.stateDir, "usage-state.json");
      writeFileSync(file, JSON.stringify({ ...original, hiddenHandles: [RAW_ID] }));
      assert.throws(() => createLocalState(fixture.options), /invalid/);
      writeFileSync(file, "x".repeat(400_001));
      assert.throws(() => createLocalState(fixture.options), /too large/);
      writeFileSync(file, JSON.stringify(original));
      assert.throws(() => state.update((local) => ({ ...local, hiddenHandles: Array(MAX_HIDDEN + 1).fill("a".repeat(64)) })), /invalid/);
      assert.deepEqual(state.read(), original);
      assert.deepEqual(readdirSync(fixture.options.stateDir), ["usage-state.json"]);
    } finally { fixture.cleanup(); }
  });

  it("keeps persisted sessions hidden when an absent source returns without an explicit refresh", () => {
    const fixture = createUsageFixture();
    const initial = createUsageService(fixture.options);
    const handle = initial.sessions({ timeframe: "all" }).sessions[0].handle;
    initial.setHidden(handle, true);
    initial.close();
    const offline = join(fixture.root, "offline.db");
    renameSync(fixture.options.dbPath, offline);
    const recovered = createUsageService(fixture.options);
    try {
      assert.equal(recovered.snapshot({ timeframe: "all" }).sessionCount, 0);
      renameSync(offline, fixture.options.dbPath);
      assert.equal(recovered.snapshot({ timeframe: "all" }).sessionCount, 1);
      assert.equal(recovered.detail(handle).session.hidden, true);
    } finally {
      recovered.close();
      fixture.cleanup();
    }
  });

  it("retains JSONL cache across repeated settings and summary requests with a stale hidden handle", async (t) => {
    const fixture = createUsageFixture();
    const state = createLocalState(fixture.options);
    state.update((local) => ({ ...local, hiddenHandles: ["f".repeat(64)] }));
    const server = await startServer({ ...fixture.options, service: createUsageService(fixture.options), port: 0 });
    const originalOpen = fs.openSync;
    let jsonlReads = 0;
    t.mock.method(fs, "openSync", function(file, ...args) {
      if (String(file).endsWith(".jsonl")) jsonlReads++;
      return originalOpen.call(this, file, ...args);
    });
    syncBuiltinESMExports();
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      async function get(path) {
        const response = await fetch(`${base}${path}`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assertPrivate(assert, body);
        return body;
      }
      await get("/api/settings");
      assert.equal(jsonlReads, 0);
      const cold = await get("/api/summary?timeframe=all");
      const coldReads = jsonlReads;
      assert.ok(coldReads > 0, "The cold summary must actually scan fixture JSONL.");
      for (let index = 0; index < 3; index++) {
        await get("/api/settings");
        const warm = await get("/api/summary?timeframe=all");
        assert.deepEqual(warm.metrics, cold.metrics);
        assert.equal(jsonlReads, coldReads, "Unresolved hidden handles must not discard the JSONL cache.");
      }
      assert.deepEqual(state.read().hiddenHandles, ["f".repeat(64)]);
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
      await new Promise((done) => { server.close(done); server.closeAllConnections(); });
      fixture.cleanup();
    }
  });

  it("fails explicitly on competing writes without losing existing preferences", () => {
    const fixture = createUsageFixture();
    try {
      const state = createLocalState(fixture.options);
      const original = state.read();
      writeFileSync(join(fixture.options.stateDir, "usage-state.lock"), "");
      assert.throws(() => state.update((local) => ({ ...local, enableVSCode: true })));
      assert.deepEqual(state.read(), original);
    } finally { fixture.cleanup(); }
  });
});
