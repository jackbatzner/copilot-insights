# Support

## Getting Help

- **Bug reports** — [Open an issue](https://github.com/jackbatzner/copilot-insights/issues/new?template=bug_report.md) using the bug report template.
- **Feature requests** — [Open an issue](https://github.com/jackbatzner/copilot-insights/issues/new?template=feature_request.md) using the feature request template.
- **Questions** — [Start a discussion](https://github.com/jackbatzner/copilot-insights/discussions) in the Discussions tab.
- **Security issues** — Follow the private disclosure guidance in [SECURITY.md](SECURITY.md). Do **not** post vulnerabilities in public issues or discussions.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No sessions found" / empty dashboard | Run `copilot` to create local history, check **Settings → Data Sources**, then Refresh. Source presence does not guarantee supported usage fields. |
| "Port 3002 already in use" | Launch on another port with `copilot-insights --port 3003`; do not terminate unrelated processes. |
| "Cannot find module 'better-sqlite3'" | From a source checkout, run `npm install` in the project root. If you need to bypass root install scripts, run `npm run setup` instead. |
| Dashboard loads but shows errors | Ensure the server is running (`npm start`). Check the terminal for errors. |
| Metrics take a long time to appear | A cold history or new filter may require a source scan. Loading placeholders and a longer-wait message are expected; no fixed completion time is guaranteed. A failed request offers Retry. See [Loading and navigation](README.md#loading-and-navigation). |
| Page fails after a local app update | Use **Reload app** on the error screen. Sidebar **Refresh** reloads usage, not application files; URL filters are retained. |
| UI build fails with dependency errors | Run `cd ui && npm install --legacy-peer-deps && npm run build`. |
| Text unexpectedly visible in Session Detail | Original local text is visible by default and may contain sensitive information. Use **Hide all text** or enable **Presentation mode** before sharing your screen. Only the preference is saved, not text. |
| VS Code enabled but usage unavailable | Content-only history cannot provide supported usage metadata. The app does not estimate usage from prompts or replies. |
| Timeframe totals differ from a billing period | The timeframe selects sessions by activity; totals cover their whole recorded history. Model/scope/UTC-day filters select matching usage observations. |
| Compare models dollars differ from a Copilot bill | These are standard-rate token-price benchmarks with explicit cache assumptions, not recorded Copilot spend. |
| No later session after saving a baseline | Run a comparable task, then use **Check for newer sessions**. The saved baseline has no automatic expiry; the later comparison uses whole history, not only usage since saving. |
| A turn contains several calls but does not explain why | Inspect the recorded ownership and ending labels. They describe how calls ended, not a verified retry, tool continuation or trigger for the next call. See [Inspect turns and model calls](README.md#inspect-turns-and-model-calls). |
| Turns or child linkage are unavailable | Exact request rows and stable same-session links are required. Aggregate-only history cannot reconstruct calls; missing ownership stays unattributed rather than being guessed. |
| A previously used model is absent from trial choices | Retired models remain in history and saved baselines but are excluded from new choices. The bundled support catalog is dated; Refresh does not update it or verify your account's entitlement. |
| An earlier page or tool is missing | See [Upgrading from the earlier dashboard](README.md#upgrading-from-the-earlier-dashboard) for relocated and removed features. |

Share only sanitized diagnostics and synthetic reproductions. Never attach source
databases, raw event files, transcripts, credentials or local paths. Presentation
mode hides text but does not make real usage suitable for a public gallery.

## Supported Versions

See [SECURITY.md](SECURITY.md#supported-versions) for the supported-version policy.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up a development environment and submit changes.
