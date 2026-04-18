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
