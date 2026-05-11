import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const SESSION_STATE_PATH =
  process.env.COPILOT_SESSION_STATE_PATH ||
  join(homedir(), ".copilot", "session-state");

export function getSessionStateDir(sessionId) {
  if (!sessionId) return null;
  const dir = join(SESSION_STATE_PATH, sessionId);
  return existsSync(dir) ? dir : null;
}

export function listSessionJsonlFiles(sessionId) {
  const sessionDir = getSessionStateDir(sessionId);
  if (!sessionDir) return [];

  try {
    const all = readdirSync(sessionDir);
    const wellKnown = ["events.jsonl", "turns.jsonl"];
    const preferred = wellKnown.filter((file) => all.includes(file));
    const rest = all.filter((file) => file.endsWith(".jsonl") && !preferred.includes(file));
    return [...preferred, ...rest].map((file) => join(sessionDir, file));
  } catch {
    return [];
  }
}

export function parseJsonlFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8");
    const results = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        results.push(JSON.parse(trimmed));
      } catch {
        // Skip malformed lines.
      }
    }
    return results;
  } catch {
    return [];
  }
}
