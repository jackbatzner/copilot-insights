import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  clearCache,
  fetchSessionEfficiency,
  fetchSessionSprawl,
} from "../ui/src/api.js";

afterEach(() => {
  mock.restoreAll();
  clearCache();
});

describe("optional session analysis payloads", () => {
  it("normalizes a missing efficiency analysis to null", async () => {
    mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
      efficiency: null,
      message: "Session too short to analyze",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const result = await fetchSessionEfficiency("short-session");

    assert.equal(result, null);
  });

  it("preserves a completed efficiency analysis", async () => {
    const analysis = {
      efficiencyRatio: 1,
      recoverySpeed: { avgTurns: 0, incidents: 0, recoveries: [] },
    };
    mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(analysis), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const result = await fetchSessionEfficiency("complete-session");

    assert.deepEqual(result, analysis);
  });

  it("normalizes a missing sprawl analysis to null", async () => {
    mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
      sprawl: null,
      message: "Session too short to analyze",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const result = await fetchSessionSprawl("short-session");

    assert.equal(result, null);
  });
});
