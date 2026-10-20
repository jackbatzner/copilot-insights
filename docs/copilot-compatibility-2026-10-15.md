# Copilot compatibility review - October 15, 2026

## October 20 refresh

The current [README gallery](../README.md#screenshot-gallery) contains 17
synthetic, text-hidden images, including desktop and mobile selected-turn call
lists. The 15-image count in the original review below describes the October 15
capture. Videos remain historical and have not been re-recorded.

The dated October 15 review below is retained as historical evidence. This
refresh supersedes its current model-source pin and confirms the scheduled
retirements while documenting a conflicting Grok 4.5 listing. No new telemetry reader or private content collection
was needed.

| Surface / current evidence | Decision | Effect here |
| --- | --- | --- |
| [CLI changelog at October 19 snapshot](https://github.com/github/copilot-cli/blob/84a2bd392a397e3dafaa9a1212b2964c3bd694bc/changelog.md), stable 1.0.100 | Adopt documentation; no reader change | Telemetry opt-out/trust-folder flags and corrected complete-usage display after resume are upstream behavior, not proof of changed local accounting or column semantics. |
| CLI 1.0.101-0 prerelease structured workflow output and assisted approval instructions | Defer | No stable local on-disk linkage established. Do not infer subagent relationships from a workflow feature. |
| [October 19 per-client matrix](https://github.com/github/docs/blob/4dd188c2c92f0b57e7f7ec863fd9cca1e093b09b/data/tables/copilot/model-supported-clients.yml) and [removal commit](https://github.com/github/docs/commit/4dd188c2c92f0b57e7f7ec863fd9cca1e093b09b) | Adopt | Five October 19 removals are reflected in the current matrix: Gemini 3.7 Flash, GPT-5 mini, GPT-5.4, GPT-5.4 mini and GPT-5.5. Keep historical recognition. |
| Grok 4.5 remains `cli: true` in that matrix and GA in the [supported-models page](https://docs.github.com/en/copilot/reference/ai-models/supported-models), but the later [October 19 deprecation post](https://github.blog/changelog/2026-10-19-github-copilot-models-deprecated-on-october-19-2026) explicitly retires it | Retain retirement conservatively | Prefer the later explicit deprecation announcement over the conflicting listing. All six announced October 19 retirements remain excluded from new trials. The catalog has 24 selectable choices and ten historical retired entries; no account entitlement was tested. |
| [SDK v1.0.22](https://github.com/github/copilot-sdk/releases/tag/v1.0.22), published October 14; subsequent releases through the check are prereleases | No stable SDK update | No newer stable SDK release verified in the October 15-20 window. Preview dependency updates are not a local schema contract. |
| [Pinned SDK streaming-event documentation](https://github.com/github/copilot-sdk/blob/206b49eee92f37a6d5a69eeba16fa5b123b1ddd0/docs/features/streaming-events.md) compared with current documentation | Retain | No verified new local identity bridge. `agentId`, `ephemeral` and `parentId` do not justify changing existing local correlation rules. The pinned Sonnet 5.5 fixture remains valid even though its path has moved on the current branch. |
| [Official changelog RSS](https://github.blog/changelog/feed/), entries October 15-20 | No App-specific update found | No desktop Copilot App-specific post appeared in the reviewed feed window. This does not establish that no app build shipped. |
| [Slack/Teams repository and model updates](https://github.blog/changelog/2026-10-15-copilot-in-slack-and-teams-adds-model-and-repository-updates) and [enterprise/org/team model-policy API](https://github.blog/changelog/2026-10-19-copilot-model-policy-api-for-enterprise-orgs-and-teams) | Not applicable | Collaboration integrations and administrative policy APIs are outside this individual local-first dashboard. No organization identity or billing integration added. |

No newly verified model identifiers or prices were adopted. GPT-6.1 Sol remains
absent from the reviewed client matrix; broader listings are insufficient for a
CLI model mapping. Listing-only handles remain non-telemetry identifiers.

Readers check schema capabilities before querying. Additional columns are not
automatically adopted: their semantics and safe output contract need independent
verification. Public SDK types alone do not establish a local-disk contract.

Current-date validation exposed two stale retirement assumptions in development
fixtures: saved-scenario tests assembled a historical trial from today's selectable
defaults, and gallery capture selected the now-retired GPT-5 mini. Historical
scenarios are now explicit and tested across the October 19 boundary; the gallery
uses a currently listed Claude Haiku 4.5 trial and matching synthetic later session.
Neither fix changes or discards the user's saved baseline.

The complete working-tree review includes untracked source/tests and the
turn-first explorer. The removed "Why these calls?" panel remains removed:
the list has a compact ownership count, ending labels stay on individual calls,
and causal limits remain in the inspector/help disclosure.
The review also found that the CLI extension listed only the first 25 sessions
without exposing pagination. `insights_sessions` now accepts a validated page
number and reports matching totals and next-page instructions. A synthetic
26-session regression verifies that every opaque handle is discoverable.

Keep SessionDB and session-state JSONL as the local baseline. Adopt the verified
model catalog delta and optional MCP classification metadata, not a new producer,
SDK client, billing model or content collection pipeline.

## Official update review

| Surface / evidence | Decision | Effect here |
| --- | --- | --- |
| [CLI releases](https://github.com/github/copilot-cli/releases), stable 1.0.98 on October 14; [pinned changelog](https://github.com/github/copilot-cli/blob/c01c66377d25426dda70c21750e1956e4dd25657/changelog.md) | Adopt selectively | Refresh supported choices and verified identifiers. CLI resume/MCP fixes are upstream behavior; this app does not install or upgrade the CLI. |
| CLI 1.0.97: hooks, `/usage` billed credits, JSON export fixes and failed-child events, in the same changelog | Defer new accounting | Existing failed-child handling remains. A CLI display change is not proof that local `total_nano_aiu`, request cost or multipliers changed units. No conversion to bills or savings. |
| [SDK v1.0.22, October 14](https://github.com/github/copilot-sdk/releases/tag/v1.0.22) | No dependency change | Release notes describe a bundled CLI dependency update to 1.0.98-2 with no SDK API changes. Preview releases are not adopted as a stable local-file contract. |
| [SDK streaming events, pinned source](https://github.com/github/copilot-sdk/blob/206b49eee92f37a6d5a69eeba16fa5b123b1ddd0/docs/features/streaming-events.md) | Adopt optional MCP marker; defer identity migration | A nonempty string `mcpServerName` classifies a tool as MCP when present. Neither that name nor `mcpToolName` is retained. SDK guidance deprecates `parentToolCallId` in favor of envelope `agentId`; no verified bridge to local child invocations was established, so agent-only evidence remains unlinked. |
| [Published per-client model matrix](https://github.com/github/docs/blob/12691d2d8a5e1a1d03c9f168f625786d576158f2/data/tables/copilot/model-supported-clients.yml) | Adopt | Thirty CLI-supported choices as of this snapshot; four earlier retired entries remain recognized for history. Six scheduled October 19 retirements are excluded from new trials on that date. |
| [Selected models retired October 2](https://github.blog/changelog/2026-10-02-selected-models-in-github-copilot-deprecated) and [October 19 retirement announcement](https://github.blog/changelog/2026-09-18-upcoming-deprecation-of-selected-github-copilot-models-in-mid-october) | Adopt | Remove retired choices from alternatives, not recorded usage or historical baselines. A stored retired alternative prompts the user to choose another model. |
| [Weekly releases, September 28](https://github.blog/changelog/2026-10-02-github-copilot-weekly-releases-september-28): Sonnet 5.5, GPT-6.1 Sol and dynamic workflows | Adopt Sonnet; defer remaining mappings | Sonnet 5.5 has a verified literal identifier. GPT-6.1 Sol appears in broader listings but has no row in the pinned per-client matrix; do not infer CLI support from the Auto pool. Workflow-specific attribution needs documented local linkage. |
| [App local sandboxing, September 23](https://github.blog/changelog/2026-09-23-local-sandboxing-in-the-github-copilot-app) | Not applicable | Per-project sandboxing does not require this read-only dashboard to manage a sandbox. |
| [Hydrafusion preview, September 30](https://github.blog/changelog/2026-09-30-hydrafusion-in-vs-code-and-the-github-copilot-app) | Defer | No verified local accounting/identity mapping. Do not divide aggregate usage among inferred underlying models. |
| [Desktop-app interaction preview, October 1](https://github.blog/changelog/2026-10-01-github-copilot-can-now-interact-with-desktop-apps) | Defer | No new desktop inspection, screenshots or content collection. Unknown tools stay in a safe category. |
| [SDK OpenTelemetry](https://docs.github.com/en/copilot/how-tos/copilot-sdk/observability/opentelemetry) | Defer | Optional future enrichment, not a prerequisite or replacement for local sources. No collector, producer configuration or RPC event-log reader was added. |

## Model identifiers and pricing

The catalog uses the **per-client support matrix**, not the generic GA model list
or Auto-selection pool. GPT-5.4 nano has `cli: false` and is not a trial choice.
GPT-6.1 Sol's inconsistent listings are an explicit deferral, not an assertion
that the model cannot be used.

`claude-sonnet-5.5` is verified in a
[pinned public SDK request fixture](https://github.com/github/copilot-sdk/blob/206b49eee92f37a6d5a69eeba16fa5b123b1ddd0/nodejs/test/e2e/compaction.e2e.test.ts)
and now survives analytics normalization and exact filtering. Newly listed
Claude Haiku 5.5, Claude Opus 5.5, Gemini 4 Argon, GPT-6 Luna, GPT-6 Sol and
Grok 4.7 use this application's **listing-only handles**. Their display names
are verified; exact telemetry identifiers were not established by this review.
They can support a manual trial suggestion, but never a guessed model filter,
pricing alias or telemetry identifier. This is our privacy mechanism, not a
claim about an upstream catalog or alias architecture.

The October 19 retirements are Gemini 3.7 Flash, GPT-5 mini, GPT-5.4,
GPT-5.4 mini, GPT-5.5 and Grok 4.5. Historical recognition is unchanged.
Access still depends on client version, subscription and policy; existing
plan/retention notices remain visible.

**Pricing was not refreshed.** The bundled September 16 standard-rate benchmark
retains its own date and source. New unpriced models display unavailable pricing.
Fixed-workload comparisons do not predict rerun tokens, quality, savings or a
Copilot bill.

## Compatibility limits

Schema availability varies by producer and version. Readers check required
columns before querying; additional columns are not adopted without verified
semantics and a safe output contract.

Public SDK event types are evidence for optional fields, not proof that every
CLI/App version writes those types to disk. The MCP change consumes the explicit
marker only when present and preserves the older tool-name-prefix fallback.
Synthetic regressions cover malformed/empty markers, built-in-name collisions,
private-name canaries and unchanged usage totals. No per-tool token allocation
or new child linkage was introduced.

No stable local on-disk contract was established by this review. Unsupported
metadata remains ignored or unavailable. In particular, SDK `agentId` without
the existing verified parent-call relationship may yield unlinked tool activity.
Do not equate it to a local call ID or infer ownership from timing.

## Persona-driven refinement

| Persona | Confirmed refinement / retained boundary |
| --- | --- |
| Individual investigating high usage | Graph-led Overview and model/day/scope drill-through; selected usage stays distinct from whole-session totals. More neutral values and readable hours, with exact-value disclosure. |
| Turn/request debugger | Turn-first list and inspector, with lazy request evidence, source coverage and return-to-origin navigation. Aggregate-only guidance points to Agents & models. |
| MCP/tool-heavy user | Explicit MCP metadata and category filter, with whole-session counts unchanged and no raw server/tool names. |
| Subagent/fleet user | Linked child tool failures and model evidence remain inspectable; full invocation links do not pretend a category filter changed the child totals. Agent-only linkage remains a documented limit. |
| Model chooser | Updated support/retirement list, unpriced and listing-only candidates, manual trials, historical baselines and explicit fixed-workload caveats. |
| Accessibility/mobile user | Primer-like light/dark tokens, contrast-checked charts, dynamic chart accessible names, pre-paint theme consistency and labeled mobile tool tables; reduced-motion/forced-colors checks retained. |

The new `scripts/persona-investigation-e2e.mjs` uses synthetic sources, blocks
content and external/mutation requests, and checks these representative paths.
It is behavioral evidence, not a claim of complete usability coverage or WCAG
certification. Existing scale protections remain unchanged; this refresh does
not claim to eliminate cold scanning costs for large real histories.

The [README gallery](../README.md#screenshot-gallery) is refreshed with 15 synthetic,
text-hidden assets, including light Overview and mobile tool activity. Earlier
local walkthrough videos remain stale after this restyle and were not re-recorded.
