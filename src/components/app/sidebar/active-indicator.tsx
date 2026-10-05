import { cn } from "@/lib/utils";
import { useEffect, useRef, type ReactNode } from "react";
import { activeCardLook } from "./sidebar-styles";

/**
 * A list whose active row (`data-active="true"`) sits on one white card that
 * glides from row to row.
 *
 * The card moves with a CSS transform transition, which the compositor runs:
 * it stays smooth while the page that was clicked is still rendering, where a
 * JS-driven layout animation would stall. It lives at the list's level, not
 * inside a row, so no row's rounded clipping cuts it off on the way.
 */
export function ActiveIndicatorList({ children, className }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const list = box.current;
    const card = mark.current;
    if (!list || !card) return;
    let shown = false;
    let frame = 0;

    /** Put the card under the active row; `glide` animates the move. */
    const place = (glide: boolean) => {
      const active = list.querySelector<HTMLElement>('[data-active="true"]');
      if (!active || active.offsetParent === null) {
        card.style.opacity = "0";
        shown = false;
        return;
      }
      const a = active.getBoundingClientRect();
      const b = list.getBoundingClientRect();
      // First appearance or a resize: no slide from wherever it was.
      card.style.transition = glide && shown ? "" : "opacity 150ms ease";
      card.style.transform = `translate3d(${a.left - b.left}px, ${a.top - b.top}px, 0)`;
      card.style.width = `${a.width}px`;
      card.style.height = `${a.height}px`;
      card.style.opacity = "1";
      shown = true;
    };
    const schedule = (glide: boolean) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => place(glide));
    };

    place(false);
    // Another row turned active, or rows came, went or moved: glide.
    const mutations = new MutationObserver(() => schedule(true));
    mutations.observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-active"] });
    // The sidebar folding, a group opening: follow at once.
    const sizes = new ResizeObserver(() => place(false));
    sizes.observe(list);
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      sizes.disconnect();
    };
  }, []);

  return (
    <div ref={box} className={cn("relative", className)}>
      <span
        ref={mark}
        aria-hidden
        className={cn(
          activeCardLook,
          "pointer-events-none absolute top-0 left-0 z-0 opacity-0 will-change-transform",
          "transition-[transform,width,height,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        )}
      />
      {children}
    </div>
  );
}
