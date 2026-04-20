// VSCode Copilot Chat session discovery and parsing.
// Reads JSON chat session files from VSCode's workspaceStorage directory
// and normalizes them to the same shape used by the CLI session-store.db reader (db.mjs).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

/** Identifies sessions originating from VSCode chat history. */
export const SOURCE_VSCODE = "vscode";

// ---------------------------------------------------------------------------
// Internal: path discovery
// ---------------------------------------------------------------------------

/** Editor variant folder names to search within each OS-specific config root. */
const EDITOR_VARIANTS = ["Code", "Code - Insiders", "VSCodium", "Cursor"];

/**
 * Returns the base config directory for each supported OS.
 * @returns {string[]} Array of root config directories that may contain editor storage.
 */
function getConfigRoots() {
  const home = homedir();
  switch (platform()) {
    case "win32":
      return [
        process.env.APPDATA || join(home, "AppData", "Roaming"),
      ];
    case "darwin":
      return [join(home, "Library", "Application Support")];
    default:
      // Linux and other Unix-like
      return [process.env.XDG_CONFIG_HOME || join(home, ".config")];
  }
}

/**
 * Module-level cache for discovered paths so repeated calls within the same
 * process don't re-scan the filesystem.
 * @type {string[] | null}
 */
let _cachedPaths = null;

/**
 * Discover all VSCode Copilot Chat `chatSessions` JSON file paths across every
 * OS-specific location and editor variant (Code, Code - Insiders, VSCodium, Cursor).
 *
 * Supports `process.env.VSCODE_STORAGE_PATH` as an override — when set, only
 * that directory is searched (useful for testing).
 *
 * @returns {string[]} Array of absolute file paths to chatSessions JSON files.
 */
export function discoverVscodePaths() {
  if (_cachedPaths) return _cachedPaths;

  /** @type {string[]} */
  const results = [];

  // If an explicit override is provided, search only there.
  if (process.env.VSCODE_STORAGE_PATH) {
    collectSessionFiles(process.env.VSCODE_STORAGE_PATH, results);
    _cachedPaths = results;
    return results;
  }

  const roots = getConfigRoots();

  for (const root of roots) {
    for (const variant of EDITOR_VARIANTS) {
      const workspaceStorageDir = join(root, variant, "User", "workspaceStorage");
      if (!existsSync(workspaceStorageDir)) continue;

      collectSessionFiles(workspaceStorageDir, results);
    }
  }

  _cachedPaths = results;
  return results;
}

/**
 * Scan a workspaceStorage (or override) directory and push every chatSessions
 * JSON file path found within `github.copilot-chat` sub-folders.
 *
 * @param {string} baseDir - The workspaceStorage directory to scan.
 * @param {string[]} out   - Array to push discovered paths into.
 */
function collectSessionFiles(baseDir, out) {
  let entries;
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return; // directory unreadable — skip silently
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const chatDir = join(baseDir, entry.name, "github.copilot-chat");
    if (!existsSync(chatDir)) continue;

    // The session data may live directly as a JSON file in the chatDir,
    // or inside a "chatSessions" sub-directory.
    const candidatePaths = [
      join(chatDir, "chatSessions"),
      chatDir,
    ];

    for (const candidate of candidatePaths) {
      let files;
      try {
        files = readdirSync(candidate, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of files) {
        if (f.isFile() && f.name.endsWith(".json")) {
          out.push(join(candidate, f.name));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Internal: workspace URI helpers
// ---------------------------------------------------------------------------

/**
 * Best-effort extraction of a repository identifier from a workspace URI.
 * Looks for patterns like `/owner/repo` inside a typical file path.
 *
 * @param {object|undefined} workspace
 * @returns {string|null}
 */
function extractRepoFromWorkspace(workspace) {
  const cwd = extractCwdFromWorkspace(workspace);
  if (!cwd) return null;

  // Attempt to pull a GitHub-style owner/repo from the path.
  // Matches segments like /repos/owner/repo, /github/owner/repo, or generic
  // two trailing non-dot segments.
  const normalized = cwd.replace(/\\/g, "/");
  const ghMatch = normalized.match(/\/(?:repos|github|projects)\/([^/]+\/[^/]+)/i);
  if (ghMatch) return ghMatch[1];

  // Fallback: last two path segments (often org/repo).
  const segments = normalized.replace(/\/+$/, "").split("/").filter(Boolean);
  if (segments.length >= 2) {
    return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
  }
  return null;
}

/**
 * Extract a working directory path from the workspace resource URI.
 *
 * @param {object|undefined} workspace
 * @returns {string|null}
 */
function extractCwdFromWorkspace(workspace) {
  if (!workspace || !workspace.resource) return null;
  try {
    const url = new URL(workspace.resource);
    // file:// URIs encode the path; decode it.
    let fsPath = decodeURIComponent(url.pathname);
    // On Windows, file:///C:/foo yields pathname /C:/foo — strip leading slash.
    if (platform() === "win32" && /^\/[A-Za-z]:/.test(fsPath)) {
      fsPath = fsPath.slice(1);
    }
    return fsPath;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Read and parse a single VSCode Copilot Chat JSON file.
 *
 * The expected top-level shape is `{ sessions: [...] }` where each session
 * contains `id`, `createdAt`, `updatedAt`, `title`, `workspace`, and `messages`.
 *
 * @param {string} filePath - Absolute path to a chatSessions JSON file.
 * @returns {Array<object>} Array of raw (un-normalised) session objects from the file.
 *   Returns an empty array if the file cannot be read or parsed.
 */
export function parseVscodeSessionFile(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }

  // Handle both `{ sessions: [...] }` wrapper and bare arrays.
  const sessions = Array.isArray(data) ? data : data?.sessions;
  if (!Array.isArray(sessions)) return [];

  // Attach the source file path for provenance / debugging.
  for (const s of sessions) {
    s._sourceFile = filePath;
  }

  return sessions;
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a raw VSCode session object to the shape returned by `db.mjs#listSessions`.
 *
 * @param {object} session - Raw session object from a parsed JSON file.
 * @returns {object} Normalised session metadata.
 */
function normalizeSession(session) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  return {
    id: session.id,
    source: SOURCE_VSCODE,
    repository: extractRepoFromWorkspace(session.workspace),
    branch: null,
    summary: session.title || "VSCode Chat",
    created_at: session.createdAt || null,
    updated_at: session.updatedAt || session.createdAt || null,
    host_type: "vscode",
    cwd: extractCwdFromWorkspace(session.workspace),
    turn_count: Math.floor(messages.length / 2),
  };
}

/**
 * Build paired turns from a flat messages array.
 * Consecutive user → assistant message pairs form a single turn. A trailing
 * user message with no assistant reply is still included (with a `null` response).
 *
 * @param {Array<object>} messages
 * @returns {Array<{turn_index: number, user_message: string|null, assistant_response: string|null, timestamp: string|null}>}
 */
function buildTurns(messages) {
  if (!Array.isArray(messages)) return [];

  /** @type {Array<{turn_index: number, user_message: string|null, assistant_response: string|null, timestamp: string|null}>} */
  const turns = [];
  let turnIndex = 0;
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === "user") {
      const userMessage = msg.content ?? null;
      const timestamp = msg.timestamp ?? null;
      let assistantResponse = null;

      // Look ahead for a paired assistant message.
      if (i + 1 < messages.length && messages[i + 1].role === "assistant") {
        assistantResponse = messages[i + 1].content ?? null;
        i += 2;
      } else {
        i += 1;
      }

      turns.push({
        turn_index: turnIndex++,
        user_message: userMessage,
        assistant_response: assistantResponse,
        timestamp,
      });
    } else {
      // Orphaned assistant message (no preceding user message) — wrap it anyway.
      turns.push({
        turn_index: turnIndex++,
        user_message: null,
        assistant_response: msg.content ?? null,
        timestamp: msg.timestamp ?? null,
      });
      i += 1;
    }
  }

  return turns;
}

// ---------------------------------------------------------------------------
// In-memory index (lazy, built on first query that needs it)
// ---------------------------------------------------------------------------

/** @type {Map<string, object> | null} */
let _sessionIndex = null;

/**
 * Build (or return cached) index of all discovered VSCode sessions.
 * Keyed by session id for O(1) lookups.
 *
 * @returns {Map<string, object>} Map of session id → raw session object.
 */
function getSessionIndex() {
  if (_sessionIndex) return _sessionIndex;

  _sessionIndex = new Map();
  const paths = discoverVscodePaths();
  for (const p of paths) {
    const sessions = parseVscodeSessionFile(p);
    for (const s of sessions) {
      if (s.id) _sessionIndex.set(s.id, s);
    }
  }
  return _sessionIndex;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List VSCode Copilot Chat sessions, normalised to the same shape as
 * `db.mjs#listSessions`.
 *
 * Discovers all chatSessions files across every OS-specific location and editor
 * variant, parses them, and returns normalised metadata sorted by `updated_at`
 * descending.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.limit=500] - Maximum number of sessions to return.
 * @param {string}  [opts.since]     - ISO date string — only include sessions
 *   created on or after this date.
 * @returns {Array<object>} Normalised session metadata objects.
 */
export function listVscodeSessions({ limit = 500, since } = {}) {
  const index = getSessionIndex();

  const sessions = [];
  for (const raw of index.values()) {
    const norm = normalizeSession(raw);

    if (since && norm.created_at && norm.created_at < since) continue;

    sessions.push(norm);
  }

  // Sort newest first.
  sessions.sort((a, b) => {
    const da = a.updated_at || "";
    const db_ = b.updated_at || "";
    return da < db_ ? 1 : da > db_ ? -1 : 0;
  });

  return sessions.slice(0, limit);
}

/**
 * Get turns for a specific VSCode Copilot Chat session, normalised to the same
 * shape as `db.mjs#getSessionTurns`.
 *
 * Pairs consecutive user/assistant messages into turns. A trailing user message
 * with no assistant reply is included with a `null` response.
 *
 * @param {string} sessionId - The VSCode session UUID.
 * @returns {Array<{turn_index: number, user_message: string|null, assistant_response: string|null, timestamp: string|null}>}
 *   Ordered array of turns, or an empty array if the session is not found.
 */
export function getVscodeSessionTurns(sessionId) {
  const index = getSessionIndex();
  const raw = index.get(sessionId);
  if (!raw) return [];
  return buildTurns(raw.messages);
}

/**
 * Get normalised metadata for a single VSCode Copilot Chat session.
 *
 * @param {string} sessionId - The VSCode session UUID.
 * @returns {object|undefined} Normalised session object, or `undefined` if not found.
 */
export function getVscodeSession(sessionId) {
  const index = getSessionIndex();
  const raw = index.get(sessionId);
  if (!raw) return undefined;
  return normalizeSession(raw);
}
