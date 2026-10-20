import { Worker } from "node:worker_threads";
import { UsageRequestError } from "./usage-service.mjs";

export const USAGE_WORKER_METHODS = Object.freeze([
  "snapshot", "sessions", "models", "comparison", "detail", "turns", "tools",
  "content", "setHidden", "settings", "updateSettings", "refresh",
]);
const UNAVAILABLE = "Local usage data is unavailable.";

// Only scalar source configuration crosses the boundary; injected services stay on the caller.
function workerOptions(options) {
  const config = {};
  for (const key of ["dbPath", "stateDir", "sessionStatePath"]) {
    if (options[key] === undefined) continue;
    if (typeof options[key] !== "string") throw new TypeError("Invalid usage source configuration.");
    config[key] = options[key];
  }
  return config;
}

export function createUsageWorker(options = {}, {
  maxQueue = 32,
  shutdownTimeoutMs = 1000,
  createWorker = (workerData) => new Worker(new URL("./usage-worker.mjs", import.meta.url), { workerData }),
} = {}) {
  if (!Number.isSafeInteger(maxQueue) || maxQueue < 0
      || !Number.isSafeInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 1) {
    throw new TypeError("Invalid usage worker configuration.");
  }
  const worker = createWorker(workerOptions(options));
  let active = null;
  const queue = [];
  let sequence = 0;
  let stopped = false;
  let exited = false;
  let shutdown;
  let finishShutdown;
  let shutdownTimer;
  const unavailable = () => new UsageRequestError(UNAVAILABLE, 503);

  function rejectPending() {
    active?.reject(unavailable());
    active = null;
    for (const request of queue.splice(0)) request.reject(unavailable());
  }
  function terminate() {
    Promise.resolve(worker.terminate()).catch(() => {}).finally(() => finishShutdown?.());
  }
  function fail() {
    stopped = true;
    rejectPending();
    if (!exited) terminate();
  }
  function dispatch() {
    if (stopped || active) return;
    active = queue.shift() ?? null;
    if (!active) {
      worker.unref();
      return;
    }
    worker.ref();
    try {
      worker.postMessage({ id: active.id, method: active.method, args: active.args });
    } catch {
      fail();
    }
  }
  worker.on("message", (message) => {
    if (stopped) return;
    if (message?.fatal || !active || message?.id !== active.id || typeof message.ok !== "boolean") {
      fail();
      return;
    }
    const request = active;
    active = null;
    if (message.ok) request.resolve(message.result);
    else if (message.error?.kind === "request" && Number.isInteger(message.error.status)
        && message.error.status >= 400 && message.error.status < 500 && typeof message.error.message === "string") {
      request.reject(new UsageRequestError(message.error.message, message.error.status));
    } else request.reject(unavailable());
    dispatch();
  });
  worker.on("error", fail);
  worker.on("exit", () => {
    exited = true;
    stopped = true;
    rejectPending();
    clearTimeout(shutdownTimer);
    finishShutdown?.();
  });
  worker.unref();

  const service = Object.fromEntries(USAGE_WORKER_METHODS.map((method) => [method, (...args) => {
    if (stopped) return Promise.reject(unavailable());
    // One in-flight message bounds the worker's own message queue as well.
    if (active && queue.length >= maxQueue) {
      return Promise.reject(new UsageRequestError("Local usage data is busy. Try again shortly.", 503));
    }
    return new Promise((resolve, reject) => {
      queue.push({ id: ++sequence, method, args, resolve, reject });
      dispatch();
    });
  }]));
  service.close = () => {
    if (shutdown) return shutdown;
    stopped = true;
    rejectPending();
    shutdown = new Promise((resolve) => { finishShutdown = resolve; });
    if (exited) finishShutdown();
    else {
      worker.ref();
      shutdownTimer = setTimeout(terminate, shutdownTimeoutMs);
      try { worker.postMessage({ close: true }); } catch { terminate(); }
    }
    return shutdown;
  };
  return service;
}
