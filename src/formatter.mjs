import { safeModel } from "./usage-metrics.mjs";

const METRICS = [
  ["requests", "Requests"], ["inputTokens", "Input tokens"], ["outputTokens", "Output tokens"],
  ["totalTokens", "Total tokens"], ["cacheReadTokens", "Cache read tokens"],
  ["cacheWriteTokens", "Cache write tokens"], ["totalNanoAiu", "Nano AIU"],
  ["requestCost", "Recorded request cost (opaque unit)"],
  ["apiDurationMs", "Session API duration (ms)"], ["durationMs", "Recorded request duration (ms)"],
  ["ttftMs", "Mean time to first token (ms)"],
  ["requestMultiplier", "Mean recorded request multiplier"],
  ["outputTtftMs", "Mean output time to first token (ms)"],
  ["interTokenLatencyMs", "Mean inter-token latency (ms)"],
  ["contentFilteredRequests", "Content-filtered requests"],
];
const STATUSES = new Set(["recorded", "partial", "not-recorded", "derived"]);
const SOURCES = new Set(["sessiondb", "jsonl", "jsonl-shutdown", "mixed", "not-recorded"]);

function recorded(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function numeric(value) {
  return recorded(value) ? String(value) : "Not recorded";
}
function modelName(value) {
  return safeModel(value);
}
function metricsTable(metrics = {}, evidence = {}) {
  const available = METRICS.filter(([key]) => recorded(metrics[key]));
  if (!available.length) return "No recorded usage metrics.";
  return [
    "| Metric | Value | Evidence | Coverage |",
    "| --- | ---: | --- | ---: |",
    ...available.map(([key, label]) => {
      const item = evidence[key] || {};
      const status = STATUSES.has(item.status) ? item.status : "not-recorded";
      const source = item.source === "jsonl-shutdown" ? "Shutdown aggregate" : SOURCES.has(item.source) ? item.source : "not-recorded";
      return `| ${label} | ${numeric(metrics[key])} | ${status} (${source}) | ${numeric(item.recorded)} / ${numeric(item.total)} |`;
    }),
  ].join("\n");
}
function sourceNote(containers) {
  const shutdown = containers.some((item) => item?.usageGranularity === "session-model-aggregate" ||
    Object.values(item?.evidence ?? {}).some((entry) => entry?.source === "jsonl-shutdown"));
  const notes = ["Local credits: Not recorded; no verified nano-AIU conversion is available."];
  if (shutdown) notes.push("Shutdown aggregate uses one selected session-model snapshot, not exact request or child attribution; repeated snapshots are not added and coverage counts aggregate rows.");
  if (containers.some((item) => recorded(item?.metrics?.requestCost))) notes.push("Request cost is an opaque recorded unit, not currency or local credits.");
  if (containers.some((item) => item?.evidence?.apiDurationMs?.scope === "session" && recorded(item?.metrics?.apiDurationMs) ||
    item?.evidence?.totalNanoAiu?.scope === "session")) notes.push("Session API duration and root nano-AIU totals are not allocated to models.");
  return notes.join(" ");
}
function capabilityText(capabilities = {}) {
  const status = (value) => ["available", "unavailable", "partial"].includes(value) ? value : "unavailable";
  return `**Sources:** session DB ${status(capabilities.sessionDb)}; session state ${status(capabilities.sessionState)}.`;
}
function sessionLabel(session) {
  return /^Session \d+$/.test(session?.label) ? session.label : "Session";
}
function sessionHandle(session) {
  return /^[a-f0-9]{64}$/.test(session?.handle) ? session.handle : "Unavailable";
}

export function formatUsageSummary(snapshot) {
  return [
    "## Copilot usage", `**Sessions:** ${numeric(snapshot.sessionCount)}`,
    "Session-scoped recorded usage for sessions with recorded activity or creation in the selected timeframe; source coverage may be partial.",
    capabilityText(snapshot.capabilities), "", metricsTable(snapshot.metrics, snapshot.evidence),
    "", sourceNote([snapshot, ...(snapshot.sessions ?? [])]),
  ].join("\n");
}

export function formatUsageSessions({ sessions, capabilities, pagination }) {
  const paged = pagination && [pagination.page, pagination.pages, pagination.total].every(Number.isSafeInteger)
    && pagination.page >= 1 && pagination.pages >= pagination.page && pagination.total >= 0;
  return [
    "## Usage sessions", capabilityText(capabilities), "",
    paged ? `**Page:** ${pagination.page} of ${pagination.pages}; **Matching sessions:** ${pagination.total}.`
      : "Pagination metadata is unavailable.",
    paged && pagination.page < pagination.pages
      ? `Call insights_sessions with page: ${pagination.page + 1} and the same filters for the next page.`
      : paged ? "No more matching sessions." : "",
    "",
    "| Session | Opaque handle | Models | Requests | Hidden |",
    "| --- | --- | --- | ---: | --- |",
    ...sessions.map((session) => `| ${sessionLabel(session)} | \`${sessionHandle(session)}\` | ${session.models.map(modelName).join(", ")} | ${numeric(session.metrics?.requests)} | ${session.hidden === true ? "Yes" : "No"} |`),
    "", sourceNote(sessions),
    "", "Use insights_session with an opaque handle for all-model session usage.",
  ].join("\n");
}

export function formatUsageSession(detail) {
  if (!detail) return "Session not found.";
  const { session } = detail;
  return [
    `## ${sessionLabel(session)} usage`, `**Handle:** \`${sessionHandle(session)}\``,
    capabilityText(detail.capabilities), "", metricsTable(session.metrics, session.evidence),
    "", "### Attribution",
    ...detail.attribution.map((group) => [
      `#### ${group.scope === "primary" ? "Primary agent" : group.scope === "subagent" ? "Subagent" : "Unattributed"}`,
      metricsTable(group.metrics, group.evidence),
    ].join("\n")),
    "", "Skills are session-level observations, not per-request attribution.",
    "", sourceNote([session, ...detail.attribution]),
  ].join("\n");
}

export function formatUsageModels({ models, capabilities }) {
  return [
    "## Model usage", capabilityText(capabilities),
    ...models.map((model) => [
      `### ${modelName(model.model)}`, `**Sessions:** ${numeric(model.sessionCount)}`,
      metricsTable(model.metrics, model.evidence),
    ].join("\n")),
    sourceNote(models),
  ].join("\n\n");
}
