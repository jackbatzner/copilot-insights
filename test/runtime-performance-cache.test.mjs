import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fs from "node:fs";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import Database from "better-sqlite3";
import { createUsageDbReader } from "../src/db.mjs";
import { createSessionExecutionReader } from "../src/session-state.mjs";
import { event, usageFixture } from "./usage-fixtures.mjs";

const fixtures = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});
function fixture() {
  const f = usageFixture();
  fixtures.push(f);
  return f;
}

function usageQueries(t) {
  const prepare = Database.prototype.prepare;
  let count = 0;
  t.mock.method(Database.prototype, "prepare", function(sql) {
    if (/FROM assistant_usage_events/.test(sql)) count++;
    return prepare.call(this, sql);
  });
  return () => count;
}

describe("versioned normalized SQLite cache", () => {
  it("reuses unchanged full and scoped reads without retaining content columns", (t) => {
    const f = fixture();
    f.session();
    f.usage();
    const count = usageQueries(t);
    const reader = createUsageDbReader(f.dbPath);
    const full = reader.read();
    assert.strictEqual(reader.read(), full);
    assert.equal(count(), 1);
    const scoped = reader.read("synthetic-session");
    assert.strictEqual(reader.read("synthetic-session"), scoped);
    assert.equal(count(), 2);
    assert.equal(scoped.source.records.length, 1);
    assert.doesNotMatch(JSON.stringify(full), /PRIVATE_|summary|cwd|prompt|reply/);
    reader.clear();
    assert.notStrictEqual(reader.read(), full);
    assert.equal(count(), 3);
  });

  it("invalidates on WAL writes, updates, deletions and checkpoint changes", () => {
    const f = fixture();
    f.db.pragma("journal_mode = WAL");
    f.session();
    f.usage();
    const reader = createUsageDbReader(f.dbPath);
    const first = reader.read();
    f.usage(undefined, { output_tokens: 7 });
    const appended = reader.read();
    assert.notEqual(appended.version, first.version);
    assert.equal(appended.source.records.length, 2);
    f.db.prepare("UPDATE assistant_usage_events SET output_tokens = 9").run();
    assert.deepEqual(reader.read().source.records.map((record) => record.outputTokens), [9, 9]);
    f.db.prepare("DELETE FROM assistant_usage_events").run();
    assert.equal(reader.read().source.records.length, 0);
    f.db.pragma("wal_checkpoint(TRUNCATE)");
    assert.equal(reader.read().source.records.length, 0);
  });

  it("refreshes a missing, deleted and replaced database rather than serving stale cached rows", () => {
    const f = fixture();
    f.session();
    f.usage();
    const path = join(f.root, "recovered.db");
    const reader = createUsageDbReader(path);
    assert.equal(reader.read().source.sessionDb, "unavailable");
    fs.copyFileSync(f.dbPath, path);
    assert.equal(reader.read().source.records.length, 1);
    fs.unlinkSync(path);
    assert.equal(reader.read().source.sessionDb, "unavailable");
    f.usage();
    fs.copyFileSync(f.dbPath, path);
    assert.equal(reader.read().source.records.length, 2);
    fs.writeFileSync(path, "not a SQLite database");
    assert.throws(() => reader.read(), { code: "DB_READ" });
  });

  it("does not cache a database modified during a read", (t) => {
    const f = fixture();
    f.session();
    f.usage();
    const prepare = Database.prototype.prepare;
    let changed = false;
    t.mock.method(Database.prototype, "prepare", function(sql) {
      const statement = prepare.call(this, sql);
      if (/FROM assistant_usage_events/.test(sql) && !changed) {
        const all = statement.all;
        t.mock.method(statement, "all", function(...args) {
          const rows = all.apply(this, args);
          changed = true;
          f.usage(undefined, { output_tokens: 7 });
          return rows;
        });
      }
      return statement;
    });
    const reader = createUsageDbReader(f.dbPath);
    const unstable = reader.read();
    assert.equal(unstable.version, null);
    assert.equal(unstable.source.sessionDb, "partial");
    assert.match(unstable.source.diagnostics.join(" "), /changed while being read/);
    const stable = reader.read();
    assert.equal(stable.source.records.length, 2);
    assert.doesNotMatch(stable.source.diagnostics.join(" "), /changed while being read/);
    assert.strictEqual(reader.read(), stable);
  });

  it("bounds byte and entry admission while still returning uncached usage", (t) => {
    const f = fixture();
    f.session("a");
    f.session("b");
    f.usage("a");
    f.usage("b");
    const count = usageQueries(t);
    const uncached = createUsageDbReader(f.dbPath, { maxCacheBytes: 0 });
    assert.equal(uncached.read().source.records.length, 2);
    assert.equal(uncached.read().source.records.length, 2);
    assert.equal(count(), 2);
    const limited = createUsageDbReader(f.dbPath, { maxCacheEntries: 1 });
    limited.read("a");
    limited.read("b");
    assert.equal(limited.read("a").source.records.length, 1);
    assert.equal(count(), 5);
  });
});

describe("source manifest and projection reuse", () => {
  it("reuses directory listings while continuing to validate file versions on every hit", (t) => {
    const f = fixture();
    const id = f.session();
    f.events(id, [event("assistant.message", { outputTokens: 1 })]);
    const readdir = fs.readdirSync;
    let count = 0;
    t.mock.method(fs, "readdirSync", (...args) => {
      count++;
      return readdir(...args);
    });
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const reader = createSessionExecutionReader(f.sessionStatePath);
    const first = reader.read(id);
    assert.equal(count, 1);
    assert.strictEqual(reader.read(id), first);
    assert.equal(count, 1);
    f.events(id, [event("assistant.message", { outputTokens: 2 }, "new")], "extra.jsonl");
    assert.equal(reader.read(id).records.length, 2);
    assert.equal(count, 2);
  });

  it("invalidates same-size event rewrites and rejects a session replaced by a junction", () => {
    const f = fixture();
    const id = f.session();
    f.events(id, [event("assistant.message", { outputTokens: 1 })]);
    const reader = createSessionExecutionReader(f.sessionStatePath);
    assert.equal(reader.read(id).records[0].outputTokens, 1);
    const directory = join(f.sessionStatePath, id);
    const file = join(directory, "events.jsonl");
    const original = fs.statSync(file);
    f.events(id, [event("assistant.message", { outputTokens: 2 })]);
    fs.utimesSync(file, original.atime, original.mtime);
    assert.equal(reader.read(id).records[0].outputTokens, 2);
    const moved = join(f.root, "moved-synthetic-session");
    fs.renameSync(directory, moved);
    fs.symlinkSync(moved, directory, "junction");
    const unsupported = reader.read(id);
    assert.equal(unsupported.records.length, 0);
    assert.match([...unsupported.diagnostics].join(" "), /Unsupported session execution/);
  });

  it("reuses unchanged session projections and invalidates only the changed execution", () => {
    const f = fixture();
    for (const id of ["a", "b"]) {
      f.session(id);
      f.usage(id, { parent_tool_call_id: "child" });
      f.events(id, [event("session.start")]);
    }
    const store = f.store();
    try {
      const rows = () => store.snapshot({ timeframe: "all" }).sessions.sort((a, b) => a.label.localeCompare(b.label));
      const first = rows(), second = rows();
      assert.strictEqual(first[0].metrics, second[0].metrics);
      assert.strictEqual(first[1].metrics, second[1].metrics);
      f.events("a", [event("subagent.started", { toolCallId: "child" })]);
      const changed = rows();
      assert.notStrictEqual(changed[0].metrics, first[0].metrics);
      assert.strictEqual(changed[1].metrics, first[1].metrics);
      assert.equal(changed[0].performance.childRequests, 1);
      f.db.prepare("UPDATE assistant_usage_events SET output_tokens = 10 WHERE session_id = 'b'").run();
      const databaseChanged = rows();
      assert.equal(databaseChanged[1].metrics.outputTokens, 10);
      store.close();
      assert.throws(() => store.snapshot(), { code: "STORE_CLOSED" });
    } finally {
      store.close();
    }
  });
});
