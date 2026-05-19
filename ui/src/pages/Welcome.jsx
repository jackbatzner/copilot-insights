import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { markOnboardingComplete } from "../onboarding.js";

const STEPS = [
  {
    title: "What is Copilot Insights?",
    content: (
      <>
        <div className="welcome-hero-icon">💡</div>
        <h2>Welcome to Copilot Insights</h2>
        <p className="welcome-subtitle">
          Understand how you work with AI. Build the skills to do it better.
        </p>
        <div className="welcome-explanation">
          <p>
            This tool analyzes your AI coding sessions to find patterns in how
            you communicate with Copilot.
          </p>
          <p>
            Copilot Insights reads your local Copilot CLI history. Before the
            dashboard can show anything, install Copilot CLI and complete at
            least one session so <code>~/.copilot/session-store.db</code> exists.
          </p>
          <p>
            Every time you correct, rephrase, or undo something the AI did —
            that's a <strong>"redirection."</strong> We track those moments to
            help you learn from them.
          </p>
        </div>
      </>
    ),
  },
  {
    title: "Key Concepts",
    content: (
      <>
        <h2>Three things to know</h2>
        <div className="welcome-concepts">
          <div className="welcome-concept-card">
            <div className="welcome-concept-icon">🔄</div>
            <h3>Redirections</h3>
            <p>
              When you correct the AI — "no, do X instead", "undo that",
              "actually…" — each one is a redirection. Fewer = clearer prompts.
            </p>
          </div>
          <div className="welcome-concept-card">
            <div className="welcome-concept-icon">📊</div>
            <h3>Skill Building</h3>
            <p>
              Your 7-part WTI workspace combines four scored pillars —{" "}
              <strong>Intent</strong>, <strong>Work Design</strong>,{" "}
              <strong>Quality Control</strong>, and <strong>Evaluation</strong>
              — plus Overview, Retro, and Dev Plan.
            </p>
          </div>
          <div className="welcome-concept-card">
            <div className="welcome-concept-icon">🏅</div>
            <h3>Tiers</h3>
            <p>
              Your overall level is based on the four scored pillars. Progress
              from Novice → Explorer → Mentor → Expert → Master as you improve.
            </p>
          </div>
        </div>
      </>
    ),
  },
  {
    title: "Where to Start",
    content: (
      <>
        <h2>You're ready! Here's where to start:</h2>
        <div className="welcome-start-options">
          <StartOption
            icon="📊"
            title="Check your Overview"
            description="See your tier, top insight, and key stats at a glance"
            path="/"
          />
          <StartOption
            icon="🧪"
            title="Try Practice Lab ✨"
            description="Rewrite a real prompt and watch your score improve"
            path="/practice"
          />
          <StartOption
            icon="🎓"
            title="Open Skill Building"
            description="Review the 7-part WTI workspace, pillar scores, retro, and dev plan"
            path="/skills"
          />
          <StartOption
            icon="📋"
            title="Browse your Sessions"
            description="Replay a session to see where you corrected the AI"
            path="/sessions"
          />
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12, textAlign: "center" }}>
          More pages in the sidebar: Token Usage, Analytics, Live, Instructions, and VS Code.
        </div>
      </>
    ),
  },
];

function StartOption({ icon, title, description, path }) {
  const navigate = useNavigate();

  function handleClick() {
    markOnboardingComplete();
    navigate(path);
  }

  return (
    <button className="welcome-start-option" onClick={handleClick}>
      <span className="welcome-start-icon">{icon}</span>
      <div className="welcome-start-text">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <span className="welcome-start-arrow">→</span>
    </button>
  );
}

export default function Welcome() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();

  function handleSkip() {
    markOnboardingComplete();
    navigate("/");
  }

  function handleNext() {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleSkip();
    }
  }

  function handleBack() {
    if (step > 0) setStep(step - 1);
  }

  return (
    <div className="welcome-page">
      <div className="welcome-container">
        <div className="welcome-step-content">{STEPS[step].content}</div>

        <div className="welcome-navigation">
          <div className="welcome-dots">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`welcome-dot ${i === step ? "active" : ""}`}
              />
            ))}
          </div>

          <div className="welcome-buttons">
            {step > 0 && (
              <button className="welcome-btn welcome-btn-back" onClick={handleBack}>
                ← Back
              </button>
            )}
            {step < STEPS.length - 1 && (
              <button className="welcome-btn welcome-btn-next" onClick={handleNext}>
                Next →
              </button>
            )}
            {step === STEPS.length - 1 && (
              <button className="welcome-btn welcome-btn-next" onClick={handleSkip}>
                Let's go! →
              </button>
            )}
          </div>

          <button className="welcome-skip" onClick={handleSkip}>
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
