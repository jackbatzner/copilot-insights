import { useEffect } from "react";
import { useSettings } from "../SettingsContext.jsx";
import { useRefresh } from "../App.jsx";
import { Capabilities, PageHeading } from "../components/Usage.jsx";
import { PresentationControl, usePresentation } from "../PresentationContext.jsx";

export default function Settings() {
  const { settings, loading, saving, error, loadSettings, setVSCodeEnabled } = useSettings();
  const { key } = useRefresh();
  const presentation = usePresentation();
  useEffect(() => { loadSettings(); }, [key, loadSettings]);
  return <>
    <PageHeading title="Settings" description="Explicit local sources. No content import or automatic optimization." />
    <section className="card" aria-labelledby="data-sources-heading">
      <h2 id="data-sources-heading">Data Sources</h2>
      <p>Copilot CLI usage is read locally from SessionDB. Session-state JSONL adds lifecycle and attribution evidence when available. Source stores remain read-only.</p>
      {loading && <p role="status">Loading data source settings...</p>}
      {error && <div role="alert" className="notice error">{error} <button onClick={loadSettings}>Retry settings</button></div>}
      {settings && <>
        <Capabilities value={settings.capabilities} />
        <div className="setting-row"><div><h3>Optional VS Code source</h3>
          <p id="vscode-description">Off unless you opt in. Content-only history cannot provide supported usage metadata; prompts are never analyzed to fill gaps.</p></div>
          <label className="checkbox-label"><input type="checkbox" checked={settings.enableVSCode} disabled={loading || saving}
            aria-describedby="vscode-description" onChange={(event) => setVSCodeEnabled(event.target.checked)} />Enable VS Code</label>
        </div>
        <div className="notice" role="status"><strong>{saving ? "Saving preference..." : settings.vscode.status === "disabled" ? "Disabled" : settings.vscode.status === "available" ? "Available" : "Usage metadata unavailable"}</strong>
          {!saving && <p>{settings.vscode.message}</p>}</div>
      </>}
    </section>
    <section className="card"><h2>Privacy and control</h2>
      <PresentationControl />
      <p>{presentation.enabled ? "Local text is hidden." : "Session Detail shows text and previews by default."} Presentation mode remembers a deliberate hide choice in this browser, including across navigation and reload. It stores only the preference, never the text.</p>
      <p>Usage analytics exclude conversation content, tool arguments/results and raw source identifiers. Proven child prompts load when expanded with text enabled. Original text may contain sensitive information and is never added to usage caches.</p>
      <p>Recommendations use recorded model, cache, and delegation metrics. They are optional and advisory. Nothing writes Copilot instructions or configuration.</p>
    </section>
  </>;
}
