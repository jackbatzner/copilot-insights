import { useState, createContext, useContext, useCallback } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import Overview from "./pages/Overview.jsx";
import Sessions from "./pages/Sessions.jsx";
import SessionDetail from "./pages/SessionDetail.jsx";
import Coaching from "./pages/Coaching.jsx";
import Analytics from "./pages/Analytics.jsx";
import Instructions from "./pages/Instructions.jsx";
import Learn from "./pages/Learn.jsx";

export const RefreshContext = createContext({ key: 0, refresh: () => {}, lastRefresh: null });
export function useRefresh() { return useContext(RefreshContext); }

function formatTime(date) {
  if (!date) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(() => new Date());
  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setLastRefresh(new Date());
    setSpinning(true);
    setTimeout(() => setSpinning(false), 800);
  }, []);

  return (
    <RefreshContext.Provider value={{ key: refreshKey, refresh, lastRefresh }}>
      <div className="app-layout">
        <nav className="sidebar">
          <div className="sidebar-logo">
            <span>💡</span> Copilot Insights
          </div>
          <NavLink to="/" end>
            <span className="nav-icon">📊</span><span className="nav-label">Overview</span>
          </NavLink>
          <NavLink to="/coaching">
            <span className="nav-icon">🎓</span><span className="nav-label">Coaching</span>
          </NavLink>
          <NavLink to="/learn">
            <span className="nav-icon">📚</span><span className="nav-label">Learn</span>
          </NavLink>
          <NavLink to="/analytics">
            <span className="nav-icon">📈</span><span className="nav-label">Analytics</span>
          </NavLink>
          <NavLink to="/instructions">
            <span className="nav-icon">⚙️</span><span className="nav-label">Instructions</span>
          </NavLink>
          <NavLink to="/sessions">
            <span className="nav-icon">📋</span><span className="nav-label">Sessions</span>
          </NavLink>
          <div className="refresh-section">
            <button className={`refresh-btn${spinning ? " spinning" : ""}`} onClick={refresh} title="Refresh data" aria-label="Refresh data">
              🔄
            </button>
            <span className="refresh-time">{formatTime(lastRefresh)}</span>
          </div>
        </nav>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/coaching" element={<Coaching />} />
            <Route path="/learn" element={<Learn />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/instructions" element={<Instructions />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/sessions/:id" element={<SessionDetail />} />
          </Routes>
        </main>
      </div>
    </RefreshContext.Provider>
  );
}

export default App;
