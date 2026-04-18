const API_BASE = "/api";

function tfParams(timeframe, repo) {
  const params = new URLSearchParams();
  if (timeframe && timeframe !== "all") params.set("timeframe", timeframe);
  if (repo) params.set("repo", repo);
  return params;
}

export async function fetchSessions(timeframe, repo) {
  const res = await fetch(`${API_BASE}/sessions?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchSessionDetail(id) {
  const res = await fetch(`${API_BASE}/sessions/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchTrends(timeframe, repo) {
  const res = await fetch(`${API_BASE}/trends?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchInsights(timeframe, repo) {
  const res = await fetch(`${API_BASE}/insights?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchClarity(timeframe, repo) {
  const res = await fetch(`${API_BASE}/clarity?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchEfficiency(timeframe, repo) {
  const res = await fetch(`${API_BASE}/efficiency?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchSessionSprawl(id) {
  const res = await fetch(`${API_BASE}/sessions/${id}/sprawl`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchSessionEfficiency(id) {
  const res = await fetch(`${API_BASE}/sessions/${id}/efficiency`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchPromptLength(timeframe, repo) {
  const res = await fetch(`${API_BASE}/analytics/prompt-length?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchRepoHealth(timeframe) {
  const res = await fetch(`${API_BASE}/analytics/repos?${tfParams(timeframe)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchHotFiles(timeframe, repo) {
  const res = await fetch(`${API_BASE}/analytics/hot-files?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchSessionDepth(timeframe, repo) {
  const res = await fetch(`${API_BASE}/analytics/depth?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchToolUsage(timeframe, repo) {
  const res = await fetch(`${API_BASE}/analytics/tools?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchInstructionGaps(timeframe, repo) {
  const res = await fetch(`${API_BASE}/instruction-gaps?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchInstructionFailures(timeframe, repo) {
  const res = await fetch(`${API_BASE}/instruction-failures?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchDelegation(timeframe, repo) {
  const res = await fetch(`${API_BASE}/delegation?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchJudgment(timeframe, repo) {
  const res = await fetch(`${API_BASE}/judgment?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchDevPlan(timeframe, repo) {
  const res = await fetch(`${API_BASE}/dev-plan?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchProgressCheck(timeframe, repo) {
  const res = await fetch(`${API_BASE}/progress-check?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchRetro(timeframe, repo) {
  const res = await fetch(`${API_BASE}/retro?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchPillarTrends(timeframe, repo) {
  const res = await fetch(`${API_BASE}/pillar-trends?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchWorkStyle(timeframe, repo) {
  const res = await fetch(`${API_BASE}/work-style?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchSessionReplay(id) {
  const res = await fetch(`${API_BASE}/sessions/${id}/replay`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchSessionComplexity(id) {
  const res = await fetch(`${API_BASE}/sessions/${id}/complexity`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchCreateEditRatio(timeframe, repo) {
  const res = await fetch(`${API_BASE}/analytics/create-edit-ratio?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchFileTypes(timeframe, repo) {
  const res = await fetch(`${API_BASE}/analytics/file-types?${tfParams(timeframe, repo)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function analyzePracticePrompt(text) {
  const res = await fetch(`${API_BASE}/practice/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchPracticeChallenge(timeframe) {
  const params = new URLSearchParams();
  if (timeframe) params.set("timeframe", timeframe);
  const res = await fetch(`${API_BASE}/practice/challenge?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchLibraryChallenge(tag) {
  const params = new URLSearchParams({ random: "1" });
  if (tag) params.set("tag", tag);
  const res = await fetch(`${API_BASE}/practice/library?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchLibraryTags() {
  const res = await fetch(`${API_BASE}/practice/library`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchWeaknesses(timeframe) {
  const params = new URLSearchParams();
  if (timeframe) params.set("timeframe", timeframe);
  const res = await fetch(`${API_BASE}/practice/weaknesses?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchLiveFeed(since) {
  const params = new URLSearchParams();
  if (since) params.set("since", since);
  const res = await fetch(`${API_BASE}/live/feed?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
