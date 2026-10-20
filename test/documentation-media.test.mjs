import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { GALLERY_IMAGES } from "../scripts/gallery-contract.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
function anchors(file) {
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  const result = new Set([...text.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
  const seen = new Map();
  for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = match[1].toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "").replace(/\s/g, "-");
    const count = seen.get(slug) || 0;
    seen.set(slug, count + 1);
    result.add(count ? `${slug}-${count}` : slug);
  }
  return result;
}
const markdownFiles = readdirSync(root).filter((name) => name.endsWith(".md")).map((name) => join(root, name));
for (const folder of ["docs", ".github"]) {
  for (const item of readdirSync(join(root, folder), { recursive: true, withFileTypes: true })) {
    if (item.isFile() && item.name.endsWith(".md")) markdownFiles.push(join(item.parentPath, item.name));
  }
}

test("published Markdown local links and media references resolve", () => {
  for (const file of markdownFiles) {
    const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
    const targets = [
      ...[...text.matchAll(/!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]),
      ...[...text.matchAll(/^\[[^\]\n]+\]:\s+(\S+)/gm)].map((match) => match[1]),
      ...[...text.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]),
    ];
    for (const target of targets) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
      const relative = decodeURIComponent(target.replace(/[?#].*$/, ""));
      const destination = relative ? resolve(dirname(file), relative) : file;
      assert.ok(existsSync(destination), `Missing local documentation target ${target} in ${file}`);
      const fragment = target.includes("#") ? decodeURIComponent(target.slice(target.indexOf("#") + 1)) : "";
      if (fragment && extname(destination) === ".md") assert.ok(anchors(destination).has(fragment), `Missing Markdown anchor ${target} in ${file}`);
    }
  }
});

test("published gallery contains only current allowlisted PNGs and retains no obsolete animation", () => {
  const folder = join(root, "docs", "screenshots");
  assert.deepEqual(readdirSync(folder).sort(), [...GALLERY_IMAGES].sort());
  for (const name of GALLERY_IMAGES) {
    const image = readFileSync(join(folder, name));
    assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `Not a PNG: ${name}`);
    assert.ok(image.readUInt32BE(16) >= 300 && image.readUInt32BE(20) >= 200, `Invalid gallery dimensions: ${name}`);
  }
});
