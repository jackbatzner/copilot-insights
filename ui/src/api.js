const API_BASE = "/api";

// ── TTL + LRU Cache ─────────────────────────────────────────
const CACHE_TTL_MS = 60_000; // 60 seconds
const CACHE_MAX_SIZE = 200;
const cache = new Map(); // url → { data, ts }

export function clearCache() {
  cache.clear();
}

function getCached(url) {
  const entry = cache.get(url);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(url);
    return undefined;
  }
  // Move to end for LRU ordering
  cache.delete(url);
  cache.set(url, entry);
  return entry.data;
}

function setCache(url, data) {
  // Evict oldest entries when cache is full
  if (cache.size >= CACHE_MAX_SIZE) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(url, { data, ts: Date.now() });
}

const FETCH_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * Wrapper around fetch that handles HTTP errors, JSON parse failures, and timeouts.
 * GET requests are cached with a 60-second TTL and LRU eviction at 200 entries.
 * Pass { text: true } in options to return raw text instead of JSON.
 */
async function safeFetch(url, options) {
  const isGet = !options || !options.method || options.method === "GET";
  const returnText = options?.text === true;
  if (isGet && !returnText) {
    const hit = getCached(url);
    if (hit !== undefined) return hit;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  // Strip custom options before passing to fetch
  const { text: _text, ...fetchOptions } = options || {};

  let res;
  try {
    res = await fetch(url, { ...fetchOptions, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Request timed out — the server took too long to respond. Try again or check that the server is running.");
    }
    throw new Error(
      "Can't reach the Copilot Insights server. Make sure it's running (npm start) and try refreshing."
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    let errorMessage;
    try {
      const body = await res.json();
      errorMessage = body.error;
    } catch {
      // no JSON body
    }
    throw new Error(errorMessage || `Server returned HTTP ${res.status} — check the server logs for details.`);
  }

  if (returnText) {
    return res.text();
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Invalid JSON response from server");
  }

  if (isGet) setCache(url, data);
  return data;
}

function tfParams(timeframe, repo) {
  const params = new URLSearchParams();
  if (timeframe && timeframe !== "all") params.set("timeframe", timeframe);
  if (repo) params.set("repo", repo);
  return params;
}

export async function fetchSessions(timeframe, repo) {
  return safeFetch(`${API_BASE}/sessions?${tfParams(timeframe, repo)}`);
}

export async function fetchSessionDetail(id) {
  return safeFetch(`${API_BASE}/sessions/${id}`);
}

export async function fetchTrends(timeframe, repo) {
  return safeFetch(`${API_BASE}/trends?${tfParams(timeframe, repo)}`);
}

export async function fetchInsights(timeframe, repo) {
  return safeFetch(`${API_BASE}/insights?${tfParams(timeframe, repo)}`);
}

export async function fetchClarity(timeframe, repo) {
  return safeFetch(`${API_BASE}/clarity?${tfParams(timeframe, repo)}`);
}

export async function fetchEfficiency(timeframe, repo) {
  return safeFetch(`${API_BASE}/efficiency?${tfParams(timeframe, repo)}`);
}

export async function fetchSessionSprawl(id) {
  return safeFetch(`${API_BASE}/sessions/${id}/sprawl`);
}

export async function fetchSessionEfficiency(id) {
  return safeFetch(`${API_BASE}/sessions/${id}/efficiency`);
}

export async function fetchPromptLength(timeframe, repo) {
  return safeFetch(`${API_BASE}/analytics/prompt-length?${tfParams(timeframe, repo)}`);
}

export async function fetchRepoHealth(timeframe) {
  return safeFetch(`${API_BASE}/analytics/repos?${tfParams(timeframe)}`);
}

export async function fetchHotFiles(timeframe, repo) {
  return safeFetch(`${API_BASE}/analytics/hot-files?${tfParams(timeframe, repo)}`);
}

export async function fetchSessionDepth(timeframe, repo) {
  return safeFetch(`${API_BASE}/analytics/depth?${tfParams(timeframe, repo)}`);
}

export async function fetchToolUsage(timeframe, repo) {
  return safeFetch(`${API_BASE}/analytics/tools?${tfParams(timeframe, repo)}`);
}

export async function fetchInstructionGaps(timeframe, repo) {
  return safeFetch(`${API_BASE}/instruction-gaps?${tfParams(timeframe, repo)}`);
}

export async function fetchInstructionFailures(timeframe, repo) {
  return safeFetch(`${API_BASE}/instruction-failures?${tfParams(timeframe, repo)}`);
}

export async function fetchDelegation(timeframe, repo) {
  return safeFetch(`${API_BASE}/delegation?${tfParams(timeframe, repo)}`);
}

export async function fetchJudgment(timeframe, repo) {
  return safeFetch(`${API_BASE}/judgment?${tfParams(timeframe, repo)}`);
}

export async function fetchDevPlan(timeframe, repo) {
  return safeFetch(`${API_BASE}/dev-plan?${tfParams(timeframe, repo)}`);
}

export async function fetchProgressCheck(timeframe, repo) {
  return safeFetch(`${API_BASE}/progress-check?${tfParams(timeframe, repo)}`);
}

export async function fetchRetro(timeframe, repo) {
  return safeFetch(`${API_BASE}/retro?${tfParams(timeframe, repo)}`);
}

export async function fetchPillarTrends(timeframe, repo) {
  return safeFetch(`${API_BASE}/pillar-trends?${tfParams(timeframe, repo)}`);
}

export async function fetchWorkStyle(timeframe, repo) {
  return safeFetch(`${API_BASE}/work-style?${tfParams(timeframe, repo)}`);
}

export async function fetchSessionReplay(id) {
  return safeFetch(`${API_BASE}/sessions/${id}/replay`);
}

export async function fetchSessionComplexity(id) {
  return safeFetch(`${API_BASE}/sessions/${id}/complexity`);
}

export async function fetchCreateEditRatio(timeframe, repo) {
  return safeFetch(`${API_BASE}/analytics/create-edit-ratio?${tfParams(timeframe, repo)}`);
}

export async function fetchFileTypes(timeframe, repo) {
  return safeFetch(`${API_BASE}/analytics/file-types?${tfParams(timeframe, repo)}`);
}

export async function analyzePracticePrompt(text) {
  return safeFetch(`${API_BASE}/practice/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export async function fetchPracticeChallenge(timeframe) {
  const params = new URLSearchParams();
  if (timeframe) params.set("timeframe", timeframe);
  return safeFetch(`${API_BASE}/practice/challenge?${params}`);
}

export async function fetchLibraryChallenge(tag) {
  const params = new URLSearchParams({ random: "1" });
  if (tag) params.set("tag", tag);
  return safeFetch(`${API_BASE}/practice/library?${params}`);
}

export async function fetchLibraryTags() {
  return safeFetch(`${API_BASE}/practice/library`);
}

export async function fetchWeaknesses(timeframe) {
  const params = new URLSearchParams();
  if (timeframe) params.set("timeframe", timeframe);
  return safeFetch(`${API_BASE}/practice/weaknesses?${params}`);
}

export async function fetchLiveFeed(since) {
  const params = new URLSearchParams();
  if (since) params.set("since", since);
  return safeFetch(`${API_BASE}/live/feed?${params}`);
}

// -- Token Usage & Cost -----------------------------------

export async function fetchTokenPricing() {
  return safeFetch(`${API_BASE}/tokens/pricing`);
}

export async function fetchTokenSummary(timeframe, repo) {
  return safeFetch(`${API_BASE}/tokens/summary?${tfParams(timeframe, repo)}`);
}

export async function fetchTokensByModel(timeframe, repo) {
  return safeFetch(`${API_BASE}/tokens/by-model?${tfParams(timeframe, repo)}`);
}

export async function fetchTokenTrends(timeframe, repo) {
  return safeFetch(`${API_BASE}/tokens/trends?${tfParams(timeframe, repo)}`);
}

export async function fetchTokenEfficiency(timeframe, repo) {
  return safeFetch(`${API_BASE}/tokens/efficiency?${tfParams(timeframe, repo)}`);
}

export async function fetchTokenCorrelations(timeframe, repo) {
  return safeFetch(`${API_BASE}/tokens/correlations?${tfParams(timeframe, repo)}`);
}

export async function fetchTokenBudget(timeframe, repo) {
  return safeFetch(`${API_BASE}/tokens/budget?${tfParams(timeframe, repo)}`);
}

export async function fetchTokenTips(timeframe, repo) {
  return safeFetch(`${API_BASE}/tokens/tips?${tfParams(timeframe, repo)}`);
}

export async function fetchSessionTokens(id) {
  return safeFetch(`${API_BASE}/sessions/${id}/tokens`);
}

export async function fetchHiddenSessions() {
  return safeFetch(`${API_BASE}/hidden-sessions`);
}

export async function hideSession(id) {
  return safeFetch(`${API_BASE}/sessions/${id}/hide`, { method: "POST" });
}

export async function unhideSession(id) {
  return safeFetch(`${API_BASE}/sessions/${id}/hide`, { method: "DELETE" });
}

// Chronicle
export async function fetchChronicleTips(timeframe, repo) {
  return safeFetch(`${API_BASE}/chronicle/tips?${tfParams(timeframe, repo)}`);
}
export async function fetchChronicleImprove(sessionId) {
  return safeFetch(`${API_BASE}/chronicle/improve/${sessionId}`);
}

// Session Intent Tags
export async function fetchSessionIntent(id) {
  return safeFetch(`${API_BASE}/sessions/${id}/intent`);
}

export async function fetchIntentSuggestion(id) {
  return safeFetch(`${API_BASE}/sessions/${id}/intent-suggestion`);
}

export async function setSessionIntent(id, intent) {
  return safeFetch(`${API_BASE}/sessions/${id}/intent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent }),
  });
}

export async function fetchAllIntents() {
  return safeFetch(`${API_BASE}/session-intents`);
}

// Dev Plan Goals
export async function fetchDevPlanGoals(withProgress = false) {
  return safeFetch(`${API_BASE}/devplan/goals${withProgress ? "?progress=true" : ""}`);
}

export async function addDevPlanGoal({ pillar, title, description, source, baselineScore }) {
  return safeFetch(`${API_BASE}/devplan/goals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pillar, title, description, source, baselineScore }),
  });
}

export async function updateDevPlanGoalStatus(id, status) {
  return safeFetch(`${API_BASE}/devplan/goals/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export async function addGoalNote(id, text) {
  return safeFetch(`${API_BASE}/devplan/goals/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addNote: text }),
  });
}

export async function fetchJournal() {
  return safeFetch(`${API_BASE}/devplan/journal`, { text: true });
}

export async function deleteDevPlanGoal(id) {
  return safeFetch(`${API_BASE}/devplan/goals/${id}`, { method: "DELETE" });
}

// VS Code sessions
export async function fetchVSCodeSessions() {
  return safeFetch(`${API_BASE}/vscode/sessions`);
}
export async function fetchVSCodeSummary() {
  return safeFetch(`${API_BASE}/vscode/summary`);
}
