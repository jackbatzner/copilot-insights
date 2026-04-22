import { useState, useEffect, createContext, useContext, useCallback } from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { NavGroup } from "./components/NavGroup.jsx";
import { ThemeToggle } from "./components/ThemeToggle.jsx";
import Overview from "./pages/Overview.jsx";
import Welcome from "./pages/Welcome.jsx";
import Sessions from "./pages/Sessions.jsx";
import SessionDetail from "./pages/SessionDetail.jsx";
import Coaching from "./pages/Coaching.jsx";
import Analytics from "./pages/Analytics.jsx";
import Instructions from "./pages/Instructions.jsx";
import Learn from "./pages/Learn.jsx";
import Practice from "./pages/Practice.jsx";
import LiveMonitor from "./pages/LiveMonitor.jsx";
import { fetchSessions, clearCache } from "./api.js";
import { TimeframeProvider } from "./TimeframeContext.jsx";

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
    if (localStorage.getItem("onboarding-complete") === "true") {
      setShowWelcome(false);
      return;
    }
    // Migrate old WelcomeModal flag if present
    if (localStorage.getItem("copilot-insights-welcomed") === "true") {
      localStorage.setItem("onboarding-complete", "true");
      setShowWelcome(false);
      return;
    }

    // Sniff: check if user has existing session data (cache-clear fallback)
    fetchSessions("all")
      .then((data) => {
        const hasSessions = data?.sessions?.length > 0 || data?.aggregate?.sessionsAnalyzed > 0;
        if (hasSessions) {
          // User has data — they just cleared cache, skip onboarding
          localStorage.setItem("onboarding-complete", "true");
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
  }, []);

  return showWelcome;
}

function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(() => new Date());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const showWelcome = useShowWelcome();
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
  if (showWelcome === null) {
    return <div className="loading">Loading…</div>;
  }

  return (
    <RefreshContext.Provider value={{ key: refreshKey, refresh, lastRefresh }}>
      <TimeframeProvider>
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
              <NavLink to="/coaching">
                <span className="nav-icon">🎓</span><span className="nav-label">Coaching</span>
              </NavLink>
              <NavLink to="/practice">
                <span className="nav-icon">🧪</span><span className="nav-label">Practice Lab</span>
                <span className="nav-badge">✨ New</span>
              </NavLink>
              <NavLink to="/learn">
                <span className="nav-icon">📚</span><span className="nav-label">Learn</span>
              </NavLink>
              <NavLink to="/sessions">
                <span className="nav-icon">📋</span><span className="nav-label">Sessions</span>
              </NavLink>
            </NavGroup>
            <NavGroup label="ADVANCED">
              <NavLink to="/analytics">
                <span className="nav-icon">📈</span><span className="nav-label">Analytics</span>
              </NavLink>
              <NavLink to="/live">
                <span className="nav-icon">📡</span><span className="nav-label">Live</span>
              </NavLink>
              <NavLink to="/instructions">
                <span className="nav-icon">⚙️</span><span className="nav-label">Instructions</span>
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
          <Routes>
            {showWelcome ? (
              <Route path="*" element={<Welcome />} />
            ) : (
              <>
                <Route path="/" element={<Overview />} />
                <Route path="/welcome" element={<Welcome />} />
                <Route path="/coaching" element={<Coaching />} />
                <Route path="/learn" element={<Learn />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/live" element={<LiveMonitor />} />
                <Route path="/instructions" element={<Instructions />} />
                <Route path="/sessions" element={<Sessions />} />
                <Route path="/sessions/:id" element={<SessionDetail />} />
                <Route path="/practice" element={<Practice />} />
              </>
            )}
          </Routes>
          </ErrorBoundary>
        </main>
      </div>
      </TimeframeProvider>
    </RefreshContext.Provider>
  );
}

export default App;
