export function ScoreBadge({ rate }) {
  let color, label;
  if (rate < 0.1) {
    color = "green";
    label = "Smooth";
  } else if (rate < 0.25) {
    color = "yellow";
    label = "Some friction";
  } else if (rate < 0.4) {
    color = "orange";
    label = "Frequent";
  } else {
    color = "red";
    label = "Heavy";
  }
  return (
    <span className={`score-badge ${color}`}>
      {label} ({(rate * 100).toFixed(0)}%)
    </span>
  );
}

export function rateColor(rate) {
  if (rate < 0.1) return "green";
  if (rate < 0.25) return "yellow";
  if (rate < 0.4) return "orange";
  return "red";
}

export const CATEGORY_META = {
  explicit_correction: { emoji: "🔄", label: "Iterative Refinement" },
  course_change: { emoji: "↩️", label: "Course Change" },
  frustration: { emoji: "💬", label: "Clarification Needed" },
  repetition: { emoji: "🔁", label: "Reinforced Instruction" },
  rollback: { emoji: "🔀", label: "Direction Change" },
};
