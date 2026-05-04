import Database from "better-sqlite3";
import { Buffer } from "node:buffer";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { scoreClarity } from "./clarity.mjs";
import { classifyMessage } from "./delegation.mjs";
import { log } from "./log.mjs";

const INTERACTIVE_SESSION_KEY = "memento/interactive-session";

function getAppDataPath() {
  return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
}

function getWorkspaceRoots() {
  const appData = getAppDataPath();
  return [
    { vscodeEdition: "stable", rootPath: join(appData, "Code", "User", "workspaceStorage") },
    { vscodeEdition: "insiders", rootPath: join(appData, "Code - Insiders", "User", "workspaceStorage") },
  ];
}

function normalizeValue(value) {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return null;
}

function openReadonlyDb(dbPath) {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function extractCopilotTurns(dbPath) {
  let db;

  try {
    db = openReadonlyDb(dbPath);
    const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(INTERACTIVE_SESSION_KEY);
    const raw = normalizeValue(row?.value);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.history?.copilot) ? parsed.history.copilot : [];
  } catch (err) {
    log.warn(`[vscode-sessions] Skipping ${dbPath}: ${err.message}`);
    return [];
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore close failures for locked or partially-opened DBs.
    }
  }
}

function normalizeTurn(entry, index, workspace) {
  return {
    source: "vscode",
    vscodeEdition: workspace.vscodeEdition,
    workspaceId: workspace.workspaceId,
    turnIndex: index,
    userMessage: typeof entry?.inputText === "string" ? entry.inputText : "",
    mode: entry?.mode?.id || "unknown",
    model: entry?.selectedModel?.metadata?.name || entry?.selectedModel?.identifier || "unknown",
    modelId: entry?.selectedModel?.identifier || "unknown",
    hasAttachments: (entry?.attachments?.length || 0) > 0,
  };
}

function buildSession(workspace, turns) {
  const models = [...new Set(turns.map((turn) => turn.model))];
  const modes = [...new Set(turns.map((turn) => turn.mode))];

  return {
    id: `vscode-${workspace.workspaceId}`,
    source: "vscode",
    host_type: "vscode",
    vscodeEdition: workspace.vscodeEdition,
    workspaceId: workspace.workspaceId,
    turns,
    turnCount: turns.length,
    models,
    modes,
    firstMessage: turns[0]?.userMessage || null,
    createdAt: null,
  };
}

export function discoverVSCodeWorkspaces() {
  const workspaces = [];

  for (const { vscodeEdition, rootPath } of getWorkspaceRoots()) {
    if (!existsSync(rootPath)) continue;

    let dirents;
    try {
      dirents = readdirSync(rootPath, { withFileTypes: true });
    } catch (err) {
      log.warn(`[vscode-sessions] Couldn't read ${rootPath}: ${err.message}`);
      continue;
    }

    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;
      const dbPath = join(rootPath, dirent.name, "state.vscdb");
      if (!existsSync(dbPath)) continue;
      workspaces.push({ workspaceId: dirent.name, dbPath, vscodeEdition });
    }
  }

  return workspaces.sort((a, b) => a.dbPath.localeCompare(b.dbPath));
}

export function readVSCodeSessions() {
  return discoverVSCodeWorkspaces()
    .map((workspace) => {
      const turns = extractCopilotTurns(workspace.dbPath).map((entry, index) => normalizeTurn(entry, index, workspace));
      return buildSession(workspace, turns);
    })
    .filter((session) => session.turnCount > 0);
}

export function analyzeVSCodeSession(session) {
  const specification = scoreClarity(session?.turns?.[0]?.userMessage || "");
  const delegationTurns = (session?.turns || []).map((turn) => ({
    turnIndex: turn.turnIndex,
    type: classifyMessage(turn.userMessage) || "unknown",
    userMessage: turn.userMessage,
  }));

  const delegation = {
    turns: delegationTurns,
    counts: delegationTurns.reduce((acc, turn) => {
      acc[turn.type] = (acc[turn.type] || 0) + 1;
      return acc;
    }, {}),
  };

  return {
    specification,
    delegation,
    judgment: null,
    efficiency: null,
    turnCount: session?.turnCount || 0,
    models: session?.models || [],
    modes: session?.modes || [],
  };
}

export function summarizeVSCodeSessions(sessions = readVSCodeSessions()) {
  const modelCounts = new Map();
  const modeCounts = new Map();
  const editions = { stable: 0, insiders: 0 };
  let totalTurns = 0;
  let sessionsWithAttachments = 0;

  for (const session of sessions) {
    totalTurns += session.turnCount;
    editions[session.vscodeEdition] = (editions[session.vscodeEdition] || 0) + 1;
    if (session.turns.some((turn) => turn.hasAttachments)) sessionsWithAttachments++;

    for (const turn of session.turns) {
      modelCounts.set(turn.model, (modelCounts.get(turn.model) || 0) + 1);
      modeCounts.set(turn.mode, (modeCounts.get(turn.mode) || 0) + 1);
    }
  }

  return {
    totalSessions: sessions.length,
    totalTurns,
    avgTurnsPerSession: sessions.length > 0 ? Math.round((totalTurns / sessions.length) * 10) / 10 : 0,
    sessionsWithAttachments,
    editions,
    models: [...modelCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    modes: [...modeCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}
