import Database from "better-sqlite3";
import { Buffer } from "node:buffer";
import { closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

const MAX_TEXT = 16 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_LINE = 4 * 1024 * 1024;
const MAX_SCAN_BYTES = 16 * 1024 * 1024;
const MAX_EVENTS = 100_000;
const NOTICE = "Original local text is not redacted and may contain sensitive information. This reveal does not add text to usage analytics, CLI output, or saved dashboard state.";
const PARTIAL_NOTICE = `${NOTICE} Some text or source records are unavailable or exceed the local reveal limits.`;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function prefix(text, length) {
  const value = text.slice(0, length);
  return /[\uD800-\uDBFF]$/.test(value) ? value.slice(0, -1) : value;
}

function response(source, values = [], { partial = false, truncated = false } = {}) {
  const result = {
    status: values.length ? partial || truncated ? "partial" : "available" : "not-recorded",
    source, messages: [], truncated, notice: PARTIAL_NOTICE,
  };
  for (const { role, text } of values) {
    let value = prefix(text, MAX_TEXT);
    if (value.length < text.length) result.truncated = true;
    const message = { role, text: value };
    result.messages.push(message);
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_RESPONSE_BYTES) {
      let low = 0;
      let high = value.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        message.text = prefix(value, middle);
        if (Buffer.byteLength(JSON.stringify(result), "utf8") <= MAX_RESPONSE_BYTES) low = middle;
        else high = middle - 1;
      }
      value = prefix(value, low);
      message.text = value;
      result.truncated = true;
    }
    if (!value.length) result.messages.pop();
    if (result.truncated && value.length < Math.min(text.length, MAX_TEXT)) break;
  }
  result.status = result.messages.length ? partial || result.truncated ? "partial" : "available" : "not-recorded";
  result.notice = partial || result.truncated ? PARTIAL_NOTICE : NOTICE;
  return result;
}

export function contentNotRecorded() {
  return response("not-recorded");
}

function readTurn(dbPath, sessionId, turnIndex) {
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const columns = new Set(db.prepare("PRAGMA table_info(turns)").all().map((column) => column.name));
    if (!columns.has("session_id") || !columns.has("turn_index")) return contentNotRecorded();
    const fields = [["user_message", "user"], ["assistant_response", "assistant"]];
    const available = fields.filter(([column]) => columns.has(column));
    if (!available.length) return contentNotRecorded();
    const select = available.map(([column]) =>
      `CASE WHEN typeof("${column}") = 'text' THEN substr("${column}", 1, ${MAX_TEXT + 1}) END AS "${column}",
       length(CAST("${column}" AS BLOB)) > length(CAST(substr("${column}", 1, ${MAX_TEXT + 1}) AS BLOB)) AS "${column}_truncated"`).join(", ");
    // A third row is bounded lookahead; at most two matching rows are revealed.
    const rows = db.prepare(`SELECT ${select} FROM turns WHERE session_id = ? AND turn_index = ? LIMIT 3`)
      .all(sessionId, turnIndex);
    if (!rows.length) return contentNotRecorded();
    const messages = [];
    let partial = available.length < fields.length;
    let truncated = rows.length > 2;
    for (const row of rows.slice(0, 2)) {
      for (const [column, role] of available) {
        if (row[`${column}_truncated`] === 1) truncated = true;
        if (typeof row[column] === "string" && row[column].length) messages.push({ role, text: row[column] });
        else partial = true;
      }
    }
    return response("sessiondb", messages, { partial, truncated });
  } catch {
    return response("not-recorded", [], { partial: true });
  } finally {
    db?.close();
  }
}

function directory(path) {
  const stat = lstatSync(path);
  return stat.isDirectory() && !stat.isSymbolicLink();
}

function scan(file, consume, state) {
  const stat = lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) {
    state.partial = true;
    return;
  }
  const fd = openSync(file, "r");
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.alloc(64 * 1024);
  let pending = "";
  let skipping = false;
  function line(value) {
    if (!value.trim()) return;
    if (++state.events > MAX_EVENTS) {
      state.truncated = true;
      state.stop = true;
      return;
    }
    try {
      consume(JSON.parse(value));
    } catch {
      state.partial = true;
    }
  }
  function chunk(value) {
    pending += value;
    let newline;
    while (!state.stop && (newline = pending.indexOf("\n")) !== -1) {
      const value = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (!skipping && value.length <= MAX_LINE) line(value);
      else state.truncated = true;
      skipping = false;
    }
    if (pending.length > MAX_LINE) {
      pending = "";
      skipping = true;
      state.truncated = true;
    }
  }
  try {
    const opened = fstatSync(fd, { bigint: true });
    // Windows path and descriptor stats can report different device numbers for the same file.
    if (!opened.isFile() || opened.ino !== stat.ino || (process.platform !== "win32" && opened.dev !== stat.dev)) {
      state.partial = true;
      return;
    }
    while (!state.stop) {
      const remaining = MAX_SCAN_BYTES - state.bytes;
      if (remaining <= 0) {
        state.truncated = true;
        state.stop = true;
        break;
      }
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, remaining), null);
      if (!count) break;
      state.bytes += count;
      chunk(decoder.write(buffer.subarray(0, count)));
    }
    if (!state.stop) {
      chunk(decoder.end());
      if (!skipping) line(pending);
    }
    const after = lstatSync(file, { bigint: true });
    if (after.isSymbolicLink() || after.ino !== stat.ino || after.dev !== stat.dev
        || after.size !== stat.size || after.mtimeNs !== stat.mtimeNs) state.changed = true;
  } finally {
    closeSync(fd);
  }
}

function readAgent(root, sessionId, toolCallId) {
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]+$/.test(sessionId)
      || typeof toolCallId !== "string" || !toolCallId) return contentNotRecorded();
  const state = { bytes: 0, events: 0, partial: false, truncated: false, stop: false, changed: false };
  let started = false;
  let invocationSeen = false;
  let prompt = null;
  try {
    const dir = join(root, sessionId);
    if (!directory(root) || !directory(dir)) return contentNotRecorded();
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")).map((entry) => entry.name);
    entries.sort((a, b) => (a === "events.jsonl" ? -1 : b === "events.jsonl" ? 1
      : a === "turns.jsonl" ? -1 : b === "turns.jsonl" ? 1 : a.localeCompare(b)));
    if (entries.length > 128) state.truncated = true;
    for (const file of entries.slice(0, 128)) {
      scan(join(dir, file), (event) => {
        if (!object(event) || !object(event.data) || event.data.toolCallId !== toolCallId) return;
        if (event.type === "subagent.started") started = true;
        if (event.type === "tool.execution_start" && !invocationSeen) {
          invocationSeen = true;
          const data = event.data;
          // Only the verified task-tool object schema is supported, never serialized arguments or other tools.
          if (data.toolName === "task" && object(data.arguments) && typeof data.arguments.prompt === "string"
              && data.arguments.prompt.length) {
            prompt = data.arguments.prompt;
          }
        }
        if (started && invocationSeen) state.stop = true;
      }, state);
      if (state.stop) break;
    }
    if (!directory(root) || !directory(dir) || state.changed) {
      return response("not-recorded", [], { partial: true });
    }
    return response("jsonl", started && prompt !== null ? [{ role: "agent-prompt", text: prompt }] : [], state);
  } catch {
    return response("not-recorded", [], { partial: true });
  }
}

// This adapter retains source locations only. Call it exclusively after request-level consent validation.
export function createLocalContentReader(options = {}) {
  const dbPath = options.dbPath ?? process.env.COPILOT_SESSION_DB ?? join(homedir(), ".copilot", "session-store.db");
  const statePath = options.sessionStatePath ?? process.env.COPILOT_SESSION_STATE_PATH ?? join(homedir(), ".copilot", "session-state");
  return {
    turn: (sessionId, turnIndex) => readTurn(dbPath, sessionId, turnIndex),
    agent: (sessionId, toolCallId) => readAgent(statePath, sessionId, toolCallId),
  };
}
