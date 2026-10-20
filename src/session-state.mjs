import { closeSync, existsSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { Buffer } from "node:buffer";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { nonnegative, safeDate, safeModel, safeRequestTimestamp, UsageSourceError } from "./usage-metrics.mjs";

const MAX_LINE_BYTES = 4 * 1024 * 1024;
const MAX_EVENTS = 100_000;
const TYPES = new Set([
  "session.start", "session.shutdown", "session.model_change", "assistant.message",
  "subagent.started", "subagent.completed", "subagent.failed",
  "tool.execution_start", "tool.execution_complete", "skill.invoked",
]);
const CATEGORIES = new Set(["explore", "task", "general-purpose", "code-review", "research", "security-review"]);
const TOOL_CATEGORIES = new Map([
  ...["view", "read_file", "list_dir"].map((name) => [name, "file-read"]),
  ...["apply_patch", "edit", "create", "write_file", "replace_string_in_file", "multi_replace_string_in_file"].map((name) => [name, "file-edit"]),
  ...["rg", "glob", "grep", "file_search", "grep_search"].map((name) => [name, "search"]),
  ...["powershell", "bash", "run_in_terminal", "read_powershell", "stop_powershell", "list_powershell"].map((name) => [name, "shell"]),
  ...["task", "read_agent", "write_agent", "list_agents"].map((name) => [name, "delegation"]),
  ...["web_fetch", "web_search"].map((name) => [name, "web"]),
]);

function toolCategory(data) {
  if (typeof data.mcpServerName === "string" && data.mcpServerName.trim()) return "mcp";
  const name = data.toolName;
  if (TOOL_CATEGORIES.has(name)) return TOOL_CATEGORIES.get(name);
  return typeof name === "string" && (name === "mcp" || name.startsWith("mcp__")) ? "mcp" : "other";
}

function toolParent(tool, data) {
  const parent = data.parentToolCallId;
  if (parent === null || parent === undefined) return;
  if (typeof parent !== "string" || !parent
      || (tool.parentToolCallId !== null && tool.parentToolCallId !== parent)) {
    tool.parentConflict = true;
  } else {
    tool.parentToolCallId = parent;
  }
}

function recordTool(tools, toolId, event, data) {
  const tool = tools.get(toolId) ?? { parentToolCallId: null, parentConflict: false, start: null, complete: null };
  toolParent(tool, data);
  const phase = event.type === "tool.execution_start" ? "start" : "complete";
  if (tool[phase] === null) {
    tool[phase] = {
      category: toolCategory(data),
      timestamp: safeRequestTimestamp(event.timestamp),
      model: typeof data.model === "string" ? safeModel(data.model) : null,
      success: phase === "complete" && typeof data.success === "boolean" ? data.success : null,
    };
  }
  tools.set(toolId, tool);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shutdownSnapshot(data, timestamp, fileIndex, order, diagnostics) {
  const apiDurationMs = nonnegative(data.totalApiDurationMs);
  const totalNanoAiu = nonnegative(data.totalNanoAiu);
  if (data.modelMetrics === undefined && apiDurationMs === null && totalNanoAiu === null) return null;
  const models = data.modelMetrics === undefined ? {} : data.modelMetrics;
  if (!timestamp || !object(models)) {
    diagnostics.add("Shutdown usage snapshot with invalid structure or timestamp was not used.");
    return null;
  }
  const records = [];
  let usable = apiDurationMs !== null || totalNanoAiu !== null;
  for (const [model, entry] of Object.entries(models)) {
    if (!object(entry)) {
      diagnostics.add("Invalid shutdown model aggregate was skipped.");
      continue;
    }
    const requests = object(entry.requests) ? entry.requests : {};
    const usage = object(entry.usage) ? entry.usage : {};
    const inputTokens = nonnegative(usage.inputTokens);
    const outputTokens = nonnegative(usage.outputTokens);
    const record = {
      source: "jsonl-shutdown", model: safeModel(model), scope: "unattributed",
      requests: Number.isSafeInteger(requests.count) ? nonnegative(requests.count) : null,
      requestCost: nonnegative(requests.cost),
      inputTokens, outputTokens,
      totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
      cacheReadTokens: nonnegative(usage.cacheReadTokens),
      cacheWriteTokens: nonnegative(usage.cacheWriteTokens),
      totalNanoAiu: nonnegative(entry.totalNanoAiu),
    };
    if (Object.values(record).some((value) => typeof value === "number")) usable = true;
    records.push(record);
  }
  if (!usable) {
    diagnostics.add("Shutdown snapshot without usable usage metadata was not used.");
    return null;
  }
  return {
    records, timestamp, fileIndex, order,
    apiDurationMs, totalNanoAiu,
  };
}

function newerDatedObservation(candidate, current) {
  if (!current) return true;
  if (candidate.timestamp !== current.timestamp) return candidate.timestamp > current.timestamp;
  if (candidate.fileIndex !== current.fileIndex) return candidate.fileIndex < current.fileIndex;
  return candidate.order > current.order;
}

function executionSource(root, sessionId, previous = null) {
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return { version: "unsupported", files: [] };
  try {
    const dir = join(root, sessionId);
    let directory;
    try {
      directory = lstatSync(dir, { bigint: true });
    } catch (error) {
      if (error.code === "ENOENT") return { version: "missing", files: [] };
      throw error;
    }
    if (!directory.isDirectory() || directory.isSymbolicLink()) return { version: "unsupported", files: [] };
    const directoryVersion = `${directory.dev}:${directory.ino}:${directory.size}:${directory.mtimeNs}:${directory.ctimeNs}`;
    const names = previous?.directoryVersion === directoryVersion ? previous.names
      : readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map((entry) => entry.name).sort();
    const regularFiles = [];
    const version = JSON.stringify([
      directoryVersion,
      ...names.map((file) => {
        const stat = lstatSync(join(dir, file), { bigint: true });
        if (stat.isFile() && !stat.isSymbolicLink()) regularFiles.push(file);
        return [file, stat.dev.toString(), stat.ino.toString(), stat.size.toString(), stat.mtimeNs.toString(), stat.ctimeNs.toString()];
      }),
    ]);
    return { version, directoryVersion, names, files: regularFiles };
  } catch {
    throw new UsageSourceError("STATE_READ", "Session execution metadata could not be read.");
  }
}

export function normalizedExecutionBytes(value) {
  return 2048 + (value.records.length + (value.shutdown?.records.length ?? 0)) * 512 +
    value.children.size * 512 + [...value.children.keys()].reduce((total, id) => total + id.length * 2, 0) +
    value.tools.size * 1024 +
    [...value.tools].reduce((total, [id, tool]) => total + (id.length + (tool.parentToolCallId?.length ?? 0)) * 2, 0);
}

export function createSessionExecutionReader(root, { maxCacheBytes = 64 * 1024 * 1024, maxCacheEntries = 8192 } = {}) {
  const cache = new Map();
  let cachedBytes = 0;
  function remove(id) {
    const entry = cache.get(id);
    if (!entry) return;
    cachedBytes -= entry.bytes;
    cache.delete(id);
  }
  return {
    read(sessionId) {
      const cached = cache.get(sessionId);
      const source = executionSource(root, sessionId, cached?.source);
      const { version } = source;
      if (cached?.version === version) {
        cache.delete(sessionId);
        cache.set(sessionId, cached);
        return cached.value;
      }
      remove(sessionId);
      const value = readExecutionSource(root, sessionId, source);
      if (executionSource(root, sessionId, source).version !== version) {
        value.diagnostics.add("Session execution metadata changed while being read; coverage is partial.");
        return value;
      }
      // Account conservatively for normalized objects and internal keys, never file content.
      const bytes = normalizedExecutionBytes(value) + (String(sessionId).length + version.length) * 2 +
        (source.names ?? []).reduce((total, name) => total + name.length * 4 + 128, 0);
      if (bytes <= maxCacheBytes && maxCacheEntries > 0) {
        while (cache.size && (cachedBytes + bytes > maxCacheBytes || cache.size >= maxCacheEntries)) {
          remove(cache.keys().next().value);
        }
        cache.set(sessionId, { version, value, bytes, source });
        cachedBytes += bytes;
      }
      return value;
    },
    clear() {
      cache.clear();
      cachedBytes = 0;
    },
  };
}

function scan(file, consume, diagnostics) {
  const fd = openSync(file, "r");
  const decoder = new StringDecoder("utf8");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let pending = "";
  let skipping = false;
  function line(value) {
    if (!value.trim()) return;
    let event;
    try {
      event = JSON.parse(value);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      diagnostics.add("Malformed or incomplete session events were skipped.");
      return;
    }
    if (event && TYPES.has(event.type)) consume(event);
  }
  function chunk(value) {
    pending += value;
    let newline;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const value = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (!skipping && value.length <= MAX_LINE_BYTES) line(value);
      else diagnostics.add("Oversized session events were skipped.");
      skipping = false;
    }
    if (pending.length > MAX_LINE_BYTES) {
      pending = "";
      skipping = true;
      diagnostics.add("Oversized session events were skipped.");
    }
  }
  try {
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) chunk(decoder.write(buffer.subarray(0, count)));
    chunk(decoder.end());
    if (!skipping) line(pending);
  } finally {
    closeSync(fd);
  }
}

export function sessionStateAvailable(root) {
  try {
    if (!existsSync(root)) return false;
    const stat = lstatSync(root);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    throw new UsageSourceError("STATE_READ", "Session execution metadata could not be read.");
  }
}

export function readSessionExecution(root, sessionId) {
  return readExecutionSource(root, sessionId, executionSource(root, sessionId));
}

function readExecutionSource(root, sessionId, source) {
  const result = { children: new Map(), tools: new Map(), toolDiagnostics: new Set(), records: [], shutdown: null, skillCount: 0, toolCount: null, active: null, updatedAt: null, diagnostics: new Set(), observed: false };
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    result.diagnostics.add("Session execution metadata has an unsupported internal identifier.");
    return result;
  }
  const dir = join(root, sessionId);
  try {
    if (source.version === "missing") return result;
    if (source.version === "unsupported") {
      result.diagnostics.add("Unsupported session execution source was skipped.");
      return result;
    }
    const files = [...source.files];
    files.sort((a, b) => (a === "events.jsonl" ? -1 : b === "events.jsonl" ? 1 : a === "turns.jsonl" ? -1 : b === "turns.jsonl" ? 1 : a.localeCompare(b)));
    const seen = new Set();
    let eventCount = 0;
    let lifecycle = null;
    let undatedLifecycle = false;
    for (const [fileIndex, file] of files.entries()) {
      let currentModel = null;
      scan(join(dir, file), (event) => {
        if (++eventCount > MAX_EVENTS) {
          result.diagnostics.add("Session execution metadata exceeded the event limit; coverage is partial.");
          return;
        }
        const id = typeof event.id === "string" && event.id ? event.id : null;
        const data = event.data && typeof event.data === "object" ? event.data : {};
        const timestamp = safeDate(event.timestamp);
        // Context belongs to this stream, even when its transitions are duplicate or anonymous.
        if (event.type === "session.start" || event.type === "session.model_change") {
          const model = safeModel(event.type === "session.start" ? data.selectedModel : data.newModel);
          if (timestamp && currentModel?.timestamp && timestamp < currentModel.timestamp) {
            result.diagnostics.add("Out-of-order model transitions did not replace newer stream context.");
          } else {
            currentModel = { model, timestamp };
          }
        }
        const toolId = typeof data.toolCallId === "string" && data.toolCallId ? data.toolCallId : null;
        const identity = id ? `event:${id}` : toolId && event.type !== "assistant.message" ? `${event.type}:${toolId}` : null;
        const isTool = event.type === "tool.execution_start" || event.type === "tool.execution_complete";
        if (isTool && !toolId) result.toolDiagnostics.add("Tool events without a stable call identifier were excluded.");
        // Even duplicate event identities must not conceal conflicting ownership evidence.
        if (isTool && toolId && result.tools.has(toolId)) toolParent(result.tools.get(toolId), data);
        // Unidentified counts use the canonical stream; shutdown snapshots compete, never accumulate.
        if (!identity && fileIndex > 0 && event.type !== "session.shutdown") return;
        if (identity && seen.has(identity)) return;
        if (identity) seen.add(identity);
        result.observed = true;
        if (timestamp && (!result.updatedAt || timestamp > result.updatedAt)) result.updatedAt = timestamp;
        if (event.type === "session.start" || event.type === "session.shutdown" && (identity || fileIndex === 0)) {
          if (!timestamp) {
            undatedLifecycle = true;
            result.diagnostics.add("Undated lifecycle evidence prevents determining the latest recorded lifecycle state.");
          } else {
            const candidate = { active: event.type === "session.start", timestamp, fileIndex, order: eventCount };
            if (newerDatedObservation(candidate, lifecycle)) lifecycle = candidate;
          }
        }
        switch (event.type) {
          case "session.shutdown": {
            const candidate = shutdownSnapshot(data, timestamp, fileIndex, eventCount, result.diagnostics);
            if (candidate && newerDatedObservation(candidate, result.shutdown)) result.shutdown = candidate;
            break;
          }
          case "assistant.message": {
            let model = data.model ? safeModel(data.model) : currentModel?.model ?? "Unknown model";
            if (!data.model && currentModel) {
              if (timestamp && currentModel.timestamp && currentModel.timestamp > timestamp) {
                model = "Unknown model";
                result.diagnostics.add("Fallback output preceding its stream model context remains unattributed to a model.");
              } else if (!timestamp || !currentModel.timestamp) {
                result.diagnostics.add("Fallback model context uses preceding same-stream order where timestamps are unavailable.");
              }
            }
            result.records.push({
              source: "jsonl", model,
              requests: null, outputTokens: nonnegative(data.outputTokens), scope: "unattributed",
            });
            break;
          }
          case "skill.invoked":
            result.skillCount++;
            break;
          case "tool.execution_start":
          case "tool.execution_complete":
            if (toolId) recordTool(result.tools, toolId, event, data);
            break;
          case "subagent.started":
            if (toolId) {
              const child = result.children.get(toolId) ?? { started: false, outcome: "not-recorded", durationMs: null };
              child.started = true;
              child.requestedModel = safeModel(data.model);
              child.category = CATEGORIES.has(data.agentType) ? data.agentType : "subagent";
              result.children.set(toolId, child);
            }
            break;
          case "subagent.completed":
          case "subagent.failed":
            if (toolId) {
              const child = result.children.get(toolId) ?? { started: false, requestedModel: null, category: "subagent", outcome: "not-recorded", durationMs: null };
              const outcome = event.type === "subagent.failed" ? "failed" : data.cancelled === true ? "cancelled" : "completed";
              child.outcome = child.outcome !== "not-recorded" && child.outcome !== outcome ? "mixed" : outcome;
              child.durationMs = nonnegative(data.durationMs);
              result.children.set(toolId, child);
            }
            break;
          default:
            break;
        }
      }, result.diagnostics);
    }
    result.active = undatedLifecycle ? null : lifecycle?.active ?? null;
    if (files.length) result.toolCount = result.tools.size;
    return result;
  } catch (error) {
    if (error instanceof UsageSourceError) throw error;
    throw new UsageSourceError("STATE_READ", "Session execution metadata could not be read.");
  }
}
