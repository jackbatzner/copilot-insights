import { useState, useEffect } from "react";

function getInitialTheme() {
  const param = new URLSearchParams(window.location.search).get("scoutTheme");
  if (param === "light" || param === "dark") return param;
  let stored;
  try { stored = localStorage.getItem("copilot-insights-theme"); } catch { /* Optional preference storage. */ }
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("copilot-insights-theme", theme); } catch { /* Theme still applies without storage. */ }
  }, [theme]);

  // Sync with system changes when no explicit user preference
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (e) => {
      let stored;
      try { stored = localStorage.getItem("copilot-insights-theme"); } catch { /* Use the system preference. */ }
      if (!stored) {
        setTheme(e.matches ? "light" : "dark");
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
