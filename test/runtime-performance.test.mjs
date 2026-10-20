import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import Database from "better-sqlite3";
import { createSessionExecutionReader } from "../src/session-state.mjs";
import { event, usageFixture } from "./usage-fixtures.mjs";

const fixtures = [];
function fixture(options) {
  const value = usageFixture(options);
  fixtures.push(value);
  return value;
}
afterEach(() => {
  for (const value of fixtures.splice(0)) value.cleanup();
});

function trackContentReads(t) {
  const read = fs.readSync;
  let count = 0;
  t.mock.method(fs, "readSync", (...args) => {
    count++;
    return read(...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return () => count;
}

describe("lightweight runtime source access", () => {
  it("checks capabilities using schema only, without usage rows or event content", (t) => {
    const f = fixture();
    const id = f.session();
    f.usage();
    f.events(id, ["PRIVATE_MALFORMED_EVENT"]);
    const prepare = Database.prototype.prepare;
    const statements = [];
    t.mock.method(Database.prototype, "prepare", function(sql) {
      assert.doesNotMatch(sql, /\bFROM\s+(?:sessions|assistant_usage_events)\b/i);
      statements.push(sql);
      return prepare.call(this, sql);
    });
    const countReads = trackContentReads(t);
    const capability = f.store().capabilities();
    assert.equal(capability.sessionDb, "available");
    assert.equal(capability.sessionState, "available");
    assert.equal(capability.usageTable, true);
    assert.match(capability.diagnostics.join(" "), /coverage is checked when usage is read/);
    assert.equal(countReads(), 0);
    assert.equal(statements.length, 3);
    assert.doesNotMatch(JSON.stringify(capability), /PRIVATE_|synthetic-session/);
  });

  it("reuses only normalized metadata for unchanged snapshot and detail reads", (t) => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    f.events(id, [
      event("assistant.message", { outputTokens: 7, content: "PRIVATE_CONTENT".repeat(10000) }, "message"),
      event("skill.invoked", { name: "PRIVATE_SKILL" }, "skill"),
    ]);
    const countReads = trackContentReads(t);
    const store = f.store();
    const first = store.snapshot({ timeframe: "all" });
    const coldReads = countReads();
    assert.ok(coldReads > 0);
    assert.deepEqual(store.snapshot({ timeframe: "all" }), first);
    assert.equal(store.detail(first.sessions[0].handle).session.metrics.outputTokens, 7);
    assert.equal(countReads(), coldReads);
    assert.doesNotMatch(JSON.stringify(first), /PRIVATE_CONTENT|PRIVATE_SKILL/);
    store.close();
    f.store().snapshot({ timeframe: "all" });
    assert.ok(countReads() > coldReads);
  });

  it("refreshes changed, added, removed and recreated event files without stale totals", (t) => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    f.events(id, [event("assistant.message", { outputTokens: 2 }, "one")]);
    const countReads = trackContentReads(t);
    const store = f.store();
    const snapshot = () => store.snapshot({ timeframe: "all" });
    assert.equal(snapshot().metrics.outputTokens, 2);
    let previous = countReads();
    const file = join(f.sessionStatePath, id, "events.jsonl");
    fs.appendFileSync(file, `\n${JSON.stringify(event("assistant.message", { outputTokens: 3 }, "two"))}`);
    assert.equal(snapshot().metrics.outputTokens, 5);
    assert.ok(countReads() > previous);
    previous = countReads();
    f.events(id, [event("assistant.message", { outputTokens: 4 }, "three")], "extra.jsonl");
    assert.equal(snapshot().metrics.outputTokens, 9);
    assert.ok(countReads() > previous);
    fs.unlinkSync(join(f.sessionStatePath, id, "extra.jsonl"));
    assert.equal(snapshot().metrics.outputTokens, 5);
    fs.unlinkSync(file);
    assert.equal(snapshot().metrics.outputTokens, null);
    f.events(id, [event("assistant.message", { outputTokens: 11 }, "replacement")]);
    assert.equal(snapshot().metrics.outputTokens, 11);
  });

  it("retains explicit malformed-source diagnostics on cache hits and clears them after repair", () => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    f.events(id, [event("assistant.message", { outputTokens: 0 }), "PRIVATE_BROKEN_LINE"]);
    const store = f.store();
    const first = store.snapshot({ timeframe: "all" });
    assert.equal(first.capabilities.sessionState, "partial");
    assert.deepEqual(store.snapshot({ timeframe: "all" }), first);
    f.events(id, [event("assistant.message", { outputTokens: 0 })]);
    const repaired = store.snapshot({ timeframe: "all" });
    assert.equal(repaired.metrics.outputTokens, 0);
    assert.equal(repaired.capabilities.sessionState, "available");
    assert.doesNotMatch(repaired.capabilities.diagnostics.join(" "), /Malformed/);
  });

  it("does not cache a source that changes during the read", (t) => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    f.events(id, [event("assistant.message", { outputTokens: 2 }, "one")]);
    const file = join(f.sessionStatePath, id, "events.jsonl");
    const original = fs.readSync;
    let changed = false;
    t.mock.method(fs, "readSync", (...args) => {
      const count = original(...args);
      if (count > 0 && !changed) {
        changed = true;
        fs.appendFileSync(file, `\n${JSON.stringify(event("assistant.message", { outputTokens: 3 }, "two"))}`);
      }
      return count;
    });
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const store = f.store();
    const unstable = store.snapshot({ timeframe: "all" });
    assert.equal(unstable.capabilities.sessionState, "partial");
    assert.match(unstable.capabilities.diagnostics.join(" "), /changed while being read/);
    const stable = store.snapshot({ timeframe: "all" });
    assert.equal(stable.metrics.outputTokens, 5);
    assert.doesNotMatch(stable.capabilities.diagnostics.join(" "), /changed while being read/);
  });

  it("retains explicit oversized-line diagnostics with the larger bounded scan buffer", () => {
    const f = fixture({ usageTable: false });
    const id = f.session();
    f.events(id, [
      event("assistant.message", { outputTokens: 99, content: "x".repeat(4 * 1024 * 1024) }),
      event("assistant.message", { outputTokens: 5 }),
    ]);
    const store = f.store();
    const result = store.snapshot({ timeframe: "all" });
    assert.equal(result.metrics.outputTokens, 5);
    assert.equal(result.capabilities.sessionState, "partial");
    assert.match(result.capabilities.diagnostics.join(" "), /Oversized session events were skipped/);
    assert.deepEqual(store.snapshot({ timeframe: "all" }), result);
  });

  it("bounds cache admission without dropping uncached session metadata", (t) => {
    const f = fixture({ usageTable: false });
    f.session("one");
    f.session("two");
    f.events("one", [event("assistant.message", { outputTokens: 1 })]);
    f.events("two", [event("assistant.message", { outputTokens: 2 })]);
    const countReads = trackContentReads(t);
    const reader = createSessionExecutionReader(f.sessionStatePath, { maxCacheEntries: 1 });
    assert.equal(reader.read("one").records[0].outputTokens, 1);
    assert.equal(reader.read("two").records[0].outputTokens, 2);
    const previous = countReads();
    assert.equal(reader.read("one").records[0].outputTokens, 1);
    assert.ok(countReads() > previous);
    const uncached = createSessionExecutionReader(f.sessionStatePath, { maxCacheBytes: 0 });
    assert.equal(uncached.read("one").records[0].outputTokens, 1);
    const firstRead = countReads();
    assert.equal(uncached.read("one").records[0].outputTokens, 1);
    assert.ok(countReads() > firstRead);
  });
});
