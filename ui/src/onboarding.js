export const ONBOARDING_COMPLETE_KEY = "onboarding-complete";
export const LEGACY_ONBOARDING_KEY = "copilot-insights-welcomed";
export const ONBOARDING_COMPLETE_EVENT = "copilot-insights:onboarding-complete";

export function markOnboardingComplete() {
  localStorage.setItem(ONBOARDING_COMPLETE_KEY, "true");
  window.dispatchEvent(new Event(ONBOARDING_COMPLETE_EVENT));
}
