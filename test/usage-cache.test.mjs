import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createUsageCache, USAGE_CACHE_POLICY } from "../ui/src/usage-cache.js";
import * as api from "../ui/src/api.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: async () => data,
});

describe("bounded tab-local safe usage cache", () => {
  it("reuses results, expires exactly at TTL, and refreshes on noCache", async () => {
    let time = 100;
    let calls = 0;
    const cache = createUsageCache({ now: () => time, ttlMs: 60_000 });
    const load = () => Promise.resolve({ version: ++calls });
    assert.deepEqual(await cache.load("summary", load), { version: 1 });
    time += 59_999;
    assert.deepEqual(await cache.load("summary", load), { version: 1 });
    time += 1;
    assert.deepEqual(await cache.load("summary", load), { version: 2 });
    assert.deepEqual(await cache.load("summary", load, { noCache: true }), { version: 3 });
    assert.deepEqual(await cache.load("summary", load), { version: 3 });
    assert.equal(calls, 3);
  });

  it("rejects invalid policies and never treats invalid or backwards clocks as fresh", async () => {
    for (const ttlMs of [-1, NaN, Infinity]) {
      assert.throws(() => createUsageCache({ ttlMs }), RangeError);
    }
    let time = 100;
    let calls = 0;
    const cache = createUsageCache({ now: () => time });
    const load = () => ++calls;
    await cache.load("a", load);
    time = 99;
    assert.equal(await cache.load("a", load), 2);
    time = NaN;
    assert.equal(await cache.load("a", load), 3);
    assert.equal(cache.status().entries, 0);
    time = Infinity;
    await cache.load("a", load);
    assert.equal(cache.status().entries, 0);
    const disabled = createUsageCache({ ttlMs: 0 });
    await disabled.load("a", load);
    assert.equal(disabled.status().entries, 0);
  });

  it("evicts least recently used entries and lazily removes expired entries", async () => {
    let time = 0;
    const cache = createUsageCache({ now: () => time, ttlMs: 60_000, maxEntries: 2 });
    const load = (key) => cache.load(key, () => key);
    await load("a");
    await load("b");
    await load("a");
    await load("c");
    let reloaded = false;
    await cache.load("b", () => { reloaded = true; return "b"; });
    assert.equal(reloaded, true);
    assert.equal(cache.status().entries, 2);
    time = 60_000;
    assert.equal(cache.status().entries, 0);
    assert.equal(cache.status().estimatedBytes, 0);
  });

  it("enforces the byte budget, delivers oversized responses without retaining them", async () => {
    const cache = createUsageCache({ maxBytes: 20 });
    await cache.load("a", () => "1234");
    assert.equal(cache.status().estimatedBytes, 14);
    await cache.load("b", () => "5678");
    assert.equal(cache.status().entries, 1);
    assert.equal(cache.status().estimatedBytes, 14);
    const large = "x".repeat(100);
    assert.equal(await cache.load("huge", () => large), large);
    assert.equal(cache.status().entries, 1);
    assert.ok(cache.status().estimatedBytes <= 20);
    await cache.load("b", () => large, { noCache: true });
    assert.equal(cache.status().estimatedBytes, 0);
  });

  it("keeps a live-sized aggregate beyond a minute until explicit invalidation", async () => {
    let time = 100, calls = 0;
    const cache = createUsageCache({ now: () => time });
    const data = { synthetic: "x".repeat(20 * 1024 * 1024) };
    const loader = () => { calls++; return data; };
    await cache.load("all-time", loader);
    assert.equal(USAGE_CACHE_POLICY.ttlMs, null);
    assert.ok(cache.status().estimatedBytes > 32 * 1024 * 1024);
    assert.ok(cache.status().estimatedBytes <= USAGE_CACHE_POLICY.maxBytes);
    time += 86_400_000;
    await cache.load("all-time", loader);
    assert.equal(calls, 1);
    cache.clear();
    await cache.load("all-time", loader);
    assert.equal(calls, 2);
  });

  it("invalidates only affected entries and inflight results during scoped mutations", async () => {
    const cache = createUsageCache();
    await cache.load("unrelated-detail", () => ({ version: 1 }));
    const pending = deferred();
    const stale = cache.load("sessions", () => pending.promise);
    await tick();
    assert.equal(cache.hasPending("sessions"), true);
    const finish = cache.beginMutation((key) => key === "sessions");
    assert.equal(cache.hasPending("sessions"), false);
    assert.equal(cache.peek("unrelated-detail").version, 1);
    let reloaded = false;
    await cache.load("unrelated-detail", () => { reloaded = true; });
    assert.equal(reloaded, false);
    pending.resolve({ old: true });
    await stale;
    finish();
    assert.equal(cache.peek("sessions"), undefined);
    assert.equal(cache.peek("unrelated-detail").version, 1);
  });

  it("shares a pending request but isolates either subscriber's abort", async () => {
    for (const abortIndex of [0, 1]) {
      const cache = createUsageCache();
      const pending = deferred();
      const controllers = [new AbortController(), new AbortController()];
      let calls = 0, sharedSignal;
      const load = (signal) => { calls += 1; sharedSignal = signal; return pending.promise; };
      const subscribers = controllers.map((controller) =>
        cache.load("same", load, { signal: controller.signal }));
      await tick();
      const rejected = assert.rejects(subscribers[abortIndex], { name: "AbortError" });
      controllers[abortIndex].abort();
      await rejected;
      assert.equal(sharedSignal.aborted, false);
      pending.resolve({ requests: 2 });
      assert.deepEqual(await subscribers[1 - abortIndex], { requests: 2 });
      assert.equal(calls, 1);
      assert.equal(cache.status().entries, 1);
    }
  });

  it("aborts the transport only when all subscribers leave and ignores its late result", async () => {
    const cache = createUsageCache();
    const pending = deferred();
    const controllers = [new AbortController(), new AbortController()];
    let sharedSignal;
    const subscribers = controllers.map((controller) => cache.load("a", (signal) => {
      sharedSignal = signal;
      return pending.promise;
    }, { signal: controller.signal }));
    await tick();
    const rejected = subscribers.map((promise) => assert.rejects(promise, { name: "AbortError" }));
    controllers.forEach((controller) => controller.abort());
    await Promise.all(rejected);
    assert.equal(sharedSignal.aborted, true);
    assert.equal(cache.status().inflight, 0);
    assert.equal(await cache.load("a", () => "new"), "new");
    pending.resolve("old");
    await tick();
    assert.equal(await cache.load("a", () => assert.fail("cache miss")), "new");
  });

  it("honors an already-aborted signal even for cache hits and does not start abandoned work", async () => {
    const cache = createUsageCache();
    await cache.load("cached", () => "safe");
    const controller = new AbortController();
    controller.abort("private reason");
    await assert.rejects(cache.load("cached", () => assert.fail(), {
      signal: controller.signal,
    }), { name: "AbortError", message: "The usage request was interrupted. Try again." });
    const fresh = new AbortController();
    const result = cache.load("uncached", () => assert.fail("abandoned request started"), {
      signal: fresh.signal,
    });
    const rejected = assert.rejects(result, { name: "AbortError" });
    fresh.abort();
    await rejected;
    await tick();
  });

  it("does not cache failures or let a cleared request replace newer data", async () => {
    const cache = createUsageCache();
    const failure = deferred();
    const first = cache.load("a", () => failure.promise);
    const second = cache.load("a", () => assert.fail("not deduped"));
    const rejects = [first, second].map((promise) => assert.rejects(promise, /failure/));
    failure.reject(new Error("failure"));
    await Promise.all(rejects);
    assert.equal(cache.status().entries, 0);
    const pending = deferred();
    const old = cache.load("a", () => pending.promise);
    await tick();
    cache.clear();
    assert.equal(await cache.load("a", () => "new"), "new");
    pending.resolve("old");
    assert.equal(await old, "old");
    assert.equal(await cache.load("a", () => assert.fail("old request overwrote cache")), "new");
  });

  it("prevents reads during overlapping mutations from entering the cache", async () => {
    const cache = createUsageCache();
    await cache.load("a", () => "before");
    const endFirst = cache.beginMutation();
    const endSecond = cache.beginMutation();
    assert.equal(cache.status().entries, 0);
    await cache.load("a", () => "during");
    assert.equal(cache.status().entries, 0);
    endFirst();
    endFirst();
    assert.equal(cache.status().mutations, 1);
    const pending = deferred();
    const old = cache.load("a", () => pending.promise);
    await tick();
    endSecond();
    pending.resolve("overlap");
    await old;
    assert.equal(cache.status().entries, 0);
    await cache.load("a", () => "after");
    assert.equal(cache.status().entries, 1);
  });

  it("exposes only frozen policy and aggregate status, never response values or keys", async () => {
    const cache = createUsageCache();
    await cache.load("opaque-session-handle", () => ({ requests: 12 }));
    const status = cache.status();
    assert.equal(status.scope, "tab");
    assert.equal(status.storage, "memory");
    assert.equal(Object.isFrozen(status), true);
    assert.equal(Object.isFrozen(USAGE_CACHE_POLICY), true);
    assert.doesNotMatch(JSON.stringify(status), /opaque-session-handle|requests/);
    assert.deepEqual(USAGE_CACHE_POLICY, { ttlMs: null, maxEntries: 200, maxBytes: 134_217_728 });
  });
});

describe("safe usage API cache integration", () => {
  beforeEach(() => api.clearCache());

  it("reuses summary and detail comparison projections while caching distinct selections", async (t) => {
    let calls = 0;
    const comparison = { models: [], availableModels: [], sessionCount: 1, sessionLabel: null };
    t.mock.method(globalThis, "fetch", async (url) => {
      calls++;
      if (url.includes("/summary?")) return response({ comparison, sessions: [], models: [], capabilities: {} });
      if (url.endsWith("/session-a")) return response({
        comparison, session: { handle: "session-a", hidden: false }, capabilities: {}, diagnostic: { active: false },
      });
      return response(comparison);
    });
    await api.fetchSummary("all");
    assert.equal((await api.fetchModelComparison("all")).sessionCount, 1);
    assert.equal(calls, 1);
    await api.fetchSessionDetail("session-a");
    await api.fetchModelComparison("all", { session: "session-a" });
    assert.equal(calls, 2);
    await api.fetchModelComparison("all", { model: "gpt-5-mini", scope: "subagent" });
    await api.fetchModelComparison("all", { model: "gpt-5-mini", scope: "subagent" });
    assert.equal(calls, 3);
    await api.setSessionHidden("session-a", true);
    await api.fetchModelComparison("all", { model: "gpt-5-mini", scope: "subagent" });
    assert.equal(calls, 5);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(api.fetchModelComparison("all", {}, { signal: controller.signal }), { name: "AbortError" });
  });

  it("keeps fresh comparison polls on revisit and yields to changed detail snapshots", async (t) => {
    let tokens = 10, calls = 0;
    t.mock.method(globalThis, "fetch", async (url) => {
      calls++;
      const comparison = { tokens, models: [] };
      return response(url.includes("/sessions/session-a") ? {
        comparison, session: { handle: "session-a", hidden: false, metrics: { totalTokens: tokens } },
        capabilities: {}, diagnostic: { active: true },
      } : comparison);
    });
    const filters = { session: "session-a" };
    await api.fetchSessionDetail("session-a");
    assert.equal((await api.fetchModelComparison("all", filters)).tokens, 10);
    assert.equal(calls, 1);
    tokens = 20;
    await api.fetchModelComparison("all", filters, { noCache: true });
    assert.equal((await api.fetchModelComparison("all", filters)).tokens, 20);
    assert.equal(calls, 2, "revisit reuses the newer comparison, not the older detail");
    tokens = 30;
    await api.fetchSessionDetail("session-a", { noCache: true });
    assert.equal((await api.fetchModelComparison("all", filters)).tokens, 30);
    assert.equal(calls, 3, "changed detail invalidates the comparison and supplies its fresh projection");
  });

  it("joins a pending comparison refresh instead of returning an older detail projection", async (t) => {
    const pending = deferred();
    let calls = 0;
    t.mock.method(globalThis, "fetch", (url) => {
      calls++;
      return url.includes("/sessions/session-a") ? Promise.resolve(response({
        comparison: { tokens: 10 }, session: { handle: "session-a", hidden: false },
      })) : pending.promise;
    });
    const filters = { session: "session-a" };
    await api.fetchSessionDetail("session-a");
    const fresh = api.fetchModelComparison("all", filters, { noCache: true });
    const controller = new AbortController();
    const abandoned = api.fetchModelComparison("all", filters, { signal: controller.signal });
    const revisit = api.fetchModelComparison("all", filters);
    const rejected = assert.rejects(abandoned, { name: "AbortError" });
    controller.abort();
    await rejected;
    pending.resolve(response({ tokens: 20 }));
    assert.equal((await fresh).tokens, 20);
    assert.equal((await revisit).tokens, 20);
    assert.equal(calls, 2);
  });

  it("reuses only the matching first session page and keeps later pages and sorts separate", async (t) => {
    const urls = [];
    t.mock.method(globalThis, "fetch", async (url) => {
      urls.push(url);
      return response({ sessions: [{ handle: "safe" }], models: [], capabilities: {},
        sessionsComplete: false, pagination: { page: 1, pageSize: 25, pages: 4, total: 100, sort: "tokens" } });
    });
    await api.fetchSummary("all");
    const first = await api.fetchSessions("all", { page: 1, sort: "tokens" });
    assert.equal(first.pagination.total, 100);
    assert.equal(urls.length, 1);
    await api.fetchSessions("all", { page: 2, sort: "tokens" });
    await api.fetchSessions("all", { sort: "recent" });
    await api.fetchSessions("all", { source: "vscode" });
    assert.equal(urls.length, 4);
    assert.ok(urls[1].includes("page=2"));
  });

  it("invalidates paged sections after a changed summary detail and reuses its comparison", async (t) => {
    let tokens = 10;
    const urls = [];
    t.mock.method(globalThis, "fetch", async (url) => {
      urls.push(url);
      return response(url.includes("?view=summary") ? {
        session: { handle: "safe", hidden: false, metrics: { totalTokens: tokens } },
        comparison: { tokens }, capabilities: {},
      } : { tokens });
    });
    await api.fetchSessionDetail("safe", {}, "summary");
    await api.fetchSessionTurns("safe", { page: 1 });
    await api.fetchSessionTools("safe");
    assert.equal((await api.fetchModelComparison("all", { session: "safe" })).tokens, 10);
    tokens = 20;
    await api.fetchSessionDetail("safe", { noCache: true }, "summary");
    assert.equal((await api.fetchSessionTurns("safe", { page: 1 })).tokens, 20);
    assert.equal((await api.fetchSessionTools("safe")).tokens, 20);
    assert.equal(urls.length, 6);
  });

  it("shares loaded summary arrays with Sessions without duplicate cache entries", async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return response({ sessions: [{ handle: "safe-handle" }], models: [], capabilities: {} });
    });
    const summary = await api.fetchSummary("all");
    const sessions = await api.fetchSessions("all");
    assert.equal(sessions.sessions, summary.sessions);
    assert.equal(sessions.models, summary.models);
    await api.fetchTokenSummary("all");
    assert.equal(calls, 1);
    assert.equal(api.getUsageCacheStatus().entries, 1);
    for (const filters of [{ model: "model-a" }, { day: "2026-09-14" }, { scope: "primary" }, { includeHidden: true }]) {
      await api.fetchSessions("all", filters);
      await api.fetchSessions("all", filters);
    }
    assert.equal(calls, 5, "distinct filtered observations must be fetched once, not inferred");
    await api.fetchSessions("7d");
    assert.equal(calls, 6);
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(api.fetchSessions("all", {}, { signal: aborted.signal }), { name: "AbortError" });
  });

  it("shares an inflight summary with Sessions without sharing consumer cancellation", async (t) => {
    const pending = deferred();
    let calls = 0;
    t.mock.method(globalThis, "fetch", () => { calls++; return pending.promise; });
    const controller = new AbortController();
    const overview = api.fetchSummary("all", { signal: controller.signal });
    const sessions = api.fetchSessions("all");
    const rejection = assert.rejects(overview, { name: "AbortError" });
    controller.abort();
    pending.resolve(response({ sessions: [], models: [], capabilities: {} }));
    await rejection;
    assert.deepEqual(await sessions, { sessions: [], models: [], capabilities: {} });
    assert.equal(calls, 1);
  });

  it("does not replace a freshly retried Sessions list with an older summary", async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => response({
      sessions: [{ version: ++calls }], models: [], capabilities: {},
    }));
    await api.fetchSummary("all");
    assert.equal((await api.fetchSessions("all")).sessions[0].version, 1);
    await api.fetchSessions("all", {}, { noCache: true });
    assert.equal((await api.fetchSessions("all")).sessions[0].version, 2);
    assert.equal(calls, 2);
  });

  it("refreshes collections when newly fetched detail changes, keeping unrelated detail cached", async (t) => {
    let calls = 0, tokens = 10;
    const session = () => ({ handle: "a", metrics: { totalTokens: tokens } });
    t.mock.method(globalThis, "fetch", async (url) => {
      calls++;
      return response(url.includes("/summary?")
        ? { sessions: [session()], models: [], capabilities: {} }
        : { session: url.endsWith("/a") ? session() : { handle: "b" } });
    });
    await api.fetchSummary("all");
    await api.fetchSessionDetail("a");
    await api.fetchSessionDetail("b");
    await api.fetchSummary("all");
    assert.equal(calls, 3, "unchanged detail must not evict reusable summaries");
    tokens = 20;
    await api.fetchSessionDetail("a", { noCache: true });
    await api.fetchSessionDetail("b");
    const summary = await api.fetchSummary("all");
    assert.equal(summary.sessions[0].metrics.totalTokens, 20);
    assert.equal(calls, 5);
    await api.setSessionHidden("a", true);
    await api.fetchSessionDetail("b");
    assert.equal(calls, 6, "hiding one session must preserve unrelated details");
    await api.fetchSessionDetail("a");
    assert.equal(calls, 7);
  });

  it("aliases summary endpoints but preserves distinct queries and session DTOs", async (t) => {
    const calls = [];
    t.mock.method(globalThis, "fetch", async (url, options) => {
      calls.push(url);
      assert.equal(options.cache, "no-store");
      return response({ call: calls.length });
    });
    assert.deepEqual(await api.fetchSummary("7d"), await api.fetchTokenSummary("7d"));
    await api.fetchSummary("30d");
    await api.fetchSessions("7d", {});
    await api.fetchSessions("7d", { model: "model-a" });
    await api.fetchSessions("7d", { includeHidden: true });
    await api.fetchSessionDetail("opaque");
    assert.equal(calls.length, 6);
    await api.fetchSessionDetail("opaque");
    assert.equal(calls.length, 6);
    await api.fetchTokenSummary("7d", { noCache: true });
    assert.deepEqual(await api.fetchSummary("7d"), { call: 7 });
    assert.equal(calls.length, 7);
  });

  it("dedupes concurrent summary aliases and propagates isolated cancellation", async (t) => {
    const pending = deferred();
    let calls = 0, transport;
    t.mock.method(globalThis, "fetch", (_url, options) => {
      calls += 1;
      transport = options.signal;
      return pending.promise;
    });
    const controller = new AbortController();
    const first = api.fetchSummary("7d", { signal: controller.signal });
    const second = api.fetchTokenSummary("7d", { noCache: true });
    await tick();
    const rejection = assert.rejects(first, { name: "AbortError" });
    controller.abort();
    await rejection;
    assert.equal(transport.aborted, false);
    pending.resolve(response({ sessionCount: 1 }));
    assert.deepEqual(await second, { sessionCount: 1 });
    assert.equal(calls, 1);
  });

  it("clears before and after refresh, hide, unhide and settings mutations", async (t) => {
    let calls = 0;
    const mutations = [];
    t.mock.method(globalThis, "fetch", async (url, options) => {
      calls += 1;
      if (options.method) {
        mutations.push([url, options.method]);
        assert.equal(api.getUsageCacheStatus().entries, 0);
      }
      return response({ version: calls });
    });
    for (const mutate of [
      () => api.refreshData(), () => api.setSessionHidden("opaque", true),
      () => api.setSessionHidden("opaque", false), () => api.updateSettings({ enableVSCode: true }),
    ]) {
      await api.fetchSummary("7d");
      assert.equal(api.getUsageCacheStatus().entries, 1);
      await mutate();
      assert.equal(api.getUsageCacheStatus().entries, 0);
    }
    assert.deepEqual(mutations.map(([, method]) => method), ["POST", "POST", "DELETE", "PATCH"]);
    assert.equal(calls, 8);
  });

  it("never dedupes or stores POST responses, even at an otherwise cacheable URL", async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => response({ call: ++calls }));
    await Promise.all([
      api.fetchSummary("7d", { method: "POST" }),
      api.fetchSummary("7d", { method: "POST" }),
    ]);
    assert.equal(calls, 2);
    assert.equal(api.getUsageCacheStatus().entries, 0);
    await Promise.all([api.refreshData(), api.refreshData()]);
    assert.equal(calls, 4);
    assert.equal(api.getUsageCacheStatus().entries, 0);
  });

  it("cannot repopulate after clear or a mutation overlapping an in-flight read", async (t) => {
    const pending = deferred();
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (_url, options) => {
      calls += 1;
      if (calls === 1) return pending.promise;
      return response({ mutation: Boolean(options.method), call: calls });
    });
    const old = api.fetchSummary("7d");
    await tick();
    await api.refreshData();
    const fresh = await api.fetchSummary("7d");
    pending.resolve(response({ old: true }));
    await old;
    assert.deepEqual(await api.fetchSummary("7d"), fresh);
    assert.equal(calls, 3);
  });

  it("cleans up request timeouts after all consumers abort and safely reports timeouts", async (t) => {
    const timers = new Map();
    let nextTimer = 0, transport;
    t.mock.method(globalThis, "setTimeout", (callback, delay) => {
      assert.equal(delay, 120_000);
      timers.set(++nextTimer, callback);
      return nextTimer;
    });
    t.mock.method(globalThis, "clearTimeout", (id) => timers.delete(id));
    t.mock.method(globalThis, "fetch", (_url, options) => new Promise((_resolve, reject) => {
      transport = options.signal;
      transport.addEventListener("abort", () => {
        const error = new Error("private transport details");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }));
    const controllers = [new AbortController(), new AbortController()];
    const results = controllers.map((controller) => api.fetchSummary("7d", { signal: controller.signal }));
    const rejections = results.map((result) => assert.rejects(result, { name: "AbortError" }));
    await tick();
    assert.equal(timers.size, 1);
    controllers.forEach((controller) => controller.abort());
    await Promise.all(rejections);
    await tick();
    assert.equal(transport.aborted, true);
    assert.equal(timers.size, 0);
    assert.equal(api.getUsageCacheStatus().entries, 0);
    const timed = api.fetchSummary("7d");
    const rejected = assert.rejects(timed, { message: "The usage request timed out. Try again." });
    await tick();
    timers.values().next().value();
    await rejected;
    assert.equal(timers.size, 0);
    assert.equal(api.getUsageCacheStatus().entries, 0);
  });

  it("allows cold usage GETs past the old 30s deadline and clears their 120s timer on success", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let pending, transport;
    t.mock.method(globalThis, "fetch", (_url, options) => {
      transport = options.signal;
      transport.addEventListener("abort", () => {
        const error = new Error("private transport details");
        error.name = "AbortError";
        pending.reject(error);
      }, { once: true });
      return pending.promise;
    });
    for (const load of [
      () => api.fetchSummary("all"), () => api.fetchTokenSummary("all"),
      () => api.fetchSessions("all", {}), () => api.fetchSessionDetail("opaque"),
    ]) {
      api.clearCache();
      pending = deferred();
      let settled = false;
      const result = load().finally(() => { settled = true; });
      await tick();
      t.mock.timers.tick(30_000);
      await tick();
      assert.equal(transport.aborted, false);
      assert.equal(settled, false);
      t.mock.timers.tick(89_999);
      assert.equal(transport.aborted, false);
      pending.resolve(response({ requests: 7 }));
      assert.deepEqual(await result, { requests: 7 });
      assert.equal(api.getUsageCacheStatus().entries, 1);
      t.mock.timers.tick(1);
      assert.equal(transport.aborted, false, "successful request left its timeout running");
    }
    api.clearCache();
    pending = deferred();
    const timed = api.fetchSummary("all");
    const rejected = assert.rejects(timed, { message: "The usage request timed out. Try again." });
    await tick();
    t.mock.timers.tick(119_999);
    assert.equal(transport.aborted, false);
    t.mock.timers.tick(1);
    await rejected;
    assert.equal(transport.aborted, true);
    assert.equal(api.getUsageCacheStatus().entries, 0);
    assert.equal(api.getUsageCacheStatus().inflight, 0);
  });

  it("keeps settings reads and every mutation on the existing 30s deadline", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let transport;
    t.mock.method(globalThis, "fetch", (_url, options) => new Promise((_resolve, reject) => {
      transport = options.signal;
      transport.addEventListener("abort", () => {
        const error = new Error("private transport details");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }));
    for (const load of [
      () => api.fetchSettings(), () => api.refreshData(),
      () => api.setSessionHidden("opaque", true), () => api.setSessionHidden("opaque", false),
      () => api.updateSettings({ enableVSCode: true }),
      () => api.fetchSummary("all", { method: "POST" }),
    ]) {
      const rejected = assert.rejects(load(), { message: "The usage request timed out. Try again." });
      await tick();
      t.mock.timers.tick(29_999);
      assert.equal(transport.aborted, false);
      t.mock.timers.tick(1);
      await rejected;
      assert.equal(transport.aborted, true);
      assert.equal(api.getUsageCacheStatus().entries, 0);
      assert.equal(api.getUsageCacheStatus().mutations, 0);
    }
  });

  it("scrubs failures, never caches errors, and invalidates even when mutation fails", async (t) => {
    let mode = "success", calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls += 1;
      if (mode === "network") throw new TypeError("private network detail");
      if (mode === "unexpected") throw new Error("<html>private server message</html>");
      if (mode === "undefined") throw undefined;
      if (mode === "json") return { ok: true, json: () => { throw new Error("private body"); } };
      if (mode === "404") return response({ private: "body" }, 404);
      if (mode === "500") return response({ private: "body" }, 500);
      return response({ safe: true });
    });
    const messages = {
      network: "Cannot reach the local usage server. Try again.",
      unexpected: "Usage data could not be loaded. Try again.",
      undefined: "Usage data could not be loaded. Try again.",
      json: "The server returned an invalid usage response. Try again.",
      404: "This view is unavailable. The session may no longer be recorded.",
      500: "Usage data could not be loaded. Try again.",
    };
    for (const [failure, message] of Object.entries(messages)) {
      mode = failure;
      await assert.rejects(api.fetchSummary("7d"), { message });
      assert.equal(api.getUsageCacheStatus().entries, 0);
    }
    assert.equal(calls, 6);
    mode = "success";
    await api.fetchSettings();
    mode = "500";
    await assert.rejects(api.updateSettings({ enableVSCode: false }), { message: messages[500] });
    assert.equal(api.getUsageCacheStatus().entries, 0);
    assert.equal(api.getUsageCacheStatus().mutations, 0);
  });
});

describe("usage hook cache and polling lifecycle", () => {
  it("uses cache on navigation, forces retries and polls, and cancels old sequences", async (t) => {
    let refreshKey = 0, hookIndex = 0, effect, cleanup, effectDeps;
    const values = [];
    const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
    const react = {
      useState(initial) {
        const index = hookIndex++;
        if (!(index in values)) values[index] = initial;
        return [values[index], (next) => {
          values[index] = typeof next === "function" ? next(values[index]) : next;
        }];
      },
      useRef(initial) {
        const index = hookIndex++;
        if (!(index in values)) values[index] = { current: initial };
        return values[index];
      },
      useCallback(callback) { return callback; },
      useEffect(callback, deps) {
        if (!same(effectDeps, deps)) { effect = callback; effectDeps = deps; }
      },
    };
    // Inject the hook dependencies without asking Node to load the app's JSX tree.
    const source = readFileSync(new URL("../ui/src/hooks/useUsageData.js", import.meta.url), "utf8")
      .replace(/^import .*;$/gm, "").replace("export function useUsageData", "function useUsageData");
    const useUsageData = new Function(
      ...Object.keys(react), "useRefresh", `${source}\nreturn useUsageData;`,
    )(...Object.values(react), () => ({ key: refreshKey }));
    t.after(() => cleanup?.());
    const timers = new Map();
    let nextTimer = 0;
    t.mock.method(globalThis, "setTimeout", (callback, delay) => {
      assert.equal(delay, 15_000);
      timers.set(++nextTimer, callback);
      return nextTimer;
    });
    t.mock.method(globalThis, "clearTimeout", (id) => timers.delete(id));
    function render(loader, pollActive = true) {
      hookIndex = 0;
      const state = useUsageData(loader, { pollActive });
      if (effect) {
        cleanup?.();
        cleanup = effect();
        effect = null;
      }
      return state;
    }
    const calls = [];
    const loader = async (options) => {
      calls.push(options);
      return { diagnostic: { active: true } };
    };
    render(loader);
    await tick();
    assert.equal(calls[0].noCache, false);
    assert.equal(timers.size, 1);
    const [timerId, poll] = timers.entries().next().value;
    timers.delete(timerId);
    poll();
    await tick();
    assert.equal(calls[1].noCache, true);
    assert.equal(timers.size, 1);
    render(loader).retry();
    render(loader);
    await tick();
    assert.equal(calls[2].noCache, true);
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(timers.size, 1);
    const nextLoader = async (options) => {
      calls.push(options);
      return { diagnostic: { active: false } };
    };
    render(nextLoader);
    await tick();
    assert.equal(calls[3].noCache, false);
    assert.equal(timers.size, 0);
    refreshKey += 1;
    render(nextLoader);
    await tick();
    assert.equal(calls.length, 5);
    const pending = deferred();
    render(() => pending.promise);
    cleanup();
    cleanup = null;
    pending.resolve({ diagnostic: { active: true } });
    await tick();
    assert.equal(timers.size, 0);
  });
});
