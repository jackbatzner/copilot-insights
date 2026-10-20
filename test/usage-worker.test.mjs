import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { createUsageWorker } from "../server/usage-worker-client.mjs";
import { UsageRequestError } from "../server/usage-service.mjs";
import { createApp, startServer } from "../server/index.mjs";

const PRIVATE = "SYNTHETIC_PRIVATE_ERROR_PATH";
const ID = "11111111-2222-4333-8444-555555555555";
function fixture(t) {
  const root = join(process.cwd(), `.usage-worker-fixture-${randomUUID()}`);
  const options = { dbPath: join(root, "synthetic.db"), stateDir: join(root, "state"), sessionStatePath: join(root, "sessions") };
  mkdirSync(options.sessionStatePath, { recursive: true });
  const db = new Database(options.dbPath);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT);
    CREATE TABLE assistant_usage_events (
      session_id TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER,
      turn_index INTEGER, created_at TEXT
    );
    INSERT INTO sessions VALUES ('${ID}', '2026-09-23T10:00:00Z', '2026-09-23T10:00:00Z');
    INSERT INTO assistant_usage_events VALUES ('${ID}', 'gpt-5', 100, 20, 0, '2026-09-23T10:00:00Z');
  `);
  db.close();
  const resources = [];
  t.after(async () => {
    for (const close of resources.reverse()) await close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, options, cleanup: (close) => resources.push(close) };
}
class FakeWorker extends EventEmitter {
  messages = [];
  terminations = 0;
  ref() {}
  unref() {}
  postMessage(message) { this.messages.push(message); }
  terminate() {
    this.terminations++;
    this.emit("exit", 1);
    return Promise.resolve(1);
  }
  reply(result) {
    this.emit("message", { id: this.messages.at(-1).id, ok: true, result });
  }
}
function fakeService(t, options = {}) {
  const worker = new FakeWorker();
  const service = createUsageWorker({}, { createWorker: () => worker, shutdownTimeoutMs: 10, ...options });
  t.after(() => service.close());
  return { worker, service };
}
const unavailable = (error) => error instanceof UsageRequestError && error.status === 503
  && !error.message.includes(PRIVATE);
function closeServer(server) {
  return new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
}

test("worker serializes requests, bounds waiting work, and recovers capacity", async (t) => {
  const { worker, service } = fakeService(t, { maxQueue: 1 });
  const first = service.snapshot({ timeframe: "all" });
  const second = service.settings();
  await assert.rejects(service.refresh(), (error) => error.status === 503 && /busy/.test(error.message));
  assert.equal(worker.messages.length, 1);
  worker.reply({ first: true });
  assert.deepEqual(await first, { first: true });
  assert.equal(worker.messages.length, 2);
  worker.reply({ second: true });
  assert.deepEqual(await second, { second: true });
  const third = service.refresh();
  worker.reply(undefined);
  assert.equal(await third, undefined);
});

test("worker preserves validation errors but scrubs unknown errors", async (t) => {
  const { worker, service } = fakeService(t);
  const invalid = service.snapshot({});
  worker.emit("message", { id: worker.messages[0].id, ok: false,
    error: { kind: "request", message: "Session not found.", status: 404 } });
  await assert.rejects(invalid, (error) => error instanceof UsageRequestError && error.status === 404 && error.message === "Session not found.");
  const unknown = service.settings();
  worker.emit("message", { id: worker.messages[1].id, ok: false, error: { message: PRIVATE, stack: PRIVATE } });
  await assert.rejects(unknown, unavailable);
});

for (const fault of ["error", "exit", "fatal", "protocol"]) {
  test(`worker ${fault} settles active and queued callers without leaking errors`, async (t) => {
    const { worker, service } = fakeService(t);
    const active = service.snapshot({});
    const queued = service.settings();
    const settled = Promise.all([assert.rejects(active, unavailable), assert.rejects(queued, unavailable)]);
    if (fault === "error") worker.emit("error", new Error(PRIVATE));
    else if (fault === "exit") worker.emit("exit", 1);
    else if (fault === "fatal") worker.emit("message", { fatal: true });
    else if (fault === "protocol") worker.emit("message", { id: -1, ok: true, result: PRIVATE });
    await settled;
    await assert.rejects(service.sessions({}), unavailable);
    await service.close();
  });
}

test("a message serialization failure rejects callers and terminates the worker", async (t) => {
  const { worker, service } = fakeService(t);
  worker.postMessage = () => { throw new Error(PRIVATE); };
  await assert.rejects(service.snapshot({}), unavailable);
  await assert.rejects(service.settings(), unavailable);
  assert.equal(worker.terminations, 1);
});

for (const operation of ["process.exit(7)", `throw new Error("${PRIVATE}")`]) {
  test(`real worker failure settles callers: ${operation.startsWith("throw") ? "error" : "exit"}`, async (t) => {
    const service = createUsageWorker({}, {
      createWorker: () => new Worker(`require("node:worker_threads").parentPort.on("message", () => { ${operation}; });`, { eval: true }),
    });
    t.after(() => service.close());
    await Promise.all([
      assert.rejects(service.snapshot({}), unavailable),
      assert.rejects(service.settings(), unavailable),
    ]);
    await service.close();
  });
}

test("a saturated worker returns a safe HTTP 503 without displacing the active request", async (t) => {
  const { worker, service } = fakeService(t, { maxQueue: 0 });
  const server = await startServer({ service, port: 0 });
  t.after(() => closeServer(server));
  const base = `http://127.0.0.1:${server.address().port}`;
  const first = fetch(`${base}/api/summary`);
  for (let tries = 0; !worker.messages.length && tries < 200; tries++) await delay(10);
  assert.equal(worker.messages.length, 1);
  const busy = await fetch(`${base}/api/settings`);
  assert.equal(busy.status, 503);
  assert.deepEqual(await busy.json(), { error: "Local usage data is busy. Try again shortly." });
  worker.reply({ synthetic: true });
  assert.deepEqual(await (await first).json(), { synthetic: true });
});

test("shutdown rejects work, terminates an unresponsive worker, and is idempotent", async (t) => {
  const { worker, service } = fakeService(t);
  const pending = Promise.all([
    assert.rejects(service.snapshot({}), unavailable),
    assert.rejects(service.settings(), unavailable),
  ]);
  const closed = service.close();
  assert.equal(closed, service.close());
  await pending;
  await closed;
  assert.equal(worker.terminations, 1);
  await assert.rejects(service.settings(), unavailable);
});

test("worker transfers only known scalar configuration", async (t) => {
  const worker = new FakeWorker();
  let transferred;
  const service = createUsageWorker({ dbPath: "synthetic", stateDir: "isolated", sessionStatePath: "events",
    port: 9999, service: { secret: PRIVATE }, arbitrary: () => {} },
  { createWorker: (data) => { transferred = data; return worker; }, shutdownTimeoutMs: 10 });
  t.after(() => service.close());
  assert.deepEqual(transferred, { dbPath: "synthetic", stateDir: "isolated", sessionStatePath: "events" });
  assert.throws(() => createUsageWorker({ dbPath: {} }), /Invalid usage source configuration/);
});

test("real worker retains safe handles and mutations while refresh sees synthetic source changes", async (t) => {
  const { options, cleanup } = fixture(t);
  const service = createUsageWorker(options);
  cleanup(() => service.close());
  const initial = await service.sessions({ timeframe: "all" });
  const handle = initial.sessions[0].handle;
  assert.equal((await service.snapshot({ timeframe: "all" })).metrics.inputTokens, 100);
  await service.setHidden(handle, true);
  assert.equal((await service.sessions({ timeframe: "all" })).sessions.length, 0);
  await service.setHidden(handle, false);
  await service.updateSettings({ enableVSCode: true });
  assert.equal((await service.settings()).enableVSCode, true);
  const db = new Database(options.dbPath);
  db.prepare("INSERT INTO assistant_usage_events VALUES (?, ?, ?, ?, ?, ?)").run(ID, "gpt-5", 50, 5, 1, "2026-09-23T11:00:00Z");
  db.close();
  await service.refresh();
  assert.equal((await service.snapshot({ timeframe: "all" })).metrics.inputTokens, 150);
  assert.equal((await service.sessions({ timeframe: "all" })).sessions[0].handle, handle);
  await assert.rejects(service.snapshot({ timeframe: PRIVATE }), (error) => error.status === 400 && error.message === "Invalid timeframe.");
  writeFileSync(join(options.stateDir, "usage-state.json"), PRIVATE);
  await assert.rejects(service.settings(), unavailable);
  await service.close();
});

test("default HTTP service awaits the worker and forwards compact detail and paging queries", async (t) => {
  const { options, cleanup } = fixture(t);
  const server = await startServer({ ...options, port: 0 });
  cleanup(() => closeServer(server));
  const base = `http://127.0.0.1:${server.address().port}`;
  const catalog = await (await fetch(`${base}/api/sessions?timeframe=all`)).json();
  const handle = catalog.sessions[0].handle;
  for (const path of [`${handle}?view=summary`, `${handle}/turns?page=1`, `${handle}/tools`]) {
    const response = await fetch(`${base}/api/sessions/${path}`);
    assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes(ID));
  }
  assert.equal((await fetch(`${base}/api/sessions/${handle}?view=bad`)).status, 400);
  assert.equal((await fetch(`${base}/api/sessions/${handle}/turns?page=0`)).status, 400);
  assert.equal((await fetch(`${base}/api/sessions/${handle}/tools?bad=true`)).status, 400);
  assert.equal((await fetch(`${base}/api/summary?timeframe=bad`)).status, 400);
});

test("failed worker initialization leaves static assets available and API failures private", async (t) => {
  const { root, options, cleanup } = fixture(t);
  mkdirSync(options.stateDir);
  writeFileSync(join(options.stateDir, "usage-state.json"), PRIVATE);
  const uiDist = join(root, "ui");
  mkdirSync(uiDist);
  writeFileSync(join(uiDist, "index.html"), "<title>Synthetic static page</title>");
  const server = await startServer({ ...options, uiDist, port: 0 });
  cleanup(() => closeServer(server));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base)).status, 200);
  const response = await fetch(`${base}/api/settings`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Local usage data is unavailable." });
  assert.equal((await fetch(base)).status, 200);
});

test("worker content reveal stays explicit and fresh without entering usage responses or preferences", async (t) => {
  const { options, cleanup } = fixture(t);
  const db = new Database(options.dbPath);
  try {
    db.exec("CREATE TABLE turns (session_id TEXT, turn_index INTEGER, user_message TEXT, assistant_response TEXT)");
    db.prepare("INSERT INTO turns VALUES (?, 0, ?, ?)").run(ID, PRIVATE, "Synthetic answer");
  } finally { db.close(); }
  const server = await startServer({ ...options, port: 0 });
  cleanup(() => closeServer(server));
  const base = `http://127.0.0.1:${server.address().port}`;
  const catalog = await (await fetch(`${base}/api/sessions?timeframe=all`)).json();
  const handle = catalog.sessions[0].handle;
  const path = `${base}/api/sessions/${handle}/content`;
  assert.equal((await fetch(path)).status, 405);
  const reveal = () => fetch(path, { method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ consent: true, kind: "turn", turnIndex: 0 }) });
  assert.equal((await (await reveal()).json()).messages[0].text, PRIVATE);
  const update = new Database(options.dbPath);
  try { update.prepare("UPDATE turns SET user_message = ?").run(`${PRIVATE}_CHANGED`); }
  finally { update.close(); }
  assert.equal((await (await reveal()).json()).messages[0].text, `${PRIVATE}_CHANGED`);
  assert.ok(!(await (await fetch(`${base}/api/summary?timeframe=all`)).text()).includes(PRIVATE));
  assert.ok(!readFileSync(join(options.stateDir, "usage-state.json"), "utf8").includes(PRIVATE));
});

test("injected sync and async services remain caller objects and async failures are scrubbed", async (t) => {
  let closes = 0;
  const service = {
    snapshot: async () => ({ synthetic: true }),
    settings: () => ({ enableVSCode: false }),
    sessions: async () => { throw new Error(PRIVATE); },
    close: async () => { await delay(10); closes++; },
  };
  const server = await startServer({ service, port: 0 });
  t.after(() => closeServer(server));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(`${base}/api/summary`)).json(), { synthetic: true });
  assert.deepEqual(await (await fetch(`${base}/api/settings`)).json(), { enableVSCode: false });
  const response = await fetch(`${base}/api/sessions`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Local usage data is unavailable." });
  await closeServer(server);
  assert.equal(closes, 1);
});

test("static assets remain responsive while the worker is blocked; server close settles the request", async (t) => {
  const { root, cleanup } = fixture(t);
  const uiDist = join(root, "ui");
  mkdirSync(uiDist);
  writeFileSync(join(uiDist, "index.html"), "<title>Synthetic static page</title>");
  const signal = new SharedArrayBuffer(4);
  const service = createUsageWorker({}, {
    shutdownTimeoutMs: 30,
    createWorker: () => new Worker(`
      const { parentPort, workerData } = require("node:worker_threads");
      parentPort.on("message", () => {
        Atomics.store(new Int32Array(workerData), 0, 1);
        Atomics.wait(new Int32Array(workerData), 0, 1);
      });
    `, { eval: true, workerData: signal }),
  });
  const server = await startServer({ service, uiDist, port: 0 });
  cleanup(() => closeServer(server));
  const base = `http://127.0.0.1:${server.address().port}`;
  const pending = fetch(`${base}/api/summary`).catch(() => null);
  for (let tries = 0; Atomics.load(new Int32Array(signal), 0) !== 1 && tries < 200; tries++) await delay(10);
  assert.equal(Atomics.load(new Int32Array(signal), 0), 1);
  const page = await fetch(base, { signal: AbortSignal.timeout(1500) });
  assert.equal(await page.text(), readFileSync(join(uiDist, "index.html"), "utf8"));
  await new Promise((resolve) => server.close(resolve));
  const response = await pending;
  assert.equal(response.status, 503);
  await service.close();
});

test("worker rejects prototype/private methods and closes cleanly", async (t) => {
  const { options, cleanup } = fixture(t);
  const worker = new Worker(new URL("../server/usage-worker.mjs", import.meta.url), { workerData: options });
  cleanup(() => worker.terminate());
  for (const method of ["constructor", "toString", "close", PRIVATE]) {
    const reply = once(worker, "message");
    worker.postMessage({ id: 1, method, args: [] });
    const [message] = await reply;
    assert.deepEqual(message, { id: 1, ok: false, error: { kind: "request", status: 400, message: "Invalid request." } });
  }
  const exited = once(worker, "exit");
  worker.postMessage({ close: true });
  assert.deepEqual(await exited, [0]);
});

test("createApp close works without a listening server", async (t) => {
  const { options } = fixture(t);
  const { close } = createApp(options);
  assert.equal(close(), close());
  await close();
});

test("default server close callback permits immediate Windows fixture removal after opening the source", async (t) => {
  const { root, options, cleanup } = fixture(t);
  const server = await startServer({ ...options, port: 0 });
  cleanup(() => closeServer(server));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/summary?timeframe=all`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).metrics.inputTokens, 100);
  await new Promise((resolve, reject) => {
    server.close((error) => {
      try {
        assert.ifError(error);
        rmSync(root, { recursive: true, force: true });
        assert.equal(existsSync(root), false);
        resolve();
      } catch (failure) { reject(failure); }
    });
    server.closeAllConnections();
  });
});
