// Instruction gap analysis — mines session corrections to find patterns
// that should be codified in .copilot-instructions.md, agent.md, or skills.

import { listSessions, getSessionTurns } from "./db.mjs";
import { matchPatterns } from "./patterns.mjs";

/**
 * Patterns that indicate the user is teaching the agent a convention
 * or preference that should be in an instruction file.
 */
const CONVENTION_PATTERNS = [
  // Style / formatting preferences
  { pattern: /\b(always|never)\s+(use|add|include|put|remove|import)\b/i, category: "convention", label: "Style rule" },
  { pattern: /\bdon'?t\s+use\s+(\w+)/i, category: "convention", label: "Tool/library preference" },
  { pattern: /\buse\s+(\w+)\s+instead\s+of\s+(\w+)/i, category: "convention", label: "Alternative preference" },
  { pattern: /\bwe\s+(use|prefer|always|never|don'?t)\b/i, category: "convention", label: "Team convention" },
  { pattern: /\bin\s+this\s+(project|repo|codebase)\b.*\b(we|always|never|use|prefer)\b/i, category: "convention", label: "Project-specific rule" },
  { pattern: /\bour\s+(convention|standard|pattern|style|approach)\b/i, category: "convention", label: "Explicit convention" },
  { pattern: /\bfollow\s+the\s+(same|existing)\s+(pattern|style|convention|approach)\b/i, category: "convention", label: "Pattern conformance" },

  // Architecture / structure preferences
  { pattern: /\bput\s+(it|that|this|files?)\s+(in|under|inside)\s+(\S+)/i, category: "structure", label: "File placement rule" },
  { pattern: /\bthat\s+(goes|belongs|should\s+be)\s+in\b/i, category: "structure", label: "Architecture guidance" },
  { pattern: /\bwe\s+(keep|store|organize)\b/i, category: "structure", label: "Organization pattern" },
  { pattern: /\bthe\s+(folder|directory|file)\s+structure\b/i, category: "structure", label: "Structure guidance" },

  // Naming conventions
  { pattern: /\bname\s+(it|them|the|this)\b.*\b(like|following|using|with)\b/i, category: "naming", label: "Naming convention" },
  { pattern: /\b(camelCase|snake_case|PascalCase|kebab-case)\b/i, category: "naming", label: "Case convention" },
  { pattern: /\bprefix\s+(with|it|them)\b/i, category: "naming", label: "Naming prefix rule" },

  // Testing preferences
  { pattern: /\b(test|spec)\s+(files?\s+)?(should|go|belong)\b/i, category: "testing", label: "Test structure" },
  { pattern: /\bwe\s+(test|mock|stub|assert)\b/i, category: "testing", label: "Testing approach" },
  { pattern: /\buse\s+(jest|vitest|mocha|pytest|rspec|xunit)\b/i, category: "testing", label: "Test framework" },

  // Error handling / patterns
  { pattern: /\b(handle|catch)\s+(errors?|exceptions?)\s+(like|using|with|by)\b/i, category: "error_handling", label: "Error handling pattern" },
  { pattern: /\bthrow\s+(a|an|new)\b/i, category: "error_handling", label: "Error throwing pattern" },

  // Import / dependency preferences
  { pattern: /\bimport\s+(from|using)\b.*\bnot\b/i, category: "imports", label: "Import preference" },
  { pattern: /\b(require|import)\s+.*\binstead\b/i, category: "imports", label: "Module system preference" },
];

/**
 * Extract convention signals from a user message.
 */
function extractConventions(message) {
  if (!message) return [];

  const cleaned = message
    .replace(/<[^>]*>[\s\S]*?<\/[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .trim();
  if (cleaned.length < 10) return [];

  const found = [];
  for (const p of CONVENTION_PATTERNS) {
    const m = cleaned.match(p.pattern);
    if (m) {
      found.push({
        category: p.category,
        label: p.label,
        matchedText: m[0],
        fullContext: cleaned.substring(
          Math.max(0, m.index - 30),
          Math.min(cleaned.length, m.index + m[0].length + 60)
        ),
      });
    }
  }
  return found;
}

/**
 * Analyze sessions for instruction gaps — repeated conventions that
 * should be codified in instruction files.
 */
export function analyzeInstructionGaps({ repo, since } = {}) {
  const sessions = listSessions({ repo, since });
  const conventionMap = {};
  const repoConventions = {};
  const examples = [];

  for (const s of sessions) {
    if (s.turn_count < 2) continue;
    const turns = getSessionTurns(s.id);
    const repoName = s.repository || "(no repo)";

    for (const t of turns) {
      if (!t.user_message) continue;

      // Check for convention signals
      const conventions = extractConventions(t.user_message);
      // Also check if this turn has a redirection — convention + redirect = strong signal
      const redirections = matchPatterns(t.user_message);
      const isRedirect = redirections.length > 0;

      for (const conv of conventions) {
        const key = `${conv.category}::${conv.label}`;
        if (!conventionMap[key]) {
          conventionMap[key] = {
            category: conv.category,
            label: conv.label,
            count: 0,
            withRedirect: 0,
            repos: new Set(),
            examples: [],
          };
        }
        conventionMap[key].count++;
        if (isRedirect) conventionMap[key].withRedirect++;
        conventionMap[key].repos.add(repoName);
        if (conventionMap[key].examples.length < 3) {
          conventionMap[key].examples.push({
            sessionId: s.id,
            repo: repoName,
            text: conv.fullContext,
          });
        }

        // Track per-repo
        if (!repoConventions[repoName]) repoConventions[repoName] = [];
        repoConventions[repoName].push(conv);
      }
    }
  }

  // Convert to sorted array
  const gaps = Object.values(conventionMap)
    .map((g) => ({
      ...g,
      repos: [...g.repos],
      repoCount: g.repos.size,
    }))
    .sort((a, b) => b.count - a.count);

  // Generate actionable suggestions
  const suggestions = generateInstructionSuggestions(gaps, repoConventions);

  // Category summary
  const categorySummary = {};
  for (const g of gaps) {
    if (!categorySummary[g.category]) categorySummary[g.category] = { count: 0, items: 0 };
    categorySummary[g.category].count += g.count;
    categorySummary[g.category].items++;
  }

  return {
    totalGaps: gaps.length,
    totalSignals: gaps.reduce((s, g) => s + g.count, 0),
    categorySummary,
    gaps: gaps.slice(0, 20),
    suggestions,
    repoBreakdown: Object.entries(repoConventions).map(([repo, convs]) => ({
      repo,
      conventionSignals: convs.length,
      topCategories: [...new Set(convs.map((c) => c.category))],
    })).sort((a, b) => b.conventionSignals - a.conventionSignals),
  };
}

/**
 * Generate concrete suggestions for instruction file improvements.
 */
function generateInstructionSuggestions(gaps, repoConventions) {
  const suggestions = [];

  // Find repeated conventions (3+ occurrences = should be in instructions)
  const repeated = gaps.filter((g) => g.count >= 2);
  if (repeated.length > 0) {
    suggestions.push({
      type: "instruction_file",
      priority: "high",
      emoji: "📝",
      title: "Add to .copilot-instructions.md",
      body: `You've stated ${repeated.length} conventions ${repeated[0].count}+ times. These should be in your instruction file so the agent knows them automatically.`,
      items: repeated.slice(0, 5).map((g) => ({
        label: g.label,
        example: g.examples[0]?.text || "",
        category: g.category,
      })),
    });
  }

  // Convention patterns — style rules
  const styleGaps = gaps.filter((g) => g.category === "convention");
  if (styleGaps.length > 0) {
    suggestions.push({
      type: "coding_style",
      priority: "medium",
      emoji: "🎨",
      title: "Codify Style Preferences",
      body: "You're correcting style choices manually. Add a style section to your instructions.",
      items: styleGaps.slice(0, 4).map((g) => ({
        label: g.label,
        example: g.examples[0]?.text || "",
        category: g.category,
      })),
    });
  }

  // Structure / architecture rules
  const structGaps = gaps.filter((g) => g.category === "structure");
  if (structGaps.length > 0) {
    suggestions.push({
      type: "architecture",
      priority: "medium",
      emoji: "🏗️",
      title: "Document Project Structure",
      body: "You're guiding file placement manually. Add an architecture section describing your folder structure.",
      items: structGaps.slice(0, 4).map((g) => ({
        label: g.label,
        example: g.examples[0]?.text || "",
        category: g.category,
      })),
    });
  }

  // Naming convention gaps
  const namingGaps = gaps.filter((g) => g.category === "naming");
  if (namingGaps.length > 0) {
    suggestions.push({
      type: "naming",
      priority: "low",
      emoji: "🏷️",
      title: "Set Naming Conventions",
      body: "Define your naming patterns (casing, prefixes, suffixes) in instructions.",
      items: namingGaps.slice(0, 3).map((g) => ({
        label: g.label,
        example: g.examples[0]?.text || "",
        category: g.category,
      })),
    });
  }

  // Multi-repo convention drift
  const multiRepo = gaps.filter((g) => g.repoCount > 1);
  if (multiRepo.length > 0) {
    suggestions.push({
      type: "global_instructions",
      priority: "high",
      emoji: "🌐",
      title: "Create Global Instructions",
      body: `${multiRepo.length} conventions appear across multiple repos. Consider adding them to your global Copilot settings.`,
      items: multiRepo.slice(0, 3).map((g) => ({
        label: g.label,
        repos: g.repos.join(", "),
        category: g.category,
      })),
    });
  }

  // No conventions found = positive signal
  if (gaps.length === 0) {
    suggestions.push({
      type: "positive",
      priority: "info",
      emoji: "✅",
      title: "Looking Good!",
      body: "No repeated convention corrections detected. Your instruction files seem well-configured.",
      items: [],
    });
  }

  return suggestions;
}
