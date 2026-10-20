# Contributing

Copilot Insights is a local-first individual usage optimizer and insights tool.
Usage-based coaching is secondary and advisory, not prompt analysis.

## Setup

Use Node.js 20+ and npm. From a source checkout:

```bash
npm install
npm start
```

Root postinstall installs nested server/UI dependencies and builds the UI.
`npm run setup` is the explicit bootstrap alternative.

For UI development, run `npm run dev` in `ui` and `npm run dev` in `server` in
separate terminals. The UI dev server proxies API requests to the local server.

## Architecture

- `src/runtime-telemetry.mjs`: capability-aware read-only sources, normalized
  usage/execution evidence, conservative attribution and safe projections.
- `server/index.mjs`: loopback API and built UI delivery.
- `src/local-content.mjs`: isolated bounded text reads behind request-level
  consent validation; Session Detail loads text by default, separately from analytics.
- `src/model-comparison.mjs`: per-observation pricing eligibility and safe model comparisons.
- `src/copilot-model-catalog.mjs`: dated public CLI support, independent of price coverage or account access.
- `ui/src/pricing-catalog.js`: dated official standard-rate profiles; no runtime network fetch.
- `src/extension-runtime.mjs` and `src/formatter.mjs`: privacy-safe CLI tools.
- `ui/src`: Overview, Sessions, Token Usage, Settings, and session detail.
- `test`: synthetic Node unit/integration tests.
- `scripts`: development and synthetic visual-validation tooling.

Keep source adapters separate from normalized analytics. Adding a field to the
reader does not make it safe to serialize. Retain field-level source and coverage
through aggregation and model/session filtering.

## Required invariants

- No prompts/replies, command contents, arguments/results, paths, raw IDs in usage output,
  endpoint URLs, arbitrary source names/descriptions, or exception text.
- Original text is allowed only in the isolated local text endpoint/previews/panels.
  Keep it outside usage DTOs, caches, exports, logs and persisted state; see
  the request-level consent, bounded-read, exact-linkage and clearing rules in
  SECURITY.md. The consent field is not a first-use opt-in dialog.
- Initialize the persistent presentation preference before content effects.
  Missing means default-visible; invalid/unreadable means hidden with a visible
  error. Presentation mode cancels and masks content across all detail panels.
- No content-based token estimates, prompt grading, or instruction generation.
- Exact usage takes precedence over JSONL fallback; do not double-count traces,
  lifecycle totals, or duplicated event streams.
- Keep fallback model context stream-local, including duplicate transitions.
  Never use future-dated model context for earlier output; leave unresolved
  attribution unknown. Select recorded lifecycle by timestamp, then canonical
  file and same-file position for ties, independently of shutdown aggregates.
  Undated lifecycle evidence remains unavailable with diagnostics, not guessed.
- Shutdown model aggregates are a session-wide fallback only when recorded
  SessionDB usage rows are absent. Select one coherent snapshot deterministically;
  never sum repeats, merge maxima, infer child ownership, allocate session-wide
  duration to models, or invent units for recorded request cost.
- Missing metrics remain unavailable; an observed zero remains zero.
- Model-comparison prices are versioned standard-rate benchmarks, never Copilot
  billing. Check official rates and retain source/date. Exclude incomplete
  observations before aggregation; cache semantics must remain an explicit
  assumption and cache writes with unknown TTL cannot be priced.
- Keep up to eight exact-selection scenarios in tab storage and one explicitly
  saved metric-only baseline in browser-local storage. The baseline has no
  automatic expiry; replace/clear are deliberate actions. Later-session comparisons
  use whole selected history, not incremental usage or causal/quality evidence.
- Model choices use the official client-support table, not provider prices or
  the Auto-selection pool. Preserve date/source, plan exceptions, access/retention
  conditions and scheduled retirement dates. Keep historical usage recognized.
  Listing-only keys must never be used as telemetry IDs, pricing aliases or
  model filters; verify exact identifiers before wiring a new model into analytics.
- Child linkage needs same-session stable parent-call evidence. Do not guess
  skill attribution or request relationships from timestamps.
- Call explanations use only normalized, allowlisted SessionDB finish reasons
  and recorded ownership. Endings are not incoming triggers: do not turn a tool
  handoff into a verified next-call link or an error into a retry. Breakdown
  counts cover all matching calls before pagination; unrecognized endings remain
  unknown. Keep call-ending detail out of unexpanded turn-summary pages.
- A nonempty string `mcpServerName` may classify an execution as MCP, but retain
  only the fixed category, never the server/tool names. Public SDK event types
  are not a verified local-disk contract. Do not substitute SDK envelope `agentId`
  for parent-call linkage without a verified local bridge and conflict tests.
  See the [October compatibility review](docs/copilot-compatibility-2026-10-15.md).
- Deduplicate tool calls across repeated start/complete observations. Only
  stable parent-call links assign them to child invocations; conflicting links
  remain unlinked. Never map opaque JSONL turn IDs to SessionDB indices or
  allocate model tokens/costs to tool calls.
- Preserve optional source behavior and safe unavailable/error states.
- Recommendations use static safe templates, recorded evidence, uncertainty,
  and a measurement to compare. No automatic configuration changes.
- Do not infer a person/owner dimension from session or repository metadata.

## UI conventions

- ES modules (`.mjs`) and React JSX; use existing patterns and minimal dependencies.
- Use CSS custom properties such as `var(--bg-card)`, `var(--text)` and
  `var(--border)`, not hardcoded theme colors.
- Keep the GitHub-native, Primer-like light/dark token palette and system fonts.
  Reuse existing semantic tokens; do not restore the former warm/rose theme.
  Chart colors must pass graphical and text contrast checks in both themes.
  Retain labels and tables for non-color interpretation, compact desktop density,
  and usable mobile targets. Changes to rounded display values must preserve
  exact-value disclosure, metric units, and the distinction between missing and zero.
- Use the shared timeframe context rather than independent timeframe state.
- Keep four main destinations: Overview, Sessions, Token Usage and Settings.
  Overview should lead from graphs and evidence to an investigation, not a score.
  Session Detail and Compare models remain drill-downs. Session-activity timeframes
  select whole histories; request-day filters intersect model/scope on the same
  observation, while whole-session totals remain available.
- Session Detail is turn-first: retain the current turn/page across analysis
  views, replace rather than stack selected call evidence, and restore keyboard
  focus when returning from call or agent inspection. Clear selection on filters
  or turn-page changes. Keep mobile list/inspector navigation single-column.
  Turn-local text state must stay outside analytics and shared caches; selecting
  a turn must reuse its existing local preview read, not fetch its text twice.
- Use `safeFetch` and visible retry states for usage; cancel stale requests on
  navigation without aborting another cache subscriber. The private text POST
  must bypass shared caching entirely.
- Reuse sanitized usage across views until explicit invalidation or bounded
  memory eviction. Unfiltered Sessions can project a loaded summary, but filtered
  selected-usage metrics must come from their own correctly filtered response.
  Prefer an exact cached or pending comparison over an older detail projection.
  Refresh matching totals when the detail snapshot changes, and preserve an
  unavailable model selection as no matches until the user explicitly clears it.
- Keep overview/session/turn payloads bounded: overview retains global totals and
  insight leaders, Sessions filters and sorts before server pagination, and turn
  pages carry summaries without request evidence until expanded. Matching totals
  must use all matching observations, never just the displayed request page.
  A single-session selection must not fetch every session just to locate its row.
- Run source scans through the worker-backed HTTP service. Bound queued work,
  propagate safe errors and terminate workers on server shutdown. Cache normalized
  metadata only; never weaken file-change detection or content isolation to
  improve benchmark numbers. Measure cold and warm paths separately.
- Keep hooks before conditional returns.
- Extract focused components from large pages; use context only where shared
  state warrants it.
- Support keyboard navigation, focus-visible styles, semantic controls, labeled
  expanders, light/dark mode and narrow screens.

## Validation

Run focused tests first, then the full suite:

```bash
npm test
npm run lint
npm run build
git diff --check
```

On Windows, use explicit file expansion:

```powershell
$tests = @(Get-ChildItem -Path test -Filter '*.test.mjs' | ForEach-Object FullName)
& node --experimental-test-module-mocks --test $tests
```

Root lint covers backend/extension code, not JSX. UI build and behavioral checks
are separate requirements.

Test at least:

1. Missing/older schemas, nullable columns, recorded zeros, partial JSONL, and
   conflicting or duplicate source records.
2. Primary/child/unattributed groups, mixed models, session/model reconciliation,
   independent skill counts, and exact-versus-shutdown-versus-output precedence.
3. Hostile content canaries in metadata as well as payloads; none may appear in
   usage API/CLI output, URLs, analytics UI, errors, or persisted application state.
   Local text previews/panels use only synthetic canaries; verify clearing on
   individual/global hide, pagination, navigation and refresh, including delayed
   responses. A collapsed turn retains its preview; a collapsed agent must not
   fetch or retain its prompt. Hiding all text must survive manual refresh.
4. Opaque handles, hidden-session persistence, retired API routes, and retries.
5. Overview graphs -> filtered Sessions -> Session Detail -> exact attribution,
   plus Token Usage -> Compare models and optional secondary guidance.
   Check Data Sources capability caveats and unavailable measurements.
6. Complete and partial shutdown aggregates, repeated snapshots, and no-data UI
   states without repeated credit tiles or duplicated missing-value captions.
7. Timestamp-grounded daily graphs, UTC boundaries, undated/aggregate exclusions,
   and same-observation intersections of day, model and execution scope.
8. Keyboard-operable graph links, selected-versus-whole session comparisons,
   sorting/pagination and filter-preserving back navigation. Check mobile
   layouts, both themes, empty sources and aggregate-only sources.
9. Session Detail turn/request reconciliation, index 0 and Unassigned behavior,
   request-level model/scope/day intersections, nested pagination and keyboard
   linkage to existing agent attribution. Never synthesize request rows from
   shutdown aggregates or read conversation text for the usage projection.

Use synthetic fixtures and isolated temporary source directories for UI/E2E
checks and screenshots. Never seed or overwrite your real Copilot database.
Screenshots must not contain real session content or identifiers.

Run the integrated synthetic workflow with:

```bash
node scripts/usage-e2e.mjs
node scripts/turn-usage-e2e.mjs
node scripts/local-usability-e2e.mjs
node scripts/settings-recovery-e2e.mjs
node scripts/tools-cache-e2e.mjs
node scripts/model-comparison-e2e.mjs
node scripts/comparison-baseline-e2e.mjs
node scripts/review-regressions-e2e.mjs
node scripts/paged-usage-e2e.mjs
node scripts/loading-states-e2e.mjs
node scripts/persona-investigation-e2e.mjs
node scripts/mobile-help-e2e.mjs
node scripts/workflow-usability-e2e.mjs
node scripts/exploratory-recovery-e2e.mjs
```

This requires Microsoft Edge and uses Playwright's `msedge` channel headlessly.
These checks use the real API/runtime, not only mocked UI responses. The turn
flow also checks request/turn reconciliation, exact child links, source limits
and paginated large sessions without displaying source content.
The review regressions check active-session matching totals, absent-model
deep links, and explicit filter clearing on desktop and narrow screens.
The persona investigation checks selected versus whole-session usage, filtered
MCP categories without token allocation, child/request evidence, model-scenario
caveats, light/dark text and chart contrast, and mobile tool tables. Run the
loading suite for reduced-motion and forced-colors placeholder behavior.
The exploratory recovery suite checks missing-session links, invalid JSON and
connection resets, failed lazy-module reloads, late responses after navigation,
failed visibility writes, and offline refresh recovery using synthetic sources.

### Screenshot gallery

Generate the current static gallery independently of the E2E scripts:

```bash
node scripts/capture-screenshots.mjs --output docs/screenshots
```

Omit `--output` to leave captures in an external temporary directory. Explicit
publication copies only allowlisted PNGs to `docs/screenshots`; the sidecar
privacy/build/hash validation manifest stays in the external directory and its
path is printed. With `--output` set to an external directory, the manifest is
written beside the PNGs. Do not commit machine-local output paths, manifests,
databases or browser state.

The 17-image contract in `scripts/gallery-contract.mjs` covers Overview and its
daily graph (`overview-daily.png`), Sessions, Session Detail, the desktop/mobile
selected-turn call lists and individual model-call inspection,
Token Usage, Models, observed/what-if/baseline comparisons, Settings, empty Overview
and mobile Sessions, a light Overview and mobile child tool activity. README uses a representative set of these images; the
contract is the filename authority. `scripts/gallery-fixture.mjs` supplies the
isolated gallery data; `test/gallery-capture.test.mjs` checks the capture contract.
`test/documentation-media.test.mjs` checks local Markdown links and anchors,
image references and the exact published gallery allowlist.

Every image must carry **SYNTHETIC DATA / TEXT HIDDEN**. Use only isolated
Edge and synthetic SessionDB/JSONL sources. Seed Presentation mode before app
scripts run; block local content endpoints, external requests, WebSockets and
non-GET requests. Check the full DOM, browser storage and API responses for
private canaries, and ensure text previews/panels never appear.
The manifest includes intentional post-capture blocked-request guard probes;
their blocked counts are not normal application attempts to fetch private text
or contact external services.
Do not substitute real history, even with text hidden. Save the
baseline using the UI, then insert the later synthetic session into the isolated
fixture and compare it; do not fabricate the comparison by editing the page.
The capture runner does not invoke the broader usage/turn E2E flows; those
remain separate tests. No video or GIF is needed for this static gallery.

CI runs lint and build/test jobs on Node 20/22. Do not bypass failing checks by
removing coverage for functionality that remains supported.

## Reporting issues

Include Node version, safe source-capability status and reproducible steps using
synthetic data. Never attach your session-store database, event files, transcripts,
credentials, or raw local paths. Report vulnerabilities privately as described
in [SECURITY.md](SECURITY.md).
