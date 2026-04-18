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
