import { createUsageCache, usageAbortError } from "./usage-cache.js";

const API_BASE = "/api";
const REQUEST_TIMEOUT_MS = 30_000;
// A cold usage read may need to scan all local sources before returning.
const USAGE_GET_TIMEOUT_MS = 120_000;
const cache = createUsageCache();

export { USAGE_CACHE_POLICY } from "./usage-cache.js";
export const getUsageCacheStatus = () => cache.status();

export function clearCache() {
  cache.clear();
}

function safeFetch(url, options = {}) {
  const { noCache, signal, ...fetchOptions } = options;
  if ((fetchOptions.method || "GET").toUpperCase() !== "GET") {
    return fetchUsage(url, { ...fetchOptions, signal });
  }
  const key = url.replace(/^\/api\/tokens\/summary(?=\?|$)/, "/api/summary");
  const timeoutMs = /^\/api\/(?:summary|tokens\/summary|sessions|comparison)(?:[/?]|$)/.test(url)
    ? USAGE_GET_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  if (noCache && isUsageCollection(key)) cache.invalidate((candidate) => isUsageCollection(candidate) && candidate !== key);
  return cache.load(key, (sharedSignal) => fetchUsage(url, {
    ...fetchOptions, signal: sharedSignal,
  }, timeoutMs), { noCache, signal });
}

async function fetchUsage(url, { signal, ...fetchOptions }, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (signal?.aborted) throw usageAbortError();
  const controller = new AbortController();
  let timedOut = false;
  let safeError;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, { ...fetchOptions, cache: "no-store", signal: controller.signal });
    if (!response.ok) {
      safeError = new Error(response.status === 404
        ? "This view is unavailable. The session may no longer be recorded."
        : "Usage data could not be loaded. Try again.");
      throw safeError;
    }
    let data;
    try {
      data = await response.json();
    } catch {
      safeError = new Error("The server returned an invalid usage response. Try again.");
      throw safeError;
    }
    if (controller.signal.aborted) throw usageAbortError();
    return data;
  } catch (error) {
    if (timedOut) throw new Error("The usage request timed out. Try again.");
    if (controller.signal.aborted || error?.name === "AbortError") throw usageAbortError();
    if (safeError && error === safeError) throw error;
    if (error instanceof TypeError) throw new Error("Cannot reach the local usage server. Try again.");
    throw new Error("Usage data could not be loaded. Try again.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function query(timeframe, { model, day, scope, includeHidden, ...extra } = {}) {
  const params = new URLSearchParams({ timeframe });
  if (model) params.set("model", model);
  if (day) params.set("day", day);
  if (scope) params.set("scope", scope);
  if (includeHidden) params.set("includeHidden", "true");
  for (const key of ["page", "pageSize", "sort", "source", "session", "after", "exclude"]) {
    if (key === "page" && extra[key] === 1 || key === "pageSize" && extra[key] === 25 || key === "sort" && extra[key] === "tokens") continue;
    if (extra[key] !== undefined && extra[key] !== "") params.set(key, extra[key]);
  }
  return params;
}

export const fetchSummary = (timeframe, options) =>
  safeFetch(`${API_BASE}/summary?${query(timeframe)}`, options);
export const fetchTokenSummary = (timeframe, options) =>
  safeFetch(`${API_BASE}/tokens/summary?${query(timeframe)}`, options);
export async function fetchSessions(timeframe, filters = {}, options = {}) {
  if (options.signal?.aborted) throw usageAbortError();
  const summaryUrl = `${API_BASE}/summary?${query(timeframe)}`;
  if (!filters.model && !filters.day && !filters.scope && !filters.includeHidden &&
      !filters.source && !filters.session && !filters.after && !filters.exclude &&
      (!filters.page || filters.page === 1) && (!filters.pageSize || filters.pageSize === 25) &&
      (!filters.sort || filters.sort === "tokens") &&
      !options.noCache && (!options.method || options.method.toUpperCase() === "GET")) {
    const snapshot = cache.peek(summaryUrl) ?? (cache.hasPending(summaryUrl) ? await safeFetch(summaryUrl, options) : null);
    if (snapshot?.sessions && snapshot.models && snapshot.capabilities) {
      return { sessions: snapshot.sessions, models: snapshot.models, capabilities: snapshot.capabilities,
        ...(snapshot.pagination ? { pagination: snapshot.pagination } : {}) };
    }
  }
  return safeFetch(`${API_BASE}/sessions?${query(timeframe, filters)}`, options);
}

const isUsageCollection = (key) => /^\/api\/(?:summary|sessions|comparison)(?:\?|$)/.test(key);
const sessionSignature = (session) => session ? JSON.stringify({ ...session, selectedUsage: null, selectedEvidence: null }) : null;

export async function fetchSessionDetail(handle, options, view = "") {
  const base = `${API_BASE}/sessions/${encodeURIComponent(handle)}`;
  const url = `${base}${view === "summary" ? "?view=summary" : ""}`;
  const previous = cache.peek(url);
  const data = await safeFetch(url, options);
  if (data === previous || cache.peek(url) !== data) return data;
  const current = sessionSignature(data?.session);
  let changed = previous?.session && (sessionSignature(previous.session) !== current || previous.revision !== data.revision);
  if (data?.session && !changed) {
    changed = ["all", "90d", "30d", "7d"].some((timeframe) => {
      const snapshot = cache.peek(`${API_BASE}/summary?${query(timeframe)}`);
      const recorded = snapshot?.sessions?.find((session) => session.handle === handle);
      return recorded && sessionSignature(recorded) !== current;
    });
  }
  if (changed) cache.invalidate((key) => isUsageCollection(key) || key.startsWith(`${base}/`));
  return data;
}
export function fetchSessionTurns(handle, filters, options) {
  const params = new URLSearchParams();
  for (const key of ["model", "scope", "day", "assignment", "sort", "page", "turn", "requestPage"]) {
    if (filters[key] !== undefined && filters[key] !== "") params.set(key, filters[key]);
  }
  return safeFetch(`${API_BASE}/sessions/${encodeURIComponent(handle)}/turns?${params}`, options);
}
export const fetchSessionTools = (handle, options) =>
  safeFetch(`${API_BASE}/sessions/${encodeURIComponent(handle)}/tools`, options);
export const fetchSettings = (options) => safeFetch(`${API_BASE}/settings`, options);

export async function fetchModelComparison(timeframe, filters = {}, options = {}) {
  if (options.signal?.aborted) throw usageAbortError();
  const params = query(timeframe, filters);
  if (filters.session) params.set("session", filters.session);
  if (filters.source) params.set("source", filters.source);
  const url = `${API_BASE}/comparison?${params}`;
  if (!options.noCache && (!options.method || options.method.toUpperCase() === "GET") &&
      (cache.peek(url) !== undefined || cache.hasPending(url))) {
    return safeFetch(url, options);
  }
  if (filters.session && timeframe === "all" && !filters.model && !filters.day && !filters.scope &&
      !options.noCache && (!options.method || options.method.toUpperCase() === "GET")) {
    const detail = cache.peek(`${API_BASE}/sessions/${encodeURIComponent(filters.session)}?view=summary`)
      ?? cache.peek(`${API_BASE}/sessions/${encodeURIComponent(filters.session)}`);
    if (detail?.comparison && (!detail.session.hidden || filters.includeHidden) &&
        (!filters.source || filters.source === detail.session.source)) {
      return { ...detail.comparison, capabilities: detail.capabilities, diagnostic: detail.diagnostic };
    }
  }
  const summaryUrl = `${API_BASE}/summary?${query(timeframe)}`;
  if (!filters.model && !filters.day && !filters.scope && !filters.includeHidden && !filters.session &&
      !filters.source && !options.noCache && (!options.method || options.method.toUpperCase() === "GET")) {
    const snapshot = cache.peek(summaryUrl) ?? (cache.hasPending(summaryUrl) ? await safeFetch(summaryUrl, options) : null);
    if (snapshot?.comparison) return { ...snapshot.comparison, capabilities: snapshot.capabilities, diagnostic: { active: false } };
  }
  return safeFetch(url, options);
}
export async function updateSettings(patch) {
  const finish = cache.beginMutation();
  try {
    return await safeFetch(`${API_BASE}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enableVSCode: patch.enableVSCode }),
    });
  } finally {
    finish();
  }
}

export async function setSessionHidden(handle, hidden) {
  const detailUrl = `${API_BASE}/sessions/${encodeURIComponent(handle)}`;
  const finish = cache.beginMutation((key) => isUsageCollection(key) || key === detailUrl || key.startsWith(`${detailUrl}?`) || key.startsWith(`${detailUrl}/`));
  try {
    return await safeFetch(`${API_BASE}/sessions/${encodeURIComponent(handle)}/hide`, {
      method: hidden ? "POST" : "DELETE",
    });
  } finally {
    finish();
  }
}

export async function refreshData() {
  const finish = cache.beginMutation();
  try {
    await safeFetch(`${API_BASE}/refresh`, { method: "POST" });
  } finally {
    finish();
  }
}
