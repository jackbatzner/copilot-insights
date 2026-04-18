# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public GitHub issue.**
2. Email the maintainer or use [GitHub Security Advisories](https://docs.github.com/en/code-security/security-advisories) to report privately.
3. Include a description of the vulnerability, steps to reproduce, and potential impact.

We will acknowledge receipt within 48 hours and aim to release a patch within 7 days for critical issues.

## Security Model

Copilot Insights is a **local-only** development tool:

- The server binds to `127.0.0.1` (localhost only) — it is not accessible from the network.
- CORS is restricted to `localhost` origins.
- The app reads your local Copilot session database (`~/.copilot/session-store.db`) in **read-only** mode.
- Goal data is stored locally at `~/.copilot/insights-goals.json`.
- No data is transmitted to external services.
- No authentication is required because the server is only accessible to the local user.

### Input Validation

- The `POST /api/practice/analyze` endpoint enforces a **10,000 character** input limit and validates that the body contains a string.
- The `GET /api/practice/library` endpoint validates tag query parameters against a **whitelist** of known tags — unrecognized tags are silently dropped.
- The `GET /api/practice/challenge` and `GET /api/practice/weaknesses` endpoints validate timeframe parameters with a strict pattern (`\d{1,4}[dwmy]` or `all`).
- The Express JSON body parser is limited to **50 KB**.
- All regex patterns used for prompt analysis are designed to avoid catastrophic backtracking (ReDoS). Greedy quantifiers like `.*` are bounded (e.g., `.{0,200}?`) and nested quantifiers use explicit upper bounds.

## Input Validation

### Request body limits

- JSON body parser limit: **50 KB** (`express.json({ limit: "50kb" })`)

### Query parameters

| Parameter | Used by | Validation |
|-----------|---------|------------|
| `timeframe` | Most endpoints | Parsed by `parseSince()` — must match `/^\d+d$/` (e.g., `7d`, `30d`, `90d`) or `all`. Invalid values default to no filter. |
| `repo` | Most endpoints | Passed as a SQL `LIKE` parameter with `%` wrapping. Used in parameterized queries only. |
| `since` | `/api/live/feed` | Validated as a parseable date via `new Date()`. Returns 400 if invalid. Normalized to ISO 8601 before SQL use. |
| `text` | `POST /api/practice/analyze` | Must be a string, max 10,000 characters. Returns 400 if missing or invalid. |
| `tag` | `GET /api/practice/library` | Validated against a whitelist of known tags. Invalid tags silently dropped. |
| `:id` | `/api/sessions/:id/*` | Path parameter used as a session ID lookup key. Passed to parameterized SQL queries. Returns 404 if not found. |

### SQL safety

All database queries use **parameterized statements** via `better-sqlite3`'s `.prepare().all()` / `.get()` API. No user input is interpolated into SQL strings.

### Regex safety

All 130+ regex patterns (in `src/patterns.mjs` and other analysis modules) have been audited for ReDoS. None use nested quantifiers, unbounded `.+`/`.*` in dangerous positions, or overlapping alternations.

## API Endpoints

All endpoints are read-only (GET) except where noted. The server exposes:

| Endpoint | Description |
|----------|-------------|
| `GET /api/summary` | Aggregate redirection stats |
| `GET /api/sessions` | List sessions with scores |
| `GET /api/sessions/:id` | Single session detail |
| `GET /api/sessions/:id/sprawl` | Session scope-creep analysis |
| `GET /api/sessions/:id/efficiency` | Session efficiency metrics |
| `GET /api/sessions/:id/replay` | Annotated turn-by-turn replay |
| `GET /api/sessions/:id/complexity` | Session complexity scoring |
| `GET /api/patterns` | Top correction patterns |
| `GET /api/trends` | Trend data for charts |
| `GET /api/pillar-trends` | Pillar score trends |
| `GET /api/insights` | Combined insights |
| `GET /api/suggestions` | Prompt rewrite suggestions |
| `GET /api/clarity` | First-turn clarity analysis |
| `GET /api/efficiency` | Efficiency batch analysis |
| `GET /api/delegation` | Delegation analysis |
| `GET /api/judgment` | Judgment quality analysis |
| `GET /api/instruction-gaps` | Missing instruction detection |
| `GET /api/instruction-failures` | Rule failure analysis |
| `GET /api/dev-plan` | Personalized dev plan |
| `GET /api/progress-check` | Daily check-in |
| `GET /api/retro` | Session retrospective |
| `GET /api/work-style` | Work style analysis |
| `GET /api/live/feed` | Real-time turn feed with pattern annotations |
| `POST /api/practice/analyze` | Instant prompt scoring (10,000 char limit) |
| `GET /api/practice/challenge` | Random low-scoring prompt from user sessions |
| `GET /api/practice/library` | Curated challenge library with tag filtering |
| `GET /api/practice/weaknesses` | Personalized category recommendations |
| `GET /api/analytics/hourly` | Hourly productivity |
| `GET /api/analytics/prompt-length` | Prompt length analysis |
| `GET /api/analytics/repos` | Repository health |
| `GET /api/analytics/hot-files` | Most-edited files |
| `GET /api/analytics/depth` | Session depth metrics |
| `GET /api/analytics/tools` | Tool usage statistics |
| `GET /api/analytics/create-edit-ratio` | Create vs. edit ratio |
| `GET /api/analytics/file-types` | File type diversity |
