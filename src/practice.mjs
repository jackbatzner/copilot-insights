// Shared prompt analyzer — pure function, no DB dependency.
// Runs pattern matching + quality heuristics on a single prompt string.

import { matchPatterns, REDIRECTION_CATEGORIES } from "./patterns.mjs";

// Compact coaching tips per category (DB-free alternative to suggestions.mjs)
const COACHING_TIPS = {
  explicit_correction: {
    principle: "Be specific upfront",
    tip: "Include the exact tool, file, or approach you want from the start.",
    rewrite: "State your preferred approach in the first message: 'Use X (not Y) because…'",
  },
  course_change: {
    principle: "Plan before you prompt",
    tip: "Use plan mode for complex tasks — outline the approach first.",
    rewrite: "Break the task into steps upfront: 'First do X, then Y, finally Z.'",
  },
  frustration: {
    principle: "Diagnose, don't repeat",
    tip: "Describe what you see vs. what you expected, and share error messages.",
    rewrite: "Instead of 'still broken', try: 'The server returns 200 but the UI shows empty — check the response parsing.'",
  },
  repetition: {
    principle: "Add context when re-requesting",
    tip: "Explain what was missed the first time and add constraints to narrow scope.",
    rewrite: "Instead of 'try again', add specifics: 'The table headers need Title Case and right-aligned numbers.'",
  },
  rollback: {
    principle: "Review incrementally",
    tip: "Ask for changes one file at a time and set boundaries on what can be modified.",
    rewrite: "Instead of 'undo that', try: 'Revert only src/auth.ts — keep the other files as-is.'",
  },
};

// Heuristic regexes
const FILE_REF_RE = /\b[\w./-]+\.\w{1,5}\b/;
const CONSTRAINT_RE = /\b(must|only|don't|do not|never|always|required|ensure|make sure)\b/i;
const SPECIFIC_RE = /(\bfunction\s+\w|class\s+\w|\/[\w/]+\.\w+|line\s+\d|\w+\(\))/i;
const CONTEXT_RE = /\b(error|expected|actual|returns?|output|result|because|since|the issue is)\b/i;

const GRADE_THRESHOLDS = [
  { min: 90, grade: "A", label: "Excellent" },
  { min: 75, grade: "B", label: "Good" },
  { min: 60, grade: "C", label: "Fair" },
  { min: 40, grade: "D", label: "Needs work" },
  { min: 0, grade: "F", label: "Poor" },
];

/**
 * Analyze a single prompt for quality and redirection patterns.
 * Pure function — no DB access.
 *
 * @param {string} text - The user prompt to analyze
 * @returns {{ score: number, grade: string, gradeLabel: string, patterns: Array, categories: object, suggestions: Array, heuristics: object }}
 */
export function analyzePrompt(text) {
  if (!text || typeof text !== "string" || text.trim().length < 3) {
    return {
      score: 0,
      grade: "F",
      gradeLabel: "Too short to analyze",
      patterns: [],
      categories: {},
      suggestions: [],
      heuristics: {},
    };
  }

  const trimmed = text.trim();

  // 1. Pattern matching
  const patterns = matchPatterns(trimmed);

  // 2. Quality heuristics
  const heuristics = {
    hasFileReference: FILE_REF_RE.test(trimmed),
    hasConstraints: CONSTRAINT_RE.test(trimmed),
    isSpecific: SPECIFIC_RE.test(trimmed),
    hasContext: CONTEXT_RE.test(trimmed),
    isAppropriateLength: trimmed.length >= 20 && trimmed.length <= 2000,
    length: trimmed.length,
  };

  // 3. Scoring: start at 100, deduct for patterns, bonus for heuristics
  let score = 100;

  // Deduct for each matched pattern (weight × 8)
  const patternPenalty = patterns.reduce((sum, p) => sum + p.weight * 8, 0);
  score -= patternPenalty;

  // Heuristic bonuses (only apply if there are some patterns to offset)
  let heuristicBonus = 0;
  if (heuristics.hasFileReference) heuristicBonus += 3;
  if (heuristics.hasConstraints) heuristicBonus += 3;
  if (heuristics.isSpecific) heuristicBonus += 3;
  if (heuristics.hasContext) heuristicBonus += 3;
  if (heuristics.isAppropriateLength) heuristicBonus += 3;

  // Bonuses only partially offset penalties — cap at half the penalty
  if (patternPenalty > 0) {
    score += Math.min(heuristicBonus, Math.floor(patternPenalty / 2));
  }

  // Penalize terse prompts even without pattern matches
  if (trimmed.length < 20 && patterns.length === 0) {
    score -= 25;
  }

  score = Math.max(0, Math.min(100, score));

  // 4. Grade
  const gradeInfo = GRADE_THRESHOLDS.find((g) => score >= g.min) || GRADE_THRESHOLDS[GRADE_THRESHOLDS.length - 1];

  // 5. Category aggregation
  const categories = {};
  for (const p of patterns) {
    if (!categories[p.category]) {
      const meta = REDIRECTION_CATEGORIES[p.category] || { emoji: "❓", label: p.category };
      categories[p.category] = {
        label: meta.label,
        emoji: meta.emoji,
        count: 0,
        weight: 0,
      };
    }
    categories[p.category].count++;
    categories[p.category].weight += p.weight;
  }

  // 6. Suggestions — one per detected category
  const suggestions = [];
  const seenCategories = new Set();
  for (const p of patterns) {
    if (seenCategories.has(p.category)) continue;
    seenCategories.add(p.category);

    const tip = COACHING_TIPS[p.category];
    if (tip) {
      suggestions.push({
        category: p.category,
        principle: tip.principle,
        tip: tip.tip,
        rewrite: tip.rewrite,
      });
    }
  }

  return {
    score,
    grade: gradeInfo.grade,
    gradeLabel: gradeInfo.label,
    patterns,
    categories,
    suggestions,
    heuristics,
  };
}
