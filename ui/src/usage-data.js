export const knownNumber = (value) => typeof value === "number" && Number.isFinite(value);
export const outcomeLabels = { completed: "Completed", failed: "Failed", cancelled: "Cancelled", mixed: "Mixed", "not-recorded": "—" };
export const granularityLabels = {
  "recorded-requests": "Recorded requests",
  "session-model-aggregate": "Shutdown aggregate",
  "output-events": "Output events",
  mixed: "Mixed measurements",
  "not-recorded": "—",
};

export { compareKnownDescending, sessionSortValue, sortSessions } from "../../src/session-list.mjs";

export function shareMetric(rows) {
  return rows.some((row) => knownNumber(row.metrics?.totalTokens)) ? "totalTokens"
    : rows.some((row) => knownNumber(row.metrics?.outputTokens)) ? "outputTokens" : null;
}

export function sourceDescription(session, filtered = false) {
  const labels = { sessiondb: "SessionDB", jsonl: "JSONL", "jsonl-shutdown": "Shutdown aggregate", mixed: "Mixed sources" };
  const evidence = Object.values((filtered ? session.selectedEvidence : session.evidence) || {});
  const sources = [...new Set(evidence.map((value) => labels[value.source]).filter(Boolean))];
  return {
    source: sources.join(" + ") || "—",
    partial: evidence.some((value) => value.status === "partial"),
    granularity: granularityLabels[session.usageGranularity] || null,
  };
}
