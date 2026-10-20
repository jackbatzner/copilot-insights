import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { PRESENTATION_KEY, readPresentationPreference, writePresentationPreference } from "./presentation-preference.js";

const PresentationContext = createContext(null);

export function PresentationProvider({ children }) {
  const [state, setState] = useState(readPresentationPreference);
  const setEnabled = useCallback((enabled) => {
    const error = writePresentationPreference(enabled);
    setState({ enabled, error });
  }, []);
  useEffect(() => {
    const changed = (event) => {
      if (event.key === PRESENTATION_KEY || event.key === null) setState(readPresentationPreference());
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  return <PresentationContext.Provider value={{ ...state, setEnabled }}>{children}</PresentationContext.Provider>;
}

export function usePresentation() {
  const value = useContext(PresentationContext);
  if (!value) throw new Error("Presentation controls require their provider.");
  return value;
}

export function PresentationControl() {
  const { enabled, setEnabled } = usePresentation();
  return <button className="presentation-toggle" aria-pressed={enabled} onClick={() => setEnabled(!enabled)}>
    Presentation mode: {enabled ? "On" : "Off"}
  </button>;
}
