// Shared helpers for linking/unlinking the Copilot CLI extension.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The directory Copilot CLI scans for extensions. */
export const EXTENSIONS_DIR = path.join(
  os.homedir(),
  ".copilot",
  "extensions",
  "copilot-insights",
);

export function getExtensionSourcePath(packageRoot) {
  return path.join(path.resolve(packageRoot), ".github", "extensions", "copilot-insights");
}

/**
 * Create a symlink from the user extensions directory to the packaged extension folder.
 * On Windows uses a junction; on Unix uses a directory symlink.
 * Returns { linked: boolean, message: string }.
 */
export function linkExtension(packageRoot) {
  const target = getExtensionSourcePath(packageRoot);
  const link = EXTENSIONS_DIR;

  if (fs.existsSync(link)) {
    try {
      const existing = fs.readlinkSync(link);
      if (path.resolve(existing) === target) {
        return { linked: false, message: "Already linked." };
      }
    } catch {
      // Not a symlink — remove it so we can recreate
    }
    fs.rmSync(link, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(link), { recursive: true });
  const type = process.platform === "win32" ? "junction" : "dir";
  fs.symlinkSync(target, link, type);
  return { linked: true, message: `Linked ${link} → ${target}` };
}

/**
 * Remove the extension symlink.
 * Returns { unlinked: boolean, message: string }.
 */
export function unlinkExtension() {
  const link = EXTENSIONS_DIR;

  if (!fs.existsSync(link)) {
    return { unlinked: false, message: "No symlink found — nothing to remove." };
  }

  fs.rmSync(link, { recursive: true, force: true });
  return { unlinked: true, message: `Removed ${link}` };
}
