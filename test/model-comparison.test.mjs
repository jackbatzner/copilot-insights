import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareUsage } from "../src/model-comparison.mjs";
import { combineBasis, costDifference, estimateCost, exactUsd } from "../ui/src/model-comparison.js";
import { compactNumber } from "../ui/src/number-format.js";
import { PRICING_CATALOG } from "../ui/src/pricing-catalog.js";
import { createUsageService } from "../server/usage-service.mjs";
import { startServer } from "../server/index.mjs";
import { createUsageFixture, assertPrivate } from "./usage-fixture.mjs";

const record = (overrides = {}) => ({
  model: "gpt-5-mini", source: "sessiondb", requests: 1, inputTokens: 1000, outputTokens: 200,
  totalTokens: 1200, cacheReadTokens: 400, cacheWriteTokens: 0, finishReason: "stop", ...overrides,
});
const rate = { input: 2, output: 8, cacheRead: 0.5 };

describe("model comparison accounting", () => {
  it("matches the documented dated rate-card arithmetic without inferred model aliases", () => {
    const basis = { included: 1, total: 1, inputTokens: 1_000_000, outputTokens: 250_000, cacheReadTokens: 500_000 };
    const expected = [4.25, 0.7625, 6.375, 6.9, 2.3];
    assert.equal(PRICING_CATALOG.currency, "USD");
    assert.equal(PRICING_CATALOG.tokensPerUnit, 1_000_000);
    assert.match(PRICING_CATALOG.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Set(PRICING_CATALOG.models.map((row) => row.model)).size, 5);
    PRICING_CATALOG.models.forEach((price, index) => {
      assert.ok(Math.abs(estimateCost(basis, price).usd - expected[index]) < 1e-12);
      assert.ok(["developers.openai.com", "platform.claude.com"].includes(new URL(price.source).hostname));
      assert.equal(price.cacheWrite, undefined);
    });
    assert.equal(PRICING_CATALOG.models.find((price) => price.model === "gpt-5.6-sol"), undefined);
  });

  it("uses input/output independently of opaque AIU, cost and multiplier telemetry", () => {
    const comparison = compareUsage([record({ totalNanoAiu: 1e15, requestCost: 123, requestMultiplier: 100 })], 1);
    const basis = comparison.models[0].pricingBasis;
    assert.equal(estimateCost(basis.uncached, rate).usd, 0.0036);
    assert.equal(estimateCost(basis["cache-included"], rate).usd, 0.003);
    assert.equal(estimateCost(basis["cache-excluded"], rate).usd, 0.0038);
    assert.equal(basis.uncached.cacheReadTokens, 0);
    assert.equal(comparison.models[0].metrics.localCredits, null);
  });

  it("excludes incomplete observations rather than silently pricing unrelated partial totals", () => {
    const rows = [record(), record({ inputTokens: null }), record({ outputTokens: null })];
    const model = compareUsage(rows, 1).models[0];
    const value = estimateCost(model.pricingBasis.uncached, rate);
    assert.equal(value.usd, 0.0036);
    assert.equal(value.partial, true);
    assert.deepEqual(value.coverage, { included: 1, total: 3 });
    assert.equal(model.pricingBasis.uncached.excluded.missingTokens, 2);
  });

  it("checks cache consistency per observation and excludes unknown TTL writes and missing cache fields", () => {
    const rows = [
      record({ inputTokens: 10, cacheReadTokens: 100 }),
      record({ inputTokens: 1000, cacheReadTokens: 0 }),
      record({ cacheReadTokens: null }), record({ cacheWriteTokens: null }), record({ cacheWriteTokens: 20 }),
    ];
    const model = compareUsage(rows, 1).models[0];
    const included = model.pricingBasis["cache-included"];
    assert.equal(included.included, 1, "aggregate input must not mask an inconsistent individual observation");
    assert.deepEqual(included.excluded, { missingTokens: 0, missingCache: 2, cacheWrites: 1, inconsistentCache: 1 });
    assert.equal(model.pricingBasis["cache-excluded"].included, 2);
    assert.equal(model.pricingBasis.uncached.included, 5);
  });

  it("keeps zero distinct from unpriced, missing and overflowing values", () => {
    const basis = compareUsage([record({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })], 1).models[0].pricingBasis.uncached;
    assert.equal(estimateCost(basis, rate).usd, 0);
    assert.equal(estimateCost(basis, null).usd, null);
    assert.equal(estimateCost({ ...basis, included: 0 }, rate).usd, null);
    assert.equal(estimateCost({ ...basis, inputTokens: Infinity }, rate).usd, null);
    assert.equal(estimateCost({ ...basis, inputTokens: Number.MAX_VALUE }, { ...rate, input: Number.MAX_VALUE }).usd, null);
    assert.equal(estimateCost({ ...basis, cacheReadTokens: 1 }, { ...rate, cacheRead: null }).usd, null);
    assert.deepEqual(costDifference(2, 0), { usd: 2, percent: null });
    assert.deepEqual(costDifference(0, 0), { usd: 0, percent: null });
    assert.deepEqual(costDifference(2, 4), { usd: -2, percent: -50 });
    assert.equal(costDifference(2, null), null);
  });

  it("uses the same eligible workload for all candidate models, including unpriced observed models", () => {
    const models = compareUsage([record(), record({ model: "Unknown model" }), record({ inputTokens: null })], 2).models;
    const basis = combineBasis(models, "uncached");
    assert.equal(basis.included, 2);
    assert.equal(basis.total, 3);
    assert.equal(estimateCost(basis, rate).usd, 0.0072);
    assert.equal(estimateCost(basis, { input: 1, output: 4, cacheRead: 0.25 }).usd, 0.0036);
  });

  it("labels model-call outcomes separately from aggregated requests and task quality", () => {
    const rows = [record(), record({ finishReason: "error" }), record({ finishReason: "cancelled" }),
      record({ finishReason: null }), record({ contentFiltered: true }),
      record({ source: "jsonl-shutdown", requests: 100 }), record({ source: "jsonl", requests: null })];
    const model = compareUsage(rows, 1).models[0];
    assert.deepEqual(model.outcomes, { completed: 1, failed: 2, cancelled: 1, unknown: 1, requests: 5, source: "sessiondb" });
    assert.equal(model.pricingBasis.uncached.total, 7);
  });

  it("does not display a positive sub-cent estimate as zero and retains precise disclosure", () => {
    assert.equal(compactNumber(0.00000025, "estimatedUsd"), "<$0.01");
    assert.equal(exactUsd(0.00000025), "$0.00000025");
    assert.equal(compactNumber(0, "estimatedUsd"), "$0.00");
    assert.equal(exactUsd(null), "Unavailable");
  });
});

describe("model comparison selection and privacy", () => {
  it("shares the unfiltered summary projection, respects same-record scope/model filters and hidden sessions", () => {
    const fixture = createUsageFixture(), service = createUsageService(fixture.options);
    try {
      const snapshot = service.snapshot({ timeframe: "all" });
      const comparison = service.comparison({ timeframe: "all" });
      assert.deepEqual(comparison.models, snapshot.comparison.models);
      assert.equal(comparison.sessionCount, 2);
      const session = snapshot.sessions.find((row) => row.models.includes("gpt-5"));
      const child = service.comparison({ timeframe: "all", session: session.handle, scope: "subagent" });
      assert.equal(child.models.length, 1);
      assert.equal(child.models[0].model, "claude-sonnet-4.5");
      assert.equal(child.models[0].metrics.totalTokens, 70);
      assert.equal(service.comparison({ timeframe: "all", session: session.handle, scope: "subagent", model: "gpt-5" }).sessionCount, 0);
      service.setHidden(session.handle, true);
      assert.equal(service.comparison({ timeframe: "all" }).sessionCount, 1);
      assert.equal(service.comparison({ timeframe: "all", includeHidden: "true" }).sessionCount, 2);
      assert.equal(service.comparison({ timeframe: "all", source: "vscode" }).models.length, 0);
      assertPrivate(assert, comparison);
      assertPrivate(assert, child);
      assert.equal(JSON.stringify(comparison).includes("parentToolCallId"), false);
    } finally { service.close(); fixture.cleanup(); }
  });

  it("validates the new API and exposes no content or raw IDs on any selection", async () => {
    const fixture = createUsageFixture();
    const server = await startServer({ ...fixture.options, port: 0 });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const query of ["timeframe=all", "timeframe=all&model=gpt-5", "timeframe=all&scope=subagent"]) {
        const response = await fetch(`${base}/api/comparison?${query}`);
        assert.equal(response.status, 200);
        assertPrivate(assert, await response.json());
      }
      for (const query of ["raw=true", "source=private", "session=invalid", "model=not-allowed", "scope=team", "day=bad", "model=gpt-5&model=gpt-4.1"]) {
        assert.equal((await fetch(`${base}/api/comparison?${query}`)).status, 400);
      }
      assert.equal((await fetch(`${base}/api/comparison?session=${"a".repeat(64)}`)).status, 404);
    } finally {
      await new Promise((done) => { server.close(done); server.closeAllConnections(); });
      fixture.cleanup();
    }
  });
});
