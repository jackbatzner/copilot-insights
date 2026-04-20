# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **VSCode Copilot Chat session support** (experimental) — Discovers and normalizes sessions from VSCode, Code Insiders, VSCodium, and Cursor `workspaceStorage` directories
  - `src/vscode-sessions.mjs` — cross-platform session discovery with cached path lookups
  - `src/token-reader.mjs` — reads real token usage from JSONL session-state files with BPE-style fallback estimator
  - Sessions appear in the dashboard alongside CLI sessions with a source badge
- **Token Efficiency page** — Coaching-first token waste analysis
  - Hero "#1 Opportunity" card highlighting the biggest waste category
  - Personalized quick wins adapted to user level (beginner / intermediate / expert)
  - Compact score summary with overall grade
  - Waste category coaching with icons, tips, and "Try this" examples for all 5 categories
  - Sortable, filterable session table with progressive loading (sort by tokens, waste, efficiency; filter by grade)
- **Token Efficiency as 4th pillar** — Added to Overview pillar trend chart (purple line) alongside delegation, judgment, and feedback
- **Conditional pillar callouts** — Overview no longer shows always-visible trend badges; instead surfaces callout cards only for declining trends (with coaching direction) or big improvements (≥10 pts)
- `GET /api/token-efficiency` endpoint for token waste analysis per session
- `CATEGORY_COACHING` map with icon, label, tip, and example for each waste category
- **Instruction snippets** — Convention gap suggestions now include a ready-to-paste markdown snippet for `.copilot-instructions.md`. Each snippet is grouped by category with imperative-form rules.
- **Copy button** on instruction suggestions — one click copies the generated markdown snippet to your clipboard
- **Practice coaching panel** — Before asking you to rewrite a bad prompt, the Practice Lab now shows "What's Wrong" guidance:
  - ⚠️ Detected Problems — patterns like correction, frustration, or rollback language
  - 📋 What's Missing — quality signals the prompt is lacking (file references, constraints, criteria, etc.)
  - ✨ How to Fix It — before/after rewrite examples for the detected issues
- **Tag-based coaching** — Challenge library prompts tagged as vague, no-files, no-context, etc. now always show coaching content even when heuristic thresholds aren't triggered
- `heuristics` field returned in `/api/practice/challenge` and `/api/practice/library` responses

### Changed

- **Token efficiency grading** — Combined ratio-based score with absolute waste penalties: ≥50k wasted → max "Needs Work", ≥20k → max "Fair", ≥10k → max "Good"
- **Practice Lab labels** — Renamed "Est. Total Cost" → "Est. Total Tokens" and "Optimized Cost" → "Optimized Tokens" with `.toLocaleString()` formatting
- User level detection in `deriveInsights()`: expert (≥20 sessions, <5% waste), intermediate (≥10 sessions, <15% waste), beginner (default)
- Mock data seeder generates VSCode sessions alongside CLI sessions for realistic demos
- Screenshot capture script includes Token Efficiency page

### Fixed

- Overview pillar trend chart reading `pillarTrends.trendDirection` instead of `pillarTrends.trend` — trend badges never rendered (pre-existing bug)
- `SortHeader` React component defined inside IIFE render block caused DOM remounting every render — converted to plain `sortTh()` helper function
- Token Efficiency session table uses plain `<table>` instead of `.session-table` CSS class to avoid column misalignment from `display: block`

## [0.2.0] - 2026-04-18

### Added

- **UX improvements** — Context, clarity, actionability, and session detection overhaul
  - **Welcome modal** — First-time onboarding flow with dismissable intro
  - **Page banners** — Contextual info banners on dashboard pages (dismissable, persisted)
  - **Metric help tooltips** — Inline `MetricHelp` component explaining scores and pillars
  - **Session type detection** — Auto-detects testing, debugging, and refactoring sessions from turn patterns
  - **Manual session tagging** — Tag any session with a custom label, persisted to localStorage
  - **Grade explainer** — Expanded tier display with score breakdown on Overview page
  - **Coaching tips** — Actionable example tips in judgment feedback (judgment.mjs)
  - **Suggested next actions** — `SuggestedNext` component with contextual follow-up prompts
  - **Weekly goals** — Goal-setting with habit stacking on Learn page
  - **Dev plan tab** — Structured improvement plan view on Learn page
- **Session hiding** — Hide specific sessions (e.g., automated loops) from all analysis
  - 🙈 toggle per session row in the Sessions table, hide/unhide button in Session Detail
  - Hidden sessions are excluded from every analysis endpoint (summary, patterns, coaching, analytics, etc.)
  - `GET /api/hidden-sessions`, `POST /api/sessions/:id/hide`, `DELETE /api/sessions/:id/hide`
  - In-memory only — resets on server restart, no file persistence
  - UUID validation on hide/unhide, 5,000 session cap to prevent memory exhaustion
- **Practice Lab** dashboard page with two modes:
  - Sandbox mode for instant prompt analysis (score 0-100, pattern detection, rewrite suggestions)
  - Rewrite Challenge mode that pulls real poorly-scored prompts for gamified improvement practice
  - Dual challenge sources: "My Bad Prompts" (from your sessions) and "Prompt Library" (83 curated bad prompts)
  - Coaching nudges after every analysis — contextual hints like "try adding a file reference" or "what should the result look like?"
  - Explicit Analyze / Re-analyze buttons (no auto-fire)
- **Challenge library** — 83 curated bad prompts across 11 tag categories, sourced from GitHub, Anthropic, Google, and OpenAI best-practice guides
- **Personalized recommendations** — "Recommended for you" tag pills on the challenge picker, ranked by which quality signals are most frequently missing from your real sessions
- **Research-backed heuristics** — 3 new quality signals: includes examples, specifies output format, uses step structure — with scoring bonuses (+5 to +6 points each)
- `src/practice.mjs` shared prompt analysis module (no DB dependency, reusable by CLI coach)
- `src/challenge-library.mjs` curated prompt library with tags and hints
- `docs/prompting-resources.md` — curated links to official prompting guides, academic papers, and a scoring-criteria reference
- `POST /api/practice/analyze` endpoint for instant prompt scoring (10,000 char limit)
- `GET /api/practice/challenge` endpoint to fetch random low-scoring prompts from user sessions
- `GET /api/practice/library` endpoint with tag filtering and random pick
- `GET /api/practice/weaknesses` endpoint for personalized category recommendations
- **Live Monitor** page (`/live`) — real-time feed of session turns with pattern badges and coaching alerts
- `GET /api/live/feed?since=<ISO>` endpoint — polls session-store.db for recent turns, annotates each with `matchPatterns()`, returns annotated turns with redirection pattern matches
- Coaching alert cards — inline tips when high-severity patterns (weight ≥ 3) are detected
- Pause/resume toggle and polling status indicator on Live Monitor
- `fetchLiveFeed(since)` API client function
- `.sr-only` CSS utility class for screen-reader-only content
- Screenshot capture script now supports `--gif` flag for animated demo GIF generation
- `--pages` flag for screenshot capture script to filter which pages to capture
- `ffmpeg-static` dev dependency for GIF creation from Playwright recordings
- Live Monitor demo GIF and screenshot in documentation

### Changed

- **OSS cleanup** — removed dead exports (`searchTurns`, `PATTERNS`, `scoreClarity`), consolidated port default into `src/defaults.mjs`, added structured logger (`src/log.mjs`), standardized route error handling, added input validation for `repo` and `timeframe` query parameters, added CLI port validation, added React `ErrorBoundary`, added `safeFetch` wrapper for frontend API resilience
- **Extension linking is now opt-in** — global `npm install` no longer auto-links the Copilot CLI extension; run `copilot-insights link` to opt in
- **Auto-generated prompt detection** — sessions with auto-generated prompts (e.g., automated agent loops) are cleaned from analysis and hard-filtered from replay
- SECURITY.md updated to reflect stricter input validation
- Added `.eslintcache` to `.gitignore`
- README now notes Copilot CLI-only scope
- Scoring algorithm rewritten: starts at a baseline determined by prompt substance (20-55), earns points via quality signals (file paths, constraints, criteria, context, examples, output format, steps, technical specifics)
- Grade thresholds tightened: Excellent ≥85, Good ≥65, Needs Work ≥45, Poor <45
- ESLint config now ignores `_`-prefixed destructured variables (`varsIgnorePattern`)
- Tightened `hasCriteria` regex to prevent potential ReDoS (bounded `when...then` match)
- Bounded `hasExamples` regex (`input.{0,200}?output` instead of greedy `input.*output`)
- Library tag filter now validates against a whitelist of known tags
- Timeframe query parameters validated with a strict pattern before processing
- Normalized all line endings to LF via `.gitattributes`

### Fixed

- Express 5 compatibility: `app.get("*", ...)` → `app.get("/{*path}", ...)` for `path-to-regexp` v8
- Express 5 `sendFile`: use `{ root }` option instead of absolute path resolution
- Removed unused imports (`useEffect`, `useRef`, `getSession`, `TIERS`)
- Added accessible labels (`<label>`, ARIA attributes) to all Practice Lab and Live Monitor form controls
- SVG score gauge now has `role="img"` and `aria-label` for screen readers
- Validate `since` query parameter on `/api/live/feed` — returns 400 for invalid dates
- Create/Edit ratio and File Type Diversity charts rendering correctly
- Mobile responsive overlap of tables and graphs on tablet/mobile
- **Rules of Hooks crash** — `useState` for session tag was declared after conditional early returns in SessionDetail, causing React to throw on state transitions
- **localStorage hardening** — Wrapped all `localStorage` read/write calls in try/catch across PageBanner, WelcomeModal, and SessionDetail to prevent crashes in Safari private browsing and restricted webviews
- **Pure state updater** — Moved `localStorage.setItem` out of `useState` updater in Learn.jsx WeeklyGoals into a `useEffect` sync
- **Dead code** — Removed unreachable `tier.description` conditional in Overview (field doesn't exist in TIERS data)

### Improved

- **Test suite** — 270 tests across 34 suites covering all modules (patterns, tiers, clarity, formatter, analyzer, replay, server, analytics, trends, delegation, judgment, work-style, and more)
- Added `aria-label` to Live Monitor pause/resume button
- Added `<label>` with `htmlFor` to Sessions page repository filter input
- Added `.sr-only` CSS utility class for visually hidden, screen-reader accessible elements
- SECURITY.md now documents all API endpoints with input validation details
- README file tree updated to list all `src/` modules
- README pages section updated to include all pages
- README badges cleaned up (removed CI and Node version badges)
- Full demo GIF and refreshed screenshots with mock data

## [0.1.0-alpha.1] - 2026-04-18

### Added

- Dashboard with 6 pages: Overview, Learn, Sessions, Session Detail, Analytics, and Coaching
- 7 CLI extension tools: `insights_analyze`, `insights_session`, `insights_patterns`, `insights_summary`, `insights_compare`, `insights_dashboard`, and `insights_stop`
- @github/copilot-sdk integration with permission framework
- 30+ redirection pattern detection across 5 categories
- Three-pillar coaching system: Clarity, Efficiency, and Delegation
- Dev plans, daily check-ins, and retros
- Work-style analysis and session complexity scoring
- File thrashing detection
- ESLint, Dependabot, and CI/CD workflows
