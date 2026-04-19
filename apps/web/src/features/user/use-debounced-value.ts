import { useEffect, useState } from "react";

// Debounces a value by delayMs. Rapid successive updates collapse into
// one delayed emission; each new input resets the timer. Used by the
// invite autocomplete to avoid firing a tRPC query per keystroke.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
