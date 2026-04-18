# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `insights_coach` CLI tool with 3 modes: immediate single-prompt feedback, periodic multi-turn review, and progress tracking over time
- `src/practice.mjs` shared prompt analysis module — pure `analyzePrompt()` function with quality heuristics and 0-100 scoring
- Proactive coaching triggered by correction patterns, frustration signals, and direction changes
- Example coaching output in README for all 3 modes

### Fixed

- Express 5 SPA fallback route (`*` → `{*path}`) in `server/index.mjs`
- `sendFile` path resolution in `server/index.mjs`
- Removed unused `TIERS` import in `extension.mjs`

### Improved

- Added `aria-label` and `<label>` to repository filter input for screen reader accessibility
- Added `.sr-only` CSS utility class for visually hidden, screen-reader accessible elements
- SECURITY.md now documents all 31 API endpoints with input validation details
- README file tree updated to list all 20 `src/` modules
- README pages section updated to include Instructions page
- README badges cleaned up (removed CI and Node version badges)

## [0.1.0-alpha.1] - 2026-04-18

### Added

- Dashboard with 6 pages: Overview, Learn, Sessions, Session Detail, Analytics, and Coaching
- 8 CLI extension tools: `insights_analyze`, `insights_session`, `insights_patterns`, `insights_summary`, `insights_compare`, `insights_coach`, `insights_dashboard`, and `insights_stop`
- @github/copilot-sdk integration with permission framework
- 30+ redirection pattern detection across 5 categories
- Three-pillar coaching system: Clarity, Efficiency, and Delegation
- Dev plans, daily check-ins, and retros
- Work-style analysis and session complexity scoring
- File thrashing detection
- ESLint, Dependabot, and CI/CD workflows
