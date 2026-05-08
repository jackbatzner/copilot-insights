// Canonical pillar definitions — single source of truth for both Coaching and Learn tabs.
// Grounded in the 2026 Microsoft Work Trends Index.
export const PILLARS = {
  intent: {
    key: "intent",
    emoji: "🎯",
    label: "Intent",
    oldKey: "specification",
    definition: "Setting clear intent — defining the desired outcome and quality bar.",
    wtiAnchor: "As AI expands what people can do, it raises the premium on setting clear intent.",
    target: 70,
    thresholds: { excellent: 80, good: 70, fair: 50 },
    subtitle: "Quality of your prompts",
    action: "Include file paths, constraints, acceptance criteria, and what success looks like.",
  },
  workDesign: {
    key: "workDesign",
    emoji: "🤝",
    label: "Work Design",
    oldKey: "delegation",
    definition: "Deciding what humans and AI do — giving goals vs. step-by-step instructions.",
    wtiAnchor: "53% of Frontier Professionals intentionally pause before starting work to decide what should be done by AI versus a human.",
    target: 70,
    thresholds: { excellent: 80, good: 70, fair: 40 },
    subtitle: "How much autonomy you give",
    action: "Describe WHAT you want, not HOW to do it.",
  },
  qualityControl: {
    key: "qualityControl",
    emoji: "🧠",
    label: "Quality Control",
    oldKey: "judgment",
    definition: "Quality control of AI output — catching issues early, not rubber-stamping.",
    wtiAnchor: "50% say quality control of AI output is the most important human skill as AI takes on more work.",
    target: 75,
    thresholds: { excellent: 80, good: 75, fair: 50 },
    subtitle: "Quality of review decisions",
    action: "Review each agent change carefully before approving. Treat AI output as a starting point.",
  },
  evaluation: {
    key: "evaluation",
    emoji: "⚡",
    label: "Evaluation",
    oldKey: "efficiency",
    definition: "Building evaluation discipline — productive turns, session completion, and context hygiene.",
    wtiAnchor: "The companies that learn fastest from their own work will be the ones that win.",
    target: 70,
    thresholds: { excellent: 80, good: 70, fair: 50 },
    subtitle: "Productive use of turns",
    action: "Front-load context, avoid drip-feeding, keep sessions focused.",
  },
};

export const PILLAR_ORDER = ["intent", "workDesign", "qualityControl", "evaluation"];

export const BACKEND_KEY_MAP = {
  specification: "intent",
  delegation: "workDesign",
  judgment: "qualityControl",
  efficiency: "evaluation",
};

export function getCanonicalPillarKey(pillar) {
  return BACKEND_KEY_MAP[pillar] || pillar;
}

export function getPillarConfig(pillar) {
  return PILLARS[getCanonicalPillarKey(pillar)] || null;
}

export function getPillarLabel(pillar) {
  return getPillarConfig(pillar)?.label || formatPillarLabel(pillar);
}

export function getPillarEmoji(pillar) {
  return getPillarConfig(pillar)?.emoji || "📌";
}

export function getPillarBadgeKey(pillar) {
  return getPillarConfig(pillar)?.oldKey || pillar;
}

export function getPillarStatus(score, pillar) {
  const config = getPillarConfig(pillar);
  if (!config || score == null || Number.isNaN(score)) return { text: "—", color: "var(--text-muted)" };
  const { thresholds } = config;
  if (score >= thresholds.excellent) return { text: "✅ Excellent", color: "var(--green)" };
  if (score >= thresholds.good) return { text: "✅ Good", color: "var(--green)" };
  if (score >= thresholds.fair) return { text: "📐 Fair", color: "var(--yellow)" };
  return { text: "⚠️ Needs work", color: "var(--yellow)" };
}

function formatPillarLabel(pillar) {
  if (!pillar) return "—";
  return pillar
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
