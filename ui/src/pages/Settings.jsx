import { useSettings } from "../SettingsContext.jsx";
import { PageBanner } from "../components/PageBanner.jsx";

export default function SettingsPage() {
  const { settings, saving, error, setVSCodeSessionsEnabled } = useSettings();

  const handleToggle = async (event) => {
    try {
      await setVSCodeSessionsEnabled(event.target.checked);
    } catch {}
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>⚙️ Settings</h1>
      </div>
      <PageBanner pageId="settings">
        Manage optional data sources for Copilot Insights. Copilot CLI session history stays on by default; VS Code session loading is opt-in.
      </PageBanner>

      <div className="card settings-card">
        <div className="card-header">Data Sources</div>
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={settings.vscodeSessionsEnabled}
            onChange={handleToggle}
            disabled={saving}
          />
          <span>
            <strong>Load VS Code Copilot sessions</strong>
            <span className="settings-toggle-copy">
              Read local VS Code / VS Code Insiders workspace storage and enable VS Code summaries on Overview, Skill Building, and the VS Code Sessions page.
            </span>
          </span>
        </label>
        <div className="settings-help-text">
          Default: off. When disabled, Copilot Insights uses Copilot CLI data only.
        </div>
        {error && <div className="settings-error-text">{error}</div>}
      </div>
    </div>
  );
}
