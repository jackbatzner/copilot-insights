// Session-level insight functions — complexity scoring, create/edit ratios, file-type diversity.

import path from "node:path";
import { getDb, hasTable } from "./db.mjs";

/**
 * Compute a complexity score (0-100) for a single session.
 */
export function computeSessionComplexity(sessionId) {
  const db = getDb();

  const session = db
    .prepare(`SELECT created_at, updated_at FROM sessions WHERE id = ?`)
    .get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const turnCount = db
    .prepare(`SELECT COUNT(*) as c FROM turns WHERE session_id = ?`)
    .get(sessionId).c;

  const checkpointCount = hasTable("checkpoints")
    ? db.prepare(`SELECT COUNT(*) as c FROM checkpoints WHERE session_id = ?`).get(sessionId).c
    : 0;

  const fileOps = db
    .prepare(`SELECT COUNT(*) as c FROM session_files WHERE session_id = ?`)
    .get(sessionId).c;

  const uniqueFiles = db
    .prepare(
      `SELECT COUNT(DISTINCT file_path) as c FROM session_files WHERE session_id = ?`
    )
    .get(sessionId).c;

  let durationMin = 0;
  if (session.created_at && session.updated_at) {
    const start = new Date(session.created_at).getTime();
    const end = new Date(session.updated_at).getTime();
    durationMin = Math.max(0, Math.round((end - start) / 60000));
  }

  const raw =
    turnCount * 2 + checkpointCount * 10 + fileOps * 1.5 + uniqueFiles * 2;
  const score = Math.min(100, Math.round(raw));

  let tier;
  if (score <= 25) tier = "lightweight";
  else if (score <= 50) tier = "moderate";
  else if (score <= 75) tier = "complex";
  else tier = "epic";

  return {
    score,
    tier,
    breakdown: {
      turns: turnCount,
      checkpoints: checkpointCount,
      fileOps,
      uniqueFiles,
      durationMin,
    },
    hasCheckpoints: checkpointCount > 0,
  };
}

/**
 * Analyze create vs edit ratio across sessions.
 * @param {object} [opts]
 * @param {string} [opts.repo]  - Filter by repository (partial match)
 * @param {string} [opts.since] - ISO date string lower bound
 */
export function computeCreateEditRatio({ repo, since, excludeIds } = {}) {
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
  if (excludeIds && excludeIds.size > 0) {
    const placeholders = [...excludeIds].map(() => "?").join(", ");
    conditions.push(`s.id NOT IN (${placeholders})`);
    params.push(...excludeIds);
  }
  const where =
    conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

  const perSession = db
    .prepare(
      `SELECT sf.session_id,
              SUM(CASE WHEN sf.tool_name = 'create' THEN 1 ELSE 0 END) as creates,
              SUM(CASE WHEN sf.tool_name = 'edit'   THEN 1 ELSE 0 END) as edits,
              COUNT(*) as totalOps
       FROM session_files sf
       JOIN sessions s ON sf.session_id = s.id
       WHERE 1=1 ${where}
       GROUP BY sf.session_id
       ORDER BY totalOps DESC`
    )
    .all(...params)
    .map((r) => ({
      sessionId: r.session_id,
      creates: r.creates,
      edits: r.edits,
      ratio: r.edits === 0 ? r.creates : +(r.creates / r.edits).toFixed(2),
      totalOps: r.totalOps,
    }));

  const totalCreates = perSession.reduce((s, r) => s + r.creates, 0);
  const totalEdits = perSession.reduce((s, r) => s + r.edits, 0);
  const overallRatio =
    totalEdits === 0 ? totalCreates : +(totalCreates / totalEdits).toFixed(2);

  let label;
  if (overallRatio > 3) label = "Greenfield-heavy";
  else if (overallRatio > 1.5) label = "Balanced-new";
  else if (overallRatio > 0.67) label = "Balanced";
  else if (overallRatio > 0.33) label = "Iteration-focused";
  else label = "Refinement-heavy";

  const ratioText =
    overallRatio >= 1
      ? `${overallRatio}x more files than you edit`
      : `${(1 / overallRatio).toFixed(1)}x more edits than creates`;

  return {
    overall: {
      creates: totalCreates,
      edits: totalEdits,
      ratio: overallRatio,
      label,
    },
    perSession,
    insight: `You create ${ratioText} — you're mostly ${overallRatio >= 1 ? "building new, not iterating" : "iterating on existing code"}.`,
  };
}

/**
 * Analyze file-extension diversity across sessions.
 * @param {object} [opts]
 * @param {string} [opts.repo]  - Filter by repository (partial match)
 * @param {string} [opts.since] - ISO date string lower bound
 */
export function computeFileTypeDiversity({ repo, since, excludeIds } = {}) {
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
  if (excludeIds && excludeIds.size > 0) {
    const placeholders = [...excludeIds].map(() => "?").join(", ");
    conditions.push(`s.id NOT IN (${placeholders})`);
    params.push(...excludeIds);
  }
  const where =
    conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `SELECT sf.file_path
       FROM session_files sf
       JOIN sessions s ON sf.session_id = s.id
       WHERE 1=1 ${where}`
    )
    .all(...params);

  // Tally by extension
  const extMap = new Map();
  for (const { file_path } of rows) {
    const ext = path.extname(file_path).toLowerCase() || "no-ext";
    extMap.set(ext, (extMap.get(ext) || 0) + 1);
  }

  const total = rows.length;
  const extensions = [...extMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([ext, count]) => ({
      ext,
      count,
      pct: total > 0 ? +((count / total) * 100).toFixed(1) : 0,
    }));

  const significantExtensions = extensions.filter((e) => e.count >= 3).length;
  const polyglotScore = Math.min(100, significantExtensions * 15);

  const primaryLanguage = extensions.length > 0 ? extensions[0].ext : "none";

  let profileLabel;
  if (significantExtensions <= 2) profileLabel = "monoglot";
  else if (significantExtensions <= 4) profileLabel = "moderate";
  else if (significantExtensions <= 6) profileLabel = "polyglot";
  else profileLabel = "hyperglot";

  return {
    extensions,
    polyglotScore,
    primaryLanguage,
    totalExtensions: extensions.length,
    insight: `You work across ${extensions.length} file type${extensions.length !== 1 ? "s" : ""} — ${profileLabel === "monoglot" ? "focused specialist" : `strong ${profileLabel}`} profile.`,
  };
}
