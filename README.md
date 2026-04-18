<p align="center">
  <img src="logo.svg" alt="Copilot Insights" width="96" />
</p>

<h1 align="center">Copilot Insights</h1>

<p align="center">
  <strong>Understand how you prompt. Get better at it.</strong><br/>
  A dashboard and Copilot CLI extension that analyzes your AI coding sessions<br/>to help you communicate more effectively with AI agents.
</p>

<p align="center">
  <a href="https://github.com/jackbatzner/copilot-insights/actions/workflows/ci.yml"><img src="https://github.com/jackbatzner/copilot-insights/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/copilot-insights"><img src="https://img.shields.io/npm/v/copilot-insights" alt="npm version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
  <img src="https://img.shields.io/node/v/copilot-insights" alt="Node version" />
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#dashboard">Dashboard</a> •
  <a href="#cli-tools">CLI Tools</a> •
  <a href="#how-it-works">How It Works</a>
</p>

---

## Why?

Every time you say "no, not that" or "go back to the previous approach," that's signal. It means there's a gap between what you asked for and what the agent did. **Copilot Insights** surfaces those moments so you can learn from them.

- 📊 **See your patterns** — Which corrections do you make most often?
- 💡 **Get coaching** — Personalized dev plans, daily check-ins, and retros
- 📈 **Watch your trends** — Pillar scores over 7/30/90 days or all time
- 🔍 **Replay sessions** — Annotated turn-by-turn session replay

Inspired by [this investigation](https://dfberry.github.io/#if-youre-building-an-agent-on-top-of-copilot) into using Copilot session data as telemetry for agent improvement.

## What It Detects

| Category | Examples |
|----------|----------|
| 🚫 **Explicit Correction** | "no, that's wrong", "not what I asked", "this is wrong" |
| ↩️ **Course Change** | "actually, do X instead", "scratch that", "I changed my mind" |
| 😤 **Frustration Signal** | "still broken", "I already said", "why did you do that" |
| 🔁 **Repeated Instruction** | "like I said", "one more time", "again" |
| ⏪ **Rollback Request** | "undo that", "go back", "revert", "change it back" |

It also detects **file thrashing** — when the same file is edited 3+ times in a session, which often indicates unclear requirements.

## Quick Start

### Prerequisites

- **Node.js 18+**
- **[Copilot CLI](https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-in-the-command-line)** installed and used at least once (creates `~/.copilot/session-store.db`)
- **OS:** macOS, Linux, or Windows

### 1. Install

**Option A: npm (recommended)**

```bash
npx copilot-insights
# → http://localhost:3002
```

Or install globally:

```bash
npm i -g copilot-insights
copilot-insights
```

**Option B: From source**

```bash
git clone https://github.com/jackbatzner/copilot-insights.git
cd copilot-insights
npm run setup
```

### 2. Launch the Dashboard

```bash
npm start          # if installed from source
copilot-insights   # if installed globally via npm
# → http://localhost:3002
```

Open [http://localhost:3002](http://localhost:3002) to see your dashboard.

### 3. Use as a Copilot CLI Extension (optional)

To get insights directly inside Copilot CLI chat, install it as an extension:

```bash
# Symlink into your Copilot extensions directory
ln -s "$(pwd)" ~/.copilot/extensions/copilot-insights
```

Then restart Copilot CLI. The extension registers 7 tools that the agent can invoke:

```
> How am I doing with my prompting?          → insights_summary
> Scan my recent sessions                    → insights_analyze
> What are my most common correction patterns? → insights_patterns
> Compare sessions abc123 and def456         → insights_compare
> Launch the insights dashboard              → insights_dashboard
```

## Dashboard

The web dashboard gives you a full view of your prompting habits:

<p align="center">
  <img src="docs/screenshots/overview.png" alt="Overview dashboard" width="800" />
</p>

<details>
<summary>📸 More screenshots</summary>

**Sessions list** — sortable, filterable by repo

<img src="docs/screenshots/sessions.png" alt="Sessions list" width="800" />

**Coaching** — delegation, judgment, and feedback analysis with tips

<img src="docs/screenshots/coaching.png" alt="Agent coaching" width="800" />

**Analytics** — work style, prompt length, session depth

<img src="docs/screenshots/analytics.png" alt="Analytics" width="800" />

**Learn & Grow** — personalized dev plan, check-ins, retros

<img src="docs/screenshots/learn.png" alt="Learn and grow" width="800" />

**Session Detail** — turn-by-turn replay with annotations

<img src="docs/screenshots/session-detail.png" alt="Session detail" width="800" />

</details>

### Pages

- **Overview** — Stats cards, trend chart, category donut, pillar trends, work-style analysis
- **Learn & Grow** — Personalized dev plan, daily check-in, retros, resources
- **Sessions** — Sortable table of all sessions with redirections, filterable by repo
- **Session Detail** — Turn-by-turn timeline showing exactly where corrections happened
- **Analytics** — Hourly productivity, prompt length, repo health, tool usage
- **Coaching** — Delegation, judgment, and instruction gap analysis

All pages include a **timeframe selector** (7d / 30d / 90d / All time).

## CLI Tools

| Tool | Description |
|------|-------------|
| `insights_analyze` | Scan recent sessions, ranked by correction severity |
| `insights_session` | Deep-dive a specific session with turn-by-turn timeline |
| `insights_patterns` | Most common correction patterns with real examples |
| `insights_summary` | Quick snapshot: tier badge, pillar scores, coaching tip |
| `insights_compare` | Compare two sessions side-by-side |
| `insights_dashboard` | Launch the web dashboard from the CLI |
| `insights_stop` | Stop the dashboard server |

## How It Works

The extension reads from `~/.copilot/session-store.db` (read-only), the SQLite database where Copilot CLI stores session history. It scans user messages against 30+ regex patterns, categorizes matches, and scores the results.

```
~/.copilot/session-store.db (read-only)
  → Read user messages from turns table
  → Match against 30+ correction patterns
  → Categorize and aggregate
  → Serve via Express API → React dashboard
```

**Privacy:** All data stays local. The tool only reads your existing session database — it never writes to it, and nothing is sent to external services.

## Development

```bash
# UI dev mode (hot reload on :5174, proxies API to :3002)
cd ui && npm run dev

# Server dev mode (auto-restart on changes)
cd server && npm run dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Architecture

```mermaid
graph LR
    subgraph "Data Source"
        DB[(~/.copilot/session-store.db)]
    end

    subgraph "Analysis Engine"
        DB -->|read-only| Analyzer[analyzer.mjs]
        Analyzer --> Patterns[30+ regex patterns]
        Analyzer --> Pillars[Clarity · Efficiency · Delegation]
        Analyzer --> Tiers[Tier scoring]
    end

    subgraph "Delivery"
        Analyzer --> API[Express API :3002]
        API --> UI[React Dashboard]
        Analyzer --> CLI[Copilot CLI Extension]
        CLI --> Tools[7 insights_* tools]
    end
```

```
copilot-insights/
├── extension.mjs          # Copilot CLI extension entry point (7 tools)
├── src/
│   ├── db.mjs             # SQLite read-only access
│   ├── patterns.mjs       # 30+ regex patterns, 5 categories
│   ├── analyzer.mjs       # Core analysis engine
│   ├── tiers.mjs          # Tier badge system (shared UI + CLI)
│   ├── suggestions.mjs    # Prompt rewrite engine
│   ├── delegation.mjs     # Delegation analysis
│   ├── judgment.mjs       # Judgment analysis
│   ├── dev-plan.mjs       # Personalized coaching
│   └── formatter.mjs      # Markdown formatting (CLI output)
├── server/
│   └── index.mjs          # Express API + static UI
├── ui/src/
│   ├── pages/             # Overview, Learn, Sessions, SessionDetail, Analytics, Coaching
│   └── components/        # Charts, badges, timeline, insights
├── scripts/               # Mock data seeder + screenshot capture
└── .github/workflows/     # CI + Release (npm publish)
```

## License

[MIT](LICENSE)

## Troubleshooting

**"No sessions found" / empty dashboard**
- You need at least one Copilot CLI session. Run `copilot` in any repo to create one.
- Check the database exists: `ls ~/.copilot/session-store.db`

**"Port 3002 already in use"**
- Kill the existing process, or use a different port: `PORT=3003 npm start`

**"Cannot find module 'better-sqlite3'"**
- Run `npm run setup` in the project root to install all dependencies.

**Dashboard loads but shows errors**
- Ensure the server is running (`npm start`) before opening the dashboard.
- Check the terminal for server-side error messages.

## Future Ideas

- **Gamification** — Scoring, XP, levels, achievements, and goals to encourage improvement
- **Live monitoring** — Flag corrections as they happen in real-time
- **Team leaderboards** — Anonymous comparison across teams
- **Custom instruction generation** — Auto-generate `.github/copilot-instructions.md` from common patterns
- **OpenTelemetry tracing** — Opt-in distributed tracing via `@github/copilot-sdk` for debugging
