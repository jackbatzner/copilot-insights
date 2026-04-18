// Tier system — maps overall pillar score to a user skill tier.
// Shared between the UI (Overview.jsx) and CLI tools (extension.mjs).

export const TIERS = [
  { min: 0,  emoji: "🌱", name: "Prompt Padawan" },
  { min: 25, emoji: "🔧", name: "Context Crafter" },
  { min: 40, emoji: "📡", name: "Signal Sender" },
  { min: 55, emoji: "⚡", name: "Flow State" },
  { min: 70, emoji: "🏗️", name: "Prompt Architect" },
  { min: 85, emoji: "🧙", name: "Agent Whisperer" },
  { min: 95, emoji: "💎", name: "Zero Redirect" },
];

/**
 * Get the tier for a given overall pillar score.
 * @param {number} score - Overall pillar score (0-100)
 * @returns {{ min: number, emoji: string, name: string, index: number, next: object|null }}
 */
export function getTier(score) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (score >= TIERS[i].min) return { ...TIERS[i], index: i + 1, next: TIERS[i + 1] || null };
  }
  return { ...TIERS[0], index: 1, next: TIERS[1] };
}
