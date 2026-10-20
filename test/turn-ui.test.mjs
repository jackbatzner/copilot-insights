import { test } from "node:test";
import assert from "node:assert/strict";
import { callEnding, pageItems, selectTurns } from "../ui/src/turn-usage.js";

test("call-ending explanations keep recorded facts separate from possible continuations", () => {
  assert.equal(callEnding("tool_calls").label, "Tools requested");
  assert.match(callEnding("tool_calls").description, /not linked/);
  assert.match(callEnding("stop").description, /does not establish/);
  assert.match(callEnding("length").description, /does not prove/);
  assert.match(callEnding("error").description, /not necessarily a retry/);
  assert.match(callEnding("cancelled").description, /not recorded/);
  assert.match(callEnding("content_filter").description, /No filtered content/);
  for (const value of [undefined, null, "", "PRIVATE_REASON", "__proto__", "constructor", "retry"]) {
    assert.deepEqual(callEnding(value), callEnding("not-recorded"));
    assert.doesNotMatch(JSON.stringify(callEnding(value)), /PRIVATE_REASON/);
  }
});

const request = (key, model, scope, createdAt) => ({ key, model, scope, createdAt });
const turns = [
  { key: "turn-0", turnIndex: 0, metrics: { totalTokens: 0 }, requests: [
    request("r1", "gpt-5.4", "primary", "2026-09-16T00:00:00.000Z"),
    request("r2", "gpt-5.4-mini", "subagent", "2026-09-15T23:00:00.000Z"),
  ] },
  { key: "turn-7", turnIndex: 7, metrics: { totalTokens: 50 }, requests: [
    request("r3", "gpt-5.4", "subagent", "2026-09-16T01:00:00.000Z"),
  ] },
  { key: "unassigned", turnIndex: null, metrics: { totalTokens: null }, requests: [
    request("r4", "gpt-5.4", "unattributed", null),
  ] },
];

test("turn explorer intersects filters on each request without changing whole-turn totals", () => {
  const selected = selectTurns(turns, { model: "gpt-5.4", scope: "subagent", day: "2026-09-16" });
  assert.deepEqual(selected.map((turn) => turn.key), ["turn-7"]);
  assert.equal(selected[0].metrics.totalTokens, 50);
  assert.deepEqual(selected[0].matchingRequests.map((row) => row.key), ["r3"]);
  assert.equal(turns[0].requests.length, 2);
});

test("turn explorer preserves zero and puts unassigned after recorded indices", () => {
  assert.deepEqual(selectTurns(turns).map((turn) => turn.turnIndex), [0, 7, null]);
  assert.deepEqual(selectTurns(turns, { sort: "tokens" }).map((turn) => turn.turnIndex), [7, 0, null]);
  assert.deepEqual(selectTurns(turns, { assignment: "unassigned" }).map((turn) => turn.key), ["unassigned"]);
  assert.equal(selectTurns(turns, { assignment: "unassigned", day: "2026-09-16" }).length, 0);
  assert.equal(selectTurns(turns, { assignment: "assigned" }).length, 2);
});

test("turn and request paging stays bounded without dropping final pages", () => {
  const values = Array.from({ length: 51 }, (_, index) => index);
  assert.deepEqual(pageItems(values, 3, 25), { items: [50], page: 3, pages: 3 });
  assert.equal(pageItems(values, 500, 25).page, 3);
  assert.equal(pageItems(values, 0, 25).page, 1);
  assert.deepEqual(pageItems([], 8, 20), { items: [], page: 1, pages: 1 });
});
