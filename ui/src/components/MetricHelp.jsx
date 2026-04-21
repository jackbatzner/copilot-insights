import { useState, useEffect, useRef, useCallback } from "react";

let instanceCounter = 0;

export function MetricHelp({ label, definition, target, action }) {
  const [open, setOpen] = useState(false);
  const iconRef = useRef(null);
  const popRef = useRef(null);
  const idRef = useRef(++instanceCounter);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const tooltipId = useRef(`metric-help-${Math.random().toString(36).slice(2, 9)}`).current;

  const updateCoords = useCallback(() => {
    if (!iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    setCoords({
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    });
  }, []);

  // Close this tooltip when another one opens
  useEffect(() => {
    function handleOtherOpen(e) {
      if (e.detail !== idRef.current) setOpen(false);
    }
    document.addEventListener("metrichelp:open", handleOtherOpen);
    return () => document.removeEventListener("metrichelp:open", handleOtherOpen);
  }, []);

  const openTooltip = useCallback(() => {
    document.dispatchEvent(new CustomEvent("metrichelp:open", { detail: idRef.current }));
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    updateCoords();
    function handleClick(e) {
      if (popRef.current && !popRef.current.contains(e.target) &&
          iconRef.current && !iconRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleScroll() { updateCoords(); }
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, updateCoords]);

  return (
    <span className="metric-help">
      {label}
      <button
        ref={iconRef}
        className="metric-help-icon"
        onClick={() => open ? setOpen(false) : openTooltip()}
        onMouseEnter={openTooltip}
        aria-label={`Info about ${label}`}
        aria-describedby={open ? tooltipId : undefined}
      >
        ℹ️
      </button>
      {open && (
        <div
          ref={popRef}
          className="metric-help-popover"
          id={tooltipId}
          role="tooltip"
          style={{ position: "fixed", top: coords.top, left: coords.left, transform: "translate(-50%, -100%)" }}
          onMouseLeave={() => setOpen(false)}
        >
          <p><strong>What it measures:</strong> {definition}</p>
          <p><strong>Target:</strong> {target}</p>
          {action && <p><strong>How to improve:</strong> {action}</p>}
        </div>
      )}
    </span>
  );
}
