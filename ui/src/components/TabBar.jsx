import { useRef, useCallback } from "react";

/**
 * Accessible tab bar with arrow key navigation (WAI-ARIA Tabs pattern).
 * @param {{ tabs: Array<{id: string, label: string}>, activeTab: string, onTabChange: (id: string) => void }} props
 */
export function TabBar({ tabs, activeTab, onTabChange, className = "" }) {
  const tablistRef = useRef(null);

  const handleKeyDown = useCallback((e, idx) => {
    let next;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = (idx + 1) % tabs.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = (idx - 1 + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = tabs.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    onTabChange(tabs[next].id);
    tablistRef.current?.querySelectorAll("[role='tab']")[next]?.focus();
  }, [tabs, onTabChange]);

  return (
    <div className={`tab-bar ${className}`} role="tablist" ref={tablistRef}>
      {tabs.map((t, idx) => {
        const isActive = activeTab === t.id;
        return (
          <button
            key={t.id}
            className={`tab-btn${isActive ? " active" : ""}`}
            onClick={() => onTabChange(t.id)}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={isActive}
            aria-controls={`tabpanel-${t.id}`}
            tabIndex={isActive ? 0 : -1}
            onKeyDown={(e) => handleKeyDown(e, idx)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Wrapper for tab panel content with proper ARIA attributes.
 */
export function TabPanel({ id, activeTab, children }) {
  if (activeTab !== id) return null;
  return (
    <div role="tabpanel" id={`tabpanel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0}>
      {children}
    </div>
  );
}
