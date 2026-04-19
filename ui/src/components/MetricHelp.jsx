import { useState, useEffect, useRef } from "react";

export function MetricHelp({ label, definition, target, action }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <span className="metric-help" ref={ref}>
      {label}
      <button
        className="metric-help-icon"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        aria-label={`Info about ${label}`}
      >
        ℹ️
      </button>
      {open && (
        <div className="metric-help-popover">
          <div className="metric-help-arrow" />
          <p><strong>What it measures:</strong> {definition}</p>
          <p><strong>Target:</strong> {target}</p>
          {action && <p><strong>How to improve:</strong> {action}</p>}
        </div>
      )}
    </span>
  );
}
