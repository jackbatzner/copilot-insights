import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { startServer } from "../server/index.mjs";
import { createExtension } from "../src/extension-runtime.mjs";
import { createUsageFixture, assertPrivate, CANARY } from "./usage-fixture.mjs";

describe("source failure privacy", () => {
  it("reports absent usage sources explicitly without creating them", async () => {
    const fixture = createUsageFixture();
    const options = { ...fixture.options, dbPath: join(fixture.root, "absent.db"), sessionStatePath: join(fixture.root, "absent-state") };
    const server = await startServer({ ...options, port: 0 });
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/summary`);
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.capabilities.sessionDb, "unavailable");
      assert.equal(body.capabilities.sessionState, "unavailable");
      assert.equal(body.sessionCount, 0);
      assert.equal(body.metrics.requests, null);
      assert.equal(body.capabilities.usageTable, false);
      assert.equal(existsSync(options.dbPath), false);
      assert.equal(existsSync(options.sessionStatePath), false);
      assertPrivate(assert, body);
      const extension = createExtension(options);
      const output = await extension.tools.find((tool) => tool.name === "insights_summary").handler();
      assert.match(output, /unavailable/);
      assertPrivate(assert, output);
    } finally {
      await new Promise((done) => { server.close(done); server.closeAllConnections(); });
      fixture.cleanup();
    }
  });

  it("never exposes the persisted secret and reports unreadable preferences as safe errors", async () => {
    const fixture = createUsageFixture();
    const server = await startServer({ ...fixture.options, port: 0 });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      assert.equal((await fetch(`${base}/api/settings`)).status, 200);
      const file = join(fixture.options.stateDir, "usage-state.json");
      const { secret } = JSON.parse(readFileSync(file, "utf8"));
      for (const path of ["/api/summary", "/api/sessions", "/api/settings"]) {
        const response = await fetch(`${base}${path}`);
        const text = await response.text();
        assert.equal(response.status, 200);
        assert.ok(!text.includes(secret));
        assertPrivate(assert, text);
      }
      writeFileSync(file, `${CANARY} invalid local state`);
      const response = await fetch(`${base}/api/settings`);
      assert.equal(response.status, 503);
      assertPrivate(assert, await response.json());
      const extension = createExtension(fixture.options);
      const output = await extension.tools.find((tool) => tool.name === "insights_summary").handler();
      assert.equal(output.resultType, "failure");
      assertPrivate(assert, output);
    } finally {
      await new Promise((done) => { server.close(done); server.closeAllConnections(); });
      fixture.cleanup();
    }
  });

  it("never serializes SQLite messages, paths or arbitrary errors", async () => {
    const fixture = createUsageFixture();
    writeFileSync(fixture.options.dbPath, `${CANARY} invalid SQLite`);
    const server = await startServer({ ...fixture.options, port: 0 });
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/summary`);
      const body = await response.json();
      assert.ok(response.status === 503 || body.capabilities?.sessionDb === "partial");
      assertPrivate(assert, body);
      const extension = createExtension(fixture.options);
      const output = await extension.tools.find((tool) => tool.name === "insights_summary").handler();
      assertPrivate(assert, output);
      if (typeof output !== "string") assert.equal(output.resultType, "failure");
    } finally {
      await new Promise((done) => { server.close(done); server.closeAllConnections(); });
      fixture.cleanup();
    }
  });

  it("scrubs unexpected application failures and malformed URLs", async () => {
    const fixture = createUsageFixture();
    const server = await startServer({
      port: 0,
      service: {
        snapshot: () => { throw new Error(`${CANARY} SELECT private FROM secret at C:\\private`); },
        close() {},
      },
    });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const response = await fetch(`${base}/api/summary`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "Local usage data is unavailable." });
      const malformed = await fetch(`${base}/api/sessions/%E0%A4%A`);
      assert.equal(malformed.status, 400);
      assertPrivate(assert, await malformed.json());
    } finally {
      await new Promise((done) => { server.close(done); server.closeAllConnections(); });
      fixture.cleanup();
    }
  });
});
