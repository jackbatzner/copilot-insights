export const PRESENTATION_KEY = "copilot-insights.presentation.v1";

export function readPresentationPreference(storage = () => globalThis.localStorage) {
  try {
    const value = storage().getItem(PRESENTATION_KEY);
    if (value === null || value === "off") return { enabled: false, error: null };
    if (value === "on") return { enabled: true, error: null };
    return { enabled: true, error: "The saved presentation preference is invalid. Text is hidden; choose a presentation setting to replace it." };
  } catch {
    return { enabled: true, error: "The presentation preference could not be read. Text is hidden until you choose a setting." };
  }
}

export function writePresentationPreference(enabled, storage = () => globalThis.localStorage) {
  if (typeof enabled !== "boolean") throw new TypeError("Presentation mode must be a boolean.");
  try {
    storage().setItem(PRESENTATION_KEY, enabled ? "on" : "off");
    return null;
  } catch {
    return "The presentation setting changed for this tab but could not be saved. Check it again after reloading.";
  }
}
