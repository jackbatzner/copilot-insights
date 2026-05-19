# Support

## Getting Help

- **Bug reports** — [Open an issue](https://github.com/jackbatzner/copilot-insights/issues/new?template=bug_report.md) using the bug report template.
- **Feature requests** — [Open an issue](https://github.com/jackbatzner/copilot-insights/issues/new?template=feature_request.md) using the feature request template.
- **Questions** — [Start a discussion](https://github.com/jackbatzner/copilot-insights/discussions) in the Discussions tab.
- **Security issues** — Follow the private disclosure guidance in [SECURITY.md](SECURITY.md). Do **not** post vulnerabilities in public issues or discussions.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No sessions found" / empty dashboard | Run `copilot` in any repo to create a session. Confirm that `~/.copilot/session-store.db` exists on your machine. |
| "Port 3002 already in use" | Kill the existing process, or launch on another port with `copilot-insights --port 3003`. |
| "Cannot find module 'better-sqlite3'" | From a source checkout, run `npm install` in the project root. If you need to bypass root install scripts, run `npm run setup` instead. |
| Dashboard loads but shows errors | Ensure the server is running (`npm start`). Check the terminal for errors. |
| UI build fails with dependency errors | Run `cd ui && npm install --legacy-peer-deps && npm run build`. |

## Supported Versions

See [SECURITY.md](SECURITY.md) for the supported version table.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up a development environment and submit changes.
