// Prompt rewrite suggestions — takes actual redirection messages and
// generates concrete before/after examples showing how to prompt better.

import { analyzeRecent } from "./analyzer.mjs";
import { REDIRECTION_CATEGORIES } from "./patterns.mjs";

/**
 * Rewrite templates keyed by pattern category.
 * Each entry provides general advice and example rewrites.
 */
const REWRITE_GUIDES = {
  explicit_correction: {
    principle: "Be specific upfront",
    tips: [
      "Include the exact tool, file, or approach you want",
      "Reference existing code patterns: 'follow the pattern in src/auth.ts'",
      "State constraints early: 'use X, not Y'",
    ],
    rewrites: [
      {
        trigger: "no use",
        before: "No, use the search API not the scraping approach",
        after: "Use the search API (not web scraping) for all data retrieval in this task.",
        why: "States the tool preference upfront with clear scope",
      },
      {
        trigger: "no let",
        before: "No let's make a plugin to launch the dashboard",
        after: "Create a CLI plugin (not a standalone script) that launches the dashboard server.",
        why: "Specifies the desired architecture pattern from the start",
      },
      {
        trigger: "wrong",
        before: "This is wrong — it should be a POST not a GET",
        after: "Implement this endpoint as POST /api/dispatches/consume (not GET) since it has side effects.",
        why: "Specifying the HTTP method and reasoning upfront avoids the correction",
      },
    ],
  },
  course_change: {
    principle: "Plan before you prompt",
    tips: [
      "Use plan mode for complex tasks — outline the approach first",
      "Break large tasks into smaller, well-defined steps",
      "If you're unsure, ask the agent to propose options before implementing",
    ],
    rewrites: [
      {
        trigger: "actually",
        before: "Actually, can we do it differently? Use React instead of vanilla JS",
        after: "Build this dashboard using React + Vite (not vanilla JS). I want component-based architecture for maintainability.",
        why: "Stating the tech choice with rationale eliminates mid-task pivots",
      },
      {
        trigger: "instead",
        before: "Instead of that, put the logic in a separate module",
        after: "Create a separate module for the analysis logic (src/analyzer.mjs) — keep the extension entry point thin.",
        why: "Specifying file structure upfront guides the architecture",
      },
      {
        trigger: "scratch",
        before: "Scratch that, try something else",
        after: "The current approach isn't working because [reason]. Let's try [alternative] instead.",
        why: "Explaining WHY you're pivoting helps the agent avoid the same mistake",
      },
    ],
  },
  frustration: {
    principle: "Diagnose, don't repeat",
    tips: [
      "When something fails, describe what you see vs. what you expected",
      "Share error messages or screenshots — don't just say 'it doesn't work'",
      "Break the problem down: 'the API responds correctly but the UI shows stale data'",
    ],
    rewrites: [
      {
        trigger: "still",
        before: "Still not working",
        after: "The server returns 200 but the dashboard still shows an empty table. I think the issue is in the fetch call — can you check the response parsing?",
        why: "Specific symptoms + hypothesis gives the agent a clear debugging path",
      },
      {
        trigger: "already said",
        before: "I already said to use TypeScript",
        after: "This file should be TypeScript (.ts). Please also convert the other new files in src/ to TypeScript for consistency.",
        why: "Restating the requirement with scope prevents future misses too",
      },
      {
        trigger: "why did",
        before: "Why did you delete my tests?",
        after: "The test file tests/auth.test.ts was removed — that was unintended. Please restore it and make sure the new changes don't modify existing test files.",
        why: "Describing the impact and adding a guard rail for the future",
      },
    ],
  },
  rollback: {
    principle: "Review incrementally",
    tips: [
      "Ask for changes one file at a time for risky operations",
      "Use 'show me the plan first' before implementation",
      "Set boundaries: 'only modify files in src/api/, don't touch tests'",
    ],
    rewrites: [
      {
        trigger: "undo",
        before: "Undo that, go back to what we had",
        after: "The last change broke the login flow. Revert only the changes to src/auth.ts — keep the other files as-is.",
        why: "Scoping what to revert prevents losing other good work",
      },
      {
        trigger: "go back",
        before: "Go back to the previous approach",
        after: "The new caching approach adds too much complexity. Let's use the simpler in-memory Map approach from before, but add a TTL of 5 minutes.",
        why: "Specifying what was good about the old approach guides the revert",
      },
    ],
  },
  repetition: {
    principle: "Add context when re-requesting",
    tips: [
      "If repeating, explain what was missed the first time",
      "Reference the specific turn or output that needs fixing",
      "Add constraints to narrow the scope",
    ],
    rewrites: [
      {
        trigger: "again",
        before: "Try again",
        after: "The formatting is still off — the table headers should use Title Case and the columns need right-alignment for numbers. Can you fix just the table rendering?",
        why: "Adding specifics to the retry gives the agent a better target",
      },
    ],
  },
};

/**
 * Generate prompt improvement suggestions from actual session data.
 */
export function generateSuggestions({ repo, limit = 500, since } = {}) {
  const result = analyzeRecent({ repo, limit, since });
  const suggestions = [];

  // Collect actual redirection messages grouped by category
  const byCategory = {};
  for (const s of result.sessions) {
    for (const r of s.redirections) {
      for (const m of r.matches) {
        if (!byCategory[m.category]) byCategory[m.category] = [];
        byCategory[m.category].push({
          message: r.message,
          label: m.label,
          sessionId: s.session.id,
          repo: s.session.repository,
        });
      }
    }
  }

  // Generate suggestions per category
  for (const [category, messages] of Object.entries(byCategory)) {
    const guide = REWRITE_GUIDES[category];
    if (!guide) continue;

    const catMeta = REDIRECTION_CATEGORIES[category] || {
      emoji: "❓",
      label: category,
    };

    // Find matching rewrites from our templates
    const matchedRewrites = [];
    for (const rewrite of guide.rewrites) {
      const matchingMsg = messages.find((m) =>
        m.message.toLowerCase().includes(rewrite.trigger)
      );
      if (matchingMsg) {
        matchedRewrites.push({
          ...rewrite,
          actualMessage: cleanMsg(matchingMsg.message),
          sessionId: matchingMsg.sessionId,
        });
      }
    }

    // If no template matches, use the first message with generic advice
    if (matchedRewrites.length === 0 && messages.length > 0) {
      matchedRewrites.push({
        before: cleanMsg(messages[0].message),
        after: `[Try being more specific about what you want and why]`,
        why: guide.principle,
        actualMessage: cleanMsg(messages[0].message),
      });
    }

    suggestions.push({
      category,
      categoryLabel: catMeta.label,
      categoryEmoji: catMeta.emoji,
      principle: guide.principle,
      tips: guide.tips,
      count: messages.length,
      rewrites: matchedRewrites.slice(0, 3),
    });
  }

  // Sort by occurrence count
  suggestions.sort((a, b) => b.count - a.count);

  return suggestions;
}

function cleanMsg(msg) {
  return msg
    .replace(/<[^>]+>/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 200);
}
