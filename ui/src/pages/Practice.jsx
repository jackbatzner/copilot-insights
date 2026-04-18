import { useState, useCallback, useEffect } from "react";
import { analyzePracticePrompt, fetchPracticeChallenge, fetchLibraryChallenge, fetchWeaknesses } from "../api";

const SCORE_COLORS = { green: "#3fb950", yellow: "#d29922", orange: "#db6d28", red: "#f85149" };
const SEVERITY_COLORS = { ok: "#3fb950", info: "#58a6ff", warning: "#d29922" };

export default function Practice() {
  const [tab, setTab] = useState("sandbox");

  return (
    <div className="page">
      <div className="page-header">
        <h1>🧪 Practice Lab</h1>
      </div>
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

/* ── Challenge Mode ────────────────────────────────────────── */

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
        {challenge.hint && (
          <div className="practice-challenge-hint">💡 {challenge.hint}</div>
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
