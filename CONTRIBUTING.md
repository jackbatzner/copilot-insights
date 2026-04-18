# Contributing to Copilot Insights

Thanks for your interest in contributing! This project helps developers improve their AI prompting by analyzing Copilot CLI session logs.

## Prerequisites

- **Node.js 18+** (check with `node --version`)
- **Copilot CLI** installed and used at least once (creates `~/.copilot/session-store.db`)

## Setup

```bash
git clone https://github.com/jackbatzner/copilot-insights.git
cd copilot-insights
npm run setup
```

## Development

```bash
# Run the API server (serves built UI + API on :3002)
cd server && npm start

# Or run UI in dev mode with hot reload
cd ui && npm run dev       # → http://localhost:5174
cd server && npm run dev   # → http://localhost:3002 (API only)
```

## Project Structure

```
src/           → Core analysis modules (patterns, scoring, DB access)
server/        → Express API server
ui/            → React + Vite dashboard frontend
extension.mjs  → Copilot CLI extension entry point
```

## Making Changes

1. **Fork** the repo and create a feature branch
2. Make your changes
3. **Lint your code**: `npm run lint`
4. **Build the UI** to verify: `cd ui && npm run build`
5. **Test the server**: `cd server && node index.mjs` → check API endpoints
6. Submit a **pull request** with a clear description

## Testing

```bash
npm test        # runs node --test test/*.test.mjs
npm run lint    # runs eslint across the project
```

Before submitting a PR:

1. **Run the tests:** `npm test` (should pass with no failures)
2. **Run the linter:** `npm run lint` (should complete with no errors)
3. **Build the UI:** `cd ui && npm run build` (should complete with no errors)
4. **Start the server:** `cd server && node index.mjs` → visit http://localhost:3002
5. **Check all pages:** Navigate through Overview, Coaching, Learn, Analytics, Instructions, Sessions, Practice, and Live Monitor
6. **Check the console:** Open browser dev tools (F12) and verify no JavaScript errors

## Code Style

- ES modules throughout (`.mjs` for Node, `.jsx` for React)
- No TypeScript (yet) — keep it simple
- Minimal dependencies — don't add packages for things Node.js handles natively
- Dark theme CSS uses CSS variables defined in `ui/src/index.css`

## Adding Redirection Patterns

New patterns go in `src/patterns.mjs`. Each pattern needs:
- A `regex` (tested against user messages)
- A `category` (one of: `explicit_correction`, `course_change`, `frustration`, `repetition`, `rollback`)
- A `label` (human-readable name)
- A `weight` (1=mild, 2=moderate, 3=strong signal)

## Reporting Issues

- Include your Node.js version
- Include the error message or unexpected behavior
- Session data stays local — never share your `session-store.db`
