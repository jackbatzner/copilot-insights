const OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export function TimeframeSelector({ value, onChange }) {
  return (
    <div className="timeframe-selector">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          className={`tf-btn${value === opt.value ? " active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
