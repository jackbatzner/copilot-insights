import assert from "node:assert/strict";
import test from "node:test";
import { compactNumber } from "../ui/src/number-format.js";

test("compact tokens preserve full precision in source and distinguish zero from missing", () => {
  assert.equal(compactNumber(62_800, "totalTokens", "en-US"), "62.8K");
  assert.equal(compactNumber(4_230_111_999, "totalTokens", "en-US"), "4.2B");
  assert.equal(compactNumber(0, "totalTokens", "en-US"), null);
  assert.equal(compactNumber(null, "totalTokens", "en-US"), null);
  assert.equal(compactNumber(NaN, "totalTokens", "en-US"), null);
  assert.equal(compactNumber(999, "totalTokens", "en-US"), null);
  assert.equal(compactNumber(1000, "totalTokens", "en-US"), "1K");
});

test("compact durations keep units while opaque cost and multiplier values are not converted", () => {
  assert.equal(compactNumber(2200, "durationMs", "en-US"), "2.2 s");
  assert.equal(compactNumber(120_000, "apiDurationMs", "en-US"), "2 min");
  assert.equal(compactNumber(7_200_000, "durationMs", "en-US"), "2 h");
  assert.equal(compactNumber(3_600_000, "apiDurationMs", "en-US"), "1 h");
  assert.equal(compactNumber(0.001, "ttftMs", "en-US"), "<0.1 ms");
  assert.equal(compactNumber(0, "durationMs", "en-US"), "0 ms");
  for (const metric of ["requestCost", "localCredits", "requestMultiplier"]) assert.equal(compactNumber(2000, metric, "en-US"), null);
  assert.equal(compactNumber(16_000_000, "totalNanoAiu", "en-US"), "16M");
});
