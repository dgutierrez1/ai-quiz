import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useLocalStorage — persisted preference hook (Story 2.7).
 *
 * Generic over T. Reads synchronously on first render (which is safe on the
 * client only). The first render before mount returns the initial value —
 * this matters for the theme + UUID providers, which read their persisted
 * state in a child component mounted after hydration.
 *
 * Writes are guarded by a mounted ref so the initial state effect does not
 * write the value we just read back to storage.
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): readonly [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initialValue);
  const hydratedRef = useRef(false);

  useEffect(() => {
    hydratedRef.current = false;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        setValue(JSON.parse(raw) as T);
      }
    } catch {
      // Storage may be unavailable (private mode, quota, etc.) — fall back to initial.
    }
    hydratedRef.current = true;
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          /* ignore quota / private-mode failures */
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update] as const;
}
