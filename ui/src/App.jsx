import { lazy, Suspense, useState, useEffect, createContext, useContext, useCallback } from "react";
import { Routes, Route, NavLink, Navigate, useLocation } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { NavGroup } from "./components/NavGroup.jsx";
import { ThemeToggle } from "./components/ThemeToggle.jsx";
import { fetchSessionCatalog, clearCache } from "./api.js";
import { SettingsProvider, useSettings } from "./SettingsContext.jsx";
import {
  LEGACY_ONBOARDING_KEY,
  ONBOARDING_COMPLETE_EVENT,
  ONBOARDING_COMPLETE_KEY,
  markOnboardingComplete,
} from "./onboarding.js";
import { TimeframeProvider } from "./TimeframeContext.jsx";

const Overview = lazy(() => import("./pages/Overview.jsx"));
const Welcome = lazy(() => import("./pages/Welcome.jsx"));
const Sessions = lazy(() => import("./pages/Sessions.jsx"));
const SessionDetail = lazy(() => import("./pages/SessionDetail.jsx"));
const SkillBuilding = lazy(() => import("./pages/SkillBuilding/index.jsx"));
const Analytics = lazy(() => import("./pages/Analytics.jsx"));
const Instructions = lazy(() => import("./pages/Instructions.jsx"));
const Practice = lazy(() => import("./pages/Practice.jsx"));
const VSCodeSessions = lazy(() => import("./pages/VSCodeSessions.jsx"));
const LiveMonitor = lazy(() => import("./pages/LiveMonitor.jsx"));
const TokenUsage = lazy(() => import("./pages/TokenUsage.jsx"));
const SettingsPage = lazy(() => import("./pages/Settings.jsx"));

export const RefreshContext = createContext({ key: 0, refresh: () => {}, lastRefresh: null });
export function useRefresh() { return useContext(RefreshContext); }

function formatTime(date) {
  if (!date) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Determines whether the Welcome page should be shown.
 * Returns true only for true first-time users (no localStorage flag AND no existing sessions).
 */
function useShowWelcome() {
  const [showWelcome, setShowWelcome] = useState(null); // null = still checking

  useEffect(() => {
    // Fast path: localStorage flag exists (including migrated old key)
    if (localStorage.getItem(ONBOARDING_COMPLETE_KEY) === "true") {
      setShowWelcome(false);
      return;
    }
    // Migrate old WelcomeModal flag if present
    if (localStorage.getItem(LEGACY_ONBOARDING_KEY) === "true") {
      markOnboardingComplete();
      setShowWelcome(false);
      return;
    }

    // Sniff: check if user has existing session data (cache-clear fallback)
    fetchSessionCatalog("all")
      .then((data) => {
        const hasSessions = data?.sessions?.length > 0;
        if (hasSessions) {
          // User has data — they just cleared cache, skip onboarding
          markOnboardingComplete();
          setShowWelcome(false);
        } else {
          // True first-time user
          setShowWelcome(true);
        }
      })
      .catch(() => {
        // If API fails, show Welcome as safe default
        setShowWelcome(true);
      });

    function handleOnboardingComplete() {
      setShowWelcome(false);
    }

    window.addEventListener(ONBOARDING_COMPLETE_EVENT, handleOnboardingComplete);
    return () => {
      window.removeEventListener(ONBOARDING_COMPLETE_EVENT, handleOnboardingComplete);
    };
  }, []);

  return showWelcome;
}

function RouteLoading() {
  return <div className="loading">Loading page…</div>;
}

function App() {
  return (
    <TimeframeProvider>
      <SettingsProvider>
        <AppShell />
      </SettingsProvider>
    </TimeframeProvider>
  );
}

function AppShell() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(() => new Date());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const showWelcome = useShowWelcome();
  const { loading: settingsLoading } = useSettings();
  const location = useLocation();
  const isWelcomePage = showWelcome || location.pathname === "/welcome";
  const refresh = useCallback(() => {
    clearCache();
    setRefreshKey((k) => k + 1);
    setLastRefresh(new Date());
    setSpinning(true);
    setTimeout(() => setSpinning(false), 800);
  }, []);

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Show nothing while checking onboarding status
  if (showWelcome === null || settingsLoading) {
    return <div className="loading">Loading…</div>;
  }

  return (
    <RefreshContext.Provider value={{ key: refreshKey, refresh, lastRefresh }}>
      <div className="app-layout">
        {/* Mobile hamburger toggle */}
        {!isWelcomePage && (
          <button
            className="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          >
            {mobileMenuOpen ? "✕" : "☰"}
          </button>
        )}
        {/* Backdrop for mobile overlay */}
        {mobileMenuOpen && !isWelcomePage && (
          <div className="sidebar-backdrop" onClick={() => setMobileMenuOpen(false)} />
        )}
        {/* Hide sidebar on Welcome page */}
        {!isWelcomePage && (
          <nav className={`sidebar${mobileMenuOpen ? " sidebar-open" : ""}`} aria-label="Main navigation">
            <div className="sidebar-logo">
              <span>💡</span> Copilot Insights
            </div>
            <NavGroup label="CORE">
              <NavLink to="/" end>
                <span className="nav-icon">📊</span><span className="nav-label">Overview</span>
              </NavLink>
              <NavLink to="/skills">
                <span className="nav-icon">🎯</span><span className="nav-label">Skill Building</span>
              </NavLink>
              <NavLink to="/practice">
                <span className="nav-icon">🧠</span><span className="nav-label">Practice Lab</span>
                <span className="nav-badge">✨ New</span>
              </NavLink>
              <NavLink to="/sessions">
                <span className="nav-icon">🗂️</span><span className="nav-label">Sessions</span>
              </NavLink>
            </NavGroup>
            <NavGroup label="ADVANCED">
              <NavLink to="/tokens">
                <span className="nav-icon">💰</span><span className="nav-label">Token Usage</span>
              </NavLink>
              <NavLink to="/analytics">
                <span className="nav-icon">📈</span><span className="nav-label">Analytics</span>
              </NavLink>
              <NavLink to="/live">
                <span className="nav-icon">📡</span><span className="nav-label">Live</span>
              </NavLink>
              <NavLink to="/instructions">
                <span className="nav-icon">📘</span><span className="nav-label">Instructions</span>
              </NavLink>
              <NavLink to="/settings">
                <span className="nav-icon">⚙️</span><span className="nav-label">Settings</span>
              </NavLink>
              <NavLink to="/vscode">
                <span className="nav-icon">💻</span><span className="nav-label">VS Code</span>
              </NavLink>
            </NavGroup>
            <div className="refresh-section">
              <ThemeToggle />
              <button className={`refresh-btn${spinning ? " spinning" : ""}`} onClick={refresh} title="Refresh data" aria-label="Refresh data">
                🔄
              </button>
              <span className="refresh-time">{formatTime(lastRefresh)}</span>
            </div>
          </nav>
        )}
        <main className={`main-content ${isWelcomePage ? "main-content-full" : ""}`}>
          <ErrorBoundary>
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                {showWelcome ? (
                  <Route path="*" element={<Welcome />} />
                ) : (
                  <>
                    <Route path="/" element={<Overview />} />
                    <Route path="/welcome" element={<Welcome />} />
                    <Route path="/skills" element={<SkillBuilding />} />
                    <Route path="/coaching" element={<Navigate to="/skills" replace />} />
                    <Route path="/learn" element={<Navigate to="/skills" replace />} />
                    <Route path="/analytics" element={<Analytics />} />
                    <Route path="/live" element={<LiveMonitor />} />
                    <Route path="/tokens" element={<TokenUsage />} />
                    <Route path="/instructions" element={<Instructions />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/sessions" element={<Sessions />} />
                    <Route path="/sessions/:id" element={<SessionDetail />} />
                    <Route path="/practice" element={<Practice />} />
                    <Route path="/vscode" element={<VSCodeSessions />} />
                  </>
                )}
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </RefreshContext.Provider>
  );
}

export default App;
