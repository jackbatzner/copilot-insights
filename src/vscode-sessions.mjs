// The legacy VS Code store contains chat content, not supported usage metadata.
// Opt-in never authorizes discovering or reading those content-only stores.
export function vscodeUsageCapability(enabled = false) {
  return enabled
    ? { status: "unavailable", message: "VS Code usage metadata is unavailable. Content-only session stores are not read or analyzed." }
    : { status: "disabled", message: "VS Code is disabled. No VS Code sources are read." };
}
