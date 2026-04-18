// Curated library of bad prompts for the Practice Lab rewrite challenge.
// Each prompt is tagged with the best-practice principles it violates,
// sourced from published guidance by GitHub, Anthropic, Google, and OpenAI.
//
// Categories:
//   vague          — Too short or unspecific (all providers)
//   no-context     — Missing background or reasoning (Anthropic, OpenAI)
//   no-constraints — No boundaries or guardrails (GitHub, Anthropic)
//   no-criteria    — No success/acceptance criteria (Anthropic, Google)
//   no-examples    — Missing examples or sample I/O (GitHub, Anthropic, Google, OpenAI)
//   no-format      — No output format specified (Anthropic, Google, OpenAI)
//   no-steps       — Complex task not broken into steps (GitHub, Google, OpenAI)
//   no-files       — No file/path references (GitHub)
//   correction     — Reactive correction instead of proactive spec (Copilot Insights)
//   frustration    — Frustration signal instead of diagnostic info (Copilot Insights)
//   rollback       — Unscoped revert request (Copilot Insights)

/**
 * @typedef {Object} ChallengePrompt
 * @property {string} prompt - The bad prompt text
 * @property {string[]} tags - Best-practice categories violated
 * @property {string} hint - A short hint about what's missing
 */

/** @type {ChallengePrompt[]} */
const CHALLENGE_LIBRARY = [
  // ── Vague / Too Short ──────────────────────────────────────────
  { prompt: "fix the bug", tags: ["vague", "no-files", "no-context"], hint: "Which bug? In which file? What behavior do you see?" },
  { prompt: "make it work", tags: ["vague", "no-context", "no-criteria"], hint: "What's broken? What does 'working' look like?" },
  { prompt: "help", tags: ["vague"], hint: "Help with what? Be specific about the task." },
  { prompt: "do the auth thing", tags: ["vague", "no-files", "no-criteria"], hint: "What auth flow? Which files? What should happen?" },
  { prompt: "write tests", tags: ["vague", "no-files", "no-criteria"], hint: "Tests for what? Which module? What cases matter?" },
  { prompt: "add error handling", tags: ["vague", "no-files", "no-constraints"], hint: "Where? What errors? How should they be handled?" },
  { prompt: "refactor that file", tags: ["vague", "no-files", "no-criteria"], hint: "Which file? What's wrong with it? What should improve?" },
  { prompt: "update the styles to look better", tags: ["vague", "no-criteria", "no-files"], hint: "'Better' how? Colors? Layout? Mobile responsive?" },
  { prompt: "clean up the code", tags: ["vague", "no-files", "no-constraints"], hint: "Which code? What cleanup — unused vars, formatting, structure?" },
  { prompt: "the page is slow, optimize it", tags: ["vague", "no-files", "no-context"], hint: "Which page? What's slow — initial load, API calls, rendering?" },

  // ── Missing File References ────────────────────────────────────
  { prompt: "the login endpoint is returning the wrong status code", tags: ["no-files", "no-criteria"], hint: "Which file has the endpoint? What code is it returning vs. expected?" },
  { prompt: "there's a type error in the user service", tags: ["no-files", "no-context"], hint: "Paste the error message. Which file and line?" },
  { prompt: "the middleware isn't working correctly", tags: ["no-files", "no-criteria", "no-context"], hint: "Which middleware? What file? What's the actual vs. expected behavior?" },
  { prompt: "the database query is too slow", tags: ["no-files", "no-context"], hint: "Which query? Which file? How slow — and what's acceptable?" },
  { prompt: "the form validation is broken", tags: ["no-files", "no-criteria"], hint: "Which form? Which validation rules? What field fails?" },
  { prompt: "fix the import error", tags: ["no-files", "no-context"], hint: "Which file? What's the error message? Which module can't be found?" },
  { prompt: "the API response format is wrong", tags: ["no-files", "no-criteria", "no-format"], hint: "Which endpoint? What does it return vs. what you expect?" },
  { prompt: "something is wrong with the routing", tags: ["vague", "no-files", "no-context"], hint: "Which route? What URL pattern? What happens vs. what should?" },

  // ── Missing Context / Reasoning ────────────────────────────────
  { prompt: "change the timeout to 30 seconds", tags: ["no-context", "no-files"], hint: "Why 30 seconds? Where? What problem does this solve?" },
  { prompt: "add a loading spinner", tags: ["no-context", "no-files", "no-criteria"], hint: "Where? When should it show/hide? What component?" },
  { prompt: "switch from REST to GraphQL", tags: ["no-context", "no-steps", "no-constraints"], hint: "Why switch? Which endpoints? What's the migration plan?" },
  { prompt: "add caching to the API", tags: ["no-context", "no-constraints", "no-files"], hint: "What kind of cache (Redis, in-memory)? TTL? Which endpoints?" },
  { prompt: "make the search case-insensitive", tags: ["no-context", "no-files"], hint: "Which search? Which file? Any locale considerations?" },
  { prompt: "add rate limiting", tags: ["no-context", "no-constraints", "no-files"], hint: "What limit? Per-user or global? Which endpoints? What HTTP status on limit?" },
  { prompt: "enable dark mode", tags: ["no-context", "no-files", "no-steps"], hint: "For which pages? Toggle mechanism? CSS variables or theme provider?" },
  { prompt: "add pagination to the list", tags: ["no-context", "no-files", "no-criteria"], hint: "Which list? Page size? Cursor or offset? UI controls?" },

  // ── Missing Constraints / Boundaries ───────────────────────────
  { prompt: "refactor the auth module to use JWT", tags: ["no-constraints", "no-files", "no-steps"], hint: "Keep backward compat? Which files can change? What about existing sessions?" },
  { prompt: "migrate the database to PostgreSQL", tags: ["no-constraints", "no-steps", "no-context"], hint: "Scope? Data migration plan? Downtime acceptable? Which models affected?" },
  { prompt: "upgrade React to the latest version", tags: ["no-constraints", "no-steps"], hint: "Any breaking changes to watch for? Test everything or specific pages?" },
  { prompt: "rewrite the component in TypeScript", tags: ["no-constraints", "no-files"], hint: "Which component? Strict mode? Keep the same props interface?" },
  { prompt: "add OAuth login support", tags: ["no-constraints", "no-steps", "no-criteria"], hint: "Which providers? Scopes? How does it integrate with existing auth?" },
  { prompt: "implement role-based access control", tags: ["no-constraints", "no-steps", "no-criteria"], hint: "Which roles? Which routes need protection? Where are permissions stored?" },
  { prompt: "add file upload support", tags: ["no-constraints", "no-criteria", "no-files"], hint: "Max size? Allowed types? Where stored? Which endpoint?" },
  { prompt: "set up CI/CD", tags: ["no-constraints", "no-context", "no-steps"], hint: "Which platform (GitHub Actions, etc.)? What triggers? Deploy where?" },

  // ── Missing Acceptance Criteria ─────────────────────────────────
  { prompt: "improve the error messages", tags: ["no-criteria", "no-files"], hint: "What makes a message 'good'? User-facing or developer logs? Examples?" },
  { prompt: "make the dashboard more responsive", tags: ["no-criteria", "no-files"], hint: "Responsive at what breakpoints? Which components break?" },
  { prompt: "fix the performance issues", tags: ["no-criteria", "no-files", "no-context"], hint: "What metric? Current vs. target? Where's the bottleneck?" },
  { prompt: "add input validation", tags: ["no-criteria", "no-files", "no-constraints"], hint: "Which inputs? What rules (email format, length limits)? What error UX?" },
  { prompt: "make the notifications better", tags: ["no-criteria", "no-files", "vague"], hint: "'Better' how? Timing? Content? Delivery method?" },
  { prompt: "improve the search functionality", tags: ["no-criteria", "no-files", "vague"], hint: "Fuzzy matching? Filters? Ranking? What's wrong with current search?" },
  { prompt: "the onboarding flow needs work", tags: ["no-criteria", "no-files", "vague"], hint: "Which steps? What's confusing? What should the user achieve?" },
  { prompt: "add better logging", tags: ["no-criteria", "no-files", "no-constraints"], hint: "Log level? Structured (JSON)? Which functions? What fields?" },

  // ── Missing Examples / Sample I/O ──────────────────────────────
  { prompt: "write a function to parse dates from strings", tags: ["no-examples", "no-criteria", "no-files"], hint: "What formats? e.g. 'MM/DD/YYYY' → Date. Edge cases?" },
  { prompt: "create a regex to validate phone numbers", tags: ["no-examples", "no-constraints"], hint: "Which formats are valid? US only? e.g. '(555) 123-4567' → true" },
  { prompt: "transform the data into the right format", tags: ["no-examples", "no-format", "vague"], hint: "Show sample input and expected output." },
  { prompt: "write a function that calculates the score", tags: ["no-examples", "no-criteria", "no-files"], hint: "What's the formula? Show input→output examples." },
  { prompt: "parse the CSV and extract the relevant columns", tags: ["no-examples", "no-files", "no-format"], hint: "Which columns? What's the CSV structure? Sample row?" },
  { prompt: "convert the response to match our API schema", tags: ["no-examples", "no-format", "no-files"], hint: "Show the current shape vs. the target schema." },
  { prompt: "write a migration script for the user data", tags: ["no-examples", "no-steps", "no-constraints"], hint: "Old schema vs new? Show a sample record transformation." },
  { prompt: "create a slug generator for blog post titles", tags: ["no-examples", "no-constraints"], hint: "e.g. 'Hello World!' → 'hello-world'. Handle unicode? Max length?" },

  // ── Missing Output Format ──────────────────────────────────────
  { prompt: "give me a summary of the codebase architecture", tags: ["no-format", "no-constraints"], hint: "As markdown? Mermaid diagram? Bullet points? How detailed?" },
  { prompt: "list all the API endpoints", tags: ["no-format", "no-files"], hint: "As a table? JSON? Include methods, params, descriptions?" },
  { prompt: "document the database schema", tags: ["no-format", "no-files"], hint: "As SQL CREATE statements? Markdown table? ER diagram?" },
  { prompt: "explain how the auth flow works", tags: ["no-format", "no-constraints"], hint: "Sequence diagram? Step-by-step? For developers or end users?" },
  { prompt: "generate an API documentation page", tags: ["no-format", "no-constraints", "no-criteria"], hint: "OpenAPI spec? Markdown? What sections? Include examples?" },

  // ── Missing Step Structure ─────────────────────────────────────
  { prompt: "set up the project with authentication, database, and deployment", tags: ["no-steps", "no-constraints"], hint: "Break this into steps. Which first? Tech choices for each?" },
  { prompt: "implement a full CRUD API for products", tags: ["no-steps", "no-constraints", "no-criteria"], hint: "Start with model, then routes, then validation? What fields?" },
  { prompt: "build a user registration flow with email verification", tags: ["no-steps", "no-constraints"], hint: "Step 1: form, Step 2: API, Step 3: email, Step 4: verify. Details?" },
  { prompt: "migrate from JavaScript to TypeScript", tags: ["no-steps", "no-constraints", "no-files"], hint: "Which files first? Strict mode? All at once or incrementally?" },
  { prompt: "add internationalization support", tags: ["no-steps", "no-constraints", "no-context"], hint: "Which library (i18next)? Which languages? Start with which page?" },

  // ── Correction / Redirection Patterns ──────────────────────────
  { prompt: "no, use TypeScript not JavaScript", tags: ["correction", "no-context"], hint: "State the tech choice upfront: 'Use TypeScript for all new files.'" },
  { prompt: "that's wrong, I said REST not GraphQL", tags: ["correction", "no-context"], hint: "Include the API style in your original prompt with reasoning." },
  { prompt: "I already told you to use PostgreSQL", tags: ["correction", "frustration"], hint: "Restate the requirement with file references instead of referencing past context." },
  { prompt: "actually, scratch that and do it a different way", tags: ["correction", "vague", "no-context"], hint: "Explain why the current approach failed and what to try instead." },
  { prompt: "not that file, I meant the other one", tags: ["correction", "no-files"], hint: "Specify the exact file path from the start." },
  { prompt: "why did you change that? I didn't ask for that", tags: ["correction", "no-constraints"], hint: "Add boundaries: 'only modify files in src/api/, don't touch tests.'" },
  { prompt: "go back, that broke everything", tags: ["rollback", "vague", "no-context"], hint: "What broke? Revert which file specifically? Keep other changes?" },

  // ── Frustration Signals ────────────────────────────────────────
  { prompt: "it's still not working", tags: ["frustration", "vague", "no-context"], hint: "What's the error? What did you expect vs. what happened?" },
  { prompt: "this is completely wrong, start over", tags: ["frustration", "vague", "no-criteria"], hint: "What specifically is wrong? What does 'correct' look like?" },
  { prompt: "I've been asking for this for 5 turns now", tags: ["frustration", "no-context"], hint: "Restate the full requirement with all constraints and examples." },
  { prompt: "why does it keep doing the same wrong thing", tags: ["frustration", "no-context", "no-criteria"], hint: "Describe: 'It does X, but it should do Y because Z.'" },
  { prompt: "just make it like I said before", tags: ["frustration", "vague", "no-context"], hint: "Don't rely on prior context — restate the requirement completely." },

  // ── Ambiguous Scope ────────────────────────────────────────────
  { prompt: "update the app to use the new API", tags: ["vague", "no-files", "no-steps", "no-constraints"], hint: "Which API? Which endpoints change? Which files need updating?" },
  { prompt: "make it production-ready", tags: ["vague", "no-criteria", "no-steps"], hint: "What does 'production-ready' mean? Error handling? Logging? Security? Performance?" },
  { prompt: "implement the feature from the ticket", tags: ["vague", "no-context", "no-criteria"], hint: "Paste the requirements. Don't reference external context the agent can't see." },
  { prompt: "something is wrong with the API, investigate", tags: ["vague", "no-files", "no-context"], hint: "Which endpoint? What response? Any error messages or status codes?" },
  { prompt: "the deploy failed, can you look into it", tags: ["vague", "no-context", "no-files"], hint: "Paste the error log. Which step failed? What changed since last deploy?" },
  { prompt: "clean up the code and make it production ready", tags: ["vague", "no-criteria", "no-steps", "no-constraints"], hint: "Which code? What standards? Linting? Types? Tests? Security?" },

  // ── Multi-concern Prompts (several issues at once) ─────────────
  { prompt: "fix the API, add tests, and deploy it", tags: ["no-steps", "no-files", "no-constraints"], hint: "Break into separate steps. What's broken in the API? Which tests? Deploy where?" },
  { prompt: "refactor everything and add TypeScript", tags: ["vague", "no-steps", "no-files", "no-constraints"], hint: "'Everything' is too broad. Pick specific files, set priorities, define done." },
  { prompt: "make the app faster and look better on mobile", tags: ["no-criteria", "no-files", "no-steps"], hint: "Two separate tasks. Which pages? Target load time? Which breakpoints?" },
  { prompt: "add auth, logging, and error handling to all endpoints", tags: ["no-steps", "no-constraints", "no-files"], hint: "Start with one concern. Which auth strategy? What log format? Which errors?" },
  { prompt: "update all dependencies and fix any breaking changes", tags: ["no-steps", "no-constraints"], hint: "Major versions? One at a time? Which packages matter most? Run tests after each?" },
];

export default CHALLENGE_LIBRARY;
