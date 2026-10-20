import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { readSessionExecution } from "../src/session-state.mjs";
import { usageFixture } from "./usage-fixtures.mjs";

const fixtures = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

function fixture(streams) {
  const f = usageFixture();
  fixtures.push(f);
  const id = f.session();
  for (const [file, events] of Object.entries(streams)) f.events(id, events, file);
  return { ...f, read: () => readSessionExecution(f.sessionStatePath, id) };
}

function event(id, type, time, data = {}) {
  return { id, type, timestamp: time === null ? undefined : `2026-09-20T${time}:00.000Z`, data };
}
const start = (id, time, model = "gpt-5-mini") => event(id, "session.start", time, { selectedModel: model });
const change = (id, time, model) => event(id, "session.model_change", time, { newModel: model });
const output = (id, time, outputTokens, model) => event(id, "assistant.message", time, { outputTokens, model });
const stop = (id, time, data) => event(id, "session.shutdown", time, data);
const models = (value) => value.records.map(({ model, outputTokens }) => [model, outputTokens]);

describe("stream-local fallback model context", () => {
  it("replays duplicate transitions for unique secondary outputs without duplicating usage", () => {
    const a = start("start", "10:00");
    const b = change("change", "11:00", "gpt-5.4");
    const late = output("late", "11:05", 20);
    const f = fixture({
      "events.jsonl": [a, b, late],
      "turns.jsonl": [a, output("early", "10:05", 100), b, late],
      "mirror.jsonl": [a, output("early", "10:05", 100), b, late],
    });
    assert.deepEqual(models(f.read()), [["gpt-5.4", 20], ["gpt-5-mini", 100]]);
    const store = f.store();
    try {
      const snapshot = store.snapshot({ timeframe: "all" });
      assert.equal(snapshot.metrics.outputTokens, 120);
      assert.equal(snapshot.models.find((row) => row.model === "gpt-5-mini").metrics.outputTokens, 100);
      f.usage();
      assert.equal(store.snapshot({ timeframe: "all" }).metrics.outputTokens, 5, "exact usage still suppresses fallback");
    } finally {
      store.close();
    }
  });

  it("uses anonymous secondary transitions as context but not as additional usage", () => {
    const f = fixture({
      "events.jsonl": [start("canonical", "12:00", "gpt-5.4")],
      "turns.jsonl": [
        start(undefined, "10:00"), output("early", "10:05", 100),
        change(undefined, "11:00", "claude-sonnet-4.6"), output("later", "11:05", 10),
        output(undefined, "11:06", 999),
      ],
    });
    assert.deepEqual(models(f.read()), [["gpt-5-mini", 100], ["claude-sonnet-4.6", 10]]);
  });

  it("never borrows context from another file or a later stream event", () => {
    const f = fixture({
      "events.jsonl": [start("canonical", "10:00", "gpt-5.4")],
      "turns.jsonl": [output("unlinked", "10:05", 100), start("later", "10:10")],
    });
    assert.deepEqual(models(f.read()), [["Unknown model", 100]]);
  });

  it("rejects future-dated context and does not roll context back on older transitions", () => {
    const f = fixture({
      "events.jsonl": [
        start("start", "10:00"), change("new", "12:00", "gpt-5.4"),
        change("old", "11:00", "claude-sonnet-4.6"),
        output("past", "11:05", 100), output("current", "12:05", 20),
        output("explicit", "09:00", 5, "gpt-5-mini"),
      ],
    });
    const result = f.read();
    assert.deepEqual(models(result), [["Unknown model", 100], ["gpt-5.4", 20], ["gpt-5-mini", 5]]);
    assert.match([...result.diagnostics].join(" "), /preceding its stream model context/);
  });

  it("uses preceding stream order for equal timestamps without applying later transitions retroactively", () => {
    const f = fixture({
      "events.jsonl": [
        start("start", "10:00"), output("first", "10:00", 1),
        change("change", "10:00", "gpt-5.4"), output("second", "10:00", 2),
      ],
    });
    assert.deepEqual(models(f.read()), [["gpt-5-mini", 1], ["gpt-5.4", 2]]);
  });

  it("keeps missing-date context stream-local and explicitly discloses stream-order fallback", () => {
    const a = start("start", null);
    const f = fixture({
      "events.jsonl": [a, change("change", null, "gpt-5.4"), output("first", null, 1)],
      "turns.jsonl": [a, output("second", null, 2)],
    });
    const result = f.read();
    assert.deepEqual(models(result), [["gpt-5.4", 1], ["gpt-5-mini", 2]]);
    assert.match([...result.diagnostics].join(" "), /same-stream order where timestamps are unavailable/);
  });
});

describe("timestamp-selected recorded lifecycle", () => {
  it("does not let an older secondary shutdown close a newer canonical start", () => {
    const f = fixture({
      "events.jsonl": [start("new-start", "12:00")],
      "turns.jsonl": [stop("old-stop", "11:00")],
    });
    const result = f.read();
    assert.equal(result.active, true);
    assert.equal(result.updatedAt, "2026-09-20T12:00:00.000Z");
    const store = f.store();
    try {
      const session = store.snapshot({ timeframe: "all" }).sessions[0];
      assert.equal(session.activityEvidence, "recorded-open-lifecycle");
      assert.equal(session.liveStatus, "not-verified");
    } finally {
      store.close();
    }
  });

  it("selects newer lifecycle events in either file and regardless of same-file order", () => {
    for (const streams of [
      { "events.jsonl": [stop("new", "12:00"), start("old", "11:00")] },
      { "events.jsonl": [start("old", "11:00")], "turns.jsonl": [stop("new", "12:00")] },
      { "events.jsonl": [stop("new", "12:00")], "turns.jsonl": [start("old", "11:00")] },
    ]) {
      assert.equal(fixture(streams).read().active, false);
    }
  });

  it("breaks timestamp ties by canonical file then later position within that file", () => {
    for (const reversed of [false, true]) {
      const events = [start("first", "12:00"), stop("last", "12:00")];
      if (reversed) events.reverse();
      const f = fixture({
        "turns.jsonl": [start("secondary", "12:00")],
        "events.jsonl": events,
      });
      assert.equal(f.read().active, reversed);
    }
  });

  it("does not replay duplicate lifecycle observations even while replaying model context", () => {
    const a = start("start", "12:00");
    const f = fixture({
      "events.jsonl": [a, stop("stop", "12:00")],
      "turns.jsonl": [a, output("unique", "12:01", 1)],
    });
    const result = f.read();
    assert.equal(result.active, false);
    assert.deepEqual(models(result), [["gpt-5-mini", 1]]);
  });

  it("leaves lifecycle unavailable when missing or invalid dates prevent chronology", () => {
    for (const undated of [stop("undated", null), { ...stop("invalid", "12:00"), timestamp: "invalid" }]) {
      for (const dated of [[], [start("dated", "12:00")]]) {
        const result = fixture({ "events.jsonl": [...dated, undated] }).read();
        assert.equal(result.active, null);
        assert.match([...result.diagnostics].join(" "), /Undated lifecycle evidence/);
      }
    }
    assert.equal(fixture({ "events.jsonl": [output("output", "12:00", 1)] }).read().active, null);
  });

  it("keeps lifecycle independent of coherent shutdown snapshot selection", () => {
    const data = (inputTokens) => ({
      modelMetrics: { "gpt-5-mini": { usage: { inputTokens, outputTokens: 5 } } },
    });
    const f = fixture({
      "events.jsonl": [stop("older", "10:00", data(999)), start("restart", "12:00")],
      "turns.jsonl": [stop(undefined, "11:00", data(10))],
    });
    const result = f.read();
    assert.equal(result.active, true);
    assert.equal(result.shutdown.records[0].inputTokens, 10);
    assert.equal(result.shutdown.records[0].outputTokens, 5);
  });
});
