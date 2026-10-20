// Published CLI support is not an account entitlement check or a pricing source.
// Listing-only keys are UI handles, never guessed CLI/telemetry identifiers.
const fableNotice = "Fable models retain prompts and outputs by default for safety monitoring. Enterprise-approved zero-retention access and administrator enablement have additional conditions; review GitHub's guidance before a trial.";

export const COPILOT_MODEL_CATALOG = {
  checkedOn: "2026-10-20",
  source: "https://docs.github.com/en/copilot/reference/ai-models/supported-models",
  snapshotSource: "https://github.com/github/docs/blob/4dd188c2c92f0b57e7f7ec863fd9cca1e093b09b/data/tables/copilot/model-supported-clients.yml",
  client: "Copilot CLI",
  models: [
    { model: "claude-haiku-4.5", label: "Claude Haiku 4.5" },
    { key: "listing:haiku-5.5", model: null, label: "Claude Haiku 5.5" },
    { model: "claude-opus-4.7", label: "Claude Opus 4.7", retiresOn: "2026-10-02" },
    { model: "claude-opus-4.8", label: "Claude Opus 4.8" },
    { key: "listing:opus-fast", model: null, label: "Claude Opus 4.8 (fast mode) (preview)" },
    { model: "claude-opus-5", label: "Claude Opus 5" },
    { key: "listing:opus-5.5", model: null, label: "Claude Opus 5.5" },
    { key: "listing:fable-5", model: null, label: "Claude Fable 5", restriction: "access and retention conditions", notice: fableNotice },
    { model: "claude-fable-5.1", label: "Claude Fable 5.1", restriction: "access and retention conditions", notice: fableNotice,
      identifierSource: "https://github.com/github/copilot-cli/blob/main/changelog.md#L119-L122" },
    { model: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", restriction: "annual plans only",
      notice: "Claude Sonnet 4.6 remains available only to individual subscribers on annual Copilot Pro or Pro+ plans, not monthly plans." },
    { model: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { model: "claude-sonnet-5.5", label: "Claude Sonnet 5.5",
      identifierSource: "https://github.com/github/copilot-sdk/blob/206b49eee92f37a6d5a69eeba16fa5b123b1ddd0/nodejs/test/e2e/compaction.e2e.test.ts" },
    { model: "gemini-3.5-flash", label: "Gemini 3.5 Flash", retiresOn: "2026-10-02" },
    { model: "gemini-3.6-flash", label: "Gemini 3.6 Flash", retiresOn: "2026-10-02" },
    { model: "gemini-3.7-flash", label: "Gemini 3.7 Flash", retiresOn: "2026-10-19" },
    { model: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    { key: "listing:gemini-4-argon", model: null, label: "Gemini 4 Argon" },
    { model: "mai-code-1.1-flash", label: "MAI-Code-1.1-Flash" },
    { model: "gpt-5-mini", label: "GPT-5 mini", retiresOn: "2026-10-19" },
    { model: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
    { model: "gpt-5.4", label: "GPT-5.4", retiresOn: "2026-10-19" },
    { model: "gpt-5.4-mini", label: "GPT-5.4 mini", retiresOn: "2026-10-19" },
    { model: "gpt-5.5", label: "GPT-5.5", retiresOn: "2026-10-19" },
    { model: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { model: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { model: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { model: "gpt-6-astra", label: "GPT-6 Astra" },
    { key: "listing:gpt-6-luna", model: null, label: "GPT-6 Luna" },
    { key: "listing:gpt-6-sol", model: null, label: "GPT-6 Sol" },
    { model: "grok-4.5", label: "Grok 4.5", retiresOn: "2026-10-19",
      notice: "The October 19 deprecation announcement takes precedence over the conflicting client matrix, which still lists this model. Historical usage remains available." },
    { model: "grok-4.6", label: "Grok 4.6" },
    { key: "listing:grok-4.7", model: null, label: "Grok 4.7" },
    { model: "kimi-k2.7-code", label: "Kimi K2.7 Code", retiresOn: "2026-10-02",
      identifierSource: "https://github.com/github/copilot-cli/blob/main/changelog.md#L647-L650" },
    { model: "kimi-k3", label: "Kimi K3",
      identifierSource: "https://github.com/github/copilot-cli/blob/main/changelog.md#L228-L231" },
  ].map((entry) => ({ ...entry, key: entry.key ?? entry.model })),
};

export function copilotModel(key) {
  return COPILOT_MODEL_CATALOG.models.find((entry) => entry.key === key);
}

export function selectableCopilotModels(day = new Date().toISOString().slice(0, 10)) {
  return COPILOT_MODEL_CATALOG.models.filter((entry) => !entry.retiresOn || day < entry.retiresOn);
}
