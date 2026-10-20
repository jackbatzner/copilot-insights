import { createUsageStore } from "../src/runtime-telemetry.mjs";
import { contentNotRecorded, createLocalContentReader } from "../src/local-content.mjs";
import { isUtcDay, safeModel } from "../src/usage-metrics.mjs";
import { vscodeUsageCapability } from "../src/vscode-sessions.mjs";
import { createLocalState, HANDLE_RE, MAX_HIDDEN } from "./local-state.mjs";

export class UsageRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const TIMEFRAMES = new Set(["7d", "30d", "90d", "all"]);
const SCOPES = new Set(["primary", "subagent", "unattributed"]);
function integer(value, fallback, max) {
  if (value === undefined) return fallback;
  if (!["string", "number"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
    throw new UsageRequestError("Invalid page.");
  }
  return Number(value);
}
function queryOptions(query = {}, allowed = ["timeframe"]) {
  if (!query || typeof query !== "object" || Array.isArray(query)
      || Object.keys(query).some((key) => !allowed.includes(key))) {
    throw new UsageRequestError("Invalid query.");
  }
  const timeframe = query.timeframe ?? "30d";
  if (!TIMEFRAMES.has(timeframe)) throw new UsageRequestError("Invalid timeframe.");
  if (query.model !== undefined && (typeof query.model !== "string" || safeModel(query.model) !== query.model)) {
    throw new UsageRequestError("Invalid model.");
  }
  if (query.includeHidden !== undefined && ![true, false, "true", "false"].includes(query.includeHidden)) {
    throw new UsageRequestError("Invalid hidden filter.");
  }
  if (query.day !== undefined && !isUtcDay(query.day)) throw new UsageRequestError("Invalid day.");
  if (query.scope !== undefined && !SCOPES.has(query.scope)) throw new UsageRequestError("Invalid scope.");
  return {
    timeframe, model: query.model ?? null, day: query.day ?? null, scope: query.scope ?? null,
    includeHidden: query.includeHidden === true || query.includeHidden === "true",
  };
}

export function createUsageService(options = {}) {
  const state = createLocalState(options);
  const contentReader = createLocalContentReader(options);
  const hiddenIds = new Set();
  let store = null;
  let secret = null;
  let hiddenRevision = null;
  function current() {
    const local = state.read();
    if (!store || local.secret !== secret) {
      store?.close();
      secret = local.secret;
      store = createUsageStore({
        dbPath: options.dbPath, sessionStatePath: options.sessionStatePath,
        handleSecret: secret, hiddenIds,
      });
      hiddenRevision = null;
    }
    const revision = JSON.stringify(local.hiddenHandles);
    if (hiddenRevision !== revision) {
      const resolved = local.hiddenHandles.map((handle) => store.resolveHandle(handle)).filter((id) => id !== null);
      hiddenIds.clear();
      for (const id of resolved) hiddenIds.add(id);
      hiddenRevision = resolved.length === local.hiddenHandles.length ? revision : null;
    }
    return store;
  }
  function validHandle(handle) {
    if (typeof handle !== "string" || !HANDLE_RE.test(handle)) {
      throw new UsageRequestError("Invalid session handle.");
    }
  }
  const service = {
    snapshot(query) {
      const filters = queryOptions(query);
      return current().snapshot({ ...filters, compact: true });
    },
    sessions(query) {
      const filters = queryOptions(query, ["timeframe", "model", "includeHidden", "day", "scope", "page", "pageSize", "sort", "source", "session", "after", "exclude"]);
      if (query.source !== undefined && !["cli", "vscode"].includes(query.source)) throw new UsageRequestError("Invalid source.");
      if (query.session !== undefined) validHandle(query.session);
      if (query.exclude !== undefined) validHandle(query.exclude);
      if (query.after !== undefined && (typeof query.after !== "string" || !Number.isFinite(Date.parse(query.after))
          || new Date(query.after).toISOString() !== query.after)) throw new UsageRequestError("Invalid date.");
      const sort = query.sort ?? "tokens";
      if (!["tokens", "recent", "duration", "cache", "delegation", "later"].includes(sort)
          || sort === "later" && !query.after) throw new UsageRequestError("Invalid sort.");
      const result = current().snapshot({
        ...filters, source: query.source ?? null, sessionHandle: query.session ?? null,
        list: { page: integer(query.page, 1, 1000000), pageSize: integer(query.pageSize, 25, 100),
          sort, after: query.after ?? null, exclude: query.exclude ?? null },
      });
      if (!result) throw new UsageRequestError("Session not found.", 404);
      return result;
    },
    models(query) {
      const snapshot = service.snapshot(query);
      return { models: snapshot.models, capabilities: snapshot.capabilities };
    },
    comparison(query) {
      const filters = queryOptions(query, ["timeframe", "model", "includeHidden", "day", "scope", "session", "source"]);
      if (query.source !== undefined && !["cli", "vscode"].includes(query.source)) throw new UsageRequestError("Invalid source.");
      if (query.session !== undefined) validHandle(query.session);
      const result = current().snapshot({
        ...filters, source: query.source ?? null, sessionHandle: query.session ?? null, comparisonOnly: true,
      });
      if (!result) throw new UsageRequestError("Session not found.", 404);
      return result;
    },
    detail(handle, query = {}) {
      validHandle(handle);
      if (Object.keys(query).some((key) => key !== "view") || query.view !== undefined && query.view !== "summary") {
        throw new UsageRequestError("Invalid query.");
      }
      return current().detail(handle, { compact: query.view === "summary" });
    },
    turns(handle, query = {}) {
      validHandle(handle);
      const filters = queryOptions(query, ["model", "scope", "day", "assignment", "sort", "page", "turn", "requestPage"]);
      if (query.assignment !== undefined && !["assigned", "unassigned"].includes(query.assignment)) throw new UsageRequestError("Invalid assignment.");
      if (query.sort !== undefined && !["turn", "tokens"].includes(query.sort)) throw new UsageRequestError("Invalid sort.");
      let turn;
      if (query.turn !== undefined) {
        if (query.turn === "unassigned") turn = null;
        else if (["string", "number"].includes(typeof query.turn) && /^(0|[1-9]\d*)$/.test(String(query.turn)) && Number.isSafeInteger(Number(query.turn))) turn = Number(query.turn);
        else throw new UsageRequestError("Invalid turn.");
      }
      return current().turns(handle, {
        ...filters, assignment: query.assignment ?? "", sort: query.sort ?? "turn",
        page: integer(query.page, 1, 1000000), pageSize: 20,
        requestPage: integer(query.requestPage, 1, 1000000), turn,
      });
    },
    tools(handle, query = {}) {
      validHandle(handle);
      if (Object.keys(query).length) throw new UsageRequestError("Invalid query.");
      return current().tools(handle);
    },
    content(handle, body) {
      validHandle(handle);
      if (!body || typeof body !== "object" || Array.isArray(body) || body.consent !== true
          || !["turn", "agent"].includes(body.kind)) throw new UsageRequestError("Explicit reveal consent is required.");
      const fields = body.kind === "turn" ? ["consent", "kind", "turnIndex"] : ["consent", "kind", "attributionKey"];
      if (Object.keys(body).length !== fields.length || Object.keys(body).some((key) => !fields.includes(key))
          || (body.kind === "turn" && (!Number.isSafeInteger(body.turnIndex) || body.turnIndex < 0))
          || (body.kind === "agent" && (typeof body.attributionKey !== "string" || !HANDLE_RE.test(body.attributionKey)))) {
        throw new UsageRequestError("Invalid reveal request.");
      }
      const runtime = current();
      const sessionId = runtime.resolveHandle(handle);
      if (sessionId === null) return null;
      if (body.kind === "turn") return contentReader.turn(sessionId, body.turnIndex);
      const target = runtime.resolveContentAgent(handle, body.attributionKey);
      return target === null ? contentNotRecorded() : contentReader.agent(target.sessionId, target.toolCallId);
    },
    setHidden(handle, hidden) {
      validHandle(handle);
      if (current().resolveHandle(handle) === null) throw new UsageRequestError("Session not found.", 404);
      state.update((local) => {
        const handles = new Set(local.hiddenHandles);
        if (hidden) handles.add(handle);
        else handles.delete(handle);
        if (handles.size > MAX_HIDDEN) throw new UsageRequestError("Hidden session limit reached.", 409);
        return { ...local, hiddenHandles: [...handles] };
      });
      return { hidden };
    },
    settings() {
      const { enableVSCode } = state.read();
      return {
        enableVSCode,
        capabilities: current().capabilities(),
        vscode: vscodeUsageCapability(enableVSCode),
      };
    },
    updateSettings(body) {
      if (!body || typeof body !== "object" || Array.isArray(body)
          || Object.keys(body).length !== 1 || typeof body.enableVSCode !== "boolean") {
        throw new UsageRequestError("Expected enableVSCode as a boolean.");
      }
      state.update((local) => ({ ...local, enableVSCode: body.enableVSCode }));
      return service.settings();
    },
    refresh() {
      store?.close();
      store = null;
      current().capabilities();
    },
    close() {
      store?.close();
      store = null;
    },
  };
  return service;
}
