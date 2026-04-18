// Database access layer — reads from the Copilot session store SQLite DB.

import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

const DB_PATH = process.env.COPILOT_SESSION_DB || join(homedir(), ".copilot", "session-store.db");

let _db = null;

export function getDb() {
  if (_db) return _db;
  if (!existsSync(DB_PATH)) {
    throw new Error(
      `Session store not found at ${DB_PATH}. Make sure Copilot CLI has been used at least once.`
    );
  }
  _db = new Database(DB_PATH, { readonly: true });
  return _db;
}

/**
 * List sessions, optionally filtered by repository and/or date range.
 * @param {object} opts
 * @param {string} [opts.repo] - Filter by repository name (partial match)
 * @param {number} [opts.limit] - Max sessions to return (default: 500)
 * @param {string} [opts.since] - ISO date string — only include sessions created on or after this date
 * @param {Set<string>} [opts.excludeIds] - Session IDs to exclude from results
 */
export function listSessions({ repo, limit = 500, since, excludeIds } = {}) {
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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  return db
    .prepare(
      `SELECT s.id, s.repository, s.branch, s.summary, s.created_at, s.updated_at,
              s.host_type, s.cwd,
              (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) as turn_count
       FROM sessions s
       ${where}
       ORDER BY s.updated_at DESC LIMIT ?`
    )
    .all(...params);
}

/**
 * Get all turns for a session, ordered by turn_index.
 */
export function getSessionTurns(sessionId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT turn_index, user_message, assistant_response, timestamp
       FROM turns WHERE session_id = ? ORDER BY turn_index`
    )
    .all(sessionId);
}

/**
 * Get session metadata by ID.
 */
export function getSession(sessionId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) as turn_count
       FROM sessions s WHERE s.id = ?`
    )
    .get(sessionId);
}

/**
 * Get files touched in a session.
 */
export function getSessionFiles(sessionId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT file_path, tool_name, turn_index FROM session_files
       WHERE session_id = ? ORDER BY turn_index`
    )
    .all(sessionId);
}

/**
 * Search turns across sessions for a text pattern.
 */
export function searchTurns(searchText, limit = 50) {
  const db = getDb();
  return db
    .prepare(
      `SELECT t.session_id, t.turn_index, t.user_message, t.timestamp,
              s.repository, s.branch
       FROM turns t
       JOIN sessions s ON t.session_id = s.id
       WHERE t.user_message LIKE ?
       ORDER BY t.timestamp DESC LIMIT ?`
    )
    .all(`%${searchText}%`, limit);
}

/**
 * Count edits per file within a session (detects file thrashing).
 */
export function getFileEditCounts(sessionId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT file_path, COUNT(*) as edit_count
       FROM session_files
       WHERE session_id = ? AND tool_name = 'edit'
       GROUP BY file_path
       ORDER BY edit_count DESC`
    )
    .all(sessionId);
}

/**
 * Get session refs (commits, PRs, issues) for a session.
 */
export function getSessionRefs(sessionId) {
  const db = getDb();
  try {
    return db
      .prepare(
        `SELECT ref_type, ref_value, turn_index, created_at
         FROM session_refs WHERE session_id = ?`
      )
      .all(sessionId);
  } catch {
    return []; // table may not exist in older DBs
  }
}
