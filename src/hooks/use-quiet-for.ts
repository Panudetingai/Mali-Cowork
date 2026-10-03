import { useEffect, useRef, useState } from "react";

/** A reply in progress with no new text or step for this long is thinking, not writing. */
export const THINKING_AFTER_MS = 1500;

/**
 * How long `growth` has stayed the same, in ms. Re-checked twice a second
 * while `active`, redrawing only the component that asks.
 */
export function useQuietFor(growth: number, active = true) {
  const last = useRef({ growth, at: Date.now() });
  if (last.current.growth !== growth) last.current = { growth, at: Date.now() };
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [active]);
  return Date.now() - last.current.at;
}
