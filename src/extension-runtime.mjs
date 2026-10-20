import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createUsageService, UsageRequestError } from "../server/usage-service.mjs";
import {
  formatUsageSummary, formatUsageSessions, formatUsageSession, formatUsageModels,
} from "./formatter.mjs";
import { DEFAULT_PORT } from "./defaults.mjs";

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "server");
const timeframe = { type: "string", enum: ["7d", "30d", "90d", "all"], default: "30d" };
const schema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const failure = (text) => ({ resultType: "failure", textResultForLlm: text });

export function createExtension(options = {}) {
  let processHandle = null;
  let runningPort = null;
  let launching = false;
  const stop = () => {
    if (processHandle) processHandle.kill("SIGTERM");
    processHandle = null;
    runningPort = null;
  };
  const usage = (fn) => async (args = {}) => {
    let service;
    try {
      service = createUsageService(options);
      return fn(service, args);
    } catch (error) {
      return failure(error instanceof UsageRequestError ? error.message : "Local usage data is unavailable.");
    } finally {
      service?.close();
    }
  };
  const tools = [
    {
      name: "insights_dashboard",
      description: "Launch the local privacy-safe Copilot usage dashboard.",
      parameters: schema({ port: { type: "integer", minimum: 1024, maximum: 65535, default: DEFAULT_PORT } }),
      handler: async (args = {}) => {
        if (!args || typeof args !== "object" || Array.isArray(args)) return failure("Invalid dashboard options.");
        const port = args.port ?? DEFAULT_PORT;
        if (Object.keys(args).some((key) => key !== "port") || !Number.isInteger(port) || port < 1024 || port > 65535) {
          return failure("Invalid port. Use an integer between 1024 and 65535.");
        }
        if (runningPort !== null) return `Dashboard already running: http://127.0.0.1:${runningPort}`;
        if (launching) return failure("Dashboard is starting. Retry shortly.");
        launching = true;
        try {
          const child = spawn(process.execPath, ["index.mjs"], {
            cwd: SERVER_DIR,
            env: {
              ...process.env, PORT: String(port),
              ...(options.dbPath ? { COPILOT_SESSION_DB: options.dbPath } : {}),
              ...(options.sessionStatePath ? { COPILOT_SESSION_STATE_PATH: options.sessionStatePath } : {}),
              ...(options.stateDir ? { COPILOT_INSIGHTS_STATE_DIR: options.stateDir } : {}),
            },
            stdio: ["ignore", "ignore", "pipe"],
          });
          processHandle = child;
          let ready = false;
          let failed = false;
          child.stderr.on("data", (chunk) => {
            if (chunk.toString().includes(`Copilot Insights dashboard: http://127.0.0.1:${port}`)) ready = true;
          });
          child.once("error", () => { failed = true; });
          child.once("exit", () => {
            failed = true;
            if (processHandle === child) {
              processHandle = null;
              runningPort = null;
            }
          });
          const deadline = Date.now() + 10_000;
          while (!ready && !failed && Date.now() < deadline) {
            await new Promise((done) => setTimeout(done, 100));
          }
          if (!ready || failed || processHandle !== child) throw new Error("Dashboard unavailable.");
          await fetch(`http://127.0.0.1:${port}/api/settings`, { signal: globalThis.AbortSignal.timeout(2000) });
          runningPort = port;
          return `Copilot Insights dashboard: http://127.0.0.1:${port}\nUse insights_stop to shut down the dashboard.`;
        } catch {
          stop();
          return failure("Dashboard could not start. Check the port and local installation.");
        } finally {
          launching = false;
        }
      },
    },
    {
      name: "insights_stop", description: "Stop the Copilot Insights dashboard server.",
      parameters: schema({}),
      handler: async () => { stop(); return "Copilot Insights dashboard stopped."; },
    },
    {
      name: "insights_summary", description: "Summarize safe local recorded usage, metric coverage, and source availability.",
      skipPermission: true, parameters: schema({ timeframe }),
      handler: usage((service, args) => formatUsageSummary(service.snapshot(args))),
    },
    {
      name: "insights_sessions", description: "List a page of anonymous usage sessions with opaque handles. Use page to browse all matching sessions. No conversation content.",
      skipPermission: true,
      parameters: schema({ timeframe, model: { type: "string", maxLength: 100 }, includeHidden: { type: "boolean" },
        page: { type: "integer", minimum: 1, maximum: 1000000, default: 1 } }),
      handler: usage((service, args) => formatUsageSessions(service.sessions(args))),
    },
    {
      name: "insights_session", description: "Show recorded usage and agent attribution for an opaque session handle.",
      skipPermission: true,
      parameters: schema({ handle: { type: "string", pattern: "^[a-f0-9]{64}$" } }, ["handle"]),
      handler: usage((service, args) => {
        if (Object.keys(args).length !== 1 || !Object.hasOwn(args, "handle")) throw new UsageRequestError("Expected an opaque session handle.");
        const detail = service.detail(args.handle);
        return detail ? formatUsageSession(detail) : failure("Session not found.");
      }),
    },
    {
      name: "insights_models", description: "Compare recognized model usage with evidence coverage, not billing estimates.",
      skipPermission: true, parameters: schema({ timeframe }),
      handler: usage((service, args) => formatUsageModels(service.models(args))),
    },
  ];
  return {
    tools,
    hooks: {
      onSessionEnd: async () => {
        stop();
        return { cleanupActions: ["Stopped Copilot Insights dashboard server"] };
      },
    },
  };
}

export async function startCopilotInsightsExtension() {
  const { joinSession } = await import("@github/copilot-sdk/extension");
  return joinSession(createExtension());
}
