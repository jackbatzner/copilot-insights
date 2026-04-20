// Tests for src/token-reader.mjs — JSONL token reader and BPE estimator.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set env override BEFORE importing the module so SESSION_STATE_PATH picks it up.
const TEST_STATE_DIR = join(tmpdir(), `ci-token-reader-test-${Date.now()}`);
process.env.COPILOT_SESSION_STATE_PATH = TEST_STATE_DIR;

let mod;

before(async () => {
  mkdirSync(TEST_STATE_DIR, { recursive: true });
  mod = await import("../src/token-reader.mjs");
});

after(() => {
  if (existsSync(TEST_STATE_DIR)) {
    rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  }
  delete process.env.COPILOT_SESSION_STATE_PATH;
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  it("returns 0 for empty input", () => {
    assert.equal(mod.estimateTokens(""), 0);
    assert.equal(mod.estimateTokens(null), 0);
    assert.equal(mod.estimateTokens(undefined), 0);
  });

  it("returns positive count for normal text", () => {
    const count = mod.estimateTokens("Hello world, how are you?");
    assert.ok(count > 0, `expected > 0, got ${count}`);
  });

  it("handles camelCase identifiers", () => {
    const count = mod.estimateTokens("getUserProfile");
    assert.ok(count >= 1, "camelCase should be >= 1 token");
  });

  it("handles snake_case identifiers", () => {
    const count = mod.estimateTokens("get_user_profile");
    assert.ok(count >= 1, "snake_case should be >= 1 token");
  });

  it("handles code snippets", () => {
    const code = `function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}`;
    const count = mod.estimateTokens(code);
    assert.ok(count > 10, `code should have many tokens, got ${count}`);
  });

  it("handles numbers", () => {
    const count = mod.estimateTokens("12345 67890");
    assert.ok(count >= 2, "two number groups should be >= 2 tokens");
  });

  it("handles punctuation", () => {
    const count = mod.estimateTokens("a + b = c;");
    assert.ok(count > 0);
  });

  it("scales with text length", () => {
    const short = mod.estimateTokens("hello");
    const long = mod.estimateTokens("hello ".repeat(100));
    assert.ok(long > short, "longer text should have more tokens");
  });
});

// ---------------------------------------------------------------------------
// estimateSessionTokens
// ---------------------------------------------------------------------------

describe("estimateSessionTokens", () => {
  it("returns empty result for null turns", () => {
    const result = mod.estimateSessionTokens(null);
    assert.equal(result.source, "estimated");
    assert.equal(result.turns.length, 0);
    assert.equal(result.totals.totalTokens, 0);
  });

  it("returns empty result for empty array", () => {
    const result = mod.estimateSessionTokens([]);
    assert.equal(result.turns.length, 0);
    assert.equal(result.totals.totalTokens, 0);
  });

  it("estimates tokens for conversation turns", () => {
    const turns = [
      { user_message: "Add a login form component", assistant_response: "Here is the login form component with email and password fields." },
      { user_message: "Now add validation", assistant_response: "Added form validation with error messages." },
    ];
    const result = mod.estimateSessionTokens(turns);
    assert.equal(result.source, "estimated");
    assert.equal(result.turns.length, 2);
    assert.ok(result.totals.totalTokens > 0);
    assert.ok(result.totals.promptTokens > 0);
    assert.ok(result.totals.completionTokens > 0);
    assert.equal(result.totals.totalTokens, result.totals.promptTokens + result.totals.completionTokens);
  });

  it("each turn has correct structure", () => {
    const turns = [{ user_message: "test", assistant_response: "ok" }];
    const result = mod.estimateSessionTokens(turns);
    const t = result.turns[0];
    assert.equal(t.turnIndex, 0);
    assert.equal(typeof t.promptTokens, "number");
    assert.equal(typeof t.completionTokens, "number");
    assert.equal(typeof t.totalTokens, "number");
    assert.equal(t.totalTokens, t.promptTokens + t.completionTokens);
    assert.equal(t.model, null);
  });
});

// ---------------------------------------------------------------------------
// readSessionTokens
// ---------------------------------------------------------------------------

describe("readSessionTokens", () => {
  it("returns null for null sessionId", () => {
    assert.equal(mod.readSessionTokens(null), null);
  });

  it("returns null for nonexistent session directory", () => {
    assert.equal(mod.readSessionTokens("nonexistent-session-id"), null);
  });

  it("returns null for session dir with no JSONL files", () => {
    const sid = "empty-session";
    const dir = join(TEST_STATE_DIR, sid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "notes.txt"), "not jsonl");
    assert.equal(mod.readSessionTokens(sid), null);
  });

  it("returns null for JSONL with no token fields", () => {
    const sid = "no-tokens";
    const dir = join(TEST_STATE_DIR, sid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "events.jsonl"), '{"type":"start","timestamp":"2025-01-01"}\n');
    assert.equal(mod.readSessionTokens(sid), null);
  });

  it("reads token data from JSONL files", () => {
    const sid = "has-tokens";
    const dir = join(TEST_STATE_DIR, sid);
    mkdirSync(dir, { recursive: true });
    const lines = [
      JSON.stringify({ prompt_tokens: 100, completion_tokens: 200, total_tokens: 300, model: "gpt-4o" }),
      JSON.stringify({ prompt_tokens: 150, completion_tokens: 250, total_tokens: 400 }),
    ].join("\n");
    writeFileSync(join(dir, "events.jsonl"), lines);

    const result = mod.readSessionTokens(sid);
    assert.ok(result);
    assert.equal(result.source, "jsonl");
    assert.equal(result.turns.length, 2);
    assert.equal(result.totals.totalTokens, 700);
    assert.equal(result.totals.promptTokens, 250);
    assert.equal(result.totals.completionTokens, 450);
    assert.equal(result.turns[0].model, "gpt-4o");
  });

  it("skips malformed JSONL lines", () => {
    const sid = "malformed";
    const dir = join(TEST_STATE_DIR, sid);
    mkdirSync(dir, { recursive: true });
    const lines = [
      "not json at all",
      JSON.stringify({ prompt_tokens: 50, completion_tokens: 50, total_tokens: 100 }),
      "{broken json",
    ].join("\n");
    writeFileSync(join(dir, "turns.jsonl"), lines);

    const result = mod.readSessionTokens(sid);
    assert.ok(result);
    assert.equal(result.turns.length, 1);
    assert.equal(result.totals.totalTokens, 100);
  });
});

// ---------------------------------------------------------------------------
// getTokenData
// ---------------------------------------------------------------------------

describe("getTokenData", () => {
  it("falls back to estimation when no JSONL data exists", () => {
    const turns = [
      { user_message: "hello", assistant_response: "world" },
    ];
    const result = mod.getTokenData("nonexistent-id", turns);
    assert.equal(result.source, "estimated");
    assert.ok(result.totals.totalTokens > 0);
  });

  it("prefers JSONL data when available", () => {
    const sid = "prefer-jsonl";
    const dir = join(TEST_STATE_DIR, sid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "events.jsonl"),
      JSON.stringify({ prompt_tokens: 500, completion_tokens: 500, total_tokens: 1000 }),
    );

    const turns = [{ user_message: "hi", assistant_response: "hello" }];
    const result = mod.getTokenData(sid, turns);
    assert.equal(result.source, "jsonl");
    assert.equal(result.totals.totalTokens, 1000);
  });
});
