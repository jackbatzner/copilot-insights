// Practice prompt analyzer — analyzes a prompt text for quality and
// redirection patterns without requiring database access.
// Used by the Practice Lab dashboard and the CLI coaching tool.

import { matchPatterns, REDIRECTION_CATEGORIES } from "./patterns.mjs";

/**
 * Rewrite guides by category — sourced from suggestions.mjs patterns.
 * Kept here as a lightweight copy so practice.mjs has no DB dependency.
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
        trigger: /\bno[,.]?\s+(use|don'?t|do not|stop)/i,
        before: "No, use the search API not the scraping approach",
        after: "Use the search API (not web scraping) for all data retrieval in this task.",
        why: "States the tool preference upfront with clear scope",
      },
      {
        trigger: /\bwrong|incorrect|not\s+(right|correct|what)/i,
        before: "This is wrong — it should be a POST not a GET",
        after: "Implement this endpoint as POST /api/dispatches/consume (not GET) since it has side effects.",
        why: "Specifying the HTTP method and reasoning upfront avoids the correction",
      },
      {
        trigger: /\bnot\s+what\s+I/i,
        before: "That's not what I asked for",
        after: "I need [specific thing] — the output should [concrete criteria]. Please re-read my original request.",
        why: "Restating the exact requirement prevents ambiguity",
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
        trigger: /\bactually/i,
        before: "Actually, can we do it differently? Use React instead of vanilla JS",
        after: "Build this dashboard using React + Vite (not vanilla JS). I want component-based architecture for maintainability.",
        why: "Stating the tech choice with rationale eliminates mid-task pivots",
      },
      {
        trigger: /\binstead/i,
        before: "Instead of that, put the logic in a separate module",
        after: "Create a separate module for the analysis logic (src/analyzer.mjs) — keep the extension entry point thin.",
        why: "Specifying file structure upfront guides the architecture",
      },
      {
        trigger: /\bscratch\s+that|never\s*mind/i,
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
        trigger: /\bstill\s+(broken|wrong|not\s+working|failing)/i,
        before: "Still not working",
        after: "The server returns 200 but the dashboard still shows an empty table. I think the issue is in the fetch call — can you check the response parsing?",
        why: "Specific symptoms + hypothesis gives the agent a clear debugging path",
      },
      {
        trigger: /\balready\s+(said|told|asked|mentioned)/i,
        before: "I already said to use TypeScript",
        after: "This file should be TypeScript (.ts). Please also convert the other new files in src/ to TypeScript for consistency.",
        why: "Restating the requirement with scope prevents future misses too",
      },
      {
        trigger: /\bwhy\s+(did|does|is)/i,
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
        trigger: /\b(undo|revert|rollback)/i,
        before: "Undo that, go back to what we had",
        after: "The last change broke the login flow. Revert only the changes to src/auth.ts — keep the other files as-is.",
        why: "Scoping what to revert prevents losing other good work",
      },
      {
        trigger: /\bgo\s+back|previous|original/i,
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
        trigger: /\bagain|one\s+more\s+time|like\s+I\s+said/i,
        before: "Try again",
        after: "The formatting is still off — the table headers should use Title Case and the columns need right-alignment for numbers. Can you fix just the table rendering?",
        why: "Adding specifics to the retry gives the agent a better target",
      },
    ],
  },
};

/**
 * Evaluate prompt quality heuristics (independent of pattern matching).
 * Returns an object with boolean flags and a detail array.
 */
function evaluateHeuristics(text) {
  const details = [];
  const words = text.trim().split(/\s+/).length;
  const chars = text.trim().length;

  // Length check
  if (chars < 20) {
    details.push({ id: "too-short", label: "Very short prompt", severity: "warning", tip: "Longer prompts with context tend to get better results. Aim for at least a sentence." });
  } else if (chars > 2000) {
    details.push({ id: "very-long", label: "Very long prompt", severity: "info", tip: "Consider breaking this into smaller, focused requests." });
  } else {
    details.push({ id: "good-length", label: "Good length", severity: "ok", tip: "Prompt length is reasonable." });
  }

  // Specificity — mentions files, paths, or code references
  const hasFilePaths = /(?:\/[\w.-]+){2,}|[\w.-]+\.(ts|js|jsx|tsx|py|go|rs|mjs|css|html|json|yaml|yml|md|sql)\b/.test(text);
  if (hasFilePaths) {
    details.push({ id: "has-files", label: "References specific files", severity: "ok", tip: "Mentioning file paths helps the agent target the right code." });
  } else if (words > 10) {
    details.push({ id: "no-files", label: "No file references", severity: "info", tip: "Consider mentioning specific files or paths to help the agent find the right code." });
  }

  // Constraints — uses words like "must", "should", "don't", "only", "not"
  const hasConstraints = /\b(must|should|don'?t|do not|only|never|always|require|ensure|avoid|without)\b/i.test(text);
  if (hasConstraints) {
    details.push({ id: "has-constraints", label: "Includes constraints", severity: "ok", tip: "Constraints help the agent understand boundaries." });
  } else if (words > 15) {
    details.push({ id: "no-constraints", label: "No constraints specified", severity: "info", tip: "Try adding constraints: 'don't modify tests', 'use TypeScript', 'only change src/api/'." });
  }

  // Acceptance criteria — mentions "should", "expect", "when...then", "return", "output"
  const hasCriteria = /\b(should\s+\w+|expect|when\s+.+\s+then|returns?|outputs?|results?\s+in|produces?)\b/i.test(text);
  if (hasCriteria) {
    details.push({ id: "has-criteria", label: "Has acceptance criteria", severity: "ok", tip: "Clear expected outcomes help the agent verify its work." });
  } else if (words > 20) {
    details.push({ id: "no-criteria", label: "No acceptance criteria", severity: "info", tip: "Describe the expected outcome: 'the API should return a 200 with...'." });
  }

  // Context — mentions "because", "since", "so that", "in order to"
  const hasContext = /\b(because|since|so\s+that|in\s+order\s+to|the\s+reason|this\s+is\s+for)\b/i.test(text);
  if (hasContext) {
    details.push({ id: "has-context", label: "Provides reasoning", severity: "ok", tip: "Explaining why helps the agent make better decisions." });
  }

  return {
    wordCount: words,
    charCount: chars,
    hasFilePaths,
    hasConstraints,
    hasCriteria,
    hasContext,
    details,
  };
}

/**
 * Compute a quality score (0-100) from pattern matches and heuristics.
 * Starts at 100, deducts for detected issues, adds for good practices.
 */
function computeScore(matches, heuristics) {
  let score = 100;

  // Deductions for redirection patterns
  for (const m of matches) {
    score -= m.weight * 10;
  }

  // Deductions for heuristic warnings
  for (const d of heuristics.details) {
    if (d.severity === "warning") score -= 10;
    if (d.severity === "info") score -= 3;
  }

  // Bonuses for good practices
  if (heuristics.hasFilePaths) score += 5;
  if (heuristics.hasConstraints) score += 5;
  if (heuristics.hasCriteria) score += 5;
  if (heuristics.hasContext) score += 3;

  return Math.max(0, Math.min(100, score));
}

/**
 * Find matching rewrite suggestions for the detected patterns.
 */
function findRewrites(text, matches) {
  const rewrites = [];
  const seenCategories = new Set();

  for (const m of matches) {
    if (seenCategories.has(m.category)) continue;
    seenCategories.add(m.category);

    const guide = REWRITE_GUIDES[m.category];
    if (!guide) continue;

    // Find the best matching rewrite template
    const rewrite = guide.rewrites.find((r) => r.trigger.test(text));
    if (rewrite) {
      rewrites.push({
        category: m.category,
        categoryLabel: REDIRECTION_CATEGORIES[m.category]?.label || m.category,
        categoryEmoji: REDIRECTION_CATEGORIES[m.category]?.emoji || "❓",
        principle: guide.principle,
        tips: guide.tips,
        before: rewrite.before,
        after: rewrite.after,
        why: rewrite.why,
      });
    } else {
      // Fallback: use general advice
      rewrites.push({
        category: m.category,
        categoryLabel: REDIRECTION_CATEGORIES[m.category]?.label || m.category,
        categoryEmoji: REDIRECTION_CATEGORIES[m.category]?.emoji || "❓",
        principle: guide.principle,
        tips: guide.tips,
        before: null,
        after: null,
        why: guide.principle,
      });
    }
  }

  return rewrites;
}

/**
 * Score label and color based on score value.
 */
function scoreGrade(score) {
  if (score >= 90) return { label: "Excellent", color: "green" };
  if (score >= 70) return { label: "Good", color: "yellow" };
  if (score >= 50) return { label: "Needs Work", color: "orange" };
  return { label: "Poor", color: "red" };
}

/**
 * Analyze a prompt text for quality and redirection patterns.
 * Pure function — no DB access. Works in both server and CLI contexts.
 *
 * @param {string} text - The prompt text to analyze.
 * @returns {object} Analysis result with score, patterns, categories, suggestions, heuristics.
 */
export function analyzePrompt(text) {
  if (!text || typeof text !== "string" || text.trim().length < 3) {
    return {
      score: 0,
      grade: { label: "Empty", color: "red" },
      patterns: [],
      categories: {},
      suggestions: [],
      heuristics: { wordCount: 0, charCount: 0, details: [] },
    };
  }

  const matches = matchPatterns(text);
  const heuristics = evaluateHeuristics(text);
  const score = computeScore(matches, heuristics);
  const grade = scoreGrade(score);

  // Group matches by category
  const categories = {};
  for (const m of matches) {
    if (!categories[m.category]) {
      const meta = REDIRECTION_CATEGORIES[m.category] || { label: m.category, emoji: "❓" };
      categories[m.category] = {
        label: meta.label,
        emoji: meta.emoji,
        count: 0,
        totalWeight: 0,
        patterns: [],
      };
    }
    categories[m.category].count++;
    categories[m.category].totalWeight += m.weight;
    categories[m.category].patterns.push({
      label: m.label,
      weight: m.weight,
      matchedText: m.matchedText,
    });
  }

  const suggestions = findRewrites(text, matches);

  return {
    score,
    grade,
    patterns: matches,
    categories,
    suggestions,
    heuristics,
  };
}
