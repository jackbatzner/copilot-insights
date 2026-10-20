import {
  closeSync, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync,
  readSync, renameSync, statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { usageSessionHandle } from "../src/runtime-telemetry.mjs";

export const MAX_HIDDEN = 5000;
export const HANDLE_RE = /^[a-f0-9]{64}$/;
const MAX_STATE_BYTES = 400_000;
const MAX_LEGACY_HIDDEN_BYTES = 256_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readLegacyJson(file, limit) {
  let descriptor;
  let located = false;
  try {
    const stat = lstatSync(file);
    located = true;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error();
    descriptor = openSync(file, "r");
    if (!fstatSync(descriptor).isFile()) throw new Error();
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > limit) throw new Error();
    return JSON.parse(buffer.toString("utf8", 0, length));
  } catch (error) {
    if (error.code === "ENOENT" && !located) return undefined;
    throw new Error("Legacy usage preferences could not be migrated.", { cause: error });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validate(state) {
  if (state?.version !== 1 || Object.keys(state).some((key) => !["version", "secret", "enableVSCode", "hiddenHandles", "legacyMigrated"].includes(key))
      || typeof state.secret !== "string" || !/^[a-f0-9]{64}$/.test(state.secret)
      || (state.legacyMigrated !== undefined && state.legacyMigrated !== true)
      || typeof state.enableVSCode !== "boolean" || !Array.isArray(state.hiddenHandles)
      || state.hiddenHandles.length > MAX_HIDDEN
      || state.hiddenHandles.some((handle) => typeof handle !== "string" || !HANDLE_RE.test(handle))) {
    throw new Error("Local usage settings are invalid.");
  }
  return state;
}

export function createLocalState(options = {}) {
  const isolatedDirectory = options.stateDir || process.env.COPILOT_INSIGHTS_STATE_DIR;
  const directory = isolatedDirectory
    || join(homedir(), ".copilot", "copilot-insights");
  const file = join(directory, "usage-state.json");
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  function legacy(secret) {
    const hidden = readLegacyJson(join(dirname(directory), "copilot-insights-hidden.json"), MAX_LEGACY_HIDDEN_BYTES);
    const settingsFile = (!isolatedDirectory && process.env.COPILOT_INSIGHTS_SETTINGS_FILE)
      || join(dirname(directory), "copilot-insights-settings.json");
    const settings = readLegacyJson(settingsFile, 4096);
    if (hidden !== undefined && (!Array.isArray(hidden) || hidden.length > MAX_HIDDEN
        || hidden.some((id) => typeof id !== "string" || !UUID_RE.test(id)))) {
      throw new Error("Legacy usage preferences could not be migrated.");
    }
    if (settings !== undefined && (!settings || typeof settings !== "object" || Array.isArray(settings)
        || Object.keys(settings).some((key) => key !== "vscodeSessionsEnabled")
        || (settings.vscodeSessionsEnabled !== undefined && typeof settings.vscodeSessionsEnabled !== "boolean"))) {
      throw new Error("Legacy usage preferences could not be migrated.");
    }
    return {
      handles: [...new Set(hidden ?? [])].map((id) => usageSessionHandle(id, secret)),
      enableVSCode: settings?.vscodeSessionsEnabled ?? false,
    };
  }

  function read() {
    if (statSync(file).size > MAX_STATE_BYTES) throw new Error("Local usage settings are too large.");
    return validate(JSON.parse(readFileSync(file, "utf8")));
  }

  function atomicWrite(state, create = false) {
    validate(state);
    const temporary = join(directory, `.usage-${process.pid}-${randomBytes(12).toString("hex")}.tmp`);
    try {
      writeFileSync(temporary, JSON.stringify(state), { flag: "wx", mode: 0o600 });
      if (create) {
        try { linkSync(temporary, file); } catch (error) {
          if (error.code !== "EEXIST") throw error;
        }
      } else {
        renameSync(temporary, file);
      }
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  if (!existsSync(file)) {
    const secret = randomBytes(32).toString("hex");
    const previous = legacy(secret);
    atomicWrite({
      version: 1, secret, enableVSCode: previous.enableVSCode,
      hiddenHandles: previous.handles, legacyMigrated: true,
    }, true);
  }
  const state = {
    read,
    update(change) {
      const lock = join(directory, "usage-state.lock");
      // A concurrent writer is an explicit retryable failure, not a lost preference update.
      const descriptor = openSync(lock, "wx", 0o600);
      try {
        const next = change(read());
        atomicWrite(next);
        return next;
      } finally {
        closeSync(descriptor);
        unlinkSync(lock);
      }
    },
  };
  if (read().legacyMigrated !== true) {
    state.update((current) => {
      if (current.legacyMigrated === true) return current;
      const previous = legacy(current.secret);
      const hiddenHandles = [...new Set([...current.hiddenHandles, ...previous.handles])];
      if (hiddenHandles.length > MAX_HIDDEN) throw new Error("Legacy usage preferences could not be migrated.");
      // Existing new-format settings are explicit choices and take precedence.
      return { ...current, hiddenHandles, legacyMigrated: true };
    });
  }
  return state;
}
