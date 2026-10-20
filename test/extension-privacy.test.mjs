import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { join } from "node:path";
import { createExtension } from "../src/extension-runtime.mjs";
import { createUsageService } from "../server/usage-service.mjs";
import { createUsageFixture, assertPrivate, CANARY, RAW_ID } from "./usage-fixture.mjs";
import { usageFixture } from "./usage-fixtures.mjs";

async function unusedPort() {
  const reservation = createServer();
  await new Promise((done) => reservation.listen(0, "127.0.0.1", done));
  const port = reservation.address().port;
  await new Promise((done) => reservation.close(done));
  return port;
}

async function waitForStop(port) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { await fetch(`http://127.0.0.1:${port}/api/settings`, { signal: AbortSignal.timeout(300) }); }
    catch { return; }
    await new Promise((done) => setTimeout(done, 50));
  }
  assert.fail("Dashboard process did not stop.");
}

describe("usage-only extension registrations", () => {
  it("discovers every matching session through explicit pages without exposing private identifiers", async () => {
    const fixture = usageFixture();
    const options = { dbPath: fixture.dbPath, sessionStatePath: fixture.sessionStatePath, stateDir: join(fixture.root, "app") };
    const service = createUsageService(options);
    try {
      for (let index = 0; index < 26; index++) {
        const id = fixture.session(`PRIVATE_SESSION_${index}`);
        fixture.usage(id);
      }
      const extension = createExtension(options);
      const tool = extension.tools.find((entry) => entry.name === "insights_sessions");
      assert.deepEqual(tool.parameters.properties.page, { type: "integer", minimum: 1, maximum: 1000000, default: 1 });
      const filters = { timeframe: "all", model: "gpt-5.4" };
      const first = await tool.handler(filters);
      const second = await tool.handler({ ...filters, page: 2 });
      assert.match(first, /\*\*Page:\*\* 1 of 2; \*\*Matching sessions:\*\* 26/);
      assert.match(first, /page: 2 and the same filters/);
      assert.match(second, /\*\*Page:\*\* 2 of 2/);
      assert.match(second, /No more matching sessions/);
      const expected = service.sessions({ ...filters, pageSize: 100 }).sessions.map((row) => row.handle).sort();
      const found = [...first.matchAll(/`([a-f0-9]{64})`/g), ...second.matchAll(/`([a-f0-9]{64})`/g)].map((match) => match[1]).sort();
      assert.deepEqual(found, expected);
      assert.equal(found.length, 26);
      assert.match(await extension.tools.find((entry) => entry.name === "insights_session").handler({ handle: found[25] }), /usage/);
      assert.equal((await tool.handler({ ...filters, page: 0 })).resultType, "failure");
      assert.equal((await tool.handler({ ...filters, page: 1000001 })).resultType, "failure");
      for (const output of [first, second]) {
        assertPrivate(assert, output);
        assert.doesNotMatch(output, /PRIVATE_/);
      }
    } finally { service.close(); fixture.cleanup(); }
  });

  it("registers only lifecycle and sanitized usage tools with closed schemas", () => {
    const extension = createExtension();
    assert.deepEqual(extension.tools.map((tool) => tool.name), [
      "insights_dashboard", "insights_stop", "insights_summary", "insights_sessions", "insights_session", "insights_models",
    ]);
    for (const tool of extension.tools) {
      assert.equal(tool.parameters.additionalProperties, false);
      assertPrivate(assert, tool.parameters);
    }
    const session = extension.tools.find((tool) => tool.name === "insights_session");
    assert.deepEqual(session.parameters.required, ["handle"]);
    assert.ok(!("session_id" in session.parameters.properties));
  });

  it("executes real fixture-backed tools with the same handles as the HTTP service", async () => {
    const fixture = createUsageFixture();
    const service = createUsageService(fixture.options);
    try {
      const extension = createExtension(fixture.options);
      const handle = service.sessions({ timeframe: "all" }).sessions[0].handle;
      for (const name of ["insights_summary", "insights_sessions", "insights_session", "insights_models"]) {
        const tool = extension.tools.find((entry) => entry.name === name);
        const output = await tool.handler(name === "insights_session" ? { handle } : { timeframe: "all" });
        assert.equal(typeof output, "string", name);
        assertPrivate(assert, output);
        if (name === "insights_sessions" || name === "insights_session") assert.ok(output.includes(handle));
      }
      const tool = extension.tools.find((entry) => entry.name === "insights_session");
      for (const args of [{ handle: RAW_ID }, { session_id: RAW_ID }, { handle, prompt: CANARY }]) {
        const output = await tool.handler(args);
        assert.equal(output.resultType, "failure");
        assertPrivate(assert, output);
      }
      const summary = extension.tools.find((entry) => entry.name === "insights_summary");
      const invalid = await summary.handler({ prompt: CANARY });
      assert.equal(invalid.resultType, "failure");
      assertPrivate(assert, invalid);
      await extension.hooks.onSessionEnd();
    } finally { service.close(); fixture.cleanup(); }
  });

  it("launches a responsive synthetic dashboard, reports the actual port, and stops its child", async () => {
    const fixture = createUsageFixture();
    const extension = createExtension(fixture.options);
    const launch = extension.tools.find((entry) => entry.name === "insights_dashboard");
    const stop = extension.tools.find((entry) => entry.name === "insights_stop");
    const port = await unusedPort();
    try {
      const result = await launch.handler({ port });
      assert.equal(typeof result, "string", JSON.stringify(result));
      assert.ok(result.includes(`http://127.0.0.1:${port}`));
      assertPrivate(assert, result);
      const response = await fetch(`http://127.0.0.1:${port}/api/summary?timeframe=all`);
      const snapshot = await response.json();
      assert.equal(response.status, 200);
      assert.equal(snapshot.metrics.requests, 3);
      assertPrivate(assert, snapshot);
      const cliSessions = await extension.tools.find((entry) => entry.name === "insights_sessions").handler({ timeframe: "all" });
      for (const session of snapshot.sessions) assert.ok(cliSessions.includes(session.handle));
      const already = await launch.handler({ port: port === 65535 ? port - 1 : port + 1 });
      assert.ok(already.includes(`http://127.0.0.1:${port}`));
      await stop.handler();
      await waitForStop(port);
    } finally {
      await extension.hooks.onSessionEnd();
      await waitForStop(port);
      fixture.cleanup();
    }
  });

  it("does not claim another process listening on the requested port is its dashboard", async () => {
    const fixture = createUsageFixture();
    const extension = createExtension(fixture.options);
    const occupied = createServer();
    await new Promise((done) => occupied.listen(0, "127.0.0.1", done));
    const port = occupied.address().port;
    try {
      const output = await extension.tools.find((entry) => entry.name === "insights_dashboard").handler({ port });
      assert.equal(output.resultType, "failure");
      assertPrivate(assert, output);
      assert.equal(occupied.listening, true);
    } finally {
      await extension.hooks.onSessionEnd();
      await new Promise((done) => occupied.close(done));
      fixture.cleanup();
    }
  });
});
