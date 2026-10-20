import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { firstTextLine } from "../local-text-preview.js";
import { usePresentation } from "../PresentationContext.jsx";

const ContentContext = createContext(null);

export function LocalContentProvider({ handle, refreshing, refreshKey, children }) {
  const presentation = usePresentation();
  const showText = !presentation.enabled;
  const setShowText = (visible) => presentation.setEnabled(!visible);
  return <ContentContext.Provider value={{ handle, enabled: showText && !refreshing, refreshKey, showText, setShowText }}>{children}</ContentContext.Provider>;
}

export function LocalContentConsent() {
  const { showText, setShowText } = useContext(ContentContext);
  return <section className="local-content-consent" aria-label="Local text privacy">
    <div className="section-heading"><h2>Local text</h2><button onClick={() => setShowText(!showText)}>{showText ? "Hide all text" : "Show text"}</button></div>
    <p className="scope-note">{showText ? "Original local text is visible and may contain sensitive information." : "Presentation mode is on. No local text or preview is loaded."}</p>
    <details className="scope-explanation"><summary>What text is shown and where it stays</summary>
    <p className="scope-note">Turn headers show the first recorded prompt line, or reply line when no prompt is recorded—not a generated summary.
      Select a turn for its text, or expand a linked child agent for its delegation prompt.</p>
    <p className="scope-note">Text loads automatically for the current page of turns and expanded agents. Original text may contain sensitive information and is not guaranteed to be redacted.
      It stays outside usage analytics, shared caches and exports. Hide all text enables presentation mode: previews and text stay hidden across navigation, Refresh and reload until you choose Show text.</p>
    </details>
  </section>;
}

export function useLocalContent({ kind, turnIndex, attributionKey }) {
  const { handle, enabled, refreshKey } = useContext(ContentContext);
  const valid = kind === "agent" ? Boolean(attributionKey) : Number.isSafeInteger(turnIndex) && turnIndex >= 0;
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const controller = useRef(null);
  const generation = useRef(0);
  const cancel = useCallback(() => {
    generation.current++;
    controller.current?.abort();
  }, []);
  const clear = useCallback(() => {
    cancel();
    setState({ loading: false, data: null, error: null });
  }, [cancel]);
  const reveal = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const current = ++generation.current;
    const timeout = setTimeout(() => abort.abort(), 30_000);
    setState({ loading: true, data: null, error: null });
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(handle)}/content`, {
        method: "POST", cache: "no-store", signal: abort.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, kind, ...(kind === "turn" ? { turnIndex } : { attributionKey }) }),
      });
      if (!response.ok) throw new Error("Local text could not be loaded. Check source availability and retry.");
      const data = await response.json();
      if (!Array.isArray(data.messages) || data.messages.some((message) =>
        !["user", "assistant", "agent-prompt"].includes(message.role) || typeof message.text !== "string")) {
        throw new Error("Local text returned an invalid response.");
      }
      if (current === generation.current) setState({ loading: false, data, error: null });
    } catch {
      if (current === generation.current) setState({ loading: false, data: null, error: "Local text could not be loaded. Retry or hide this panel." });
    } finally { clearTimeout(timeout); }
  }, [handle, kind, turnIndex, attributionKey]);
  useEffect(() => {
    if (enabled && valid) void reveal();
    else clear();
    return cancel;
  }, [enabled, valid, refreshKey, reveal, clear, cancel]);
  return { ...(enabled && valid ? state : { loading: false, data: null, error: null }), enabled: enabled && valid, reveal, clear, kind };
}

export function LocalTextPreview({ content }) {
  if (!content.enabled) return null;
  const preview = firstTextLine(content.data?.messages);
  return <span className="local-content-preview">
    {preview ? <><span className="scope-note">{preview.role === "user" ? "Prompt" : "Reply"} · first line</span><span dir="auto">{preview.text}</span></>
      : <span className="scope-note">{content.loading ? "Loading text..." : content.error ? "Text unavailable; select to retry" : content.data ? "Text not recorded" : "Text hidden"}</span>}
  </span>;
}

export function LocalContentView({ content }) {
  const { enabled, loading, data, error, reveal, clear, kind } = content;
  const title = kind === "turn" ? "turn text" : "agent prompt";
  if (!enabled) return <p className="scope-note">Text is hidden. Use Show text above to restore it.</p>;
  return <div className="local-content-panel">
    {!loading && !data && <button onClick={reveal}>{error ? `Retry ${title}` : `Show ${title}`}</button>}
    {(loading || data || error) && <button onClick={clear}>{loading ? `Cancel ${title} loading` : `Hide ${title}`}</button>}
    {loading && <p role="status">Loading local text only for this panel...</p>}
    {error && <p role="alert">{error}</p>}
    {data && <div aria-label={`Local ${title}`} className="local-content-text">
      <p className="scope-note">Source: {data.source === "sessiondb" ? "Local SessionDB" : data.source === "jsonl" ? "Local session-state JSONL" : "Not recorded"}.
        {kind === "turn" ? " Stored turn text is not necessarily the full input sent with each model request." : " Recorded delegation prompt; not the agent's full system instructions."}</p>
      {!data.messages.length && <p>No matching text is recorded in the supported local source. No linkage is inferred from timing.</p>}
      {data.truncated && <p role="note">Text is partial because a display or source-reading limit was reached.</p>}
      {data.messages.map((message, index) => <div key={index}>
        <h4>{({ user: "User prompt", assistant: "Assistant reply", "agent-prompt": "Agent delegation prompt" })[message.role]}</h4>
        <pre dir="auto">{message.text}</pre>
      </div>)}
    </div>}
  </div>;
}

export function LocalContentPanel(props) {
  const content = useLocalContent(props);
  return <LocalContentView content={content} />;
}
