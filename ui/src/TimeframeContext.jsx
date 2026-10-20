import { createContext, useContext, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";

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
  const [storedTimeframe, setTimeframeRaw] = useState(readStored);
  const [params, setParams] = useSearchParams();
  const candidate = params.get("timeframe");
  const timeframe = ["7d", "30d", "90d", "all"].includes(candidate) ? candidate : storedTimeframe;

  const setTimeframe = useCallback((v) => {
    if (!["7d", "30d", "90d", "all"].includes(v)) return;
    setTimeframeRaw(v);
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("timeframe", v);
      next.set("page", "1");
      return next;
    });
    try { localStorage.setItem(STORAGE_KEY, v); } catch { /* ignore */ }
  }, [setParams]);

  return (
    <TimeframeContext.Provider value={{ timeframe, setTimeframe }}>
      {children}
    </TimeframeContext.Provider>
  );
}

export function useTimeframe() {
  return useContext(TimeframeContext);
}
