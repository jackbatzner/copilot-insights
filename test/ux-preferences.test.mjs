import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { PRESENTATION_KEY, readPresentationPreference, writePresentationPreference } from "../ui/src/presentation-preference.js";
import { matchingUsage } from "../ui/src/turn-usage.js";
import { safeUsageQueryValues, validUtcDay } from "../ui/src/usage-query-values.js";

test("pre-paint theme respects explicit light and dark before stored or system preference", () => {
  const html = readFileSync(new URL("../ui/index.html", import.meta.url), "utf8");
  const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const [query, saved, systemDark, expected] of [
    ["light", "dark", true, "light"], ["dark", "light", false, "dark"],
    ["", "light", true, "light"], ["", "dark", false, "dark"],
    ["invalid", "invalid", false, "light"], ["", null, true, "dark"],
  ]) {
    const writes = [];
    runInNewContext(code, { URLSearchParams,
      window: { location: { search: `?scoutTheme=${query}` }, matchMedia: () => ({ matches: systemDark }) },
      localStorage: { getItem: () => saved },
      document: { documentElement: { setAttribute: (key, value) => writes.push([key, value]) } },
    });
    assert.deepEqual(writes, [["data-theme", expected]]);
  }
});

test("usage navigation never propagates arbitrary filter text and retains invalid selection state", () => {
  const value = safeUsageQueryValues({
    model: "PRIVATE_QUERY_CANARY", session: "PRIVATE_QUERY_CANARY", scope: "PRIVATE_QUERY_CANARY",
    day: "PRIVATE_QUERY_CANARY", source: "PRIVATE_QUERY_CANARY", unknown: "PRIVATE_QUERY_CANARY",
  });
  assert.ok(!JSON.stringify(value).includes("PRIVATE_QUERY_CANARY"));
  assert.equal(value.model, "invalid-model");
  assert.equal(value.scope, "invalid-scope");
  assert.equal(value.day, "invalid-day");
  assert.equal(value.session, "invalid-session");
  const valid = safeUsageQueryValues({ model: "gpt-4.1", scope: "subagent", day: "2026-09-17", session: "a".repeat(64), page: 2, includeHidden: true });
  assert.equal(valid.model, "gpt-4.1");
  assert.equal(valid.session, "a".repeat(64));
  assert.equal(valid.includeHidden, "true");
  assert.equal(valid.page, 2);
  assert.equal(validUtcDay("2026-02-30"), false);
});

test("presentation defaults to visible text, persists only a bounded preference, and fails closed", () => {
  const map = new Map();
  const storage = () => ({ getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) });
  assert.deepEqual(readPresentationPreference(storage), { enabled: false, error: null });
  assert.equal(writePresentationPreference(true, storage), null);
  assert.equal(map.get(PRESENTATION_KEY), "on");
  assert.deepEqual(readPresentationPreference(storage), { enabled: true, error: null });
  writePresentationPreference(false, storage);
  assert.equal(readPresentationPreference(storage).enabled, false);
  map.set(PRESENTATION_KEY, '{"unexpected":"value"}');
  assert.equal(readPresentationPreference(storage).enabled, true);
  assert.ok(readPresentationPreference(storage).error);
  const denied = () => { throw new Error("Unavailable"); };
  assert.equal(readPresentationPreference(denied).enabled, true);
  assert.ok(readPresentationPreference(denied).error);
  assert.ok(writePresentationPreference(true, denied));
  assert.throws(() => writePresentationPreference("on", storage), TypeError);
});

test("matching call totals exclude missing observations and never add cache to tokens", () => {
  const result = matchingUsage([
    { metrics: { totalTokens: 100, inputTokens: 80, outputTokens: 20, cacheReadTokens: 70, requests: 1 }, evidence: { totalTokens: { source: "sessiondb", status: "derived" } } },
    { metrics: { totalTokens: null, inputTokens: null, outputTokens: 0, cacheReadTokens: null, requests: 1 }, evidence: {} },
  ]);
  assert.equal(result.metrics.totalTokens, 100);
  assert.equal(result.metrics.outputTokens, 20);
  assert.equal(result.metrics.requests, 2);
  assert.deepEqual(result.evidence.totalTokens, { status: "partial", source: "sessiondb", recorded: 1, total: 2 });
  assert.equal(matchingUsage([]).metrics.totalTokens, null);
  assert.equal(matchingUsage([{ metrics: { totalTokens: 0 } }]).metrics.totalTokens, 0);
});
