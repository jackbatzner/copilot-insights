import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import { assertCaptureSafe, captureRequestPolicy, GALLERY_IMAGES } from "../scripts/gallery-contract.mjs";
import { createGalleryFixture } from "../scripts/gallery-fixture.mjs";

test("gallery policy permits only isolated read-only metadata and blocks text, external requests and mutations", () => {
  const origins = new Set(["http://127.0.0.1:3456"]);
  const base = [...origins][0];
  for (const path of ["/", "/assets/ui.js", "/api/settings", "/api/summary?timeframe=30d", "/api/sessions", `/api/sessions/${"a".repeat(64)}`, "/api/comparison"]) {
    assert.equal(captureRequestPolicy(base + path, "GET", origins), "allow");
  }
  for (const section of ["turns", "tools"]) assert.equal(captureRequestPolicy(`${base}/api/sessions/${"a".repeat(64)}/${section}?page=1`, "GET", origins), "allow");
  for (const method of ["GET", "POST"]) assert.equal(captureRequestPolicy(`${base}/api/sessions/${"a".repeat(64)}/content`, method, origins), "content");
  assert.equal(captureRequestPolicy(base + "/api/refresh", "POST", origins), "mutation");
  assert.equal(captureRequestPolicy(base + "/api/instructions", "GET", origins), "unknown-api");
  assert.equal(captureRequestPolicy("http://localhost:3003/api/summary", "GET", origins), "external");
  assert.equal(captureRequestPolicy("https://example.com", "GET", origins), "external");
  assert.equal(captureRequestPolicy("file:///private", "GET", origins), "external");
  assert.equal(captureRequestPolicy("invalid", "GET", origins), "external");
  assert.throws(() => assertCaptureSafe("private-marker", ["private-marker"]), /privacy check failed/);
  assert.doesNotThrow(() => assertCaptureSafe('{"tokens":5}', ["private-marker"]));
  assert.equal(new Set(GALLERY_IMAGES).size, GALLERY_IMAGES.length);
  for (const name of ["turn-summary-desktop.png", "turn-summary-mobile.png", "turn-requests-desktop.png"]) {
    assert.ok(GALLERY_IMAGES.includes(name), `Missing turn exploration capture: ${name}`);
  }
});

test("gallery uses isolated synthetic tool linkage and a real later-session metadata insertion", () => {
  const fixture = createGalleryFixture();
  try {
    const db = new Database(fixture.dbPath, { readonly: true });
    try {
      assert.equal(db.prepare("SELECT count(*) AS count FROM sessions").get().count, 8);
      const id = fixture.addLaterSession();
      const row = db.prepare("SELECT model,input_tokens,output_tokens FROM assistant_usage_events WHERE session_id=?").get(id);
      assert.equal(row.model, "claude-haiku-4.5");
      assert.equal(row.input_tokens + row.output_tokens, 13500);
      assert.equal(db.prepare("SELECT count(*) AS count FROM sessions").get().count, 9);
    } finally { db.close(); }
  } finally { rmSync(fixture.directory, { recursive: true, force: true }); }
});
