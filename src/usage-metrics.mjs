const MODELS = new Set([
  "gpt-4.1", "gpt-5", "gpt-5-mini", "gpt-5.1", "gpt-5.1-codex",
  "gpt-5.2", "gpt-5.2-codex", "gpt-5.3-codex", "gpt-5.4",
  "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.5", "gpt-5.6-sol",
  "gpt-5.6-sol-fast", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-6-astra",
  "claude-haiku-4.5", "claude-sonnet-4", "claude-sonnet-4.5",
  "claude-sonnet-4.6", "claude-sonnet-5", "claude-sonnet-5.5", "claude-opus-4.5",
  "claude-opus-4.6", "claude-opus-4.7", "claude-opus-4.8", "claude-opus-5",
  "gemini-2.5-pro", "gemini-3-flash", "gemini-3.1-pro", "gemini-3.5-flash",
  "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash",
  "grok-code-fast-1", "grok-4.5", "grok-4.6", "raptor-mini", "goldeneye",
  "mai-code-1.1-flash", "claude-fable-5.1", "kimi-k2.7-code", "kimi-k3",
]);

export const METRICS = [
  "requests", "inputTokens", "outputTokens", "totalTokens", "cacheReadTokens",
  "cacheWriteTokens", "totalNanoAiu", "localCredits", "durationMs", "ttftMs",
  "requestMultiplier", "outputTtftMs", "interTokenLatencyMs", "contentFilteredRequests",
  "requestCost", "apiDurationMs",
];
const MEANS = new Set(["ttftMs", "requestMultiplier", "outputTtftMs", "interTokenLatencyMs"]);

export class UsageSourceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "UsageSourceError";
    this.code = code;
  }
}

export function safeModel(value) {
  return MODELS.has(value) ? value : "Unknown model";
}

export function nonnegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function isUtcDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function safeDate(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!match || !isUtcDay(match[1])) return null;
  if (match[2] === undefined) return `${match[1]}T00:00:00.000Z`;
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return null;
  const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}${match[5] ?? ""}${match[6] ?? "Z"}`);
  if (!Number.isFinite(date.getTime())) return null;
  const normalized = date.toISOString();
  return /^\d{4}-/.test(normalized) ? normalized : null;
}

export function safeRequestTimestamp(value, { sqliteUtc = false } = {}) {
  if (typeof value !== "string") return null;
  const zoned = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  const verifiedSqlite = sqliteUtc && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value);
  return zoned || verifiedSqlite ? safeDate(value) : null;
}

export function aggregateUsage(records) {
  const metrics = {};
  const evidence = {};
  for (const metric of METRICS) {
    const present = records.filter((record) => record[metric] !== null && record[metric] !== undefined);
    const sources = new Set(present.map((record) => record.source));
    const sum = present.reduce((total, record) => total + record[metric], 0);
    metrics[metric] = present.length ? (MEANS.has(metric) ? sum / present.length : sum) : null;
    const derived = metric === "totalTokens";
    evidence[metric] = {
      source: sources.size > 1 ? "mixed" : sources.values().next().value ?? "not-recorded",
      status: !present.length ? "not-recorded" : present.length < records.length ? "partial" : derived ? "derived" : "recorded",
      recorded: present.length,
      total: records.length,
    };
  }
  const granularities = new Set(records.map((record) => record.source === "jsonl-shutdown"
    ? "session-model-aggregate" : record.source === "sessiondb" ? "recorded-requests" : "output-events"));
  return {
    metrics, evidence,
    usageGranularity: granularities.size > 1 ? "mixed" : granularities.values().next().value ?? "not-recorded",
  };
}

export function modelUsage(records) {
  return [...new Set(records.map((record) => record.model))].sort().map((model) => ({
    model,
    ...aggregateUsage(records.filter((record) => record.model === model)),
  }));
}

export function recommend(records) {
  const { metrics, evidence } = aggregateUsage(records);
  const caveat = "Advisory only. Recorded usage does not establish task quality or future savings.";
  if (evidence.cacheReadTokens.status === "recorded" && metrics.requests >= 2) {
    const aggregate = records.some((record) => record.source === "jsonl-shutdown");
    return {
      kind: "cache",
      title: "Compare recorded cache reuse",
      evidence: `${metrics.cacheReadTokens} cache-read tokens with ${metrics.requests} recorded requests${aggregate ? " reported by aggregate usage" : ""}.`,
      action: "Try keeping related work in one session, then compare cache-read tokens and total usage.",
      caveat,
      compareMetric: "cacheReadTokens",
    };
  }
  if (records.some((record) => record.scope === "subagent") && metrics.totalTokens !== null) {
    return {
      kind: "delegation",
      title: "Compare delegated usage",
      evidence: `${records.filter((record) => record.scope === "subagent").length} requests have exact child attribution.`,
      action: "Try a smaller delegated scope and compare recorded child usage on similar work.",
      caveat,
      compareMetric: "totalTokens",
    };
  }
  if (new Set(records.map((record) => record.model).filter((model) => model !== "Unknown model")).size > 1 && metrics.totalTokens !== null) {
    return {
      kind: "model",
      title: "Compare model usage on similar work",
      evidence: `${metrics.totalTokens} tokens have both input and output recorded across multiple models.`,
      action: "Choose one comparable task and compare recorded model usage before changing your default.",
      caveat,
      compareMetric: "totalTokens",
    };
  }
  return {
    kind: "insufficient-data",
    title: "More recorded evidence is needed",
    evidence: "Available usage does not support a specific model, cache, or delegation comparison.",
    action: "Inspect source coverage and compare again after more usage is recorded.",
    caveat: "Missing metrics are not zero. Session content is never used to estimate usage.",
    compareMetric: null,
  };
}
