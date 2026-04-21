const API_BASE = "/api";

/**
 * Wrapper around fetch that handles HTTP errors and JSON parse failures.
 */
async function safeFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new Error("Invalid JSON response from server");
  }
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

export async function fetchHiddenSessions() {
  return safeFetch(`${API_BASE}/hidden-sessions`);
}

export async function hideSession(id) {
  return safeFetch(`${API_BASE}/sessions/${id}/hide`, { method: "POST" });
}

export async function unhideSession(id) {
  return safeFetch(`${API_BASE}/sessions/${id}/hide`, { method: "DELETE" });
}
