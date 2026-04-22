/**
 * Centralized tooltip definitions for all Copilot Insights metrics.
 * Used by MetricHelp components across pages.
 */
export const METRIC_TOOLTIPS = {
  redirection: {
    label: "Redirection",
    definition: "A turn where you corrected, redirected, or re-explained something to the agent. It signals the agent didn't do what you wanted on the first try.",
    target: "Fewer is better. Under 10% of turns is smooth sailing.",
    action: "Add more context, file paths, and acceptance criteria upfront.",
  },
  redirectionRate: {
    label: "Redirection Rate",
    definition: "Percentage of your turns that correct or redirect the agent.",
    target: "Under 10% is smooth. 10–25% is some friction. Over 25% needs attention.",
    action: "Front-load requirements in your first message to reduce back-and-forth.",
  },
  pillar: {
    label: "Pillar Score",
    definition: "Your skill is measured across three pillars: Delegation (handing off work effectively), Judgment (reviewing agent output well), and Feedback (communicating clearly).",
    target: "70+ in each pillar is strong. Balance across all three matters most.",
  },
  tier: {
    label: "Tier",
    definition: "Your overall skill level, derived from your combined pillar scores. Tiers range from 🌱 Prompt Padawan to 💎 Zero Redirect.",
    target: "Progress through tiers by improving your weakest pillar.",
  },
  delegation: {
    label: "Delegation",
    definition: "How effectively you hand off work to the agent — giving goals vs. step-by-step instructions.",
    target: "Over 60% delegation ratio is good. Under 30% suggests micro-managing.",
    action: "Describe WHAT you want, not HOW to do it.",
  },
  judgment: {
    label: "Judgment",
    definition: "How well you evaluate agent output — catching issues early, not rubber-stamping, avoiding costly late rollbacks.",
    target: "70+ is good, 80+ is excellent.",
    action: "Review each agent change carefully before approving.",
  },
  feedback: {
    label: "Feedback",
    definition: "How clearly you communicate requirements and corrections. Clear feedback = fewer iterations.",
    target: "70+ clarity score is clear communication.",
    action: "Include file paths, constraints, and what success looks like.",
  },
  thrashing: {
    label: "Repeated File Edits",
    definition: "When the same file is edited many times in one session — a sign of iterative refinement that could be reduced with clearer initial direction.",
    target: "Minimal re-editing. If a file is edited 5+ times, consider providing more detail upfront.",
    action: "Specify expected behavior and constraints in your first message.",
  },
  weight: {
    label: "Weight",
    definition: "Severity of a redirection signal. 1 = mild (small course correction), 2 = moderate, 3 = strong (major direction change).",
    target: "Lower total weight means smoother sessions.",
  },
  complexityScore: {
    label: "Complexity Score",
    definition: "A measure of how complex the session was — based on file operations, unique files touched, and checkpoints created.",
    target: "Not a target — just context. Higher complexity sessions naturally have more redirections.",
  },
  courseChange: {
    label: "Course Change",
    definition: "When you pivot the agent's direction mid-task — 'actually, instead, let's try...'",
    target: "Some course changes are natural. Many suggest the goal wasn't clear upfront.",
  },
  iterativeRefinement: {
    label: "Iterative Refinement",
    definition: "When you refine or adjust the agent's output — a natural part of collaboration, not a failure.",
    target: "Keep under 10% of turns. If higher, try providing clearer initial context.",
  },
  clarificationNeeded: {
    label: "Clarification Needed",
    definition: "When the agent needs more clarity — often triggered by re-explaining something.",
    target: "Minimize by front-loading context and being specific about expectations.",
  },
  directionChange: {
    label: "Direction Change",
    definition: "When you steer toward a different approach — reverting, undoing, or going back.",
    target: "Occasional direction changes are fine. Frequent ones suggest unclear planning.",
  },
  reinforcedInstruction: {
    label: "Reinforced Instruction",
    definition: "When you re-state something you already said — the agent may have missed or ignored earlier context.",
    target: "Should be rare. If frequent, check that your instructions are specific enough.",
  },
};
