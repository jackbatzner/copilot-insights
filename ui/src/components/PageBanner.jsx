import { useState, useEffect } from "react";

export function PageBanner({ pageId, children }) {
  const storageKey = `banner-dismissed-${pageId}`;
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(!!localStorage.getItem(storageKey));
  }, [storageKey]);

  function dismiss() {
    localStorage.setItem(storageKey, "true");
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
