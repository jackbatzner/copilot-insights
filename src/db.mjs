import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { nonnegative, safeDate, safeModel, safeRequestTimestamp, UsageSourceError } from "./usage-metrics.mjs";

export const USAGE_COLUMNS = [
  "session_id", "model", "input_tokens", "output_tokens", "turn_index", "agent_id",
  "parent_tool_call_id", "cache_read_tokens", "cache_write_tokens", "total_nano_aiu",
  "request_multiplier", "duration_ms", "time_to_first_token_ms", "output_ttft_ms",
  "inter_token_latency_ms", "finish_reason", "content_filter_triggered", "created_at",
];

function columnInfo(db, table) {
  return new Map(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => [row.name, row]));
}

function columns(db, table) {
  return new Set(columnInfo(db, table).keys());
}

function sqliteUtcDefault(value) {
  if (typeof value !== "string") return false;
  let expression = value.trim();
  while (expression.startsWith("(") && expression.endsWith(")")) expression = expression.slice(1, -1).trim();
  return /^CURRENT_TIMESTAMP$/i.test(expression) ||
    /^datetime\s*\(\s*'now'\s*\)$/.test(expression.replace(/^datetime/i, "datetime"));
}

function selectColumns(available, wanted) {
  return wanted.map((name) => available.has(name) ? `"${name}"` : `NULL AS "${name}"`).join(", ");
}

function readDatabase(path, whenMissing, read) {
  if (!existsSync(path)) return whenMissing();
  let db;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    return read(db);
  } catch (error) {
    if (error instanceof UsageSourceError) throw error;
    throw new UsageSourceError("DB_READ", "Session database could not be read.");
  } finally {
    db?.close();
  }
}

export function sessionCatalogVersion(path) {
  function version(file) {
    try {
      const stat = statSync(file, { bigint: true });
      return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    } catch (error) {
      if (error.code === "ENOENT") return "missing";
      throw new UsageSourceError("DB_READ", "Session database could not be read.");
    }
  }
  const database = version(path);
  return database === "missing" ? database : `${database}|${version(`${path}-wal`)}`;
}

export function readSessionIds(path) {
  return readDatabase(path, () => [], (db) => {
    if (!columns(db, "sessions").has("id")) {
      throw new UsageSourceError("DB_SCHEMA", "Session database schema is incompatible.");
    }
    return db.prepare("SELECT id FROM sessions").all().map((row) => row.id).filter((id) => typeof id === "string");
  });
}

export function readUsageCapabilities(path) {
  return readDatabase(path, () => ({
    sessionDb: "unavailable", usageTable: false, diagnostics: ["Session database is unavailable."],
  }), (db) => {
    const sessionColumns = columns(db, "sessions");
    if (!sessionColumns.has("id")) {
      throw new UsageSourceError("DB_SCHEMA", "Session database schema is incompatible.");
    }
    const diagnostics = [];
    if (!sessionColumns.has("created_at") || !sessionColumns.has("updated_at")) {
      diagnostics.push("Session activity timestamps are partially recorded.");
    }
    const usageTable = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'assistant_usage_events'").get());
    if (!usageTable) {
      return { sessionDb: "partial", usageTable, diagnostics: [...diagnostics, "Recorded request usage table is unavailable."] };
    }
    const usageInfo = columnInfo(db, "assistant_usage_events");
    const usageColumns = new Set(usageInfo.keys());
    if (!usageColumns.has("session_id")) {
      return { sessionDb: "partial", usageTable, diagnostics: [...diagnostics, "Recorded request usage cannot be linked to sessions."] };
    }
    if (USAGE_COLUMNS.some((column) => !usageColumns.has(column))) {
      diagnostics.push("Some recorded request usage columns are unavailable.");
    }
    return { sessionDb: diagnostics.length ? "partial" : "available", usageTable, diagnostics };
  });
}

export function readUsageDb(path, { sessionId = null } = {}) {
  return readDatabase(path, () => ({
    sessions: [], records: [], sessionDb: "unavailable", usageTable: false, diagnostics: ["Session database is unavailable."],
  }), (db) => {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    if (!tables.has("sessions") || !columns(db, "sessions").has("id")) {
      throw new UsageSourceError("DB_SCHEMA", "Session database schema is incompatible.");
    }
    const sessionColumns = columns(db, "sessions");
    const sessions = db.prepare(`SELECT ${selectColumns(sessionColumns, ["id", "created_at", "updated_at"])} FROM sessions`).all()
      .filter((row) => typeof row.id === "string").map((row) => ({
        id: row.id,
        createdAt: safeDate(row.created_at),
        updatedAt: safeDate(row.updated_at),
      }));
    const diagnostics = [];
    if (!sessionColumns.has("created_at") || !sessionColumns.has("updated_at")) {
      diagnostics.push("Session activity timestamps are partially recorded.");
    }
    const usageTable = tables.has("assistant_usage_events");
    if (!usageTable) {
      return { sessions, records: [], sessionDb: "partial", usageTable, diagnostics: [...diagnostics, "Recorded request usage table is unavailable."] };
    }
    const usageInfo = columnInfo(db, "assistant_usage_events");
    const usageColumns = new Set(usageInfo.keys());
    if (!usageColumns.has("session_id")) {
      return { sessions, records: [], sessionDb: "partial", usageTable, diagnostics: [...diagnostics, "Recorded request usage cannot be linked to sessions."] };
    }
    if (USAGE_COLUMNS.some((name) => !usageColumns.has(name))) {
      diagnostics.push("Some recorded request usage columns are unavailable.");
    }
    const sqliteUtc = sqliteUtcDefault(usageInfo.get("created_at")?.dflt_value);
    let undatedValues = false;
    const where = sessionId === null ? "" : " WHERE session_id = ?";
    const records = db.prepare(`SELECT ${selectColumns(usageColumns, USAGE_COLUMNS)} FROM assistant_usage_events${where}`)
      .all(...(sessionId === null ? [] : [sessionId])).map((row) => {
      const inputTokens = nonnegative(row.input_tokens);
      const outputTokens = nonnegative(row.output_tokens);
      const createdAt = safeRequestTimestamp(row.created_at, { sqliteUtc });
      if (row.created_at !== null && createdAt === null) undatedValues = true;
      return {
        sessionId: row.session_id,
        model: safeModel(row.model),
        source: "sessiondb",
        requests: 1,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
        cacheReadTokens: nonnegative(row.cache_read_tokens),
        cacheWriteTokens: nonnegative(row.cache_write_tokens),
        totalNanoAiu: nonnegative(row.total_nano_aiu),
        localCredits: null,
        durationMs: nonnegative(row.duration_ms),
        ttftMs: nonnegative(row.time_to_first_token_ms) ?? nonnegative(row.output_ttft_ms),
        turnIndex: Number.isSafeInteger(row.turn_index) && row.turn_index >= 0 ? row.turn_index : null,
        agentId: typeof row.agent_id === "string" ? row.agent_id : null,
        parentToolCallId: typeof row.parent_tool_call_id === "string" ? row.parent_tool_call_id : null,
        primaryRecorded: usageColumns.has("agent_id") && usageColumns.has("parent_tool_call_id") && row.agent_id === null && row.parent_tool_call_id === null,
        requestMultiplier: nonnegative(row.request_multiplier),
        outputTtftMs: nonnegative(row.output_ttft_ms),
        interTokenLatencyMs: nonnegative(row.inter_token_latency_ms),
        finishReason: ["stop", "length", "tool_calls", "content_filter", "cancelled", "error"].includes(row.finish_reason) ? row.finish_reason : "not-recorded",
        contentFiltered: row.content_filter_triggered === 1 ? true : row.content_filter_triggered === 0 ? false : null,
        contentFilteredRequests: row.content_filter_triggered === 1 ? 1 : row.content_filter_triggered === 0 ? 0 : null,
        createdAt,
      };
    });
    if (records.some((record) => record.totalNanoAiu !== null)) {
      diagnostics.push("Local credits are unavailable: no verified recorded nano-AIU conversion is defined.");
    }
    if (undatedValues) {
      diagnostics.push("Some request timestamps are invalid or have unverified timezone semantics; those requests are undated.");
    }
    return { sessions, records, sessionDb: diagnostics.some((message) => message.includes("columns") || message.includes("timestamps")) ? "partial" : "available", usageTable, diagnostics };
  });
}

export function normalizedUsageBytes(rows) {
  return rows.reduce((total, row) => total + 1024 +
    Object.values(row).reduce((bytes, value) => bytes + (typeof value === "string" ? value.length * 2 : 0), 0), 0);
}

export function createUsageDbReader(path, { maxCacheBytes = 128 * 1024 * 1024, maxCacheEntries = 64 } = {}) {
  const cache = new Map();
  let version = null;
  let bytes = 0;
  function clear() {
    cache.clear();
    bytes = 0;
    version = null;
  }
  return {
    read(sessionId = null) {
      const current = sessionCatalogVersion(path);
      if (version !== current) {
        clear();
        version = current;
      }
      const cached = cache.get(sessionId);
      if (cached) {
        cache.delete(sessionId);
        cache.set(sessionId, cached);
        return cached.value;
      }
      const source = readUsageDb(path, { sessionId });
      if (sessionCatalogVersion(path) !== current) {
        clear();
        return {
          version: null,
          source: {
            ...source, sessionDb: "partial",
            diagnostics: [...source.diagnostics, "Session database changed while being read; coverage is partial."],
          },
        };
      }
      const value = { source, version: current };
      const size = 2048 + normalizedUsageBytes(source.sessions) + normalizedUsageBytes(source.records);
      if (size <= maxCacheBytes && maxCacheEntries > 0) {
        while (cache.size && (bytes + size > maxCacheBytes || cache.size >= maxCacheEntries)) {
          const key = cache.keys().next().value;
          bytes -= cache.get(key).bytes;
          cache.delete(key);
        }
        cache.set(sessionId, { value, bytes: size });
        bytes += size;
      }
      return value;
    },
    clear,
  };
}
