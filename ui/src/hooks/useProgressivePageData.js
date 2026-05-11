import { useEffect, useMemo, useState } from "react";

function buildInitialState(initialEntries, deferredByTab) {
  const state = {};
  for (const key of Object.keys(initialEntries || {})) state[key] = null;
  for (const loaders of Object.values(deferredByTab || {})) {
    for (const key of Object.keys(loaders || {})) {
      if (!(key in state)) state[key] = null;
    }
  }
  return state;
}

export function useProgressivePageData({
  deps,
  initialEntries,
  deferredByTab,
  activeTab,
  validateInitial,
}) {
  const emptyState = useMemo(
    () => buildInitialState(initialEntries, deferredByTab),
    [initialEntries, deferredByTab]
  );
  const [data, setData] = useState(emptyState);
  const [loadedDeferredKeys, setLoadedDeferredKeys] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(emptyState);
    setLoadedDeferredKeys(new Set());

    const entries = Object.entries(initialEntries || {});
    Promise.allSettled(entries.map(([, loader]) => loader()))
      .then((results) => {
        if (cancelled) return;
        const next = { ...emptyState };
        entries.forEach(([key], index) => {
          if (results[index].status === "fulfilled") {
            next[key] = results[index].value;
          }
        });
        setData(next);

        const validationError = validateInitial?.(next, results);
        if (validationError) {
          setError(validationError);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [emptyState, initialEntries, ...deps]);

  useEffect(() => {
    if (!activeTab) return undefined;

    const loaders = deferredByTab?.[activeTab];
    if (!loaders) return undefined;

    const pendingEntries = Object.entries(loaders).filter(([key]) => !loadedDeferredKeys.has(key));
    if (pendingEntries.length === 0) return undefined;

    let cancelled = false;
    Promise.allSettled(pendingEntries.map(([, loader]) => loader()))
      .then((results) => {
        if (cancelled) return;
        setLoadedDeferredKeys((prev) => {
          const next = new Set(prev);
          pendingEntries.forEach(([key]) => next.add(key));
          return next;
        });
        setData((prev) => {
          const next = { ...prev };
          pendingEntries.forEach(([key], index) => {
            if (results[index].status === "fulfilled") {
              next[key] = results[index].value;
            }
          });
          return next;
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, deferredByTab, loadedDeferredKeys, ...deps]);

  return { data, setData, loading, error, setError };
}
