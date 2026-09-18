import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number, active: boolean) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (!active) {
      setDebounced(value);
      return;
    }
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs, active]);

  return active ? debounced : value;
}
