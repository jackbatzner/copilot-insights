const OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export function TimeframeSelector({ value, onChange }) {
  const handleKeyDown = (e, idx) => {
    let next;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = (idx + 1) % OPTIONS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = (idx - 1 + OPTIONS.length) % OPTIONS.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = OPTIONS.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    onChange(OPTIONS[next].value);
    e.currentTarget.parentElement.querySelectorAll("[role='radio']")[next]?.focus();
  };

  return (
    <div className="timeframe-selector" role="radiogroup" aria-label="Time range">
      {OPTIONS.map((opt, idx) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            className={`tf-btn${isActive ? " active" : ""}`}
            onClick={() => onChange(opt.value)}
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={(e) => handleKeyDown(e, idx)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
