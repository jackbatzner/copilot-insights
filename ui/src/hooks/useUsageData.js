import { useCallback, useEffect, useRef, useState } from "react";
import { useRefresh } from "../App.jsx";

export function useUsageData(loader, { pollActive = false, enabled = true } = {}) {
  const { key } = useRefresh();
  const [retryKey, setRetryKey] = useState(0);
  const previousRetry = useRef(0);
  const selection = useRef(null);
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const retry = useCallback(() => setRetryKey((value) => value + 1), []);

  useEffect(() => {
    selection.current = { loader, key, retryKey };
    if (!enabled) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    let timer;
    const forceFresh = previousRetry.current !== retryKey;
    previousRetry.current = retryKey;
    setState({ data: null, loading: true, error: null });
    const load = async (noCache = false) => {
      if (controller.signal.aborted) return;
      try {
        const data = await loader({ signal: controller.signal, noCache });
        if (controller.signal.aborted) return;
        setState({ data, loading: false, error: null });
        if (pollActive && data.diagnostic?.active === true) {
          timer = setTimeout(() => load(true), 15_000);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setState((previous) => ({
          ...previous, loading: false,
          error: error.name === "AbortError" ? "The usage request was interrupted. Try again." : "Usage data is unavailable. Try again.",
        }));
      }
    };
    load(forceFresh);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [loader, key, retryKey, pollActive, enabled]);
  const current = selection.current;
  if (current?.loader !== loader || current?.key !== key || current?.retryKey !== retryKey) {
    return { data: null, loading: enabled, error: null, retry };
  }
  return { ...state, retry };
}
