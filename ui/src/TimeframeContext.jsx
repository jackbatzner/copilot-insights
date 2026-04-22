import { createContext, useContext, useState, useCallback } from "react";

const STORAGE_KEY = "copilot-insights-timeframe";
const DEFAULT_TIMEFRAME = "all";

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && ["7d", "30d", "90d", "all"].includes(v)) return v;
  } catch { /* private browsing */ }
  return DEFAULT_TIMEFRAME;
}

const TimeframeContext = createContext({
  timeframe: DEFAULT_TIMEFRAME,
  setTimeframe: () => {},
});

export function TimeframeProvider({ children }) {
  const [timeframe, setTimeframeRaw] = useState(readStored);

  const setTimeframe = useCallback((v) => {
    setTimeframeRaw(v);
    try { localStorage.setItem(STORAGE_KEY, v); } catch { /* ignore */ }
  }, []);

  return (
    <TimeframeContext.Provider value={{ timeframe, setTimeframe }}>
      {children}
    </TimeframeContext.Provider>
  );
}

export function useTimeframe() {
  return useContext(TimeframeContext);
}
