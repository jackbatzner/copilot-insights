import { createHmac, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { homedir } from "node:os";
import { join } from "node:path";
import { createUsageDbReader, normalizedUsageBytes, readSessionIds, readUsageCapabilities, sessionCatalogVersion } from "./db.mjs";
import { createSessionExecutionReader, normalizedExecutionBytes, sessionStateAvailable } from "./session-state.mjs";
import { aggregateUsage, isUtcDay, modelUsage, recommend, UsageSourceError } from "./usage-metrics.mjs";
import { compareUsage } from "./model-comparison.mjs";
import { compareKnownDescending, sessionPage, sortSessions } from "./session-list.mjs";

export { UsageSourceError } from "./usage-metrics.mjs";

const SCOPES = ["primary", "subagent", "unattributed"];

function validateHandleSecret(secret) {
  if ((typeof secret !== "string" && !Buffer.isBuffer(secret)) || !secret.length) {
    throw new UsageSourceError("HANDLE_SECRET", "A nonempty opaque handle secret is required.");
  }
}

// Internal metadata migration helper; never expose raw IDs through public APIs.
export function usageSessionHandle(rawId, handleSecret) {
  validateHandleSecret(handleSecret);
  if (typeof rawId !== "string") {
    throw new UsageSourceError("HANDLE_ID", "Session handle input is invalid.");
  }
  return createHmac("sha256", handleSecret).update(JSON.stringify(["session", rawId])).digest("hex");
}

function requestOutcome(records) {
  const outcomes = new Set(records.map((record) =>
    record.contentFiltered === true || record.finishReason === "error" || record.finishReason === "content_filter"
      ? "failed"
      : record.finishReason === "cancelled" ? "cancelled"
        : ["stop", "length", "tool_calls"].includes(record.finishReason) ? "completed" : "not-recorded"
  ).filter((outcome) => outcome !== "not-recorded"));
  return outcomes.size > 1 ? "mixed" : outcomes.values().next().value ?? "not-recorded";
}

function callBreakdown(records) {
  const scopes = { primary: 0, subagent: 0, unattributed: 0 };
  const endings = new Map();
  for (const record of records) {
    scopes[record.scope]++;
    endings.set(record.finishReason, (endings.get(record.finishReason) ?? 0) + 1);
  }
  return {
    source: "sessiondb", total: records.length, scopes,
    endings: [...endings].map(([reason, count]) => ({ reason, count })),
  };
}

function skills(execution) {
  return execution.skillCount ? [{ category: "skill", count: execution.skillCount }] : [];
}

function activityEvidence(active) {
  return active === true ? "recorded-open-lifecycle" : active === false ? "recorded-closed-lifecycle" : "not-recorded";
}

function sessionUsage(session) {
  if (session.usage) return session.usage;
  const usage = aggregateUsage(session.records);
  session.usage = usage;
  if (!session.shutdown) return usage;
  usage.usageGranularity = "session-model-aggregate";
  const { apiDurationMs, totalNanoAiu } = session.shutdown;
  usage.metrics.apiDurationMs = apiDurationMs;
  usage.evidence.apiDurationMs = {
    source: apiDurationMs === null ? "not-recorded" : "jsonl-shutdown",
    status: apiDurationMs === null ? "not-recorded" : "recorded",
    recorded: apiDurationMs === null ? 0 : 1, total: 1, scope: "session",
  };
  if (totalNanoAiu !== null) {
    usage.metrics.totalNanoAiu = totalNanoAiu;
    usage.evidence.totalNanoAiu = { source: "jsonl-shutdown", status: "recorded", recorded: 1, total: 1, scope: "session" };
  }
  return usage;
}

function catalogUsage(records, sessions, filtered) {
  const usage = aggregateUsage(records);
  if (filtered) return usage;
  const sessionValues = sessions.map(sessionUsage);
  const granularities = new Set(sessionValues.map((value) => value.usageGranularity).filter((value) => value !== "not-recorded"));
  usage.usageGranularity = granularities.size > 1 ? "mixed" : granularities.values().next().value ?? "not-recorded";
  for (const metric of ["apiDurationMs", "totalNanoAiu"]) {
    if (metric === "totalNanoAiu" && !sessions.some((session) => (session.shutdown?.totalNanoAiu ?? null) !== null)) continue;
    const present = sessionValues.filter((value) => value.metrics[metric] !== null);
    const sources = new Set(present.map((value) => value.evidence[metric].source));
    usage.metrics[metric] = present.length ? present.reduce((total, value) => total + value.metrics[metric], 0) : null;
    usage.evidence[metric] = {
      source: sources.size > 1 ? "mixed" : sources.values().next().value ?? "not-recorded",
      status: !present.length ? "not-recorded"
        : present.length < sessions.length || present.some((value) => value.evidence[metric].status === "partial") ? "partial" : "recorded",
      recorded: present.length, total: sessions.length, scope: "session",
    };
  }
  return usage;
}

function sessionPerformance(session) {
  const childUsage = aggregateUsage(session.records.filter((record) => record.scope === "subagent"));
  const children = [...session.execution.children.values()];
  const childCount = session.execution.observed ? children.filter((child) => child.started).length : null;
  const toolCount = session.execution.toolCount;
  const observations = [
    ...session.records.filter((record) => record.source === "sessiondb")
      .map((record) => ({ source: "sessiondb", outcome: requestOutcome([record]) })),
    ...children.map((child) => ({ source: "jsonl", outcome: child.outcome })),
  ];
  const recorded = observations.filter((item) => ["completed", "failed", "cancelled", "mixed"].includes(item.outcome));
  const outcomes = new Set(recorded.map((item) => item.outcome));
  const sources = new Set(recorded.map((item) => item.source));
  const outcome = outcomes.size > 1 ? "mixed" : outcomes.values().next().value ?? "not-recorded";
  const counterEvidence = (value) => ({
    source: value === null ? "not-recorded" : "jsonl",
    status: value === null ? "not-recorded" : session.execution.diagnostics.size ? "partial" : "derived",
    recorded: value ?? 0, total: value ?? 0,
  });
  return {
    childTokens: childUsage.metrics.totalTokens,
    childRequests: childUsage.metrics.requests,
    childCount, toolCount, outcome,
    evidence: {
      childTokens: childUsage.evidence.totalTokens,
      childRequests: childUsage.evidence.requests,
      childCount: counterEvidence(childCount),
      toolCount: counterEvidence(toolCount),
      outcome: {
        source: sources.size > 1 ? "mixed" : sources.values().next().value ?? "not-recorded",
        status: !recorded.length ? "not-recorded" : recorded.length < observations.length ? "partial" : "recorded",
        recorded: recorded.length, total: observations.length,
      },
    },
  };
}

function usageTrend(records, sessions, timeframe, now) {
  const windowDays = timeframe === "7d" ? 7 : timeframe === "30d" ? 30 : 90;
  const endDay = new Date(now).toISOString().slice(0, 10);
  const end = Date.parse(`${endDay}T00:00:00.000Z`);
  const start = end - (windowDays - 1) * 86400000;
  const startDay = new Date(start).toISOString().slice(0, 10);
  const buckets = new Map();
  let undatedRequests = 0;
  let recordedRequests = 0;
  for (const record of records) {
    if (record.source !== "sessiondb") continue;
    if (typeof record.createdAt !== "string") {
      undatedRequests++;
      continue;
    }
    const day = record.createdAt.slice(0, 10);
    if (day < startDay || day > endDay) continue;
    if (!buckets.has(day)) buckets.set(day, []);
    buckets.get(day).push(record);
    recordedRequests++;
  }
  const days = recordedRequests ? Array.from({ length: windowDays }, (_, index) => {
    const day = new Date(start + index * 86400000).toISOString().slice(0, 10);
    const observed = buckets.get(day) ?? [];
    const usage = aggregateUsage(observed);
    if (!observed.length) {
      usage.metrics.requests = 0;
      usage.evidence.requests = { source: "sessiondb", status: "derived", recorded: 0, total: 0 };
    }
    return { day, ...usage, sessionCount: new Set(observed.map((record) => record.sessionId)).size };
  }) : [];
  return {
    basis: "sessiondb-request-timestamp", available: recordedRequests > 0,
    windowDays, startDay, endDay, days, recordedRequests, undatedRequests,
    excludedAggregateSessions: sessions.filter((session) => session.shutdown !== null).length,
  };
}

/**
 * Read-only local usage projection. Only resolveHandle exposes an internal ID,
 * for server-owned hide bookkeeping; public DTOs must never call it implicitly.
 */
export function createUsageStore(options = {}) {
  const dbPath = options.dbPath ?? process.env.COPILOT_SESSION_DB ?? join(homedir(), ".copilot", "session-store.db");
  const statePath = options.sessionStatePath ?? process.env.COPILOT_SESSION_STATE_PATH ?? join(homedir(), ".copilot", "session-state");
  const secret = options.handleSecret ?? randomBytes(32);
  validateHandleSecret(secret);
  const hiddenIds = options.hiddenIds ?? new Set();
  let closed = false;
  let handleIndex = null;
  let handleIndexVersion = null;
  const executionReader = createSessionExecutionReader(statePath);
  const databaseReader = createUsageDbReader(dbPath);
  let preparedSources = new WeakMap();
  const projections = new Map();
  let projectionVersion = null;
  let projectionBytes = 0;
  const unavailableExecution = {
    children: new Map(), tools: new Map(), toolDiagnostics: new Set(), records: [],
    skillCount: 0, toolCount: null, active: null, updatedAt: null, observed: false, diagnostics: new Set(),
  };
  function opaque(domain, ...values) {
    return createHmac("sha256", secret).update(JSON.stringify([domain, ...values])).digest("hex");
  }
  function resolveHandle(handle) {
    if (closed) throw new UsageSourceError("STORE_CLOSED", "Usage store is closed.");
    if (typeof handle !== "string" || !/^[a-f0-9]{64}$/.test(handle)) return null;
    const version = sessionCatalogVersion(dbPath);
    if (handleIndex === null || handleIndexVersion !== version) {
      handleIndex = new Map(readSessionIds(dbPath).map((id) => [usageSessionHandle(id, secret), id]));
      handleIndexVersion = version;
    }
    return handleIndex.get(handle) ?? null;
  }
  function load(sessionId = null) {
    if (closed) throw new UsageSourceError("STORE_CLOSED", "Usage store is closed.");
    const { source, version } = databaseReader.read(sessionId);
    if (version === null || projectionVersion !== version) {
      projections.clear();
      projectionBytes = 0;
      projectionVersion = version;
    }
    const stateAvailable = sessionStateAvailable(statePath);
    const diagnostics = new Set(source.diagnostics);
    if (!stateAvailable) diagnostics.add("Session execution metadata is unavailable.");
    let prepared = preparedSources.get(source);
    if (!prepared) {
      const bySession = new Map();
      for (const record of source.records) {
        if (!bySession.has(record.sessionId)) bySession.set(record.sessionId, []);
        bySession.get(record.sessionId).push(record);
      }
      const catalogIds = new Set(source.sessions.map((session) => session.id));
      prepared = {
        bySession, catalog: [...source.sessions].sort((a, b) => a.id.localeCompare(b.id)),
        orphaned: source.records.some((record) => !catalogIds.has(record.sessionId)),
      };
      preparedSources.set(source, prepared);
    }
    const sessions = prepared.catalog.flatMap((session, index) => {
      if (sessionId !== null && session.id !== sessionId) return [];
      const execution = stateAvailable
        ? executionReader.read(session.id)
        : unavailableExecution;
      for (const diagnostic of execution.diagnostics) diagnostics.add(diagnostic);
      const exact = prepared.bySession.get(session.id) ?? [];
      const shutdown = exact.length ? null : execution.shutdown ?? null;
      const records = exact.length ? exact : shutdown ? shutdown.records : execution.records;
      if (shutdown) {
        diagnostics.add("Shutdown aggregate uses one selected session-model snapshot, not individually linked requests or exact child attribution.");
        diagnostics.add("Session API duration and root nano-AIU are session totals and are not allocated to models.");
        diagnostics.add("Request cost is an opaque recorded unit, not currency or local credits.");
        diagnostics.add("Local credits are unavailable: no verified recorded nano-AIU conversion is defined.");
      } else if (!exact.length && execution.records.length) {
        diagnostics.add("JSONL output-only fallback is partial; request counts and input usage are not recorded.");
      }
      if (exact.some((record) => record.outputTokens === null) && execution.records.some((record) => record.outputTokens !== null)) {
        diagnostics.add("JSONL output was not combined with recorded requests without a stable request match.");
      }
      const label = `Session ${index + 1}`;
      const cached = projections.get(session.id);
      if (cached?.value.execution === execution && cached.value.label === label) {
        projections.delete(session.id);
        projections.set(session.id, cached);
        return [cached.value];
      }
      if (cached) {
        projectionBytes -= cached.bytes;
        projections.delete(session.id);
      }
      const attributed = records.map((record) => {
        const child = execution.children.get(record.parentToolCallId);
        return { ...record, scope: child?.started ? "subagent" : record.primaryRecorded ? "primary" : "unattributed" };
      });
      const value = {
        ...session,
        updatedAt: [session.updatedAt, execution.updatedAt].filter(Boolean).sort().at(-1) ?? null,
        handle: usageSessionHandle(session.id, secret),
        label,
        execution,
        records: attributed,
        shutdown,
      };
      const bytes = normalizedUsageBytes([session, ...attributed]) + normalizedExecutionBytes(execution);
      if (version !== null && bytes <= 128 * 1024 * 1024) {
        while (projections.size && (projectionBytes + bytes > 128 * 1024 * 1024 || projections.size >= 8192)) {
          const key = projections.keys().next().value;
          projectionBytes -= projections.get(key).bytes;
          projections.delete(key);
        }
        projections.set(session.id, { value, bytes });
        projectionBytes += bytes;
      }
      return [value];
    });
    if (prepared.orphaned) {
      diagnostics.add("Usage without a matching session catalog entry was excluded.");
    }
    const statePartial = sessions.some((session) => session.execution.diagnostics.size || !session.execution.observed);
    if (sessions.some((session) => session.execution.active !== null)) {
      diagnostics.add("Recorded lifecycle events do not verify a live process; session history may be incomplete.");
    }
    if (handleIndex === null || handleIndexVersion !== version) {
      handleIndex = new Map(source.sessions.map((session) => [usageSessionHandle(session.id, secret), session.id]));
      handleIndexVersion = version;
    }
    return {
      sessions,
      capabilities: {
        sessionDb: source.sessionDb,
        sessionState: !stateAvailable ? "unavailable" : statePartial ? "partial" : "available",
        usageTable: source.usageTable,
        diagnostics: [...diagnostics],
      },
    };
  }
  const summaries = new WeakMap();
  const revisions = new WeakMap();
  function revision(session) {
    if (!revisions.has(session)) {
      revisions.set(session, opaque("revision", session.id, JSON.stringify({
        records: session.records, children: [...session.execution.children],
        tools: [...session.execution.tools], skills: session.execution.skillCount,
        active: session.execution.active, updatedAt: session.updatedAt,
        diagnostics: [...session.execution.diagnostics], toolDiagnostics: [...session.execution.toolDiagnostics ?? []],
      })));
    }
    return revisions.get(session);
  }
  function summary(session, recordFilter = null) {
    if (recordFilter !== null) {
      const selected = aggregateUsage(session.records.filter(recordFilter));
      return { ...summary(session), selectedUsage: selected.metrics, selectedEvidence: selected.evidence };
    }
    if (recordFilter === null && summaries.has(session)) {
      return { ...summaries.get(session), hidden: hiddenIds.has(session.id) };
    }
    const value = {
      handle: session.handle, label: session.label, source: "cli",
      createdAt: session.createdAt, updatedAt: session.updatedAt,
      active: session.execution.active, hidden: hiddenIds.has(session.id),
      activityEvidence: activityEvidence(session.execution.active), liveStatus: "not-verified",
      models: [...new Set(session.records.map((record) => record.model))].sort(),
      ...sessionUsage(session),
      selectedUsage: null,
      selectedEvidence: null,
      performance: sessionPerformance(session),
    };
    if (recordFilter === null) summaries.set(session, value);
    return value;
  }
  function attribution(session) {
    const groups = [];
    for (const scope of ["primary", "unattributed"]) {
      const records = session.records.filter((record) => record.scope === scope);
      if (!records.length) continue;
      groups.push({
        key: opaque("group", session.id, scope), label: scope === "primary" ? "Primary" : "Unattributed",
        scope, correlation: scope === "primary" ? "recorded-primary" : "unattributed",
        invocationCategory: null, requestedModel: null, outcome: requestOutcome(records),
        durationMs: null, ...aggregateUsage(records), models: modelUsage(records), skill: null,
      });
    }
    let childIndex = 0;
    for (const [id, child] of session.execution.children) {
      if (!child.started) continue;
      const records = session.records.filter((record) => record.scope === "subagent" && record.parentToolCallId === id);
      groups.push({
        key: opaque("child", session.id, id), label: `Subagent ${++childIndex}`,
        scope: "subagent", correlation: "exact-child", invocationCategory: child.category,
        requestedModel: child.requestedModel, outcome: child.outcome,
        durationMs: child.durationMs, ...aggregateUsage(records), models: modelUsage(records), skill: null,
      });
    }
    return groups.sort((a, b) => SCOPES.indexOf(a.scope) - SCOPES.indexOf(b.scope));
  }
  function turnUsage(session, groups, selection = null) {
    const records = session.records.filter((record) => record.source === "sessiondb");
    const { metrics, evidence } = sessionUsage(session);
    const result = {
      status: records.length ? "available" : session.shutdown ? "aggregate-only" : "unavailable",
      source: records.length ? "sessiondb" : session.shutdown ? "jsonl-shutdown" : session.records.length ? "jsonl" : "not-recorded",
      requestCount: records.length, assignedRequestCount: 0, unassignedRequestCount: 0,
      turnCount: 0, metrics, evidence, turns: [],
      models: [...new Set(records.map((record) => record.model))].sort(),
    };
    const byKey = new Map(groups.map((group) => [group.key, group]));
    const byTurn = new Map();
    // Undated rows follow dated rows in source order; ordinals are presentation IDs, not chronology.
    const ordered = records.map((record, index) => ({ record, index })).sort((a, b) =>
      (a.record.createdAt ?? "\uffff").localeCompare(b.record.createdAt ?? "\uffff") || a.index - b.index);
    for (const [index, { record }] of ordered.entries()) {
      const turnIndex = record.turnIndex;
      if (!byTurn.has(turnIndex)) byTurn.set(turnIndex, []);
      const turn = byTurn.get(turnIndex);
      turn.push({ record, ordinal: index + 1 });
      if (turnIndex === null) result.unassignedRequestCount++;
      else result.assignedRequestCount++;
    }
    result.turnCount = [...byTurn.keys()].filter((key) => key !== null).length;
    const matches = (record) => !selection || ((!selection.model || record.model === selection.model)
      && (!selection.scope || record.scope === selection.scope)
      && (!selection.day || record.createdAt?.slice(0, 10) === selection.day));
    let turns = [...byTurn].map(([turnIndex, values]) => ({
      turnIndex, values, matching: values.filter(({ record }) => matches(record)),
      tokens: values.reduce((sum, { record }) => record.totalTokens === null ? sum : (sum ?? 0) + record.totalTokens, null),
    })).filter((turn) => !selection || turn.matching.length
      && (selection.assignment !== "assigned" || turn.turnIndex !== null)
      && (selection.assignment !== "unassigned" || turn.turnIndex === null));
    turns.sort((a, b) => (selection?.sort === "tokens" ? compareKnownDescending(a.tokens, b.tokens) : 0)
      || (a.turnIndex === null ? 1 : b.turnIndex === null ? -1 : a.turnIndex - b.turnIndex));
    if (selection) {
      result.matchingRequestCount = turns.reduce((sum, turn) => sum + turn.matching.length, 0);
      result.matchingTurnCount = turns.length;
      const pages = Math.max(1, Math.ceil(turns.length / selection.pageSize));
      const page = Math.min(selection.page, pages);
      result.pagination = { page, pages, pageSize: selection.pageSize, total: turns.length };
      turns = selection.turn === undefined
        ? turns.slice((page - 1) * selection.pageSize, page * selection.pageSize)
        : turns.filter((turn) => turn.turnIndex === selection.turn);
    }
    function request({ record, ordinal }) {
      const key = record.scope === "subagent"
        ? opaque("child", session.id, record.parentToolCallId) : opaque("group", session.id, record.scope);
      const group = byKey.get(key);
      const usage = aggregateUsage([record]);
      return {
        key: `request-${ordinal}`, ordinal, turnIndex: record.turnIndex, model: record.model, scope: record.scope,
        agentLabel: group.label, attributionKey: group.key, correlation: group.correlation,
        requestedModel: group.requestedModel, invocationCategory: group.invocationCategory,
        createdAt: record.createdAt, outcome: requestOutcome([record]),
        finishReason: record.finishReason, contentFiltered: record.contentFiltered,
        metrics: usage.metrics, evidence: usage.evidence,
      };
    }
    result.turns = turns.map(({ turnIndex, values, matching }) => {
        const records = values.map(({ record }) => record);
        const usage = aggregateUsage(records);
        const requestPages = Math.max(1, Math.ceil(matching.length / 25));
        const requestPage = Math.min(selection?.requestPage ?? 1, requestPages);
        const requests = !selection ? values.map(request) : selection.turn !== undefined
          ? matching.slice((requestPage - 1) * 25, requestPage * 25).map(request) : [];
        return {
          key: turnIndex === null ? "unassigned" : `turn-${turnIndex}`,
          turnIndex, label: turnIndex === null ? "Unassigned" : `Turn ${turnIndex}`,
          requestCount: values.length, metrics: usage.metrics, evidence: usage.evidence,
          models: [...new Set(records.map((record) => record.model))].sort(), requests,
          ...(!selection || selection.turn !== undefined
            ? { callBreakdown: callBreakdown(matching.map(({ record }) => record)) } : {}),
          ...(selection ? {
            matchingRequestCount: matching.length,
            matchingUsage: aggregateUsage(matching.map(({ record }) => record)),
            childAttributionKeys: [...new Set(matching.filter(({ record }) => record.scope === "subagent")
              .map(({ record }) => opaque("child", session.id, record.parentToolCallId)))],
            requestPagination: { page: requestPage, pages: requestPages, total: matching.length, pageSize: 25 },
          } : {}),
        };
      });
    return result;
  }
  function toolUsage(session, attributionGroups) {
    const { execution } = session;
    const count = execution.toolCount;
    const result = {
      source: count === null ? "not-recorded" : "jsonl",
      status: count === null ? "not-recorded" : "recorded",
      count, linkedCount: count === null ? null : 0, unlinkedCount: count === null ? null : 0,
      groups: [],
      notice: "Tool counts describe recorded executions, not token costs or turn-level usage. Child ownership requires exact same-session parent-call evidence; invocation wrappers remain session / unlinked. Durations are derived from ordered JSONL start/completion timestamps, may overlap, and are not wall-clock totals. Models are recorded tool metadata, not charged usage. Skills remain session-only counts.",
    };
    if (count === null) return result;
    if (execution.diagnostics.size || execution.toolDiagnostics.size) result.status = "partial";
    const children = new Map(attributionGroups.filter((group) => group.scope === "subagent").map((group) => [group.key, group]));
    const grouped = new Map();
    for (const [id, tool] of execution.tools) {
      const parent = tool.parentConflict || execution.children.get(id)?.started
        ? null : execution.children.get(tool.parentToolCallId);
      const key = parent?.started ? opaque("child", session.id, tool.parentToolCallId) : null;
      const child = children.get(key);
      if (!grouped.has(key)) grouped.set(key, {
        attributionKey: key, agentLabel: child?.label ?? "Session / unlinked",
        scope: child ? "subagent" : "unattributed", count: 0, categories: new Map(),
      });
      const group = grouped.get(key);
      group.count++;
      if (child) result.linkedCount++;
      else result.unlinkedCount++;
      const category = tool.start?.category ?? tool.complete.category;
      if (!group.categories.has(category)) group.categories.set(category, {
        category, count: 0, completedCount: 0, succeededCount: 0, failedCount: 0,
        unknownOutcomeCount: 0, durationMs: null, timedCount: 0, models: new Set(),
      });
      const value = group.categories.get(category);
      value.count++;
      if (tool.complete) value.completedCount++;
      if (tool.complete?.success === true) value.succeededCount++;
      else if (tool.complete?.success === false) value.failedCount++;
      else value.unknownOutcomeCount++;
      for (const model of [tool.start?.model, tool.complete?.model]) if (model) value.models.add(model);
      const start = tool.start?.timestamp;
      const complete = tool.complete?.timestamp;
      const duration = start && complete ? Date.parse(complete) - Date.parse(start) : null;
      if (duration !== null && duration >= 0) {
        value.durationMs = (value.durationMs ?? 0) + duration;
        value.timedCount++;
      } else result.status = "partial";
      if (tool.parentConflict || tool.complete?.success === null || !tool.complete) result.status = "partial";
    }
    const order = [...children.keys(), null];
    result.groups = order.filter((key) => grouped.has(key)).map((key) => {
      const group = grouped.get(key);
      return {
        ...group,
        categories: [...group.categories.values()].sort((a, b) => a.category.localeCompare(b.category))
          .map((category) => ({ ...category, models: [...category.models].sort() })),
      };
    });
    return result;
  }
  return {
    snapshot({ timeframe = "30d", model = null, includeHidden = false, day = null, scope = null,
      source = null, sessionHandle = null, comparisonOnly = false, compact = false, list = null } = {}) {
      const days = { "7d": 7, "30d": 30, "90d": 90, all: null };
      if (!Object.hasOwn(days, timeframe)) throw new UsageSourceError("TIMEFRAME", "Unsupported usage timeframe.");
      if (day !== null && !isUtcDay(day)) throw new UsageSourceError("DAY", "Invalid usage day.");
      if (scope !== null && !SCOPES.includes(scope)) throw new UsageSourceError("SCOPE", "Invalid usage scope.");
      const now = Date.now();
      const sessionId = sessionHandle === null ? null : resolveHandle(sessionHandle);
      if (sessionHandle !== null && sessionId === null) return null;
      const loaded = load(sessionId);
      const cutoff = days[timeframe] === null ? null : new Date(now - days[timeframe] * 86400000).toISOString();
      const catalog = loaded.sessions.filter((session) => (includeHidden || !hiddenIds.has(session.id)) &&
        (sessionHandle === null || session.handle === sessionHandle) &&
        (source === null || source === "cli") &&
        (!cutoff || (session.updatedAt ?? session.createdAt ?? "") >= cutoff));
      const matchesModel = (record) => model === null || record.model === model;
      const matchesRecord = (record) => matchesModel(record) &&
        (scope === null || record.scope === scope) &&
        (day === null || record.source === "sessiondb" && record.createdAt?.slice(0, 10) === day);
      const filtered = model !== null || day !== null || scope !== null;
      const discoverySessions = catalog.filter((session) => model === null || session.records.some(matchesModel));
      const discoveryRecords = discoverySessions.flatMap((session) => session.records.filter(matchesModel));
      const selected = discoverySessions.filter((session) => !filtered || session.records.some(matchesRecord));
      const records = selected.flatMap((session) => session.records.filter(matchesRecord));
      if (list) return {
        ...sessionPage(selected.map((session) => summary(session, filtered ? matchesRecord : null)), list, filtered),
        models: [...new Set(catalog.flatMap((session) => session.records.map((record) => record.model)))].sort().map((model) => ({ model })),
        capabilities: loaded.capabilities,
      };
      const comparison = {
        ...compareUsage(records, selected.length),
        availableModels: [...new Set(catalog.flatMap((session) => session.records.map((record) => record.model)))].sort(),
        sessionLabel: sessionHandle === null ? null : loaded.sessions.find((session) => session.handle === sessionHandle)?.label ?? null,
      };
      if (comparisonOnly) return {
        ...comparison, capabilities: loaded.capabilities,
        diagnostic: { active: sessionHandle === null ? false : selected[0]?.execution.active ?? false },
      };
      const catalogRecords = catalog.flatMap((session) => session.records);
      const rows = selected.map((session) => summary(session, filtered ? matchesRecord : null));
      const firstPage = compact ? sessionPage(rows) : null;
      return {
        ...catalogUsage(records, selected, filtered), sessionCount: selected.length,
        sessions: compact ? firstPage.sessions : rows.sort((a, b) => (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? "") || a.handle.localeCompare(b.handle)),
        ...(compact ? {
          pagination: firstPage.pagination, sessionsComplete: rows.length <= firstPage.pagination.pageSize,
          insights: Object.fromEntries(["duration", "delegation", "cache"].map((sort) => [sort, sortSessions(rows, sort)[0] ?? null])),
        } : {}),
        models: (filtered ? modelUsage(catalogRecords) : comparison.models.map(({ model, metrics, evidence, usageGranularity }) =>
          ({ model, metrics, evidence, usageGranularity }))).map((entry) => ({
          ...entry, sessionCount: catalog.filter((session) => session.records.some((record) => record.model === entry.model)).length,
        })),
        capabilities: loaded.capabilities, comparison,
        exploration: { trend: usageTrend(discoveryRecords, discoverySessions, timeframe, now) },
        performance: {
          groups: SCOPES.map((groupScope) => ({
            scope: groupScope,
            ...aggregateUsage(discoveryRecords.filter((record) => record.scope === groupScope)),
            sessionCount: discoverySessions.filter((session) => session.records.some((record) => matchesModel(record) && record.scope === groupScope)).length,
          })),
          skills: selected.reduce((total, session) => total + session.execution.skillCount, 0)
            ? [{ category: "skill", count: selected.reduce((total, session) => total + session.execution.skillCount, 0) }] : [],
          skillLinkage: "session-only",
        },
        recommendation: recommend(records),
      };
    },
    detail(handle, { compact = false } = {}) {
      const sessionId = resolveHandle(handle);
      if (sessionId === null) return null;
      const loaded = load(sessionId);
      const session = loaded.sessions.find((entry) => entry.handle === handle);
      if (!session) return null;
      const groups = attribution(session);
      return {
        session: summary(session), revision: revision(session), attribution: groups, ...(compact ? {} : { turnUsage: turnUsage(session, groups) }),
        comparison: {
          ...compareUsage(session.records, 1),
          availableModels: [...new Set(session.records.map((record) => record.model))].sort(), sessionLabel: session.label,
        },
        ...(compact ? {} : { toolUsage: toolUsage(session, groups) }),
        skills: skills(session.execution), skillLinkage: "session-only",
        recommendation: recommend(session.records), capabilities: loaded.capabilities,
        diagnostic: {
          active: session.execution.active, updatedAt: session.updatedAt,
          activityEvidence: activityEvidence(session.execution.active), liveStatus: "not-verified",
          toolCount: session.execution.toolCount,
          childCount: session.execution.observed ? [...session.execution.children.values()].filter((child) => child.started).length : null,
          status: session.execution.active === true ? "active" : session.execution.active === false ? "completed" : "not-recorded",
        },
      };
    },
    turns(handle, selection) {
      const sessionId = resolveHandle(handle);
      if (sessionId === null) return null;
      const loaded = load(sessionId);
      const session = loaded.sessions.find((entry) => entry.handle === handle);
      return session ? turnUsage(session, attribution(session), selection) : null;
    },
    tools(handle) {
      const sessionId = resolveHandle(handle);
      if (sessionId === null) return null;
      const loaded = load(sessionId);
      const session = loaded.sessions.find((entry) => entry.handle === handle);
      return session ? toolUsage(session, attribution(session)) : null;
    },
    resolveHandle,
    // Server-only consented content linkage; never include internal identifiers in a public DTO.
    resolveContentAgent(handle, attributionKey) {
      const sessionId = resolveHandle(handle);
      if (sessionId === null || typeof attributionKey !== "string" || !/^[a-f0-9]{64}$/.test(attributionKey)) return null;
      if (!sessionStateAvailable(statePath)) return null;
      for (const [toolCallId, child] of executionReader.read(sessionId).children) {
        if (child.started && opaque("child", sessionId, toolCallId) === attributionKey) return { sessionId, toolCallId };
      }
      return null;
    },
    capabilities() {
      if (closed) throw new UsageSourceError("STORE_CLOSED", "Usage store is closed.");
      const source = readUsageCapabilities(dbPath);
      const stateAvailable = sessionStateAvailable(statePath);
      return {
        ...source,
        sessionState: stateAvailable ? "available" : "unavailable",
        diagnostics: [
          ...source.diagnostics,
          stateAvailable
            ? "Session execution source is available; event coverage is checked when usage is read."
            : "Session execution metadata is unavailable.",
        ],
      };
    },
    close() {
      closed = true;
      handleIndex = null;
      handleIndexVersion = null;
      executionReader.clear();
      databaseReader.clear();
      projections.clear();
      projectionBytes = 0;
      preparedSources = new WeakMap();
    },
  };
}
