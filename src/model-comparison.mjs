import { aggregateUsage, nonnegative } from "./usage-metrics.mjs";

const MODES = ["uncached", "cache-included", "cache-excluded"];

function pricingBasis(records, mode) {
  const result = {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
    included: 0, total: records.length,
    excluded: { missingTokens: 0, missingCache: 0, cacheWrites: 0, inconsistentCache: 0 },
  };
  for (const record of records) {
    const input = nonnegative(record.inputTokens), output = nonnegative(record.outputTokens);
    if (input === null || output === null) { result.excluded.missingTokens++; continue; }
    let read = 0;
    if (mode !== "uncached") {
      read = nonnegative(record.cacheReadTokens);
      const write = nonnegative(record.cacheWriteTokens);
      if (read === null || write === null) { result.excluded.missingCache++; continue; }
      if (write > 0) { result.excluded.cacheWrites++; continue; }
      if (mode === "cache-included" && read > input) { result.excluded.inconsistentCache++; continue; }
    }
    result.inputTokens += mode === "cache-included" ? input - read : input;
    result.outputTokens += output;
    result.cacheReadTokens += read;
    result.included++;
  }
  if (!result.included || [result.inputTokens, result.outputTokens, result.cacheReadTokens].some((value) => !Number.isFinite(value))) {
    result.inputTokens = result.outputTokens = result.cacheReadTokens = null;
  }
  return result;
}

function outcomes(records) {
  const result = { completed: 0, failed: 0, cancelled: 0, unknown: 0, requests: 0, source: "not-recorded" };
  for (const record of records.filter((entry) => entry.source === "sessiondb")) {
    result.requests++;
    const outcome = record.contentFiltered === true || ["error", "content_filter"].includes(record.finishReason) ? "failed"
      : record.finishReason === "cancelled" ? "cancelled"
        : ["stop", "length", "tool_calls"].includes(record.finishReason) ? "completed" : "unknown";
    result[outcome]++;
  }
  if (result.requests) result.source = "sessiondb";
  return result;
}

export function compareUsage(records, sessionCount) {
  return {
    sessionCount,
    models: [...new Set(records.map((record) => record.model))].sort().map((model) => {
      const selected = records.filter((record) => record.model === model);
      return {
        model, ...aggregateUsage(selected), outcomes: outcomes(selected),
        pricingBasis: Object.fromEntries(MODES.map((mode) => [mode, pricingBasis(selected, mode)])),
      };
    }),
  };
}
