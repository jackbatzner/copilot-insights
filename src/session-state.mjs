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

/**
 * Scan a JSONL file line-by-line and only parse lines that match a cheap text predicate.
 * Useful for hot paths that only need a small subset of events.
 *
 * @param {string} filePath
 * @param {(line: string) => boolean} [shouldParseLine]
 * @param {(obj: any) => void} onObject
 */
export function scanJsonlFile(filePath, shouldParseLine, onObject) {
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (shouldParseLine && !shouldParseLine(trimmed)) continue;
      try {
        onObject(JSON.parse(trimmed));
      } catch {
        // Skip malformed lines.
      }
    }
  } catch {
    // Ignore unreadable files.
  }
}
