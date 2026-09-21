// Scrollbars are hidden across the app, which leaves a cut-off list looking
// like a complete one. These fade the content at whichever edge has more
// behind it, so "there is more" is visible without a scrollbar.

import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

const FADE = "1.5rem";

function maskFor(top: boolean, bottom: boolean): CSSProperties | undefined {
  if (!top && !bottom) return undefined;
  const from = top ? `transparent 0, #000 ${FADE}` : "#000 0";
  const to = bottom ? `#000 calc(100% - ${FADE}), transparent 100%` : "#000 100%";
  const mask = `linear-gradient(to bottom, ${from}, ${to})`;
  return { maskImage: mask, WebkitMaskImage: mask };
}

/**
 * Wire a scroll container to an edge fade: spread `ref`, `onScroll` and
 * `style` onto it. `watch` re-measures when the content behind it changes.
 */
export function useScrollFade<T extends HTMLElement>(watch?: unknown) {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    // A pixel or two of rounding is not "more content".
    setEdges({ top: el.scrollTop > 4, bottom: max > 4 && el.scrollTop < max - 4 });
  }, []);

  useEffect(() => {
    sync();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [sync, watch]);

  return { ref, onScroll: sync, style: maskFor(edges.top, edges.bottom), more: edges.bottom };
}

/** A nudge at the bottom edge of a list that has more below. */
export function ScrollMore({ show, className }: { show: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-1 transition-opacity duration-200",
        show ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      <span className="flex size-4 items-center justify-center rounded-full bg-muted/80 text-muted-foreground shadow-sm">
        <ChevronDownIcon className="size-3" />
      </span>
    </span>
  );
}
