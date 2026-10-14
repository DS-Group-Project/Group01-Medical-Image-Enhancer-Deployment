import { useState, useEffect, useCallback, useRef } from 'react';

const MAX_BACKOFF_MS = 60_000; // 1 minute ceiling

export const usePolling = (callback, interval, enabled = false, options = {}) => {
  const [isPolling, setIsPolling] = useState(enabled);
  const savedCallback = useRef(callback);
  const savedOnError = useRef(options.onError);
  const timerRef = useRef(null);
  const errorCountRef = useRef(0);
  const currentIntervalRef = useRef(interval);

  // Keep refs fresh
  useEffect(() => { savedCallback.current = callback; }, [callback]);
  useEffect(() => { savedOnError.current = options.onError; }, [options.onError]);

  const startPolling = useCallback(() => setIsPolling(true), []);
  const stopPolling = useCallback(() => {
    setIsPolling(false);
    errorCountRef.current = 0;
    currentIntervalRef.current = interval;
  }, [interval]);

  useEffect(() => { setIsPolling(enabled); }, [enabled]);

  useEffect(() => {
    if (!isPolling) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      timerRef.current = setTimeout(async () => {
        if (cancelled) return;
        try {
          await savedCallback.current();
          // Success: reset backoff
          errorCountRef.current = 0;
          currentIntervalRef.current = interval;
        } catch (err) {
          errorCountRef.current += 1;
          // Exponential backoff: base * 2^errorCount, capped
          currentIntervalRef.current = Math.min(
            interval * Math.pow(2, errorCountRef.current),
            MAX_BACKOFF_MS
          );
          if (savedOnError.current) savedOnError.current(err);
        }
        schedule();
      }, currentIntervalRef.current);
    };

    schedule();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPolling, interval]);

  return { isPolling, startPolling, stopPolling };
};

export default usePolling;
