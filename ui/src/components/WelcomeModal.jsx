import { useState, useEffect } from "react";

const STORAGE_KEY = "copilot-insights-welcomed";

const PILLARS = [
  { icon: "🤝", title: "Delegation", desc: "How you divide work with the agent" },
  { icon: "🔍", title: "Judgment", desc: "How well you review agent output" },
  { icon: "💬", title: "Feedback", desc: "How clearly you communicate requirements" },
];

export function WelcomeModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setVisible(true);
      }
    } catch { /* storage unavailable */ }
  }, []);

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, "true"); } catch { /* storage unavailable */ }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="welcome-overlay" onClick={dismiss}>
      <div className="welcome-modal" onClick={(e) => e.stopPropagation()}>
        <div className="welcome-logo">💡</div>
        <h2 className="welcome-title">Welcome to Copilot Insights</h2>
        <p className="welcome-desc">
          Understand how you prompt AI agents — and get better at it.
        </p>

        <div className="welcome-pillars">
          {PILLARS.map((p) => (
            <div key={p.title} className="welcome-pillar">
              <span className="welcome-pillar-icon">{p.icon}</span>
              <strong>{p.title}</strong>
              <span className="welcome-pillar-desc">{p.desc}</span>
            </div>
          ))}
        </div>

        <p className="welcome-tip">
          Tip: Start with the Overview page for your snapshot, then explore
          Coaching for details.
        </p>

        <button className="welcome-btn" onClick={dismiss}>
          Get Started
        </button>
      </div>
    </div>
  );
}
