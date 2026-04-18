// Deep analytics — time-of-day productivity, prompt length analysis,
// per-repo health, hot files, session depth, and checkpoint usage.

import {
  listSessions,
  getSessionTurns,
  getFileEditCounts,
  getSessionRefs,
  getDb,
} from "./db.mjs";
import { matchPatterns } from "./patterns.mjs";

/**
 * Productivity by hour — turn counts and redirection rates per hour of day.
 */
export function hourlyProductivity({ repo, since } = {}) {
  const sessions = listSessions({ repo, since });
  const buckets = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    totalTurns: 0,
    redirectionTurns: 0,
  }));

  for (const s of sessions) {
    if (s.turn_count < 2) continue;
    const turns = getSessionTurns(s.id);
    for (const t of turns) {
      if (!t.timestamp || !t.user_message) continue;
      const hour = new Date(t.timestamp).getUTCHours();
      if (isNaN(hour)) continue;
      buckets[hour].totalTurns++;
      const matches = matchPatterns(t.user_message);
      if (matches.length > 0) buckets[hour].redirectionTurns++;
    }
  }

  return buckets.map((b) => ({
    ...b,
    redirectionRate:
      b.totalTurns > 0 ? Math.round((b.redirectionTurns / b.totalTurns) * 100) : 0,
  }));
}

/**
 * Prompt length vs redirection rate — bucket message lengths.
 */
export function promptLengthAnalysis({ repo, since } = {}) {
  const sessions = listSessions({ repo, since });
  const buckets = [
    { label: "< 50", min: 0, max: 50, total: 0, redirected: 0 },
    { label: "50-150", min: 50, max: 150, total: 0, redirected: 0 },
    { label: "150-500", min: 150, max: 500, total: 0, redirected: 0 },
    { label: "500-1k", min: 500, max: 1000, total: 0, redirected: 0 },
    { label: "1k+", min: 1000, max: Infinity, total: 0, redirected: 0 },
  ];

  for (const s of sessions) {
    if (s.turn_count < 2) continue;
    const turns = getSessionTurns(s.id);
    for (const t of turns) {
      if (!t.user_message) continue;
      const cleaned = t.user_message
        .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .trim();
      const len = cleaned.length;
      const matches = matchPatterns(t.user_message);
      for (const b of buckets) {
        if (len >= b.min && len < b.max) {
          b.total++;
          if (matches.length > 0) b.redirected++;
          break;
        }
      }
    }
  }

  return buckets.map((b) => ({
    label: b.label,
    total: b.total,
    redirected: b.redirected,
    rate: b.total > 0 ? Math.round((b.redirected / b.total) * 100) : 0,
  }));
}

/**
 * Per-repo health — redirection rates broken down by repository.
 */
export function repoHealth({ since } = {}) {
  const sessions = listSessions({ since });
  const repos = {};

  for (const s of sessions) {
    const repoName = s.repository || "(no repo)";
    if (!repos[repoName]) {
      repos[repoName] = { sessions: 0, totalTurns: 0, redirectionTurns: 0, totalWeight: 0 };
    }
    repos[repoName].sessions++;
    if (s.turn_count < 2) continue;
    const turns = getSessionTurns(s.id);
    for (const t of turns) {
      if (!t.user_message) continue;
      repos[repoName].totalTurns++;
      const matches = matchPatterns(t.user_message);
      if (matches.length > 0) {
        repos[repoName].redirectionTurns++;
        repos[repoName].totalWeight += matches.reduce((sum, m) => sum + m.weight, 0);
      }
    }
  }

  return Object.entries(repos)
    .map(([name, data]) => ({
      name,
      ...data,
      rate: data.totalTurns > 0
        ? Math.round((data.redirectionTurns / data.totalTurns) * 100)
        : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions);
}

/**
 * Hot files — files touched across multiple sessions.
 */
export function hotFiles({ repo, since } = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (repo) {
    conditions.push("s.repository LIKE ?");
    params.push(`%${repo}%`);
  }
  if (since) {
    conditions.push("s.created_at >= ?");
    params.push(since);
  }

  const where = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

  const files = db.prepare(
    `SELECT sf.file_path,
            COUNT(DISTINCT sf.session_id) as sessions,
            COUNT(*) as total_touches,
            sf.tool_name
     FROM session_files sf
     JOIN sessions s ON sf.session_id = s.id
     WHERE 1=1 ${where}
     GROUP BY sf.file_path, sf.tool_name
     ORDER BY total_touches DESC
     LIMIT 20`
  ).all(...params);

  // Simplify paths — show just filename + parent dir
  return files.map((f) => {
    const parts = f.file_path.replace(/\\/g, "/").split("/");
    const short = parts.length > 2
      ? `…/${parts.slice(-2).join("/")}`
      : f.file_path;
    return { ...f, shortPath: short };
  });
}

/**
 * Session depth distribution — how many turns per session.
 */
export function sessionDepth({ repo, since } = {}) {
  const sessions = listSessions({ repo, since });
  const buckets = [
    { label: "1-2 turns", min: 1, max: 3, count: 0 },
    { label: "3-5 turns", min: 3, max: 6, count: 0 },
    { label: "6-10 turns", min: 6, max: 11, count: 0 },
    { label: "11-20 turns", min: 11, max: 21, count: 0 },
    { label: "21+ turns", min: 21, max: Infinity, count: 0 },
  ];

  for (const s of sessions) {
    const tc = s.turn_count || 0;
    for (const b of buckets) {
      if (tc >= b.min && tc < b.max) { b.count++; break; }
    }
  }

  return {
    total: sessions.length,
    buckets,
    avgTurns: sessions.length > 0
      ? Math.round(sessions.reduce((s, x) => s + (x.turn_count || 0), 0) / sessions.length)
      : 0,
  };
}

/**
 * Tool usage — create vs edit breakdown.
 */
export function toolUsage({ repo, since } = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (repo) {
    conditions.push("s.repository LIKE ?");
    params.push(`%${repo}%`);
  }
  if (since) {
    conditions.push("s.created_at >= ?");
    params.push(since);
  }

  const where = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

  const tools = db.prepare(
    `SELECT sf.tool_name, COUNT(*) as cnt
     FROM session_files sf
     JOIN sessions s ON sf.session_id = s.id
     WHERE 1=1 ${where}
     GROUP BY sf.tool_name ORDER BY cnt DESC`
  ).all(...params);

  return tools;
}
