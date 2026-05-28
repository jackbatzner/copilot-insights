import { useEffect, useState } from "react";
import { fetchTokenSummaryProgress } from "../api.js";

const POLL_INTERVAL_MS = 400;

export function useProgressiveTokenSummary(timeframe, refreshKey, { delayMs = 0 } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timerId = null;
    const controller = new AbortController();

    setData(null);
    setLoading(true);
    setError(null);
    setIsUpdating(false);

    const poll = async () => {
      try {
        const next = await fetchTokenSummaryProgress(timeframe, undefined, { signal: controller.signal });
        if (cancelled) return;
        setData(next);
        setLoading(false);
        const complete = next?.progress?.complete === true;
        setIsUpdating(!complete);
        if (!complete) {
          timerId = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled || err?.name === "AbortError") return;
        setError(err.message);
        setLoading(false);
        setIsUpdating(false);
      }
    };

    timerId = setTimeout(poll, delayMs);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timerId);
    };
  }, [timeframe, refreshKey, delayMs]);

  return { data, loading, error, isUpdating };
}
