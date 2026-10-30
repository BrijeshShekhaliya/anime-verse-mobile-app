import { useCallback, useEffect, useRef, useState } from 'react';

// Loads data for a screen. Supports optional initialData (e.g. from sync in-memory cache)
// so navigation is instantaneous with zero skeleton flash.
// Exposes reload() for retry and pull-to-refresh.
export function useFetch<T>(load: () => Promise<T>, deps: unknown[], initialData?: T | null) {
  const [data, setData] = useState<T | null>(initialData ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initialData);
  const token = useRef(0);

  const run = useCallback(() => {
    const mine = ++token.current;
    if (!data) setLoading(true);
    setError(null);
    load()
      .then((d) => {
        if (mine === token.current) setData(d);
      })
      .catch((e: Error) => {
        if (mine === token.current) setError(e.message || 'Something went wrong');
      })
      .finally(() => {
        if (mine === token.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
    return () => {
      token.current += 1;
    };
  }, [run]);

  return { data, error, loading, reload: run };
}
