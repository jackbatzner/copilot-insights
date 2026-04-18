// Redirection pattern definitions.
// Each pattern has a category, weight (severity), and matching logic.

/**
 * Categories of redirection signals:
 *   explicit_correction  — User directly says "no", "wrong", "undo"
 *   course_change        — User pivots direction: "actually", "instead", "wait"
 *   frustration          — User shows impatience: "still broken", "I already said"
 *   repetition           — User repeats an earlier instruction
 *   rollback             — User asks to revert or go back
 */

export const REDIRECTION_CATEGORIES = {
  explicit_correction: {
    label: "Explicit Correction",
    emoji: "🚫",
    description: "User directly rejects or corrects the agent's output",
  },
  course_change: {
    label: "Course Change",
    emoji: "↩️",
    description: "User changes direction mid-task",
  },
  frustration: {
    label: "Frustration Signal",
    emoji: "😤",
    description: "User shows impatience or repeats themselves",
  },
  repetition: {
    label: "Repeated Instruction",
    emoji: "🔁",
    description: "User re-states something they already said",
  },
  rollback: {
    label: "Rollback Request",
    emoji: "⏪",
    description: "User asks to undo, revert, or go back",
  },
};

/**
 * Regex-based pattern matchers.
 * Each entry: { pattern, category, weight, label }
 *
 * weight: 1 = mild signal, 2 = moderate, 3 = strong redirection
 *
 * Patterns are tested against the user message (case-insensitive).
 * We use word boundaries (\b) to avoid false positives inside longer words.
 */
export const PATTERNS = [
  // ── Explicit corrections ──────────────────────────────────────
  {
    pattern: /\bno[,.]?\s+(don'?t|do not|stop|that'?s not|that is not|wrong)/i,
    category: "explicit_correction",
    weight: 3,
    label: "Direct rejection",
  },
  {
    pattern: /\bthat'?s\s+(wrong|incorrect|not\s+(right|correct|what))/i,
    category: "explicit_correction",
    weight: 3,
    label: "Declared wrong",
  },
  {
    pattern: /\bnot\s+what\s+I\s+(asked|wanted|meant|said)/i,
    category: "explicit_correction",
    weight: 3,
    label: "Intent mismatch",
  },
  {
    pattern: /\bwrong\s+(file|approach|way|method|thing|one)/i,
    category: "explicit_correction",
    weight: 2,
    label: "Wrong target",
  },
  {
    pattern: /\bthis\s+is\s+wrong/i,
    category: "explicit_correction",
    weight: 3,
    label: "Direct correction",
  },
  {
    pattern: /\bno\s+use\b/i,
    category: "explicit_correction",
    weight: 2,
    label: "Correct approach",
  },
  {
    pattern: /\bno\s+let'?s?\b/i,
    category: "explicit_correction",
    weight: 2,
    label: "Redirect action",
  },

  // ── Course changes ────────────────────────────────────────────
  {
    pattern: /\bactually[,.]?\s/i,
    category: "course_change",
    weight: 2,
    label: "Mid-course pivot",
  },
  {
    pattern: /\binstead[,.]?\s/i,
    category: "course_change",
    weight: 2,
    label: "Alternative chosen",
  },
  {
    pattern: /\bwait[,.]?\s/i,
    category: "course_change",
    weight: 1,
    label: "Pause & redirect",
  },
  {
    pattern: /\brather\s+than\b/i,
    category: "course_change",
    weight: 2,
    label: "Preference override",
  },
  {
    pattern: /\bI\s+changed\s+my\s+mind\b/i,
    category: "course_change",
    weight: 3,
    label: "Explicit mind change",
  },
  {
    pattern: /\blet'?s\s+(try|do)\s+(something|it)\s+(else|differently)\b/i,
    category: "course_change",
    weight: 2,
    label: "Different approach requested",
  },
  {
    pattern: /\bscratch\s+that\b/i,
    category: "course_change",
    weight: 3,
    label: "Full retraction",
  },
  {
    pattern: /\bnever\s*mind\b/i,
    category: "course_change",
    weight: 2,
    label: "Abandoned direction",
  },

  // ── Frustration signals ───────────────────────────────────────
  {
    pattern: /\bstill\s+(broken|wrong|not\s+working|failing|no\s+dice|doesn'?t)/i,
    category: "frustration",
    weight: 3,
    label: "Persistent failure",
  },
  {
    pattern: /\bI\s+(already|just)\s+(said|told|asked|mentioned)\b/i,
    category: "frustration",
    weight: 3,
    label: "Repeated instruction (frustrated)",
  },
  {
    pattern: /\bwhy\s+(did|does|is|are|would)\s+(you|it|this)\b/i,
    category: "frustration",
    weight: 2,
    label: "Questioning agent behavior",
  },
  {
    pattern: /\bas\s+I\s+(said|mentioned|asked)\b/i,
    category: "frustration",
    weight: 2,
    label: "Referring back",
  },
  {
    pattern: /\bthat\s+didn'?t\s+(work|help|fix|solve)\b/i,
    category: "frustration",
    weight: 2,
    label: "Failed attempt",
  },
  {
    pattern: /\bno\s+dice\b/i,
    category: "frustration",
    weight: 2,
    label: "Failure idiom",
  },
  {
    pattern: /\bshouldn'?t\s+this\b/i,
    category: "frustration",
    weight: 1,
    label: "Expected behavior mismatch",
  },

  // ── Repetition ────────────────────────────────────────────────
  {
    pattern: /\bagain[,.]?\s/i,
    category: "repetition",
    weight: 1,
    label: "Re-request",
  },
  {
    pattern: /\blike\s+I\s+said\b/i,
    category: "repetition",
    weight: 2,
    label: "Self-reference",
  },
  {
    pattern: /\bone\s+more\s+time\b/i,
    category: "repetition",
    weight: 2,
    label: "Retry request",
  },

  // ── Rollback requests ─────────────────────────────────────────
  {
    pattern: /\b(undo|revert|rollback|roll\s+back)\b/i,
    category: "rollback",
    weight: 3,
    label: "Explicit undo",
  },
  {
    pattern: /\bgo\s+back\b/i,
    category: "rollback",
    weight: 2,
    label: "Go back",
  },
  {
    pattern: /\bput\s+(it|that|this)\s+back\b/i,
    category: "rollback",
    weight: 2,
    label: "Restore original",
  },
  {
    pattern: /\bchange\s+(it|that|this)\s+back\b/i,
    category: "rollback",
    weight: 3,
    label: "Revert change",
  },
  {
    pattern: /\bthe\s+(original|previous|old)\s+(version|way|approach|code)\b/i,
    category: "rollback",
    weight: 2,
    label: "Prefer original",
  },
];

/**
 * Match a user message against all patterns. Returns an array of matches.
 */
export function matchPatterns(message) {
  if (!message || typeof message !== "string") return [];

  // Strip cross-session messages, skill contexts, and other XML blocks entirely
  const cleaned = message
    .replace(/<cross_session_message>[\s\S]*?<\/cross_session_message>/gi, "")
    .replace(/<skill-context[^>]*>[\s\S]*?<\/skill-context>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .trim();
  if (cleaned.length < 3) return [];

  const matches = [];
  for (const p of PATTERNS) {
    const m = cleaned.match(p.pattern);
    if (m) {
      matches.push({
        category: p.category,
        weight: p.weight,
        label: p.label,
        matchedText: m[0],
      });
    }
  }
  return matches;
}
