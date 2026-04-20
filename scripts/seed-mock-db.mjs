#!/usr/bin/env node
// Generates a mock session-store.db with realistic Copilot CLI session data.

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, unlinkSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "..", "mock-session-store.db");

if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
const db = new Database(DB_PATH);

// ── Schema ──────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    repository TEXT,
    branch TEXT,
    summary TEXT,
    created_at TEXT,
    updated_at TEXT,
    host_type TEXT DEFAULT 'cli',
    cwd TEXT
  );
  CREATE TABLE IF NOT EXISTS turns (
    session_id TEXT,
    turn_index INTEGER,
    user_message TEXT,
    assistant_response TEXT,
    timestamp TEXT,
    PRIMARY KEY (session_id, turn_index)
  );
  CREATE TABLE IF NOT EXISTS session_files (
    session_id TEXT,
    file_path TEXT,
    tool_name TEXT,
    turn_index INTEGER,
    first_seen_at TEXT
  );
  CREATE TABLE IF NOT EXISTS session_refs (
    session_id TEXT,
    ref_type TEXT,
    ref_value TEXT,
    turn_index INTEGER,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS checkpoints (
    session_id TEXT,
    checkpoint_number INTEGER,
    title TEXT,
    overview TEXT,
    history TEXT,
    work_done TEXT,
    technical_details TEXT,
    important_files TEXT,
    next_steps TEXT,
    PRIMARY KEY (session_id, checkpoint_number)
  );
`);

// ── Helpers ─────────────────────────────────────────────────────

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function isoDate(date) {
  return date.toISOString();
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Data pools ──────────────────────────────────────────────────

const repos = [
  "user/web-app",
  "user/api-service",
  "user/mobile-app",
  "user/shared-utils",
];

const branches = [
  "feature/auth",
  "feature/dashboard",
  "feature/notifications",
  "feature/search",
  "feature/payments",
  "fix/login-bug",
  "fix/memory-leak",
  "fix/race-condition",
  "fix/null-pointer",
  "refactor/cleanup",
  "refactor/extract-service",
  "chore/update-deps",
];

const summaries = [
  "Implemented JWT authentication flow with refresh tokens",
  "Fixed login form validation and error handling",
  "Added user search with debounced input",
  "Refactored database queries for pagination support",
  "Created notification service with WebSocket updates",
  "Fixed memory leak in event listener cleanup",
  "Added unit tests for payment processing module",
  "Migrated REST endpoints to new router structure",
  "Built dashboard analytics charts with Recharts",
  "Fixed race condition in concurrent API calls",
  "Updated TypeScript types for API response models",
  "Added caching layer for frequently accessed data",
  "Implemented dark mode toggle with CSS variables",
  "Fixed null pointer in user profile component",
  "Refactored auth middleware into separate module",
  "Created shared utility functions for date formatting",
  "Added integration tests for checkout flow",
  "Fixed mobile responsiveness issues on settings page",
  "Implemented file upload with progress tracking",
  "Added rate limiting middleware to API endpoints",
  "Built user onboarding wizard component",
  "Fixed timezone handling in scheduled tasks",
  "Added error boundary components for React pages",
  "Implemented pagination for session list view",
  "Refactored CSS to use design tokens",
];

// Good messages — clear, focused prompts
const goodUserMessages = [
  "Add a login form component with email and password fields",
  "Create a REST endpoint for GET /api/users/:id",
  "Write unit tests for the calculateTotal function",
  "Add TypeScript types for the API response",
  "Refactor the auth middleware to use async/await",
  "Add error handling to the database connection",
  "Create a reusable Button component with variants",
  "Add pagination to the sessions list API endpoint",
  "Write a migration script for the new schema",
  "Add input validation for the signup form",
  "Create a custom hook for fetching data with loading state",
  "Implement the search bar with debounced queries",
  "Add CORS configuration for the Express server",
  "Write integration tests for the checkout flow",
  "Add a loading spinner component",
  "Create the user profile page layout",
  "Implement file upload with drag and drop",
  "Add rate limiting to the API endpoints",
  "Write a helper function for formatting dates",
  "Set up the WebSocket connection for notifications",
];

// Convention messages — user teaching the agent project rules
// These trigger instruction-gap detection ("always use", "don't use", "we use", "put files in")
const conventionMessages = [
  "Always use TypeScript in this project, not plain JavaScript",
  "Don't use class-based components — we only use functional components with hooks",
  "We always use vitest for testing, never jest",
  "Put test files in __tests__/ next to the source file",
  "Always use named exports, never default exports",
  "We use pnpm, not npm or yarn",
  "Don't use any inline styles — always use CSS modules",
  "Always add JSDoc comments to exported functions",
  "We always use Tailwind CSS for styling in this repo",
  "Put all API route handlers in src/routes/ directory",
  "Don't use console.log — use the project logger instead",
  "We prefer zod for validation over manual checks",
  "Always use async/await, never .then() chains",
  "Put shared types in src/types/ and import from there",
  "We use ESM imports, not CommonJS require",
  "Don't use any as a TypeScript type — be explicit",
];

// Redirection messages — user correcting the agent
const redirectionMessages = [
  "No, that's wrong. I said to use async/await, not callbacks",
  "Go back and undo that change, it broke the tests",
  "I already told you to use TypeScript, not plain JavaScript",
  "Actually, do it with a class component instead of hooks",
  "Undo that — the previous version was better",
  "Still broken. The error is on line 42, not line 30",
  "That's not what I asked for. Read my first message again",
  "No no no. Use PostgreSQL, not MySQL. I said this already",
  "Go back to the previous approach, this one doesn't work",
  "Wrong file! I said to edit src/auth.ts, not src/utils.ts",
  "Actually, scratch that. Let me rethink the approach",
  "This is still failing the same way. Try a different approach",
  "I keep telling you — the API returns an array, not an object",
  "Why did you change that file? I didn't ask for that",
  "That's completely wrong. The endpoint should be POST not GET",
  "No, revert those changes. You're modifying the wrong module",
  "You're repeating the same mistake. The type is string not number",
  "Still not working. Can you actually read the error message?",
  "I said add validation, not remove the existing checks",
  "Go back to step 1, everything since then has been wrong",
];

// Realistic assistant responses
const assistantResponses = [
  "I've created the component with the requested fields. Here's what I added:\n\n```tsx\nexport function LoginForm() {\n  const [email, setEmail] = useState('');\n  ...\n}\n```",
  "Done! I've added the REST endpoint at `src/routes/users.ts`. It handles GET requests and returns user data from the database.",
  "I've written 5 unit tests covering the main scenarios including edge cases for empty arrays and negative numbers.",
  "Updated the TypeScript types in `src/types/api.ts`. The new interface covers all response fields including optional metadata.",
  "Refactored the middleware to use async/await. I also added proper error handling with try/catch blocks.",
  "Added error handling with retry logic and connection pooling. The database will now gracefully handle connection failures.",
  "Created the Button component with 'primary', 'secondary', and 'danger' variants. It supports disabled state and loading indicator.",
  "I've added the pagination with `limit` and `offset` query parameters. The response now includes `total` count for the frontend.",
  "I see the issue — I was using the wrong import. Let me fix that and use the correct module path.",
  "You're right, I apologize for the confusion. Let me revert that change and implement it correctly with async/await.",
  "I've corrected the approach. Now using the proper API endpoint and handling the array response correctly.",
  "Fixed! The issue was a missing null check. I've added proper validation before accessing the property.",
  "I've reverted my changes and started fresh with the approach you specified. Here's the updated implementation.",
  "Good catch — I've updated the file path and made the edit in the correct location now.",
  "Applied the fix to the correct file. The tests should pass now with the updated type annotations.",
  "I've implemented the search functionality with a 300ms debounce to avoid excessive API calls.",
  "Set up the WebSocket connection with automatic reconnection logic and message queuing.",
  "Created the migration script with up/down functions. It adds the new columns and backfills existing data.",
  "Added comprehensive input validation using zod schema. Invalid inputs return descriptive error messages.",
  "Here's the custom hook:\n\n```ts\nexport function useFetch<T>(url: string) {\n  const [data, setData] = useState<T | null>(null);\n  ...\n}\n```",
];

const filePaths = [
  "src/components/LoginForm.tsx",
  "src/components/Button.tsx",
  "src/components/SearchBar.tsx",
  "src/components/UserProfile.tsx",
  "src/components/Dashboard.tsx",
  "src/components/Sidebar.tsx",
  "src/routes/users.ts",
  "src/routes/auth.ts",
  "src/routes/sessions.ts",
  "src/routes/payments.ts",
  "src/middleware/auth.ts",
  "src/middleware/rateLimit.ts",
  "src/services/database.ts",
  "src/services/notifications.ts",
  "src/services/cache.ts",
  "src/utils/dates.ts",
  "src/utils/validation.ts",
  "src/types/api.ts",
  "src/types/user.ts",
  "tests/auth.test.ts",
  "tests/users.test.ts",
  "tests/payments.test.ts",
  "package.json",
  "tsconfig.json",
  ".env",
];

// ── Generate sessions ───────────────────────────────────────────

const insertSession = db.prepare(
  `INSERT INTO sessions (id, repository, branch, summary, created_at, updated_at, host_type, cwd)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertTurn = db.prepare(
  `INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp)
   VALUES (?, ?, ?, ?, ?)`
);
const insertFile = db.prepare(
  `INSERT INTO session_files (session_id, file_path, tool_name, turn_index, first_seen_at)
   VALUES (?, ?, ?, ?, ?)`
);
const insertRef = db.prepare(
  `INSERT INTO session_refs (session_id, ref_type, ref_value, turn_index, created_at)
   VALUES (?, ?, ?, ?, ?)`
);

const sessionCount = 25;
const vscodeSessionCount = 8;  // ~25% VSCode sessions for realistic mix
const sessionIds = [];

const seedAll = db.transaction(() => {
  const totalSessions = sessionCount + vscodeSessionCount;

  for (let i = 0; i < totalSessions; i++) {
    const sid = randomUUID();
    sessionIds.push(sid);

    const isVscode = i >= sessionCount; // last batch are VSCode sessions
    const repo = pick(repos);
    const branch = pick(branches);
    const summary = pick(summaries);
    const startDay = randInt(1, 30);
    const created = daysAgo(startDay);
    const updated = new Date(created.getTime() + randInt(10, 120) * 60000);
    const hostType = isVscode ? "vscode" : "cli";
    const cwd = isVscode
      ? `/home/dev/projects/${repo.split("/")[1]}`
      : `/home/dev/projects/${repo.split("/")[1]}`;

    insertSession.run(
      sid, repo, branch, summary,
      isoDate(created), isoDate(updated),
      hostType, cwd
    );

    // Determine session quality: ~40% will be "bad" (lots of redirections)
    // VSCode sessions tend to have longer assistant responses (more tokens)
    const isBadSession = Math.random() < 0.4;
    const turnCount = isVscode ? randInt(3, 10) : randInt(5, 15);
    const redirectionRate = isBadSession ? 0.5 : 0.1;

    const sessionFiles = [];

    for (let t = 0; t < turnCount; t++) {
      const roll = Math.random();
      const isRedirection = roll < redirectionRate;
      const isConvention = !isRedirection && roll < redirectionRate + 0.15;
      const userMsg = isRedirection
        ? pick(redirectionMessages)
        : isConvention
          ? pick(conventionMessages)
          : pick(goodUserMessages);
      // VSCode responses tend to be longer (include code blocks, explanations)
      let assistantMsg = pick(assistantResponses);
      if (isVscode && Math.random() < 0.6) {
        assistantMsg += "\n\n```typescript\n// Additional implementation detail\nexport function handle() {\n  return { status: 'ok' };\n}\n```\n\nI've also updated the related tests.";
      }
      const turnTime = new Date(created.getTime() + t * randInt(30, 300) * 1000);

      insertTurn.run(sid, t, userMsg, assistantMsg, isoDate(turnTime));

      // Generate file edits for some turns
      if (Math.random() < 0.7) {
        const filePath = pick(filePaths);
        const toolName = Math.random() < 0.3 ? "create" : "edit";
        insertFile.run(sid, filePath, toolName, t, isoDate(turnTime));
        sessionFiles.push(filePath);
      }
    }

    // For bad sessions, add extra edits on the same file (thrashing)
    if (isBadSession) {
      const thrashFile = pick(filePaths);
      const thrashCount = randInt(3, 6);
      for (let f = 0; f < thrashCount; f++) {
        const turnIdx = randInt(0, turnCount - 1);
        const turnTime = new Date(created.getTime() + turnIdx * randInt(30, 300) * 1000);
        insertFile.run(sid, thrashFile, "edit", turnIdx, isoDate(turnTime));
      }
    }

    // Add refs for some sessions
    if (Math.random() < 0.6) {
      const commitSha = randomUUID().replace(/-/g, "").slice(0, 12);
      insertRef.run(sid, "commit", commitSha, turnCount - 1, isoDate(updated));
    }
    if (Math.random() < 0.3) {
      const prNum = String(randInt(100, 500));
      insertRef.run(sid, "pr", prNum, turnCount - 1, isoDate(updated));
    }

    // Add checkpoints for ~40% of sessions (longer ones)
    if (turnCount >= 8 && Math.random() < 0.4) {
      const cpCount = randInt(1, 3);
      const insertCheckpoint = db.prepare(
        `INSERT INTO checkpoints (session_id, checkpoint_number, title, overview, work_done, next_steps)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const cpTitles = ["Initial setup and scaffolding", "Core feature implementation", "Testing and polish"];
      const cpOverviews = [
        "Set up project structure and installed dependencies.",
        "Implemented the main feature with tests.",
        "Added error handling, documentation, and final polish.",
      ];
      const cpWorkDone = [
        "Created package.json, configured build tools, set up directory structure.",
        "Built core logic, added API endpoints, wrote unit tests.",
        "Fixed edge cases, added JSDoc comments, updated README.",
      ];
      const cpNextSteps = [
        "Implement core business logic and write tests.",
        "Add error handling and edge case coverage.",
        "Final review, merge PR, deploy.",
      ];
      for (let c = 0; c < cpCount; c++) {
        insertCheckpoint.run(sid, c + 1, cpTitles[c], cpOverviews[c], cpWorkDone[c], cpNextSteps[c]);
      }
    }
  }

  // ── Live Monitor: add a few sessions with very recent turns ──────
  const liveMessages = [
    "Refactor the auth middleware to validate JWT expiry before checking roles",
    "No, that's not right — the token refresh should happen BEFORE the role check",
    "Add rate limiting to the /api/upload endpoint, max 10 requests per minute",
    "Can you also add unit tests for the rate limiter?",
    "The test is failing because you're not mocking the Redis client",
    "Update the README with the new API endpoints we added today",
    "Actually, use markdown tables for the endpoint docs instead of bullet points",
    "Deploy the staging build and verify the health check endpoint",
  ];
  const liveAssistantMsgs = [
    "I'll refactor the auth middleware. Here's the updated flow:\n\n```ts\nasync function authMiddleware(req, res, next) {\n  const token = extractToken(req);\n  if (isExpired(token)) return res.status(401).json({ error: 'Token expired' });\n  ...\n}\n```",
    "You're right — I've moved the token refresh before the role check. The updated middleware now refreshes first, then validates roles.",
    "I've added rate limiting using a sliding window counter. The `/api/upload` endpoint now returns 429 after 10 requests per minute per IP.",
    "Here are the unit tests for the rate limiter covering: normal flow, limit exceeded, window reset, and concurrent requests.",
    "Good catch — I've added a Redis mock using `ioredis-mock`. All 4 tests now pass.",
    "I've updated the README with the new endpoints. Each one includes method, path, description, and example request/response.",
    "Done — switched from bullet points to markdown tables. The endpoint docs now show Method | Path | Description | Auth Required columns.",
    "Deployed to staging. Health check at `/health` returns `{ status: 'ok', version: '2.1.0' }` with 200 OK.",
  ];

  for (let ls = 0; ls < 2; ls++) {
    const liveSid = randomUUID();
    const liveRepo = pick(repos);
    const liveBranch = pick(branches);
    const liveSummary = ls === 0 ? "Refactor auth middleware and add rate limiting" : "Update docs and deploy staging";
    const liveCreated = new Date(Date.now() - randInt(5, 30) * 60000);
    const liveUpdated = new Date(Date.now() - randInt(1, 4) * 60000);

    insertSession.run(
      liveSid, liveRepo, liveBranch, liveSummary,
      isoDate(liveCreated), isoDate(liveUpdated),
      "cli", `/home/dev/projects/${liveRepo.split("/")[1]}`
    );

    const turnOffset = ls * 4;
    for (let t = 0; t < 4; t++) {
      const minutesAgo = (4 - t) * randInt(2, 6);
      const turnTime = new Date(Date.now() - minutesAgo * 60000);
      insertTurn.run(liveSid, t, liveMessages[turnOffset + t], liveAssistantMsgs[turnOffset + t], isoDate(turnTime));
    }
  }
});

seedAll();
db.close();

console.log(`✅ Seeded ${sessionCount + vscodeSessionCount} sessions (${sessionCount} CLI + ${vscodeSessionCount} VSCode) → ${DB_PATH}`);
