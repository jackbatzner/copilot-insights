# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Practice Lab** dashboard page with two modes:
  - Sandbox mode for instant prompt analysis (score 0-100, pattern detection, rewrite suggestions)
  - Rewrite Challenge mode that pulls real poorly-scored prompts for gamified improvement practice
  - Dual challenge sources: "My Bad Prompts" (from your sessions) and "Generic Examples" (12 curated prompts)
  - Coaching nudges after every analysis — contextual hints like "try adding a file reference" or "what should the result look like?"
  - Explicit Analyze / Re-analyze buttons (no auto-fire)
- `src/practice.mjs` shared prompt analysis module (no DB dependency, reusable by CLI coach)
- `POST /api/practice/analyze` endpoint for instant prompt scoring (10,000 char limit)
- `GET /api/practice/challenge` endpoint to fetch random low-scoring prompts
- Screenshot capture script now supports `--gif` flag for animated demo GIF generation
- `ffmpeg-static` dev dependency for GIF creation from Playwright recordings

### Changed

- Scoring algorithm rewritten: starts at a baseline determined by prompt substance (20-55), earns points via quality signals (file paths, constraints, criteria, context, technical specifics)
- Grade thresholds tightened: Excellent ≥85, Good ≥65, Needs Work ≥45, Poor <45
- ESLint config now ignores `_`-prefixed destructured variables (`varsIgnorePattern`)
- Tightened `hasCriteria` regex to prevent potential ReDoS (bounded `when...then` match)

### Fixed

- Express 5 compatibility: `app.get("*", ...)` → `app.get("/{*path}", ...)` for `path-to-regexp` v8
- Express 5 `sendFile`: use `{ root }` option instead of absolute path resolution
- Removed unused imports (`useEffect`, `useRef`, `getSession`)

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
