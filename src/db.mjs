// Database access layer — reads from the Copilot session store SQLite DB.

import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

const DB_PATH = process.env.COPILOT_SESSION_DB || join(homedir(), ".copilot", "session-store.db");

const REQUIRED_TABLES = ["sessions", "turns", "session_files"];
const OPTIONAL_TABLES = ["session_refs", "checkpoints"];

let _db = null;
let _missingOptional = new Set();

/**
 * Validate that the DB has the expected Copilot session-store schema.
 * Required tables cause an error; optional tables are tracked for graceful degradation.
 */
function validateSchema(db) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const tables = new Set(rows.map((r) => r.name));

  const missingRequired = REQUIRED_TABLES.filter((t) => !tables.has(t));
  if (missingRequired.length > 0) {
    throw new Error(
      `Copilot session DB is missing required tables: ${missingRequired.join(", ")}.\n` +
      `The database at ${DB_PATH} may be from an incompatible Copilot CLI version.\n` +
      `Expected tables: ${REQUIRED_TABLES.join(", ")}\n` +
      `Please update Copilot CLI or report this issue:\n` +
      `  https://github.com/jackbatzner/copilot-insights/issues`
    );
  }

  const missingOpt = OPTIONAL_TABLES.filter((t) => !tables.has(t));
  if (missingOpt.length > 0) {
    _missingOptional = new Set(missingOpt);
    console.warn(
      `[copilot-insights] Optional tables missing: ${missingOpt.join(", ")}. Some features may be limited.`
    );
  }
}

/**
 * Check whether an optional table is available.
 * @param {string} tableName
 * @returns {boolean}
 */
export function hasTable(tableName) {
  return !_missingOptional.has(tableName);
}

export function getDb() {
  if (_db) return _db;
  if (!existsSync(DB_PATH)) {
    throw new Error(
      `Couldn't find the Copilot session database at ${DB_PATH}. ` +
      `Make sure Copilot CLI is installed and you've completed at least one session. ` +
      `You can set the COPILOT_SESSION_DB environment variable to point to a custom location.`
    );
  }
  try {
    _db = new Database(DB_PATH, { readonly: true });
  } catch (err) {
    throw new Error(
      `Couldn't open the session database at ${DB_PATH}: ${err.message}. ` +
      `The file may be corrupted or locked by another process.`,
      { cause: err }
    );
  }
  validateSchema(_db);
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
  if (!hasTable("session_refs")) return [];
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
