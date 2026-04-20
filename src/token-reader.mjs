// Token reader — reads real token usage from JSONL session-state files,
// with a fallback byte-pair-encoding–style estimator for accurate counting.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Base path for Copilot CLI session-state directories.
 * Override with the `COPILOT_SESSION_STATE_PATH` env var for testing.
 * @type {string}
 */
export const SESSION_STATE_PATH =
  process.env.COPILOT_SESSION_STATE_PATH ||
  join(homedir(), ".copilot", "session-state");

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a JSONL file and return all successfully-parsed objects.
 * Malformed lines are silently skipped.
 * @param {string} filePath
 * @returns {object[]}
 */
function parseJsonlFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8");
    const results = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        results.push(JSON.parse(trimmed));
      } catch {
        // skip malformed lines
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Return true when `obj` carries any token-usage field.
 * @param {object} obj
 * @returns {boolean}
 */
function hasTokenFields(obj) {
  return (
    typeof obj.prompt_tokens === "number" ||
    typeof obj.completion_tokens === "number" ||
    typeof obj.total_tokens === "number"
  );
}

/**
 * Build a single turn record from a raw JSONL object.
 * @param {object} obj
 * @param {number} index
 * @returns {object}
 */
function turnFromObject(obj, index) {
  const promptTokens = obj.prompt_tokens ?? 0;
  const completionTokens = obj.completion_tokens ?? 0;
  const totalTokens =
    obj.total_tokens ?? promptTokens + completionTokens;

  return {
    turnIndex: obj.turn_index ?? obj.turnIndex ?? index,
    promptTokens,
    completionTokens,
    totalTokens,
    model: obj.model ?? null,
    thinkingTokens: obj.thinking_tokens ?? null,
    toolCalls: obj.tool_calls != null ? Number(obj.tool_calls) : null,
  };
}

/**
 * Aggregate totals from an array of turn records.
 * @param {object[]} turns
 * @returns {{ promptTokens: number, completionTokens: number, totalTokens: number, thinkingTokens: number }}
 */
function computeTotals(turns) {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let thinkingTokens = 0;
  for (const t of turns) {
    promptTokens += t.promptTokens;
    completionTokens += t.completionTokens;
    totalTokens += t.totalTokens;
    thinkingTokens += t.thinkingTokens ?? 0;
  }
  return { promptTokens, completionTokens, totalTokens, thinkingTokens };
}

// ---------------------------------------------------------------------------
// Core public API
// ---------------------------------------------------------------------------

/**
 * Read real token-usage data from JSONL session-state files for a given
 * session ID.
 *
 * Looks inside `SESSION_STATE_PATH/<sessionId>/` for any `.jsonl` files
 * (including `events.jsonl`, `turns.jsonl`, and similar event log files),
 * parses every line, and collects entries that carry token-usage fields
 * (`prompt_tokens`, `completion_tokens`, `total_tokens`, etc.).
 *
 * @param {string} sessionId — The session ID whose token data to read.
 * @returns {{ source: "jsonl", turns: object[], totals: object } | null}
 *   Token data extracted from the JSONL files, or `null` when no usable
 *   data was found (missing directory, no JSONL files, or no token fields).
 */
export function readSessionTokens(sessionId) {
  if (!sessionId) return null;

  const sessionDir = join(SESSION_STATE_PATH, sessionId);
  if (!existsSync(sessionDir)) return null;

  // Prioritise well-known filenames, then fall back to any .jsonl
  let jsonlFiles;
  try {
    const all = readdirSync(sessionDir);
    const wellKnown = ["events.jsonl", "turns.jsonl"];
    const preferred = wellKnown.filter((f) => all.includes(f));
    const rest = all.filter(
      (f) => f.endsWith(".jsonl") && !preferred.includes(f)
    );
    jsonlFiles = [...preferred, ...rest];
  } catch {
    return null;
  }

  if (jsonlFiles.length === 0) return null;

  // Collect token-bearing objects across all files
  const tokenObjects = [];
  for (const file of jsonlFiles) {
    const objects = parseJsonlFile(join(sessionDir, file));
    for (const obj of objects) {
      if (hasTokenFields(obj)) {
        tokenObjects.push(obj);
      }
    }
  }

  if (tokenObjects.length === 0) return null;

  const turns = tokenObjects.map((obj, i) => turnFromObject(obj, i));
  return {
    source: "jsonl",
    turns,
    totals: computeTotals(turns),
  };
}

/**
 * Estimate the number of tokens a piece of text would consume under a
 * cl100k_base-compatible tokeniser (used by GPT-4 / Claude families).
 *
 * The heuristic splits text into word-like units and applies empirical
 * multipliers:
 * - English/identifier words ≈ 1.3 tokens on average
 * - camelCase / snake_case identifiers split into sub-word pieces ≈ 0.8
 *   tokens per part
 * - Digit groups (numbers) ≈ 1 token per group, plus 1 per extra 3 digits
 * - Individual punctuation / operators ≈ 1 token each
 *
 * Targets ≈ 90-95 % accuracy vs. the real tiktoken tokeniser for mixed
 * English prose and source code.
 *
 * @param {string} text — The input text to estimate.
 * @returns {number} Estimated token count (always ≥ 0).
 */
export function estimateTokens(text) {
  if (!text) return 0;

  // Match word-like units, digit groups, or individual punctuation/operators.
  const units =
    text.match(/[a-zA-Z_]\w*|[0-9]+(?:\.[0-9]+)?|[^\s\w]/g) || [];

  let tokens = 0;

  for (const unit of units) {
    if (/^[a-zA-Z_]\w*$/.test(unit)) {
      // Identifier / word — split on camelCase boundaries and underscores
      const parts = unit
        .split(/(?=[A-Z])|_/)
        .filter(Boolean);

      if (parts.length > 1) {
        // Multi-part identifiers: each sub-word ≈ 0.8 tokens (BPE merges
        // common prefixes), but very short parts (1-2 chars) are cheaper.
        let subTokens = 0;
        for (const p of parts) {
          subTokens += p.length <= 2 ? 0.5 : 0.8;
        }
        // At least 1 token for the whole unit
        tokens += Math.max(subTokens, 1);
      } else {
        // Single word: common words up to ~5 chars are nearly always a
        // single BPE token; longer words increasingly split.
        const len = unit.length;
        if (len <= 5) {
          tokens += 1;
        } else if (len <= 9) {
          tokens += 1.4;
        } else {
          tokens += Math.ceil(len / 3.5);
        }
      }
    } else if (/^[0-9]/.test(unit)) {
      // Number: each group of up to 3 digits is roughly 1 token
      const digits = unit.replace(/\D/g, "");
      tokens += Math.max(1, Math.ceil(digits.length / 3));
    } else {
      // Punctuation / operator / special character — 1 token each
      tokens += 1;
    }
  }

  return Math.ceil(tokens);
}

/**
 * Estimate token usage for an array of conversation turns retrieved from
 * the session store (e.g. via `db.mjs`'s `getSessionTurns`).
 *
 * Each input turn should have the shape:
 * ```
 * { user_message: string, assistant_response: string }
 * ```
 *
 * @param {Array<{ user_message: string, assistant_response: string }>} turns
 * @returns {{ source: "estimated", turns: object[], totals: object }}
 */
export function estimateSessionTokens(turns) {
  if (!turns || turns.length === 0) {
    return {
      source: "estimated",
      turns: [],
      totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, thinkingTokens: 0 },
    };
  }

  const mapped = turns.map((t, i) => {
    const promptTokens = estimateTokens(t.user_message);
    const completionTokens = estimateTokens(t.assistant_response);
    return {
      turnIndex: i,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      model: null,
      thinkingTokens: null,
      toolCalls: null,
    };
  });

  return {
    source: "estimated",
    turns: mapped,
    totals: computeTotals(mapped),
  };
}

/**
 * Convenience helper — try to read real JSONL token data for a session; if
 * none is found, fall back to estimation from conversation turns.
 *
 * @param {string} sessionId — Session ID to look up.
 * @param {Array<{ user_message: string, assistant_response: string }>} turns
 *   Conversation turns to use for estimation when real data is unavailable.
 * @returns {{ source: "jsonl" | "estimated", turns: object[], totals: object }}
 */
export function getTokenData(sessionId, turns) {
  const real = readSessionTokens(sessionId);
  if (real && real.source === "jsonl") return real;
  return estimateSessionTokens(turns);
}
