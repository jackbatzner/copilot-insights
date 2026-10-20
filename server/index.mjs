import express from "express";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT } from "../src/defaults.mjs";
import { UsageRequestError } from "./usage-service.mjs";
import { createUsageWorker } from "./usage-worker-client.mjs";
import { HANDLE_RE } from "./local-state.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function localAuthority(value) {
  try {
    const url = new URL(`http://${value}`);
    return LOOPBACK.has(url.hostname) && url.host === value.toLowerCase();
  } catch {
    return false;
  }
}

export function createApp(options = {}) {
  const service = options.service || createUsageWorker(options);
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    if (!localAuthority(req.headers.host || "")) {
      return res.status(403).json({ error: "Local access only." });
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let allowed = false;
      try {
        const url = new URL(origin);
        allowed = url.protocol === "http:" && url.origin === origin
          && url.host === req.headers.host && LOOPBACK.has(url.hostname);
      } catch {
        // Unparseable origins are denied, never reflected.
      }
      if (!allowed) return res.status(403).json({ error: "Origin not allowed." });
    }
    if (req.headers["sec-fetch-site"] === "cross-site") {
      return res.status(403).json({ error: "Origin not allowed." });
    }
    next();
  });
  const route = (fn) => async (req, res, next) => {
    try { await fn(req, res); } catch (error) { next(error); }
  };
  app.all("/api/sessions/:handle/content", (req, res, next) => {
    if (req.method !== "POST") return res.status(405).set("Allow", "POST").json({ error: "Explicit POST reveal required." });
    if (req.headers.origin !== `http://${req.headers.host}`) return res.status(403).json({ error: "Origin not allowed." });
    if (!req.is("application/json")) return res.status(415).json({ error: "JSON content type required." });
    next();
  });
  app.post("/api/sessions/:handle/content", express.json({
    limit: "2kb", strict: true,
    verify(req, _res, buffer) {
      const text = buffer.toString("utf8");
      const keys = [...text.matchAll(/"(?:\\.|[^"\\])*"/g)]
        .filter((match) => /^\s*:/.test(text.slice(match.index + match[0].length)))
        .map((match) => {
          try { return JSON.parse(match[0]); } catch { return null; }
        });
      req.duplicateContentFields = keys.length !== new Set(keys).size;
    },
  }), route(async (req, res) => {
    if (!HANDLE_RE.test(req.params.handle)) return res.status(404).json({ error: "Session not found." });
    if (Object.keys(req.query).length || req.duplicateContentFields) throw new UsageRequestError("Invalid reveal request.");
    const content = await service.content(req.params.handle, req.body);
    if (!content) return res.status(404).json({ error: "Session not found." });
    res.json(content);
  }));
  app.use(express.json({ limit: "2kb", strict: true }));
  app.get(["/api/summary", "/api/tokens/summary"], route(async (req, res) => {
    res.json(await service.snapshot(req.query));
  }));
  app.get("/api/sessions", route(async (req, res) => {
    res.json(await service.sessions(req.query));
  }));
  app.get("/api/comparison", route(async (req, res) => {
    res.json(await service.comparison(req.query));
  }));
  app.get("/api/sessions/:handle", route(async (req, res) => {
    if (!HANDLE_RE.test(req.params.handle)) return res.status(404).json({ error: "Session not found." });
    const detail = await service.detail(req.params.handle, req.query);
    if (!detail) return res.status(404).json({ error: "Session not found." });
    res.json(detail);
  }));
  for (const method of ["turns", "tools"]) {
    app.get(`/api/sessions/:handle/${method}`, route(async (req, res) => {
      if (!HANDLE_RE.test(req.params.handle)) return res.status(404).json({ error: "Session not found." });
      const result = await service[method](req.params.handle, req.query);
      if (!result) return res.status(404).json({ error: "Session not found." });
      res.json(result);
    }));
  }
  for (const [method, hidden] of [["post", true], ["delete", false]]) {
    app[method]("/api/sessions/:handle/hide", route(async (req, res) => {
      if (!HANDLE_RE.test(req.params.handle)) return res.status(404).json({ error: "Session not found." });
      if (Object.keys(req.query).length || (req.body && Object.keys(req.body).length)) {
        throw new UsageRequestError("Invalid request.");
      }
      res.json(await service.setHidden(req.params.handle, hidden));
    }));
  }
  app.get("/api/settings", route(async (req, res) => {
    if (Object.keys(req.query).length) throw new UsageRequestError("Invalid query.");
    res.json(await service.settings());
  }));
  app.patch("/api/settings", route(async (req, res) => {
    if (Object.keys(req.query).length) throw new UsageRequestError("Invalid query.");
    res.json(await service.updateSettings(req.body));
  }));
  app.post("/api/refresh", route(async (req, res) => {
    if (Object.keys(req.query).length || (req.body && Object.keys(req.body).length)) {
      throw new UsageRequestError("Invalid request.");
    }
    await service.refresh();
    res.json({ ok: true });
  }));
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));
  app.use((req, res, next) => {
    let path;
    try { path = decodeURIComponent(req.path).toLowerCase(); }
    catch { return res.status(400).json({ error: "Invalid request." }); }
    if (path === "/api" || path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
    next();
  });
  const uiDist = options.uiDist || resolve(directory, "..", "ui", "dist");
  app.use(express.static(uiDist, { etag: false, lastModified: false, index: false }));
  app.get("/{*path}", (_req, res, next) => {
    res.sendFile("index.html", { root: uiDist }, (error) => {
      if (error) next(error);
    });
  });
  app.use((error, _req, res, _next) => {
    if (error instanceof UsageRequestError) {
      return res.status(error.status).json({ error: error.message });
    }
    if (error?.type === "entity.too.large") {
      return res.status(413).json({ error: "Request too large." });
    }
    if (error?.type === "entity.parse.failed" || error instanceof URIError) {
      return res.status(400).json({ error: "Invalid request." });
    }
    res.status(503).json({ error: "Local usage data is unavailable." });
  });
  let closing;
  const close = () => {
    closing ??= Promise.resolve().then(() => service.close()).catch(() => {});
    return closing;
  };
  return { app, close };
}

export async function startServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Invalid dashboard port.");
  }
  const { app, close } = createApp(options);
  return new Promise((resolveStart, reject) => {
    const server = app.listen(port, "127.0.0.1");
    const closeServer = server.close.bind(server);
    server.close = (callback) => {
      const cleanup = close();
      closeServer((error) => { void cleanup.then(() => callback?.(error)); });
      return server;
    };
    server.once("error", async () => {
      await close();
      reject(new Error("Dashboard could not start. Check the port and local access."));
    });
    server.once("listening", () => {
      server.once("close", close);
      resolveStart(server);
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = await startServer();
    console.error(`Copilot Insights dashboard: http://127.0.0.1:${server.address().port}`);
    const stop = () => {
      server.close();
      server.closeIdleConnections();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch {
    console.error("Dashboard could not start. Check the port and local usage state.");
    process.exitCode = 1;
  }
}
