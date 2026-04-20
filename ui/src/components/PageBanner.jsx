import { useState, useEffect } from "react";

export function PageBanner({ pageId, children }) {
  const storageKey = `banner-dismissed-${pageId}`;
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try { setDismissed(!!localStorage.getItem(storageKey)); } catch { /* storage unavailable */ }
  }, [storageKey]);

  function dismiss() {
    try { localStorage.setItem(storageKey, "true"); } catch { /* storage unavailable */ }
    setDismissed(true);
  }

  if (dismissed) return null;

  return (
    <div className="page-banner">
      <span className="page-banner-text">{children}</span>
      <button className="page-banner-close" onClick={dismiss} aria-label="Dismiss banner">
        ×
      </button>
    </div>
  );
}
