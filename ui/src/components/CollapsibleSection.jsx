import { useState, useEffect } from "react";

/**
 * Collapsible section with persisted open/closed state.
 * Used on Overview page to reduce information overload.
 */
export function CollapsibleSection({ title, id, defaultOpen = true, children }) {
  const storageKey = `section-v2-${id}`;

  const [open, setOpen] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) return stored === "open";
    return defaultOpen;
  });

  useEffect(() => {
    localStorage.setItem(storageKey, open ? "open" : "closed");
  }, [open, storageKey]);

  const panelId = `panel-${id}`;

  return (
    <div className={`collapsible-section ${open ? "is-open" : "is-closed"}`}>
      <button
        className="collapsible-section-header"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="collapsible-section-title">{title}</span>
        <span className={`collapsible-chevron ${open ? "open" : ""}`}></span>
      </button>
      <div className="collapsible-section-body" id={panelId} role="region" aria-label={title}>
        {open && children}
      </div>
    </div>
  );
}
