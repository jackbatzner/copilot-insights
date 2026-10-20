import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatUsageSummary, formatUsageSession, formatUsageSessions, formatUsageModels } from "../src/formatter.mjs";
import { CANARY, RAW_ID, assertPrivate } from "./usage-fixture.mjs";

const capabilities = { sessionDb: "available", sessionState: "partial", diagnostics: [CANARY] };
const metrics = { requests: 0, inputTokens: 100, outputTokens: null, totalTokens: null, totalNanoAiu: null, localCredits: null };
const evidence = {
  requests: { source: "sessiondb", status: "recorded", recorded: 1, total: 1 },
  inputTokens: { source: "jsonl", status: "partial", recorded: 1, total: 2 },
};
const session = { handle: "a".repeat(64), label: "Session 1", hidden: false, models: ["gpt-5", CANARY], metrics, evidence, id: RAW_ID, summary: CANARY, repository: CANARY, branch: CANARY };

describe("privacy-safe CLI formatting", () => {
  it("preserves known zero, unavailable values, provenance, and partial coverage", () => {
    const output = formatUsageSummary({ sessionCount: 1, metrics, evidence, capabilities });
    assert.match(output, /\| Requests \| 0 \| recorded \(sessiondb\) \| 1 \/ 1 \|/);
    assert.match(output, /\| Input tokens \| 100 \| partial \(jsonl\) \| 1 \/ 2 \|/);
    assert.doesNotMatch(output, /\| Output tokens \|/);
    assert.doesNotMatch(output, /\| Local credits \|/);
    assert.match(output, /Local credits: Not recorded; no verified nano-AIU conversion/);
    assert.match(output, /recorded activity or creation/);
    assertPrivate(assert, output);
  });

  it("shows anonymous sessions and handles without arbitrary metadata", () => {
    const output = formatUsageSessions({ sessions: [session], capabilities });
    assert.match(output, /Session 1/);
    assert.ok(output.includes(session.handle));
    assert.match(output, /Unknown model/);
    assertPrivate(assert, output);
  });

  it("reports safe pagination, empty pages and unavailable metadata explicitly", () => {
    const empty = formatUsageSessions({ sessions: [], capabilities, pagination: { page: 1, pages: 1, total: 0 } });
    assert.match(empty, /\*\*Matching sessions:\*\* 0/);
    assert.match(empty, /No more matching sessions/);
    for (const pagination of [undefined, { page: CANARY, pages: 2, total: 26 }, { page: 0, pages: 1, total: 0 },
      { page: 2, pages: 1, total: 26 }, { page: 1, pages: Infinity, total: 26 }]) {
      const output = formatUsageSessions({ sessions: [], capabilities, pagination });
      assert.match(output, /Pagination metadata is unavailable/);
      assertPrivate(assert, output);
    }
  });

  it("renders recorded modern metrics with coverage without deriving charges", () => {
    const modern = {
      requestMultiplier: 1.5, outputTtftMs: 0, interTokenLatencyMs: null, contentFilteredRequests: 0,
    };
    const coverage = Object.fromEntries(Object.keys(modern).map((key) => [
      key, { source: "sessiondb", status: "partial", recorded: 1, total: 2 },
    ]));
    const output = formatUsageSummary({
      sessionCount: 1, metrics: { ...metrics, ...modern }, evidence: { ...evidence, ...coverage }, capabilities,
    });
    assert.match(output, /\| Mean recorded request multiplier \| 1.5 \| partial \(sessiondb\) \| 1 \/ 2 \|/);
    assert.match(output, /\| Mean output time to first token \(ms\) \| 0 \|/);
    assert.doesNotMatch(output, /\| Mean inter-token latency \(ms\) \|/);
    assert.match(output, /\| Content-filtered requests \| 0 \|/);
    assert.match(output, /Local credits: Not recorded/);
    assertPrivate(assert, output);
  });

  it("renders only whitelisted fields from session detail and models", () => {
    const detail = { session, capabilities, skills: [{ category: CANARY }], attribution: [{ scope: "subagent", label: CANARY, key: CANARY, metrics, evidence }] };
    assertPrivate(assert, formatUsageSession(detail));
    assertPrivate(assert, formatUsageModels({ models: [{ model: `gpt-5-${CANARY}`, sessionCount: 1, metrics, evidence }], capabilities }));
    assert.equal(formatUsageSession(null), "Session not found.");
  });

  it("rejects poisoned numeric, handle, label, source and evidence values", () => {
    const poisoned = { ...session, handle: RAW_ID, label: CANARY, metrics: { requests: CANARY }, evidence: { requests: { source: CANARY, status: CANARY, total: CANARY, recorded: CANARY } } };
    assertPrivate(assert, formatUsageSession({ session: poisoned, capabilities: { sessionDb: CANARY }, attribution: [] }));
  });
});
