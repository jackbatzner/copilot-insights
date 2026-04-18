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
- CORS is restricted to `localhost` origins via regex: `/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/`.
- Request body size is limited to 50 KB (`express.json({ limit: "50kb" })`).
- The app reads your local Copilot session database (`~/.copilot/session-store.db`) in **read-only** mode.
- Goal data is stored locally at `~/.copilot/insights-goals.json`.
- No data is transmitted to external services.
- No authentication is required because the server is only accessible to the local user.
- Error responses return generic messages — stack traces are logged server-side only, never sent to clients.

## API Endpoints

All endpoints are **read-only** (GET). Query parameters are validated as follows:

| Parameter | Validation | Used by |
|-----------|-----------|---------|
| `repo` | Optional string, used as substring filter | Most endpoints |
| `timeframe` | Strict regex `^(\d+)d$` or literal `"all"` | Most endpoints |
| `id` (path) | UUID from database lookup, returns 404 if not found | Session endpoints |

### Endpoint List

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/summary` | Aggregate redirection stats |
| GET | `/api/sessions` | List sessions with redirection counts |
| GET | `/api/sessions/:id` | Single session analysis |
| GET | `/api/sessions/:id/replay` | Turn-by-turn session replay |
| GET | `/api/sessions/:id/complexity` | Session complexity scoring |
| GET | `/api/sessions/:id/sprawl` | Scope sprawl analysis |
| GET | `/api/sessions/:id/efficiency` | Session efficiency metrics |
| GET | `/api/patterns` | Top redirection patterns |
| GET | `/api/trends` | Redirection trends over time |
| GET | `/api/pillar-trends` | Weekly pillar score trends |
| GET | `/api/insights` | Session insights summary |
| GET | `/api/suggestions` | Prompt rewrite suggestions |
| GET | `/api/clarity` | Prompt clarity analysis |
| GET | `/api/efficiency` | Efficiency metrics |
| GET | `/api/delegation` | Delegation analysis |
| GET | `/api/judgment` | Judgment analysis |
| GET | `/api/instruction-gaps` | Instruction gap detection |
| GET | `/api/instruction-failures` | Instruction failure analysis |
| GET | `/api/dev-plan` | Personalized dev plan |
| GET | `/api/progress-check` | Daily progress check-in |
| GET | `/api/retro` | Session retrospective |
| GET | `/api/work-style` | Work style analysis |
| GET | `/api/analytics/hourly` | Hourly activity breakdown |
| GET | `/api/analytics/prompt-length` | Prompt length distribution |
| GET | `/api/analytics/repos` | Per-repo stats |
| GET | `/api/analytics/hot-files` | Most-edited files |
| GET | `/api/analytics/depth` | Session depth analysis |
| GET | `/api/analytics/tools` | Tool usage stats |
| GET | `/api/analytics/create-edit-ratio` | File create vs. edit ratio |
| GET | `/api/analytics/file-types` | File type breakdown |
