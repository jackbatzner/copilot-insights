import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COPILOT_MODEL_CATALOG, copilotModel, selectableCopilotModels } from "../src/copilot-model-catalog.mjs";
import { safeModel } from "../src/usage-metrics.mjs";
import { PRICING_CATALOG } from "../ui/src/pricing-catalog.js";
import { estimateCost } from "../ui/src/model-comparison.js";
import Database from "better-sqlite3";
import { createUsageService, UsageRequestError } from "../server/usage-service.mjs";
import { assertPrivate, createUsageFixture, RAW_ID } from "./usage-fixture.mjs";

const verifiedNewIds = ["claude-fable-5.1", "kimi-k2.7-code", "kimi-k3", "claude-sonnet-5.5"];

describe("published Copilot CLI model availability", () => {
  const models = COPILOT_MODEL_CATALOG.models;

  it("uses the client support list, not prices or the Auto selection pool", () => {
    assert.equal(COPILOT_MODEL_CATALOG.checkedOn, "2026-10-20");
    assert.equal(new URL(COPILOT_MODEL_CATALOG.source).hostname, "docs.github.com");
    assert.equal(COPILOT_MODEL_CATALOG.client, "Copilot CLI");
    assert.equal(models.length, 34);
    assert.equal(selectableCopilotModels("2026-10-15").length, 30);
    assert.equal(selectableCopilotModels("2026-10-20").length, 24);
    assert.match(COPILOT_MODEL_CATALOG.snapshotSource, /4dd188c2c92f0b57e7f7ec863fd9cca1e093b09b/);
    assert.equal(new Set(models.map((entry) => entry.key)).size, models.length);
    for (const model of ["gpt-6-astra", "gpt-5.6-sol", "claude-sonnet-5", "claude-opus-5", "gemini-3.8-flash", "grok-4.6", "gpt-5.4", ...verifiedNewIds]) {
      assert.ok(models.some((entry) => entry.model === model));
    }
    for (const model of ["gpt-4.1", "gpt-5.4-nano", "claude-opus-4.6", "gpt-5.6-sol-fast", "gpt-6.1-sol", "hydrafusion"]) {
      assert.ok(!models.some((entry) => entry.model === model), `${model} is not a current public CLI trial suggestion`);
    }
  });

  it("keeps supported unpriced choices and historical priced usage distinct", () => {
    const basis = { included: 1, total: 1, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0 };
    assert.ok(copilotModel("gpt-6-astra"));
    const unpriced = PRICING_CATALOG.models.find((entry) => entry.model === "gpt-6-astra");
    assert.equal(estimateCost(basis, unpriced).usd, null);
    assert.equal(safeModel("gpt-4.1"), "gpt-4.1", "retirement must not erase recorded history");
    assert.equal(copilotModel("gpt-4.1"), undefined);
    assert.ok(estimateCost(basis, PRICING_CATALOG.models.find((entry) => entry.model === "gpt-4.1")).usd > 0);
  });

  it("honors scheduled retirements without removing model recognition or annual-plan exceptions", () => {
    const before = selectableCopilotModels("2026-10-01");
    const after = selectableCopilotModels("2026-10-02");
    assert.equal(before.length - after.length, 4);
    assert.ok(!after.some((entry) => entry.model === "claude-opus-4.7"));
    assert.equal(safeModel("claude-opus-4.7"), "claude-opus-4.7");
    assert.equal(safeModel("kimi-k2.7-code"), "kimi-k2.7-code");
    assert.match(after.find((entry) => entry.model === "claude-sonnet-4.6").notice, /annual Copilot Pro or Pro\+/);
    assert.match(after.find((entry) => entry.model === "claude-sonnet-4.6").notice, /not monthly/);
    const october = selectableCopilotModels("2026-10-19");
    assert.equal(after.length - october.length, 6);
    for (const model of ["gemini-3.7-flash", "gpt-5-mini", "gpt-5.4", "gpt-5.4-mini", "gpt-5.5", "grok-4.5"]) {
      assert.ok(!october.some((entry) => entry.model === model));
      assert.equal(safeModel(model), model, "retirement does not erase historical attribution");
    }
    assert.match(copilotModel("grok-4.5").notice, /deprecation announcement takes precedence/);
  });

  it("never treats a public listing handle as a verified telemetry identifier or aliases fast mode", () => {
    for (const entry of models) {
      if (entry.model) {
        assert.equal(safeModel(entry.model), entry.model);
        assert.equal(entry.key, entry.model);
      } else {
        assert.equal(safeModel(entry.key), "Unknown model");
        assert.ok(entry.key.startsWith("listing:"));
        assert.equal(PRICING_CATALOG.models.find((rate) => rate.model === entry.key), undefined);
      }
    }
    assert.equal(copilotModel("listing:opus-fast").model, null);
    assert.equal(safeModel("private-custom-model-name"), "Unknown model");
    assert.match(copilotModel("listing:fable-5").notice, /retain prompts and outputs by default/);
    assert.match(copilotModel("claude-fable-5.1").notice, /administrator enablement/);
    for (const model of verifiedNewIds.filter((model) => model !== "claude-sonnet-5.5")) {
      assert.equal(new URL(copilotModel(model).identifierSource).pathname, "/github/copilot-cli/blob/main/changelog.md");
    }
    assert.match(copilotModel("claude-sonnet-5.5").identifierSource, /copilot-sdk\/blob\/206b49eee92f37a6d5a69eeba16fa5b123b1ddd0\//);
  });

  it("filters exact recorded new CLI identifiers while rejecting unverified listing keys and guessed aliases", () => {
    const fixture = createUsageFixture();
    let service;
    try {
      const db = new Database(fixture.options.dbPath);
      try {
        const insert = db.prepare("INSERT INTO assistant_usage_events (session_id, model, input_tokens, output_tokens, created_at) VALUES (?, ?, 100, 20, ?)");
        for (const model of verifiedNewIds) insert.run(RAW_ID, model, new Date().toISOString());
      } finally { db.close(); }
      service = createUsageService(fixture.options);
      for (const model of verifiedNewIds) {
        const sessions = service.sessions({ timeframe: "all", model });
        assert.equal(sessions.sessions.length, 1);
        const comparison = service.comparison({ timeframe: "all", model });
        assert.equal(comparison.models.length, 1);
        assert.equal(comparison.models[0].model, model);
        assert.equal(comparison.models[0].metrics.totalTokens, 120);
        assertPrivate(assert, sessions);
        assertPrivate(assert, comparison);
      }
      for (const model of ["listing:fable-5", "listing:opus-fast", "listing:haiku-5.5", "listing:gpt-6-sol", "listing:gemini-4-argon",
        "claude-fable-5", "claude-opus-4.8-fast", "kimi-k2.7", "claude-haiku-5.5", "gpt-6-sol", "gemini-4-argon"]) {
        assert.throws(() => service.sessions({ timeframe: "all", model }), UsageRequestError);
        assert.throws(() => service.comparison({ timeframe: "all", model }), UsageRequestError);
      }
    } finally { service?.close(); fixture.cleanup(); }
  });
});
