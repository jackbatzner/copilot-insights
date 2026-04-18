// Tests for src/tiers.mjs — tier system
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TIERS, getTier } from "../src/tiers.mjs";

describe("TIERS", () => {
  it("has exactly 7 entries", () => {
    assert.equal(TIERS.length, 7);
  });

  it("is sorted ascending by min", () => {
    for (let i = 1; i < TIERS.length; i++) {
      assert.ok(
        TIERS[i].min > TIERS[i - 1].min,
        `TIERS[${i}].min (${TIERS[i].min}) should be > TIERS[${i - 1}].min (${TIERS[i - 1].min})`
      );
    }
  });

  it("each tier has min (number), emoji (string), name (string)", () => {
    for (const tier of TIERS) {
      assert.equal(typeof tier.min, "number");
      assert.equal(typeof tier.emoji, "string");
      assert.equal(typeof tier.name, "string");
    }
  });
});

describe("getTier", () => {
  it("returns first tier 'Prompt Padawan' for score 0", () => {
    const tier = getTier(0);
    assert.equal(tier.name, "Prompt Padawan");
    assert.equal(tier.min, 0);
  });

  it("returns 'Signal Sender' for score 50", () => {
    const tier = getTier(50);
    assert.equal(tier.name, "Signal Sender");
    assert.equal(tier.min, 40);
  });

  it("returns last tier 'Zero Redirect' for score 100", () => {
    const tier = getTier(100);
    assert.equal(tier.name, "Zero Redirect");
    assert.equal(tier.min, 95);
  });

  it("returns 1-based index", () => {
    const tier = getTier(0);
    assert.equal(tier.index, 1);

    const last = getTier(100);
    assert.equal(last.index, 7);
  });

  it("returns next tier (or null for last)", () => {
    const first = getTier(0);
    assert.ok(first.next !== null, "First tier should have a next");
    assert.equal(first.next.name, "Context Crafter");

    const last = getTier(100);
    assert.equal(last.next, null);
  });

  it("exact boundary returns that tier, not previous", () => {
    const tier = getTier(25);
    assert.equal(tier.name, "Context Crafter");
    assert.equal(tier.min, 25);
  });
});
