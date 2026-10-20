// Local display labels select named pricing profiles, not a verified Copilot provider route.
export const PRICING_CATALOG = {
  version: "2026-09-16-standard-usd",
  checkedOn: "2026-09-16",
  currency: "USD",
  tokensPerUnit: 1_000_000,
  notice: "Published standard on-demand text rates, USD per million tokens, checked on the stated date (not a verified effective-from date). " +
    "This benchmark assumes standard requests up to 200K context tokens. Actual context tiers, regional uplifts, batch/flex/fast discounts or premiums, tools and negotiated pricing are not modeled. " +
    "Named model profiles do not verify Copilot's provider routing or model availability. Cache-write rates are deliberately unavailable because cache TTL is not recorded.",
  models: [
    { model: "gpt-4.1", provider: "OpenAI", input: 2, output: 8, cacheRead: 0.5,
      source: "https://developers.openai.com/api/docs/pricing" },
    { model: "gpt-5-mini", provider: "OpenAI", input: 0.25, output: 2, cacheRead: 0.025,
      source: "https://developers.openai.com/api/docs/pricing" },
    { model: "gpt-5.4", provider: "OpenAI", input: 2.5, output: 15, cacheRead: 0.25,
      source: "https://developers.openai.com/api/docs/pricing" },
    { model: "claude-sonnet-4.6", provider: "Anthropic", input: 3, output: 15, cacheRead: 0.3,
      source: "https://platform.claude.com/docs/en/about-claude/pricing#model-pricing" },
    { model: "claude-haiku-4.5", provider: "Anthropic", input: 1, output: 5, cacheRead: 0.1,
      source: "https://platform.claude.com/docs/en/about-claude/pricing#model-pricing" },
  ],
};
