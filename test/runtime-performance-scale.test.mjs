import assert from "node:assert/strict";
import { it } from "node:test";
import { performance } from "node:perf_hooks";
import { createSessionExecutionReader } from "../src/session-state.mjs";
import { readUsageDb } from "../src/db.mjs";
import { event, usageFixture } from "./usage-fixtures.mjs";

it("benchmarks aggregate-sized synthetic source reads", { skip: process.env.COPILOT_INSIGHTS_SCALE_TEST !== "1" }, () => {
  const f = usageFixture();
  const sessions = 8166, requests = 72032;
  const now = new Date().toISOString(), old = "2000-01-01T00:00:00.000Z";
  let store;
  try {
    f.db.transaction(() => {
      for (let index = 0; index < sessions; index++) {
        f.session(`synthetic-${index}`, { createdAt: old, updatedAt: index < 2619 ? now : old });
      }
      for (let index = 0; index < requests; index++) f.usage(`synthetic-${index % 2401}`);
    })();
    for (let index = 0; index < sessions; index++) {
      f.events(`synthetic-${index}`, [
        { ...event("session.start", { selectedModel: "gpt-5.4" }), timestamp: index < 2619 ? now : old },
        { ...event("session.shutdown"), timestamp: index < 2619 ? now : old },
      ]);
    }
    const measure = (label, read) => {
      const start = performance.now();
      const value = read();
      console.log(JSON.stringify({ label, ms: Math.round(performance.now() - start), sessions, requests }));
      return value;
    };
    assert.equal(measure("sqlite-uncached", () => readUsageDb(f.dbPath)).records.length, requests);
    const reader = createSessionExecutionReader(f.sessionStatePath);
    for (const phase of ["cold", "warm"]) {
      measure(`jsonl-${phase}`, () => {
        for (let index = 0; index < sessions; index++) assert.equal(reader.read(`synthetic-${index}`).active, false);
      });
    }
    reader.clear();
    store = f.store();
    for (const phase of ["cold", "warm"]) {
      const result = measure(`snapshot-${phase}`, () => store.snapshot({ timeframe: "30d" }));
      assert.equal(result.sessionCount, 2619);
      assert.equal(result.metrics.requests, requests);
    }
  } finally {
    store?.close();
    f.cleanup();
  }
});
