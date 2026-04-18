#!/usr/bin/env node

// Release script — bumps version, updates CHANGELOG, commits, tags, and pushes.
//
// Usage:
//   node scripts/release.mjs patch    # 0.1.0 → 0.1.1
//   node scripts/release.mjs minor    # 0.1.0 → 0.2.0
//   node scripts/release.mjs major    # 0.1.0 → 1.0.0
//   node scripts/release.mjs 0.2.0-beta.1  # explicit version
//
// Flags:
//   --dry-run   Show what would happen without making changes

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");
const bump = process.argv.find((a) => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]);

if (!bump) {
  console.error("Usage: node scripts/release.mjs <patch|minor|major|x.y.z> [--dry-run]");
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  if (DRY_RUN && !opts.readOnly) return "";
  return execSync(cmd, { cwd: ROOT, encoding: "utf-8", stdio: opts.stdio ?? "pipe" }).trim();
}

// Ensure clean working tree
const status = run("git status --porcelain", { readOnly: true });
if (status) {
  console.error("❌ Working tree is not clean. Commit or stash changes first.\n");
  console.error(status);
  process.exit(1);
}

// Ensure on main branch
const branch = run("git rev-parse --abbrev-ref HEAD", { readOnly: true });
if (branch !== "main") {
  console.error(`❌ Releases must be made from 'main' (currently on '${branch}').`);
  process.exit(1);
}

// Calculate new version
const pkgPath = resolve(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const currentVersion = pkg.version;

function bumpVersion(current, type) {
  if (!["patch", "minor", "major"].includes(type)) return type; // explicit version
  const parts = current.replace(/-.*$/, "").split(".").map(Number);
  if (type === "major") return `${parts[0] + 1}.0.0`;
  if (type === "minor") return `${parts[0]}.${parts[1] + 1}.0`;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

const newVersion = bumpVersion(currentVersion, bump);
const tag = `v${newVersion}`;

console.log(`\n📦 Release: ${currentVersion} → ${newVersion}\n`);

// Update package.json
console.log("1. Updating package.json...");
pkg.version = newVersion;
if (!DRY_RUN) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// Update ui/package.json
const uiPkgPath = resolve(ROOT, "ui", "package.json");
const uiPkg = JSON.parse(readFileSync(uiPkgPath, "utf-8"));
uiPkg.version = newVersion;
console.log("2. Updating ui/package.json...");
if (!DRY_RUN) writeFileSync(uiPkgPath, JSON.stringify(uiPkg, null, 2) + "\n");

// Update CHANGELOG.md
console.log("3. Updating CHANGELOG.md...");
const changelogPath = resolve(ROOT, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf-8");
const today = new Date().toISOString().split("T")[0];
const newEntry = `## [${newVersion}] - ${today}\n\n_See [GitHub Release](https://github.com/jackbatzner/copilot-insights/releases/tag/${tag}) for full release notes._\n`;

const updatedChangelog = changelog.replace(
  /^(# Changelog\n.*?\n)/ms,
  `$1\n${newEntry}\n`
);
if (!DRY_RUN) writeFileSync(changelogPath, updatedChangelog);

// Commit, tag, push
console.log("4. Committing...");
run("git add package.json ui/package.json CHANGELOG.md");
run(`git commit -m "release: ${tag}"`);

console.log(`5. Tagging ${tag}...`);
run(`git tag -a ${tag} -m "Release ${newVersion}"`);

console.log("6. Pushing...");
run("git push origin main --follow-tags");

console.log(`\n✅ Released ${tag}!`);
console.log(`   GitHub Actions will create the release at:`);
console.log(`   https://github.com/jackbatzner/copilot-insights/releases/tag/${tag}\n`);
