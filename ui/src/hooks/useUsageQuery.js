import { useSearchParams } from "react-router-dom";
import { useTimeframe } from "../TimeframeContext.jsx";
import { safeUsageQueryValues } from "../usage-query-values.js";
export { validUtcDay } from "../usage-query-values.js";

export const scopeLabels = { primary: "Primary", subagent: "Child invocations", unattributed: "Unattributed" };

export function useUsageQuery() {
  const [params, setParams] = useSearchParams();
  const { timeframe, setTimeframe } = useTimeframe();
  const safe = safeUsageQueryValues(Object.fromEntries(params));
  const { model, session, source, day, scope, sort, page } = safe;
  const includeHidden = safe.includeHidden === "true";
  const createParams = (overrides = {}) => {
    const values = { timeframe, model, session, day, scope, includeHidden: includeHidden ? "true" : "", source, sort, page, ...overrides };
    return new URLSearchParams(Object.entries(safeUsageQueryValues(values)).filter(([, value]) => value !== "" && value != null));
  };
  return {
    timeframe, setTimeframe, model, session, day, scope, includeHidden, source, sort, page,
    search: `?${createParams({ session: "" })}`,
    link: (path, overrides) => `${path}?${createParams({ session: path === "/tokens/compare" ? session : "", ...overrides })}`,
    update: (overrides) => setParams(createParams({ page: 1, ...overrides })),
  };
}
