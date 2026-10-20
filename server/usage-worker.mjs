import { parentPort, workerData } from "node:worker_threads";
import { createUsageService, UsageRequestError } from "./usage-service.mjs";
import { USAGE_WORKER_METHODS } from "./usage-worker-client.mjs";

const methods = new Set(USAGE_WORKER_METHODS);
let service;
try {
  service = createUsageService(workerData);
} catch {
  parentPort.postMessage({ fatal: true });
  parentPort.close();
}

if (service) {
  parentPort.on("message", (message) => {
    if (message?.close === true) {
      try { service.close(); } finally { parentPort.close(); }
      return;
    }
    const id = message?.id;
    try {
      if (!Number.isSafeInteger(id) || id < 1 || !methods.has(message?.method)
          || !Array.isArray(message.args)) {
        throw new UsageRequestError("Invalid request.");
      }
      parentPort.postMessage({ id, ok: true, result: service[message.method](...message.args) });
    } catch (error) {
      const safe = error instanceof UsageRequestError
        ? { kind: "request", status: error.status, message: error.message }
        : { kind: "unavailable" };
      parentPort.postMessage({ id, ok: false, error: safe });
    }
  });
}
