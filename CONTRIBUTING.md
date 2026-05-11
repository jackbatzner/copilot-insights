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
3. **Run the tests**: `npm test` (must pass — tests run in CI and are a merge gate)
4. **Lint your code**: `npm run lint`
5. **Build the UI** to verify: `cd ui && npm run build`
6. **Test the server**: `cd server && node index.mjs` → check API endpoints
7. Submit a **pull request** with a clear description

> **CI gate:** Pull requests run lint, tests, and builds across Node 18/20/22. All checks must pass before merging.

## Testing

```bash
npm test        # runs node --test test/*.test.mjs
npm run lint    # runs eslint across the project
```

Before submitting a PR:

1. **Run the tests:** `npm test` (should pass with no failures — currently 316 tests across 80 suites)
2. **Run the linter:** `npm run lint` (should complete with no errors)
3. **Build the UI:** `cd ui && npm run build` (should complete with no errors)
4. **Start the server:** `cd server && node index.mjs` → visit http://localhost:3002
5. **Check all pages:** Navigate through Overview, Skill Building, Analytics, Sessions, Practice, VS Code, Live Monitor, Token Usage, and Instructions
6. **Check the console:** Open browser dev tools (F12) and verify no JavaScript errors

## Code Style

- ES modules throughout (`.mjs` for Node, `.jsx` for React)
- No TypeScript (yet) — keep it simple
- Minimal dependencies — don't add packages for things Node.js handles natively
- Dark theme CSS uses CSS custom properties defined in `ui/src/index.css` — **never use hardcoded colors** (e.g., `#161b22`), always use `var(--bg-card)`, `var(--text)`, etc. so dark mode works
- New pages should consume the shared `TimeframeContext` via `useTimeframe()` (see `ui/src/TimeframeContext.jsx`) rather than managing timeframe state locally
- **Hooks ordering** — all `useState`, `useEffect`, `useContext`, and other hooks must be called before any conditional `return` statements. This is a React requirement (Rules of Hooks) and has been a recurring issue
- **Component decomposition** — Large page components (300+ lines) should be split into a directory with `index.jsx` (orchestrator), individual tab/section components, `shared.jsx` (reusable sub-components), and a context file if prop drilling becomes unwieldy. See `ui/src/pages/SkillBuilding/` for the reference pattern
- **State context vs props** — Use React Context (e.g., `DevPlanContext`) to share state across deeply nested component trees instead of passing props through multiple layers. Only create a context when 3+ components need the same state
- **API resilience** — Use `safeFetch()` from `ui/src/api.js` for all API calls; prefer `Promise.allSettled` over `Promise.all` for parallel requests; always include a retry mechanism in error states

## Accessibility

All new UI components must meet these requirements:

- **ARIA attributes** — Interactive elements need appropriate ARIA roles and properties (`aria-expanded`, `aria-controls`, `aria-selected`, `aria-label`, etc.)
- **Keyboard navigation** — All interactive elements must be reachable via Tab. Tab bars and selector groups must support arrow key navigation (see `TabBar.jsx` for the WAI-ARIA Tabs pattern)
- **Focus styles** — Use `:focus-visible` for keyboard focus indicators. The global style in `index.css` provides a `var(--accent)` outline; override `outline-offset` as needed for specific components
- **Dark mode support** — Use CSS custom properties (`var(--text)`, `var(--bg-card)`, `var(--border)`, etc.) instead of hardcoded colors. Both `:root` (dark) and `:root[data-theme="light"]` must have valid contrast ratios

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
