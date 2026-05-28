import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { clearCache, fetchSettings, updateSettings } from "./api.js";

const DEFAULT_SETTINGS = Object.freeze({
  vscodeSessionsEnabled: false,
});

const SettingsContext = createContext({
  settings: DEFAULT_SETTINGS,
  loading: true,
  saving: false,
  error: null,
  setVSCodeSessionsEnabled: async () => {},
});

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const loadSettings = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);

    try {
      if (silent) clearCache();
      const next = await fetchSettings();
      setSettings(next);
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load settings.");
      if (!silent) {
        setSettings(DEFAULT_SETTINGS);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const handleFocus = () => {
      loadSettings({ silent: true });
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadSettings]);

  const setVSCodeSessionsEnabled = useCallback(async (enabled) => {
    setSaving(true);
    setError(null);
    try {
      const next = await updateSettings({ vscodeSessionsEnabled: enabled });
      setSettings(next);
    } catch (err) {
      setError(err.message || "Failed to update settings.");
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  const value = useMemo(() => ({
    settings,
    loading,
    saving,
    error,
    setVSCodeSessionsEnabled,
  }), [error, loading, saving, settings, setVSCodeSessionsEnabled]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  return useContext(SettingsContext);
}
