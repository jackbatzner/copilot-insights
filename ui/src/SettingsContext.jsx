import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { fetchSettings, updateSettings } from "./api.js";

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const generation = useRef(0);
  const activeRead = useRef(null);
  const writing = useRef(false);
  const queuedRead = useRef(false);
  const loadSettings = useCallback(async () => {
    if (writing.current) { queuedRead.current = true; return; }
    const current = ++generation.current;
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSettings({ signal: controller.signal });
      if (current === generation.current) setSettings(result);
    } catch {
      if (current === generation.current) setError("Data source settings could not be loaded. Try again.");
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    loadSettings();
    return () => { generation.current++; activeRead.current?.abort(); };
  }, [loadSettings]);

  const setVSCodeEnabled = async (enableVSCode) => {
    if (writing.current) return;
    writing.current = true;
    const previous = settings;
    const current = ++generation.current;
    activeRead.current?.abort();
    setLoading(false);
    setSaving(true);
    setError(null);
    setSettings((value) => ({ ...value, enableVSCode }));
    try {
      const result = await updateSettings({ enableVSCode });
      if (current === generation.current) setSettings(result);
    } catch {
      if (current === generation.current) {
        setSettings(previous);
        setError("The setting could not be confirmed. The previous value is shown; retry loading to check.");
      }
    } finally {
      writing.current = false;
      if (current === generation.current) {
        setSaving(false);
        if (queuedRead.current) { queuedRead.current = false; await loadSettings(); }
      }
    }
  };

  return <SettingsContext.Provider value={{ settings, loading, saving, error, loadSettings, setVSCodeEnabled }}>
    {children}
  </SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
