import { useState, useCallback, useEffect } from "react";
import { analyzePracticePrompt, fetchPracticeChallenge, fetchLibraryChallenge, fetchWeaknesses } from "../api";
import { PageBanner } from "../components/PageBanner.jsx";

const SCORE_COLORS = { green: "#3fb950", yellow: "#d29922", orange: "#db6d28", red: "#f85149" };
const SEVERITY_COLORS = { ok: "#3fb950", info: "#58a6ff", warning: "#d29922" };

export default function Practice() {
  const [tab, setTab] = useState("sandbox");

  return (
    <div className="page">
      <div className="page-header">
        <h1>🧪 Practice Lab</h1>
      </div>
      <PageBanner pageId="practice">
        Practice rewriting real prompts from your sessions. The goal: Create Clarity upfront so the agent can deliver on the first try.
      </PageBanner>
      <p style={{ color: "var(--text-muted)", marginBottom: 16 }}>
        Sharpen your prompting skills — type a prompt to get instant feedback, or take a rewrite challenge.
      </p>

      <div className="tab-bar">
        <button className={`tab-btn ${tab === "sandbox" ? "active" : ""}`} onClick={() => setTab("sandbox")}>✏️ Sandbox</button>
        <button className={`tab-btn ${tab === "challenge" ? "active" : ""}`} onClick={() => setTab("challenge")}>🏆 Rewrite Challenge</button>
      </div>

      {tab === "sandbox" && <SandboxMode />}
      {tab === "challenge" && <ChallengeMode />}
    </div>
  );
}

/* ── Score Gauge ────────────────────────────────────────────── */

function ScoreGauge({ score, grade }) {
  const color = SCORE_COLORS[grade?.color] || "#8b949e";
  const pct = Math.max(0, Math.min(100, score));
  // SVG arc for the gauge
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div style={{ textAlign: "center" }}>
      <svg width="130" height="130" viewBox="0 0 130 130" role="img" aria-label={`Score: ${score} out of 100, ${grade?.label || "unknown"}`}>
        <title>Prompt quality score: {score}/100</title>
        <circle cx="65" cy="65" r={radius} fill="none" stroke="var(--border)" strokeWidth="10" />
        <circle cx="65" cy="65" r={radius} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 65 65)"
          style={{ transition: "stroke-dashoffset 0.4s ease" }} />
        <text x="65" y="60" textAnchor="middle" fill={color} fontSize="28" fontWeight="700">{score}</text>
        <text x="65" y="80" textAnchor="middle" fill="var(--text-muted)" fontSize="12">{grade?.label || ""}</text>
      </svg>
    </div>
  );
}

/* ── Pattern Badge ─────────────────────────────────────────── */

function PatternBadge({ category, emoji, label, matchedText }) {
  return (
    <div className="practice-badge">
      <span className="practice-badge-emoji">{emoji}</span>
      <div>
        <div className="practice-badge-label">{label}</div>
        {matchedText && <div className="practice-badge-match">matched: &ldquo;{matchedText}&rdquo;</div>}
      </div>
    </div>
  );
}

/* ── Nudges ─────────────────────────────────────────────────── */

function Nudges({ result }) {
  if (!result || result.score >= 85) return null;

  const nudges = [];
  const h = result.heuristics || {};

  if (h.charCount < 30) {
    nudges.push("Try expanding your prompt — what file, function, or endpoint are you working with?");
  }
  if (!h.hasFilePaths && h.wordCount >= 5) {
    nudges.push("What if you mentioned the specific file? e.g. \"in src/auth.ts\" or \"the /api/login endpoint\"");
  }
  if (!h.hasConstraints && h.wordCount >= 8) {
    nudges.push("Try adding a boundary — \"don't modify tests\", \"only change the middleware\", \"keep backward compat\"");
  }
  if (!h.hasCriteria && h.wordCount >= 10) {
    nudges.push("What should the result look like? Try \"it should return 200 with…\" or \"the test should pass when…\"");
  }
  if (!h.hasContext && h.wordCount >= 12) {
    nudges.push("Try adding why — \"because the token is expiring too early\" or \"so that the redirect works for OAuth\"");
  }
  if (!h.hasExamples && h.wordCount >= 15) {
    nudges.push("Try including an example — \"e.g. parseDate('11/14/2023') → Date\" helps clarify intent");
  }
  if (!h.hasOutputFormat && h.wordCount >= 15) {
    nudges.push("What format do you want? Try \"respond as a markdown table\" or \"return JSON with fields…\"");
  }
  if (!h.hasSteps && h.wordCount >= 20) {
    nudges.push("This seems complex — try breaking it into numbered steps: \"1. First... 2. Then...\"");
  }
  if (result.patterns.length > 0 && result.score < 45) {
    nudges.push("Try rephrasing without correction language — describe what you want, not what went wrong");
  }

  if (nudges.length === 0) return null;

  return (
    <div className="practice-nudges">
      <div className="practice-nudges-header">💬 Try this</div>
      {nudges.map((n, i) => (
        <div key={i} className="practice-nudge">{n}</div>
      ))}
    </div>
  );
}

/* ── Sandbox Mode ──────────────────────────────────────────── */

function SandboxMode() {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  const analyze = useCallback(async (prompt) => {
    if (!prompt || prompt.trim().length < 3) {
      setResult(null);
      return;
    }
    setAnalyzing(true);
    try {
      const data = await analyzePracticePrompt(prompt);
      setResult(data);
    } catch {
      // Silently ignore — user is still typing
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const handleChange = (e) => {
    setText(e.target.value);
  };

  const handleAnalyzeClick = () => {
    analyze(text);
  };

  return (
    <div className="practice-layout">
      <div className="practice-input-section">
        <label htmlFor="sandbox-prompt" className="sr-only">Enter a prompt to analyze</label>
        <textarea
          id="sandbox-prompt"
          className="practice-textarea"
          placeholder="Type a prompt to analyze...&#10;&#10;Example: &quot;Fix the login bug&quot; vs. &quot;The login endpoint POST /api/auth/login returns 401 even with valid credentials. Check the JWT verification in src/auth.ts — I think the token expiry check is using seconds instead of milliseconds.&quot;"
          value={text}
          onChange={handleChange}
          rows={8}
        />
        <div className="practice-char-count" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>
            {text.length} chars · {text.trim().split(/\s+/).filter(Boolean).length} words
            {analyzing && <span style={{ marginLeft: 8, color: "var(--accent)" }}>analyzing…</span>}
          </span>
          <button className="practice-analyze-btn" onClick={handleAnalyzeClick} disabled={analyzing || text.trim().length < 3}>
            {result ? "Re-analyze" : "Analyze"}
          </button>
        </div>
      </div>

      {result && (
        <div className="practice-results">
          {result.autoGenerated && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              marginBottom: 12,
              borderRadius: 8,
              background: "rgba(110, 118, 129, 0.15)",
              border: "1px solid #30363d",
              fontSize: 13,
              color: "#8b949e",
            }}>
              <span style={{ fontSize: 18 }}>🤖</span>
              <span>This looks like an auto-generated prompt (system notification, cross-session message, etc.) — scores may not be meaningful for machine-generated content.</span>
            </div>
          )}
          <div className="practice-results-top">
            <ScoreGauge score={result.score} grade={result.grade} />
            <div className="practice-heuristics">
              <h3>Quality Checks</h3>
              {result.heuristics?.details?.map((d) => (
                <div key={d.id} className="practice-heuristic">
                  <span className="practice-heuristic-dot" style={{ background: SEVERITY_COLORS[d.severity] }} />
                  <span className="practice-heuristic-label">{d.label}</span>
                  <span className="practice-heuristic-tip">{d.tip}</span>
                </div>
              ))}
            </div>
          </div>

          <Nudges result={result} />

          {result.tokenEfficiency && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header">⚡ Token Efficiency</div>
              <div style={{ padding: "12px 16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 12 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>
                      ~{result.tokenEfficiency.estimatedInputTokens}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Input Tokens</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: (result.tokenEfficiency.estimatedRetryProbability ?? 0) > 0.5 ? "var(--red)" : "var(--green)" }}>
                      {Math.round((result.tokenEfficiency.estimatedRetryProbability ?? 0) * 100)}%
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Retry Probability</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--orange)" }}>
                      ~{result.tokenEfficiency.estimatedTotalTokens.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Est. Total Tokens</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "var(--green)" }}>
                      ~{result.tokenEfficiency.optimizedEstimate.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Optimized Tokens</div>
                  </div>
                </div>
                {result.tokenEfficiency.savingsPercent > 0 && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 12px", borderRadius: 6,
                    background: "rgba(63, 185, 80, 0.08)", border: "1px solid rgba(63, 185, 80, 0.2)",
                    fontSize: 13,
                  }}>
                    <span>💰</span>
                    <span>
                      With improvements, this prompt could save <strong>{result.tokenEfficiency.savingsPercent}%</strong> of tokens
                      ({result.tokenEfficiency.estimatedTotalTokens - result.tokenEfficiency.optimizedEstimate} tokens)
                    </span>
                  </div>
                )}
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                  Grade: <strong style={{ color: result.tokenEfficiency.grade?.color }}>{result.tokenEfficiency.grade?.label || "—"}</strong> · High retry probability means prompts that need follow-ups cost 3-5× more.
                </div>
              </div>
            </div>
          )}

          {result.patterns.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header">⚠️ Detected Patterns</div>
              <div className="practice-badges">
                {result.patterns.map((p, i) => (
                  <PatternBadge key={i} {...p}
                    emoji={result.categories[p.category]?.emoji || "❓"}
                  />
                ))}
              </div>
            </div>
          )}

          {result.suggestions.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header">💡 How to Improve</div>
              {result.suggestions.map((s, i) => (
                <div key={i} className="practice-suggestion">
                  <div className="practice-suggestion-header">
                    {s.categoryEmoji} {s.categoryLabel} — <strong>{s.principle}</strong>
                  </div>
                  {s.before && s.after && (
                    <div className="practice-rewrite">
                      <div className="practice-rewrite-before">
                        <span className="practice-rewrite-label">❌ Instead of:</span>
                        <q>{s.before}</q>
                      </div>
                      <div className="practice-rewrite-after">
                        <span className="practice-rewrite-label">✅ Try:</span>
                        <q>{s.after}</q>
                      </div>
                      <div className="practice-rewrite-why">{s.why}</div>
                    </div>
                  )}
                  <ul className="practice-tips">
                    {s.tips.map((t, j) => <li key={j}>{t}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {result.patterns.length === 0 && result.score >= 70 && (
            <div className="card" style={{ marginTop: 16, textAlign: "center", padding: "32px 16px" }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>Clean prompt!</div>
              <div style={{ color: "var(--text-muted)", marginTop: 4 }}>
                No redirection patterns detected. This prompt looks well-structured.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Coaching Panel (shown before rewrite) ─────────────────── */

/**
 * Human-readable coaching tips keyed by challenge tag.
 * Used when heuristic details don't cover the tag's weakness.
 */
const TAG_COACHING = {
  vague: { label: "Too vague or short", tip: "Add specifics: which file, function, endpoint, or behavior? A one-liner rarely gives the agent enough to work with." },
  "no-files": { label: "No file or path references", tip: "Mention the specific file or path, e.g. \"in src/auth.ts\" or \"the /api/login endpoint\"." },
  "no-context": { label: "Missing context or reasoning", tip: "Explain why — \"because the token expires too early\" or \"so the redirect works for OAuth\"." },
  "no-constraints": { label: "No constraints or boundaries", tip: "Add guardrails: \"don't modify tests\", \"only change the middleware\", \"keep backward compat\"." },
  "no-criteria": { label: "No acceptance criteria", tip: "Describe the expected outcome: \"it should return 200 with…\" or \"the test should pass when…\"." },
  "no-examples": { label: "No examples provided", tip: "Include a sample: \"e.g. parseDate('11/14/2023') → Date\" helps clarify intent." },
  "no-format": { label: "No output format specified", tip: "State the format: \"respond as a markdown table\" or \"return JSON with fields…\"." },
  "no-steps": { label: "Not broken into steps", tip: "Break complex tasks into numbered steps: \"1. First... 2. Then...\"." },
  correction: { label: "Correction pattern", tip: "Instead of correcting after the fact, state the requirement upfront in your initial prompt." },
  frustration: { label: "Frustration signal", tip: "Describe what you see vs. what you expected — symptoms + hypothesis give the agent a debugging path." },
  rollback: { label: "Unscoped rollback", tip: "Scope what to revert: \"revert only changes to src/auth.ts — keep the other files\"." },
};

/**
 * Explains specifically what's wrong with the original prompt and
 * gives the user concrete guidance BEFORE they attempt a rewrite.
 */
function CoachingPanel({ challenge }) {
  if (!challenge) return null;

  const suggestions = challenge.suggestions || [];
  const h = challenge.heuristics || {};
  const patterns = challenge.patterns || [];
  const categories = challenge.categories || {};
  const details = h.details || [];
  const tags = challenge.tags || [];

  // Collect the "what's wrong" items — missing quality signals from heuristics
  const missingSignals = details.filter((d) => d.severity === "info" || d.severity === "warning");

  // Also generate coaching items from tags that aren't already covered by heuristics
  const coveredIds = new Set(details.map((d) => d.id));
  const tagCoaching = tags
    .filter((t) => TAG_COACHING[t] && !coveredIds.has(t))
    .map((t) => TAG_COACHING[t]);

  const hasContent = patterns.length > 0 || missingSignals.length > 0 || tagCoaching.length > 0 || suggestions.length > 0;
  if (!hasContent) return null;

  return (
    <div className="card coaching-panel" style={{ marginBottom: 16 }}>
      <div className="card-header">🎓 What's Wrong With This Prompt</div>

      {/* Problem patterns — explain why this prompt triggers redirections */}
      {patterns.length > 0 && (
        <div className="coaching-section">
          <div className="coaching-section-title">⚠️ Detected Problems</div>
          {patterns.map((p, i) => (
            <div key={i} className="coaching-problem">
              <span className="coaching-problem-emoji">{categories[p.category]?.emoji || "❓"}</span>
              <div className="coaching-problem-content">
                <strong>{p.label}</strong>
                {p.matchedText && (
                  <span className="coaching-matched"> — triggered by: &ldquo;{p.matchedText}&rdquo;</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Missing quality signals — what this prompt is lacking */}
      {(missingSignals.length > 0 || tagCoaching.length > 0) && (
        <div className="coaching-section">
          <div className="coaching-section-title">📋 What's Missing</div>
          {missingSignals.map((d, i) => (
            <div key={i} className="coaching-missing">
              <span className="coaching-missing-dot" style={{
                background: d.severity === "warning" ? "#d29922" : "#58a6ff"
              }} />
              <div>
                <strong>{d.label}</strong>
                <div className="coaching-missing-tip">{d.tip}</div>
              </div>
            </div>
          ))}
          {tagCoaching.map((t, i) => (
            <div key={`tag-${i}`} className="coaching-missing">
              <span className="coaching-missing-dot" style={{ background: "#d29922" }} />
              <div>
                <strong>{t.label}</strong>
                <div className="coaching-missing-tip">{t.tip}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rewrite guides — show before/after examples for their specific patterns */}
      {suggestions && suggestions.length > 0 && (
        <div className="coaching-section">
          <div className="coaching-section-title">✨ How to Fix It</div>
          {suggestions.map((s, i) => (
            <div key={i} className="coaching-guide">
              <div className="coaching-guide-header">
                {s.categoryEmoji} <strong>{s.principle}</strong>
              </div>
              {s.before && s.after && (
                <div className="coaching-rewrite-example">
                  <div className="coaching-rewrite-before">
                    <span className="coaching-rewrite-label">❌ Before:</span>
                    <q>{s.before}</q>
                  </div>
                  <div className="coaching-rewrite-after">
                    <span className="coaching-rewrite-label">✅ After:</span>
                    <q>{s.after}</q>
                  </div>
                  <div className="coaching-rewrite-why">💡 {s.why}</div>
                </div>
              )}
              <ul className="coaching-tips-list">
                {s.tips.map((t, j) => <li key={j}>{t}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Challenge Mode ────────────────────────────────────────── */

const TAG_EXPLANATIONS = {
  vague: "The prompt is too short or generic for the agent to know what you actually want. Add specifics: what file, what behavior, what the output should look like.",
  "no-files": "No file paths are mentioned, so the agent has to guess which files to work on — leading to wasted turns or wrong edits. Specify the files upfront.",
  "no-context": "The prompt lacks background about why this change is needed or how it fits into the bigger picture. The agent works better when it understands the intent.",
  "no-constraints": "No boundaries are set (language, framework, style, scope). Without constraints, the agent may choose an approach that doesn't fit your project.",
  "no-criteria": "There's no definition of done — how should the agent know when it's finished? Add acceptance criteria: what should work, what tests to pass, what output to expect.",
  "no-examples": "No example input/output is provided. Examples are the fastest way to show the agent exactly what you expect.",
  "no-format": "The prompt doesn't specify what format the output should be in (code, markdown, JSON, etc.). Be explicit about the deliverable.",
  "no-steps": "This is a complex task crammed into one prompt. Break it into smaller steps so the agent can succeed at each one before moving to the next.",
  correction: "This prompt is a correction of something the agent already did wrong. To avoid this, provide clearer constraints and examples in the original prompt.",
  frustration: "This prompt shows frustration — the agent isn't meeting expectations. Step back and reframe: what exactly do you need, and what has the agent gotten wrong?",
  rollback: "You're asking the agent to undo its work. This usually means the original prompt was missing constraints or acceptance criteria.",
};

const TAG_LABELS = {
  "": "All Topics",
  vague: "🔍 Vague / Too Short",
  "no-files": "📁 Missing File References",
  "no-context": "💭 Missing Context",
  "no-constraints": "🚧 No Constraints",
  "no-criteria": "✅ No Acceptance Criteria",
  "no-examples": "📝 No Examples",
  "no-format": "📊 No Output Format",
  "no-steps": "📋 Not Broken Into Steps",
  correction: "🚫 Correction Pattern",
  frustration: "😤 Frustration Signal",
  rollback: "⏪ Rollback Request",
};

function ChallengeMode() {
  const [source, setSource] = useState(null); // null = picker, "mine" | "library"
  const [tagFilter, setTagFilter] = useState("");
  const [challenge, setChallenge] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rewrite, setRewrite] = useState("");
  const [rewriteResult, setRewriteResult] = useState(null);
  const [analyzingRewrite, setAnalyzingRewrite] = useState(false);
  const [weaknesses, setWeaknesses] = useState(null);

  // Fetch user's weaknesses on mount for recommendations
  useEffect(() => {
    fetchWeaknesses("90d").then(setWeaknesses).catch(() => {});
  }, []);

  const loadChallenge = async (src) => {
    const effectiveSource = src || source;
    setLoading(true);
    setError(null);
    setRewrite("");
    setRewriteResult(null);
    try {
      if (effectiveSource === "mine") {
        const data = await fetchPracticeChallenge();
        setChallenge(data.challenge);
        if (!data.challenge) {
          setError(data.message || "No challenges available.");
        }
      } else {
        // Library: pick a random curated bad prompt, optionally filtered by tag
        const data = await fetchLibraryChallenge(tagFilter || undefined);
        if (!data.challenge) {
          setError("No challenges match that filter.");
        } else {
          setChallenge({
            ...data.challenge,
            sessionId: null,
            turnIndex: null,
          });
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const analyzeRewrite = useCallback(async (text) => {
    if (!text || text.trim().length < 3) {
      setRewriteResult(null);
      return;
    }
    setAnalyzingRewrite(true);
    try {
      const data = await analyzePracticePrompt(text);
      setRewriteResult(data);
    } catch {
      // Silently ignore
    } finally {
      setAnalyzingRewrite(false);
    }
  }, []);

  const handleRewriteChange = (e) => {
    setRewrite(e.target.value);
  };

  // Source picker — choose between your own bad prompts or curated library
  if (!source) {
    const topWeaknesses = weaknesses?.weaknesses?.slice(0, 3) || [];

    return (
      <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🏆</div>
        <h2 style={{ marginBottom: 8 }}>Rewrite Challenge</h2>
        <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>
          Pick a poorly-written prompt and rewrite it to score higher.
        </p>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="practice-challenge-btn" onClick={() => { setSource("mine"); loadChallenge("mine"); }}>
            🔍 My Bad Prompts
          </button>
          <button className="practice-challenge-btn" style={{ background: "var(--bg-card)", color: "var(--text)", border: "1px solid var(--border)" }} onClick={() => { setSource("library"); loadChallenge("library"); }}>
            📚 Prompt Library ({Object.keys(TAG_LABELS).length - 1} topics)
          </button>
        </div>

        {topWeaknesses.length > 0 && (
          <div className="practice-recommendations">
            <div className="practice-recommendations-header">📊 Recommended for you</div>
            <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 12 }}>
              Based on your recent sessions, practice these areas:
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {topWeaknesses.map((w) => (
                <button
                  key={w.tag}
                  className="practice-rec-tag"
                  onClick={() => { setTagFilter(w.tag); setSource("library"); loadChallenge("library"); }}
                  title={`${w.pct}% of your prompts are missing this`}
                >
                  {TAG_LABELS[w.tag] || w.tag}
                  <span className="practice-rec-pct">{w.pct}%</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 16 }}>
          &ldquo;My Bad Prompts&rdquo; pulls real low-scoring prompts from your sessions.<br/>
          &ldquo;Prompt Library&rdquo; has 80+ curated bad prompts covering best practices from GitHub, Anthropic, Google &amp; OpenAI.
        </p>
      </div>
    );
  }

  if (!challenge && !loading && !error) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🏆</div>
        <h2 style={{ marginBottom: 8 }}>Rewrite Challenge</h2>
        <button className="practice-challenge-btn" onClick={() => loadChallenge()}>
          Start Challenge
        </button>
      </div>
    );
  }

  if (loading) return <div className="loading">Finding a challenge…</div>;
  if (error) return (
    <div className="card" style={{ textAlign: "center", padding: "32px 24px" }}>
      <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
      <p style={{ color: "var(--text-muted)" }}>{error}</p>
      <button className="practice-challenge-btn" onClick={loadChallenge} style={{ marginTop: 16 }}>
        Try Again
      </button>
    </div>
  );

  const improved = rewriteResult && rewriteResult.score > challenge.score;

  return (
    <div>
      {/* Original prompt card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>📝 Original Prompt</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {source === "mine" ? "From your sessions" : "Prompt Library"}
          </span>
        </div>
        <div className="practice-challenge-original">
          <q style={{ fontStyle: "italic", color: "var(--text-muted)" }}>{challenge.originalPrompt}</q>
        </div>
        {challenge && (challenge.tags || challenge.hint || challenge.category) && (
          <div style={{ background: "rgba(248, 81, 73, 0.08)", border: "1px solid rgba(248, 81, 73, 0.2)", borderRadius: 8, padding: "12px 16px", marginBottom: 16 }}>
            <div style={{ fontWeight: 600, color: "#f85149", marginBottom: 8, fontSize: 13 }}>
              🔍 What's wrong with this prompt?
            </div>
            {/* Specific evidence from the prompt */}
            {(() => {
              const prompt = challenge.originalPrompt || "";
              const words = prompt.trim().split(/\s+/).length;
              const hasFiles = /[\/\\][\w.-]+\.\w+|\.jsx?|\.tsx?|\.py|\.css|\.mjs/.test(prompt);
              const hasConstraints = /must|should|don't|avoid|only|limit|require|constraint/i.test(prompt);
              const hasCriteria = /expect|result|output|return|should.*work|accept|test|verify/i.test(prompt);
              const hasContext = /because|since|currently|right now|the goal|we need|background/i.test(prompt);
              const issues = [];
              if (words < 15) issues.push(`📏 Only ${words} words — too short for the agent to understand what you need.`);
              else if (words < 30) issues.push(`📏 Only ${words} words — short prompts often lack enough detail for the agent.`);
              if (!hasFiles) issues.push("📁 No file paths mentioned — the agent has to guess which files to work on.");
              if (!hasConstraints) issues.push("🚧 No constraints given — no \"must\", \"should\", \"avoid\" etc. The agent might choose an approach that doesn't fit.");
              if (!hasCriteria) issues.push("✅ No acceptance criteria — how will the agent know when it's done correctly?");
              if (!hasContext) issues.push("💭 No context about WHY this change is needed or how it fits the bigger picture.");
              if (issues.length === 0) issues.push("🔍 This prompt is technically okay but could be more specific to reduce back-and-forth.");
              return (
                <div style={{ background: "rgba(248, 81, 73, 0.05)", borderRadius: 6, padding: "8px 12px", marginBottom: 10, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Specifically, this prompt:</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, color: "var(--text-muted)" }}>
                    {issues.map((issue, i) => <div key={i}>{issue}</div>)}
                  </div>
                </div>
              );
            })()}
            {challenge.tags && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                {(Array.isArray(challenge.tags) ? challenge.tags : [challenge.tags]).map((tag, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ background: "rgba(248, 81, 73, 0.15)", color: "#f85149", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", marginTop: 1 }}>{TAG_LABELS[tag] || tag}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{TAG_EXPLANATIONS[tag] || ""}</span>
                  </div>
                ))}
              </div>
            )}
            {challenge.hint && <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>💡 <em>{challenge.hint}</em></p>}
            {challenge.hint && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#3fb950" }}>
                ✅ <strong>How to improve:</strong> {challenge.suggestion || challenge.hint}
              </div>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div className="practice-score-pill" style={{ background: SCORE_COLORS[challenge.grade?.color] + "22", color: SCORE_COLORS[challenge.grade?.color] }}>
            Score: {challenge.score}/100
          </div>
          {challenge.tags && challenge.tags.map((t, i) => (
            <span key={i} className="practice-tag-pill">{t}</span>
          ))}
          {challenge.patterns.map((p, i) => (
            <span key={`p${i}`} className="practice-pattern-tag">
              {challenge.categories[p.category]?.emoji} {p.label}
            </span>
          ))}
        </div>
        {/* Tag filter for library source */}
        {source === "library" && (
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label htmlFor="tag-filter" style={{ fontSize: 12, color: "var(--text-muted)" }}>Filter:</label>
            <select
              id="tag-filter"
              className="practice-tag-select"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
            >
              {Object.entries(TAG_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Coaching panel — explain what's wrong before asking for a rewrite */}
      <CoachingPanel challenge={challenge} />

      {/* Rewrite area */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">✍️ Your Rewrite</div>
        <label htmlFor="rewrite-prompt" className="sr-only">Rewrite the prompt to improve its score</label>
        <textarea
          id="rewrite-prompt"
          className="practice-textarea"
          placeholder="Rewrite the prompt above to eliminate the detected patterns..."
          value={rewrite}
          onChange={handleRewriteChange}
          rows={5}
        />
        <div className="practice-char-count" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>
            {rewrite.length} chars
            {analyzingRewrite && <span style={{ marginLeft: 8, color: "var(--accent)" }}>analyzing…</span>}
          </span>
          <button className="practice-analyze-btn" onClick={() => analyzeRewrite(rewrite)} disabled={analyzingRewrite || rewrite.trim().length < 3}>
            {rewriteResult ? "Re-analyze" : "Analyze"}
          </button>
        </div>
      </div>

      {/* Score comparison */}
      {rewriteResult && (
        <div className="practice-comparison">
          <div className="practice-comparison-side">
            <h3>Original</h3>
            <ScoreGauge score={challenge.score} grade={challenge.grade} />
          </div>
          <div className="practice-comparison-arrow">
            →
          </div>
          <div className="practice-comparison-side">
            <h3>Your Rewrite</h3>
            <ScoreGauge score={rewriteResult.score} grade={rewriteResult.grade} />
          </div>
          <div className="practice-comparison-verdict">
            {improved && (
              <div className="practice-verdict-win">
                🎉 +{rewriteResult.score - challenge.score} points! Great improvement!
              </div>
            )}
            {rewriteResult && !improved && rewriteResult.score === challenge.score && (
              <div className="practice-verdict-tie">
                🤔 Same score — try adding more specificity, constraints, or file references.
              </div>
            )}
            {rewriteResult && !improved && rewriteResult.score < challenge.score && (
              <div className="practice-verdict-loss">
                📉 Score went down — check the pattern badges below for what to fix.
              </div>
            )}
          </div>
        </div>
      )}

      {rewriteResult && <Nudges result={rewriteResult} />}

      {/* Rewrite analysis */}
      {rewriteResult && rewriteResult.patterns.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">⚠️ Patterns still detected in your rewrite</div>
          <div className="practice-badges">
            {rewriteResult.patterns.map((p, i) => (
              <PatternBadge key={i} {...p}
                emoji={rewriteResult.categories[p.category]?.emoji || "❓"}
              />
            ))}
          </div>
        </div>
      )}

      {rewriteResult && rewriteResult.suggestions.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">💡 Tips for your rewrite</div>
          {rewriteResult.suggestions.map((s, i) => (
            <div key={i} className="practice-suggestion">
              <strong>{s.categoryEmoji} {s.principle}</strong>
              <ul className="practice-tips">
                {s.tips.map((t, j) => <li key={j}>{t}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
        <button className="practice-challenge-btn" onClick={() => loadChallenge()}>
          Next Challenge →
        </button>
        <button
          className="practice-challenge-btn"
          style={{ background: "var(--bg-card)", color: "var(--text)", border: "1px solid var(--border)" }}
          onClick={() => { setSource(null); setChallenge(null); setRewrite(""); setRewriteResult(null); setError(null); }}
        >
          Switch Source
        </button>
      </div>
    </div>
  );
}
