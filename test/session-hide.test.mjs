// Tests for session hiding feature
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("session hide — UUID validation regex", () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it("accepts valid UUID v4", () => {
    assert.ok(UUID_RE.test("550e8400-e29b-41d4-a716-446655440000"));
  });

  it("accepts uppercase UUID", () => {
    assert.ok(UUID_RE.test("550E8400-E29B-41D4-A716-446655440000"));
  });

  it("rejects non-UUID strings", () => {
    assert.ok(!UUID_RE.test("not-a-uuid"));
    assert.ok(!UUID_RE.test(""));
    assert.ok(!UUID_RE.test("../../../etc/passwd"));
    assert.ok(!UUID_RE.test("550e8400-e29b-41d4-a716"));
    assert.ok(!UUID_RE.test("550e8400e29b41d4a716446655440000"));
  });
});

describe("session hide — in-memory Set behavior", () => {
  let hiddenSessions;

  beforeEach(() => {
    hiddenSessions = new Set();
  });

  it("starts empty", () => {
    assert.equal(hiddenSessions.size, 0);
  });

  it("can add and check membership", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    hiddenSessions.add(id);
    assert.ok(hiddenSessions.has(id));
    assert.equal(hiddenSessions.size, 1);
  });

  it("can remove an id", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    hiddenSessions.add(id);
    hiddenSessions.delete(id);
    assert.ok(!hiddenSessions.has(id));
    assert.equal(hiddenSessions.size, 0);
  });

  it("deduplicates adds", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    hiddenSessions.add(id);
    hiddenSessions.add(id);
    assert.equal(hiddenSessions.size, 1);
  });

  it("delete of non-existent id is a no-op", () => {
    hiddenSessions.delete("nonexistent");
    assert.equal(hiddenSessions.size, 0);
  });
});

describe("session hide — excludeIds SQL clause generation", () => {
  function buildExcludeClause(excludeIds) {
    if (!excludeIds || excludeIds.size === 0) return { clause: "", params: [] };
    const placeholders = [...excludeIds].map(() => "?").join(", ");
    return {
      clause: `s.id NOT IN (${placeholders})`,
      params: [...excludeIds],
    };
  }

  it("returns empty for no excludeIds", () => {
    const result = buildExcludeClause(undefined);
    assert.equal(result.clause, "");
    assert.deepEqual(result.params, []);
  });

  it("returns empty for empty set", () => {
    const result = buildExcludeClause(new Set());
    assert.equal(result.clause, "");
    assert.deepEqual(result.params, []);
  });

  it("builds correct clause for one ID", () => {
    const ids = new Set(["abc-123"]);
    const result = buildExcludeClause(ids);
    assert.equal(result.clause, "s.id NOT IN (?)");
    assert.deepEqual(result.params, ["abc-123"]);
  });

  it("builds correct clause for multiple IDs", () => {
    const ids = new Set(["id-1", "id-2", "id-3"]);
    const result = buildExcludeClause(ids);
    assert.equal(result.clause, "s.id NOT IN (?, ?, ?)");
    assert.deepEqual(result.params, ["id-1", "id-2", "id-3"]);
  });
});
