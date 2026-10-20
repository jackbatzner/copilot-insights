import { isUtcDay, safeModel } from "../../src/usage-metrics.mjs";

export { isUtcDay as validUtcDay };

export function safeUsageQueryValues(values) {
  const model = values.model || "";
  const session = values.session || "";
  const day = values.day || "";
  const scope = values.scope || "";
  const page = Number(values.page);
  return {
    timeframe: ["7d", "30d", "90d", "all"].includes(values.timeframe) ? values.timeframe : "all",
    model: !model || safeModel(model) === model ? model : "invalid-model",
    session: !session || /^[a-f0-9]{64}$/.test(session) ? session : "invalid-session",
    day: !day || isUtcDay(day) ? day : "invalid-day",
    scope: !scope || ["primary", "subagent", "unattributed"].includes(scope) ? scope : "invalid-scope",
    includeHidden: values.includeHidden === true || values.includeHidden === "true" ? "true" : "",
    source: ["cli", "vscode"].includes(values.source) ? values.source : "",
    sort: ["tokens", "recent", "duration", "cache", "delegation"].includes(values.sort) ? values.sort : "tokens",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}
