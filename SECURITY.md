# Security and privacy

## Reporting a vulnerability

Do not open a public issue containing a vulnerability or private telemetry.
Use GitHub's [private security reporting](https://github.com/jackbatzner/copilot-insights/security/advisories/new).
If unavailable, contact the maintainer privately before sharing details.

Provide a minimal synthetic reproduction, affected version, and expected versus
observed behavior. Do not send credentials, your session database, event files,
or transcripts.

## Supported versions

Security changes target the latest published release. Upgrade before reproducing
an issue; historical releases may still contain removed content-based features.

## Local boundary

Copilot Insights is a single-user, loopback-only usage dashboard. It is not a
multi-user service and must not be exposed through a public bind address or
reverse proxy.

- Source SessionDB and session-state files are read-only.
- Usage APIs serve sanitized metadata, not raw source records. A separate
  request-consented local text endpoint is the explicit exception described below.
  Session Detail displays text by default; this is not a first-use opt-in viewer.
- Local app settings, hidden-session state, and opaque-handle bookkeeping are
  application data, distinct from the source database.
- No source telemetry is uploaded to an external analytics service.
- Optional sources require explicit opt-in. Content-only sources do not become
  usage sources through transcript parsing.
- Removed instruction/practice/goal/journal/retrospective files are not consumed
  or automatically deleted.

Upgrade migration reads only bounded legacy app-owned hidden-session IDs and
source preference booleans. It converts IDs to opaque handles without reading
session content, preserves existing new-format choices, and leaves old files
unchanged. Invalid legacy state produces a safe error instead of silently
unhiding sessions.

Loopback is not an authentication boundary against other processes running as
the same user. OS account and filesystem protections remain necessary.

## Safe output contract

Usage API responses, CLI results and analytics UI labels must not contain:

- Prompt or reply content, commands, tool arguments/results.
- Local paths, CWDs, endpoint URLs or credentials.
- Raw session, agent, tool-call, interaction or request identifiers.
- Arbitrary names, descriptions, or error text from source telemetry.

Identifiers needed for correlation stay inside the normalizer. Application
handles and anonymous labels support session navigation. Metadata uses strict
allowlists or generic categories; escaping HTML alone is insufficient.

Numeric metrics retain source and coverage. Missing values are not silently
converted to zero, and JSONL fallback is not added to the same recorded usage.
Request-duration sums must not be presented as wall-clock time. Local credits
are not organization billing statements.

## API surface

| Endpoint | Purpose |
| --- | --- |
| `GET /api/summary` | Safe usage snapshot and source capabilities |
| `GET /api/sessions` | Anonymous catalog and model filters |
| `GET /api/sessions/:handle` | Unified attribution, independent skill counts and diagnostic status |
| `GET /api/sessions/:handle/turns` | Paginated turn summaries and selected-turn model-call evidence, without text |
| `GET /api/sessions/:handle/tools` | Safe execution categories and proven child-invocation links, without arguments/results |
| `POST /api/sessions/:handle/content` | Explicitly consented, bounded local turn text or proven delegation prompt; never cached |
| `GET /api/tokens/summary` | Usage/model/performance snapshot |
| `POST /api/sessions/:handle/hide` | Hide a session using its application handle |
| `DELETE /api/sessions/:handle/hide` | Unhide a session |
| `GET /api/settings` | Safe source availability and opt-in status |
| `PATCH /api/settings` | Update explicitly supported settings |
| `POST /api/refresh` | Refresh local reader/cache state |
| `GET /api/comparison` | Sanitized model usage and eligible token-price bases; no content or source IDs |

Retired content/coaching endpoints return JSON not-found/gone responses. They do
not remain callable behind hidden navigation, and are not handled as SPA pages.

Validate query/body types and handles. Use parameterized SQL and check optional
tables/columns before access. Errors must be explicit but sanitized; never return
raw exception messages, SQL, or source paths. Mutating endpoints must retain
origin protections and bounded request bodies.

### Explicit local text exception

Session Detail defaults to displaying original text. Mounted turns on the
current paginated page automatically request bounded text for a first-line
preview and expansion; agent prompts load only inside expanded exact-child
attribution. Each read separately POSTs consent and either a safe recorded
turn index or an existing anonymous attribution key. The endpoint requires
an exact same-origin Origin header, JSON content type and strictly validated
body. It is not available through GET, CLI tools, usage summaries or exports.

Turn text comes only from capability-checked columns in the same session's
`turns` table. A child prompt needs exact same-session parent-call evidence and
the corresponding verified task invocation's `arguments.prompt`; no arbitrary
argument objects, tool results, commands or assembled system prompts are read
out. Missing or ambiguous linkage is unavailable, not timestamp-guessed.
Reads and response text are bounded, with explicit partial/truncation states.

Original revealed text is **not guaranteed to be redacted** and can itself
contain sensitive values. Render it as plain text, never HTML or interpreted
Markdown. First-line previews are verbatim, length-bounded text, not generated
summaries, and belong only to mounted turn state—not usage DTOs or labels.
Do not log text or put it in app settings, browser persistence, usage
DTOs or shared response caches. Browser HTTP caching is disabled. Clear panel
state and abort pending requests on individual/global hide, pagination,
navigation and manual refresh; stale responses must not repaint cleared text.
Collapsing a turn removes its full text from the DOM but keeps its preview and
bounded response in that mounted turn's state; collapsing an agent unmounts its
prompt entirely. Hide all text removes both previews and full text, stops
automatic reads, and enables presentation mode across navigation and reload.
The browser stores only an `on`/`off` preference. Missing preference defaults to
shown; unreadable or invalid stored values hide text and surface an explicit
error. A failed write changes this tab's mode but visibly warns it was not saved.
Other tabs follow preference storage events. Metadata polling does not refetch unchanged
turn text; newly mounted turns follow the current text-display choice.

This remains a single-user local viewer, not a secret-management boundary
against other processes with access to the account.

### Shutdown aggregate fallback

Only verified numeric model-usage fields are normalized from shutdown events.
Arbitrary nested values, model names outside the safe catalog, and raw event IDs
are not exposed. Any recorded SessionDB usage rows suppress this fallback for
that session. Repeated shutdown snapshots are not summed; partial aggregates
remain partial and cannot establish individual request or child-agent identity.
Recorded request-cost values have no inferred monetary unit, and session-wide API
duration is not replicated into each model's usage.

### Visual exploration

Comparison browser persistence is bounded and validated: up to eight exact-selection
scenarios in tab storage and one explicit metric-only baseline in browser-local
storage, never original text, arbitrary notes, source
paths or raw identifiers. Corrupt or unavailable storage is surfaced rather
than silently replacing a baseline. The baseline has no automatic expiry and
remains until replaced, cleared or removed with site data. It stores recorded
metrics, source coverage and scenario assumptions, not a price estimate.
Later-session comparisons use whole selected history, not an incremental delta
or evidence of task quality, savings or causation. Standard-rate price scenarios
are benchmarks, never a Copilot bill; cache assumptions must stay explicit.
Browser-generated navigation allowlists
filter values and uses fixed invalid-selection markers instead of reflecting
arbitrary query text into links or controls.

Daily usage graphs use verified timestamps on exact SessionDB usage only.
Shutdown snapshots and undated records cannot establish a request timeline.
UTC-day and execution-scope filters are validated and intersect on the same
usage observation as a model filter. Drill-through links carry only safe filter
values and opaque application handles, never raw identifiers or source content.
Session performance and insights describe recorded usage, not personal skill,
task quality, or an inferred causal connection between a skill and a model.

The detail-only turn/request projection reuses normalized exact SessionDB usage.
It does not read conversation-content tables. Turn indices must be safe
nonnegative integers; other values remain Unassigned without dropping usage.
Request labels are generated ordinals, never raw request/tool/agent IDs.
Existing anonymous attribution keys connect requests to their proven group;
timestamps do not infer skill/tool ownership. Shutdown counts never become
fabricated request rows.

## Telemetry evolution

SessionDB and JSONL fields vary across producers and releases. Capability checks
and synthetic fixtures are required. A missing relationship is unavailable
evidence, not permission to infer it from adjacent timestamps.

OTel consumption is not implemented. A future adapter must apply the same output
contract even if its producer claims content capture is disabled. Trace
attributes can be content-bearing, and a second source must not double-count
usage already recorded in SessionDB.

## Regression coverage

Use synthetic canaries in prompts, arguments, results, paths, raw IDs, and
arbitrary model/tool/skill names. Assert that none appear in usage payloads,
CLI output, URLs, errors, or analytics screenshots. Synthetic text may appear only
in dedicated local text responses/previews/panels; verify clearing and absence
from subsequent analytics, caches and app state. Test absent/corrupt sources, partial
metrics, stale handles, source filtering and retired routes as well as the happy
path.

Published gallery captures are stricter: isolated synthetic sources only,
Presentation mode enabled, and content endpoints and external requests blocked.
Require the **SYNTHETIC DATA / TEXT HIDDEN** label and no previews or text panels.
Only allowlisted PNGs belong in the gallery; keep the validation manifest and
environment-specific paths outside checked-in documentation.
