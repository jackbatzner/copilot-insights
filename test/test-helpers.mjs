// Shared test utilities — in-memory SQLite DB with Copilot session schema.
// Set COPILOT_SESSION_DB env var BEFORE importing any src/ modules.

import Database from "better-sqlite3";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DB_PATH = join(tmpdir(), `copilot-insights-test-${process.pid}.db`);

/**
 * Create a temporary SQLite DB with the session-store schema and seed data.
 * Sets COPILOT_SESSION_DB so src/db.mjs picks it up.
 * Call this BEFORE importing any src/ modules that depend on db.mjs.
 *
 * @param {object} [opts]
 * @param {Array} [opts.sessions] - Session rows to insert
 * @param {Array} [opts.turns] - Turn rows to insert
 * @param {Array} [opts.files] - session_files rows to insert
 * @param {Array} [opts.refs] - session_refs rows to insert
 * @returns {Database} The test DB instance
 */
export function setupTestDb(opts = {}) {
  // Point the app at our test DB
  process.env.COPILOT_SESSION_DB = TEST_DB_PATH;

  // Create fresh DB
  if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  const db = new Database(TEST_DB_PATH);

  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      repository TEXT,
      branch TEXT,
      summary TEXT,
      created_at TEXT,
      updated_at TEXT,
      host_type TEXT,
      cwd TEXT
    );

    CREATE TABLE turns (
      session_id TEXT,
      turn_index INTEGER,
      user_message TEXT,
      assistant_response TEXT,
      timestamp TEXT,
      PRIMARY KEY (session_id, turn_index)
    );

    CREATE TABLE session_files (
      session_id TEXT,
      file_path TEXT,
      tool_name TEXT,
      turn_index INTEGER
    );

    CREATE TABLE session_refs (
      session_id TEXT,
      ref_type TEXT,
      ref_value TEXT,
      turn_index INTEGER,
      created_at TEXT
    );

    CREATE TABLE checkpoints (
      session_id TEXT,
      checkpoint_number INTEGER,
      title TEXT,
      overview TEXT,
      history TEXT,
      work_done TEXT,
      technical_details TEXT,
      important_files TEXT,
      next_steps TEXT
    );
  `);

  // Seed sessions
  if (opts.sessions) {
    const ins = db.prepare(
      "INSERT INTO sessions (id, repository, branch, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const s of opts.sessions) {
      ins.run(s.id, s.repository || null, s.branch || null, s.summary || null, s.created_at || new Date().toISOString(), s.updated_at || new Date().toISOString());
    }
  }

  // Seed turns
  if (opts.turns) {
    const ins = db.prepare(
      "INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp) VALUES (?, ?, ?, ?, ?)"
    );
    for (const t of opts.turns) {
      ins.run(t.session_id, t.turn_index, t.user_message || null, t.assistant_response || null, t.timestamp || new Date().toISOString());
    }
  }

  // Seed files
  if (opts.files) {
    const ins = db.prepare(
      "INSERT INTO session_files (session_id, file_path, tool_name, turn_index) VALUES (?, ?, ?, ?)"
    );
    for (const f of opts.files) {
      ins.run(f.session_id, f.file_path, f.tool_name || "edit", f.turn_index || 0);
    }
  }

  // Seed refs
  if (opts.refs) {
    const ins = db.prepare(
      "INSERT INTO session_refs (session_id, ref_type, ref_value, turn_index, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const r of opts.refs) {
      ins.run(r.session_id, r.ref_type, r.ref_value, r.turn_index || 0, r.created_at || new Date().toISOString());
    }
  }

  // Seed checkpoints
  if (opts.checkpoints) {
    const ins = db.prepare(
      "INSERT INTO checkpoints (session_id, checkpoint_number, title, overview) VALUES (?, ?, ?, ?)"
    );
    for (const c of opts.checkpoints) {
      ins.run(c.session_id, c.checkpoint_number, c.title || null, c.overview || null);
    }
  }

  return db;
}

/**
 * Clean up the test DB file. Call in after() hooks.
 */
export function teardownTestDb() {
  // Reset the cached DB instance in db.mjs by clearing the module
  try {
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  } catch { /* ignore */ }
}

/**
 * Pre-built test session data for common scenarios.
 */
export const FIXTURES = {
  // A session with clear redirections
  redirectionSession: {
    sessions: [
      { id: "sess-redirect-1", repository: "org/my-app", branch: "feature-auth", summary: "Add auth module", created_at: "2025-01-15T10:00:00Z" },
    ],
    turns: [
      { session_id: "sess-redirect-1", turn_index: 0, user_message: "Create an auth module in src/auth/ with JWT token support", assistant_response: "I'll create the auth module..." },
      { session_id: "sess-redirect-1", turn_index: 1, user_message: "No, don't use passport. Use jsonwebtoken directly", assistant_response: "Got it, switching to jsonwebtoken..." },
      { session_id: "sess-redirect-1", turn_index: 2, user_message: "That's wrong, the token should expire in 1 hour not 24", assistant_response: "Fixed the expiry..." },
      { session_id: "sess-redirect-1", turn_index: 3, user_message: "Actually, use bcrypt for password hashing instead of argon2", assistant_response: "Switching to bcrypt..." },
      { session_id: "sess-redirect-1", turn_index: 4, user_message: "Looks good, ship it", assistant_response: "Done! The auth module is ready." },
    ],
    files: [
      { session_id: "sess-redirect-1", file_path: "src/auth/index.js", tool_name: "create", turn_index: 0 },
      { session_id: "sess-redirect-1", file_path: "src/auth/index.js", tool_name: "edit", turn_index: 1 },
      { session_id: "sess-redirect-1", file_path: "src/auth/index.js", tool_name: "edit", turn_index: 2 },
      { session_id: "sess-redirect-1", file_path: "src/auth/index.js", tool_name: "edit", turn_index: 3 },
    ],
  },

  // A clean session with no redirections
  cleanSession: {
    sessions: [
      { id: "sess-clean-1", repository: "org/my-app", branch: "feature-tests", summary: "Add unit tests for utils", created_at: "2025-01-16T10:00:00Z" },
    ],
    turns: [
      { session_id: "sess-clean-1", turn_index: 0, user_message: "Create unit tests for src/utils.js covering the formatDate and parseConfig functions. Use vitest.", assistant_response: "I'll create comprehensive tests..." },
      { session_id: "sess-clean-1", turn_index: 1, user_message: "Great, now add edge case tests for null inputs", assistant_response: "Adding null input edge cases..." },
      { session_id: "sess-clean-1", turn_index: 2, user_message: "Perfect, run the tests", assistant_response: "All 12 tests pass!" },
    ],
    files: [
      { session_id: "sess-clean-1", file_path: "test/utils.test.js", tool_name: "create", turn_index: 0 },
      { session_id: "sess-clean-1", file_path: "test/utils.test.js", tool_name: "edit", turn_index: 1 },
    ],
    refs: [
      { session_id: "sess-clean-1", ref_type: "commit", ref_value: "abc123" },
    ],
  },

  // A session with auto-generated turns mixed in
  mixedAutoSession: {
    sessions: [
      { id: "sess-mixed-1", repository: "org/my-app", branch: "fix-bug", summary: "<cross_session_message>\nfrom_session_id: other\n</cross_session_message>", created_at: "2025-01-17T10:00:00Z" },
    ],
    turns: [
      { session_id: "sess-mixed-1", turn_index: 0, user_message: "<cross_session_message>\nfrom_session_id: other\n</cross_session_message>Fix the login bug", assistant_response: "Looking into the login bug..." },
      { session_id: "sess-mixed-1", turn_index: 1, user_message: "The login form crashes on empty email", assistant_response: "I see the issue..." },
      { session_id: "sess-mixed-1", turn_index: 2, user_message: "<system_notification>\nSession completed\n</system_notification>", assistant_response: "Noted." },
      { session_id: "sess-mixed-1", turn_index: 3, user_message: "Go back to the previous version, this broke something", assistant_response: "Reverting..." },
    ],
  },

  // Session with drip-feeding pattern
  dripFeedSession: {
    sessions: [
      { id: "sess-drip-1", repository: "org/my-app", branch: "feature-dash", summary: "Build dashboard", created_at: "2025-01-18T10:00:00Z" },
    ],
    turns: [
      { session_id: "sess-drip-1", turn_index: 0, user_message: "Create a dashboard page", assistant_response: "Creating the dashboard...", timestamp: "2025-01-18T10:00:00Z" },
      { session_id: "sess-drip-1", turn_index: 1, user_message: "Oh and also add a sidebar navigation", assistant_response: "Adding sidebar..." , timestamp: "2025-01-18T10:01:00Z"},
      { session_id: "sess-drip-1", turn_index: 2, user_message: "I forgot to mention, it needs dark mode support", assistant_response: "Adding dark mode...", timestamp: "2025-01-18T10:02:00Z" },
      { session_id: "sess-drip-1", turn_index: 3, user_message: "btw the header should be sticky", assistant_response: "Making header sticky...", timestamp: "2025-01-18T10:03:00Z" },
      { session_id: "sess-drip-1", turn_index: 4, user_message: "Looks great, thanks!", assistant_response: "Happy to help!", timestamp: "2025-01-18T10:04:00Z" },
    ],
  },
};
