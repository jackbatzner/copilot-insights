export const USAGE_CACHE_POLICY = Object.freeze({
  ttlMs: null,
  maxEntries: 200,
  maxBytes: 128 * 1024 * 1024,
});

export function usageAbortError() {
  const error = new Error("The usage request was interrupted. Try again.");
  error.name = "AbortError";
  return error;
}

// Only safe usage DTOs belong here. Content requests must use a separate transport.
export function createUsageCache({
  now = Date.now,
  ttlMs = USAGE_CACHE_POLICY.ttlMs,
  maxEntries = USAGE_CACHE_POLICY.maxEntries,
  maxBytes = USAGE_CACHE_POLICY.maxBytes,
} = {}) {
  for (const value of [maxEntries, maxBytes, ...(ttlMs === null ? [] : [ttlMs])]) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError("Invalid usage cache policy.");
  }
  const entries = new Map();
  const inflight = new Map();
  let bytes = 0;
  let generation = 0;
  const mutations = new Set();
  const isMutating = (key) => [...mutations].some((mutation) => mutation.matches(key));

  function remove(key) {
    const entry = entries.get(key);
    if (entry) bytes -= entry.bytes;
    entries.delete(key);
  }

  function prune(time) {
    for (const [key, entry] of entries) {
      const age = time - entry.fetchedAt;
      if (!Number.isFinite(age) || age < 0 || (ttlMs !== null && age >= ttlMs)) remove(key);
    }
  }

  function clear() {
    generation += 1;
    entries.clear();
    inflight.clear();
    bytes = 0;
  }

  function invalidate(matches) {
    for (const key of entries.keys()) if (matches(key)) remove(key);
    for (const key of inflight.keys()) if (matches(key)) inflight.delete(key);
  }

  function peek(key) {
    prune(now());
    if (isMutating(key)) return undefined;
    const entry = entries.get(key);
    if (!entry) return undefined;
    entries.delete(key);
    entries.set(key, entry);
    return entry.data;
  }

  function hasPending(key) {
    return !isMutating(key) && inflight.has(key);
  }

  function store(key, data) {
    const fetchedAt = now();
    prune(fetchedAt);
    if (!Number.isFinite(fetchedAt) || ttlMs === 0 || maxEntries < 1) return;
    let size;
    try {
      // Conservative UTF-16 serialized size, not an exact JavaScript heap measurement.
      size = (JSON.stringify(data).length + key.length) * 2;
    } catch {
      return;
    }
    remove(key);
    if (size > maxBytes) return;
    while (entries.size >= maxEntries || bytes + size > maxBytes) {
      remove(entries.keys().next().value);
    }
    entries.set(key, { data, fetchedAt, bytes: size });
    bytes += size;
  }

  function load(key, loader, { signal, noCache = false } = {}) {
    if (signal?.aborted) return Promise.reject(usageAbortError());
    prune(now());
    if (noCache) remove(key);
    const cached = peek(key);
    if (cached !== undefined) return Promise.resolve(cached);
    let request = inflight.get(key);
    if (!request) {
      const controller = new AbortController();
      request = { controller, consumers: new Set(), generation, cacheable: !isMutating(key) };
      inflight.set(key, request);
      const pending = request;
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw usageAbortError();
        return loader(controller.signal);
      }).then(
        (data) => finish(pending, null, data),
        (error) => finish(pending, error),
      );
    }
    return new Promise((resolve, reject) => {
      const pending = request;
      const consumer = {
        finish(error, data) {
          signal?.removeEventListener("abort", abort);
          pending.consumers.delete(consumer);
          if (error) reject(error);
          else resolve(data);
        },
      };
      const abort = () => {
        consumer.finish(usageAbortError());
        if (pending.consumers.size === 0) {
          if (inflight.get(key) === pending) inflight.delete(key);
          pending.controller.abort();
        }
      };
      pending.consumers.add(consumer);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });

    function finish(pending, error, data) {
      const current = inflight.get(key) === pending;
      if (current) inflight.delete(key);
      if (!error && current && pending.generation === generation &&
          pending.cacheable && !isMutating(key) && !pending.controller.signal.aborted) {
        store(key, data);
      }
      for (const consumer of pending.consumers) consumer.finish(error, data);
    }
  }

  function beginMutation(matches = () => true) {
    if (typeof matches !== "function") throw new TypeError("Invalid cache mutation scope.");
    const mutation = { matches };
    mutations.add(mutation);
    invalidate(matches);
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      mutations.delete(mutation);
      invalidate(matches);
    };
  }

  function status() {
    prune(now());
    return Object.freeze({
      ...USAGE_CACHE_POLICY, ttlMs, maxEntries, maxBytes,
      entries: entries.size, estimatedBytes: bytes, inflight: inflight.size,
      scope: "tab", storage: "memory", mutations: mutations.size,
    });
  }

  return Object.freeze({ load, peek, hasPending, invalidate, clear, beginMutation, status });
}
