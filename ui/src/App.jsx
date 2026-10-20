import { lazy, Suspense, useState, useEffect, createContext, useContext, useCallback, useRef } from "react";
import { Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { ThemeToggle } from "./components/ThemeToggle.jsx";
import { refreshData } from "./api.js";
import { SettingsProvider } from "./SettingsContext.jsx";
import { TimeframeProvider } from "./TimeframeContext.jsx";
import { useUsageQuery } from "./hooks/useUsageQuery.js";
import { PresentationControl, PresentationProvider, usePresentation } from "./PresentationContext.jsx";
import UsageLoading from "./components/UsageLoading.jsx";

const Overview = lazy(() => import("./pages/Overview.jsx"));
const Welcome = lazy(() => import("./pages/Welcome.jsx"));
const Sessions = lazy(() => import("./pages/Sessions.jsx"));
const SessionDetail = lazy(() => import("./pages/SessionDetail.jsx"));
const TokenUsage = lazy(() => import("./pages/TokenUsage.jsx"));
const ModelComparison = lazy(() => import("./pages/ModelComparison.jsx"));
const Settings = lazy(() => import("./pages/Settings.jsx"));
export const RefreshContext = createContext({ key: 0, refresh: () => {} });
export const useRefresh = () => useContext(RefreshContext);

export default function App() {
  return <TimeframeProvider><SettingsProvider><PresentationProvider><AppShell /></PresentationProvider></SettingsProvider></TimeframeProvider>;
}

function AppShell() {
  const [key, setKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuButton = useRef(null);
  const main = useRef(null);
  const location = useLocation();
  const { search } = useUsageQuery();
  const presentation = usePresentation();
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await refreshData();
      setKey((value) => value + 1);
      setLastRefresh(new Date());
    } catch {
      setError("Usage could not be refreshed. Try again.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
    main.current?.focus();
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  return <RefreshContext.Provider value={{ key, refresh, refreshing }}>
    <div className="app-layout">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <button ref={menuButton} className="mobile-menu-toggle" onClick={() => setMobileMenuOpen((value) => !value)}
        aria-expanded={mobileMenuOpen} aria-controls="main-navigation" aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}>
        {mobileMenuOpen ? "\u2715" : "\u2630"}
      </button>
      {mobileMenuOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => {
        setMobileMenuOpen(false);
        menuButton.current?.focus();
      }} />}
      <nav id="main-navigation" className={`sidebar${mobileMenuOpen ? " sidebar-open" : ""}`} aria-label="Main navigation">
        <div className="sidebar-logo"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 3v14h14M7 13V9m4 4V5m4 8V7" /></svg> Copilot Insights</div>
        <div className="nav-group-label">LOCAL USAGE</div>
        {[["/", "Overview", "◈"], ["/sessions", "Sessions", "▤"], ["/tokens", "Token Usage", "◷"], ["/settings", "Settings", "⚙"]].map(([path, label, icon]) =>
          <NavLink key={path} to={`${path}${search}`} end={path === "/"}>
            <span aria-hidden="true" className="nav-icon">{icon}</span><span>{label}</span>
          </NavLink>)}
        <div className="sidebar-note">{presentation.enabled ? "Presentation mode hides local text." : "Session text is on by default."}<br />Your data stays local.</div>
        <div className="refresh-section">
          <PresentationControl />
          <ThemeToggle />
          <button onClick={refresh} disabled={refreshing} aria-label="Refresh data">{refreshing ? "Refreshing..." : "Refresh"}</button>
          <small>Loaded usage is reused across views in this tab. Refresh updates it.</small>
          {lastRefresh && <small>Updated {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>}
        </div>
      </nav>
      <main id="main-content" className="main-content" ref={main} tabIndex={-1}>
        {presentation.error && <div role="alert" className="notice error">{presentation.error}</div>}
        {error && <div role="alert" className="notice error">{error} <button onClick={refresh}>Retry refresh</button></div>}
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<UsageLoading view label="Loading view..." variant={
            location.pathname === "/" ? "overview" : location.pathname === "/sessions" ? "sessions"
              : location.pathname.startsWith("/sessions/") ? "detail"
                : location.pathname === "/tokens" ? "tokens" : location.pathname === "/tokens/compare" ? "comparison" : "rows"
          } />}>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/welcome" element={<Welcome />} />
              <Route path="/tokens" element={<TokenUsage />} />
              <Route path="/tokens/compare" element={<ModelComparison />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/sessions" element={<Sessions />} />
              <Route path="/sessions/:handle" element={<SessionDetail />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  </RefreshContext.Provider>;
}
