"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, type RefObject } from "react";

/**
 * Bars that move with the voice. They read `level` each frame and set their
 * own height, so the component around them never re-renders for it. With no
 * level (system dictation, or speech playing) they breathe on their own.
 */
export function Waveform({
  level,
  bars = 5,
  className,
  barClassName,
}: {
  level?: RefObject<number>;
  bars?: number;
  className?: string;
  barClassName?: string;
}) {
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const items = Array.from(el.children) as HTMLElement[];
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let smooth = 0;
    let frame = 0;
    const draw = (now: number) => {
      // Rises fast, falls slowly: reads as a voice, not a flicker.
      const target = level ? level.current : 0.35 + 0.25 * Math.sin(now / 260);
      smooth += (target - smooth) * (target > smooth ? 0.5 : 0.12);
      items.forEach((bar, i) => {
        const wobble = reduced ? 0.6 : 0.55 + 0.45 * Math.sin(now / 140 + i * 1.3);
        const h = Math.max(0.18, Math.min(1, smooth * 1.6 * wobble + 0.12));
        bar.style.transform = `scaleY(${h.toFixed(3)})`;
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [level]);

  return (
    <span ref={box} className={cn("flex h-4 items-center gap-[3px]", className)} aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className={cn("h-full w-[3px] origin-center rounded-full bg-current transition-none", barClassName)} />
      ))}
    </span>
  );
}
