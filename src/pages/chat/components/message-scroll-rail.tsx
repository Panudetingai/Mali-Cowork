import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/pages/chat/types";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Dashes on each side of the one you're on — the rail never shows more than 2 × RAIL_SIDE + 1. */
const RAIL_SIDE = 4;
const JUMP_PREVIEW = 52;

type Jump = { id: string; preview: string };

function previewLine(content: string) {
  const flat = content.replace(/\s+/g, " ").trim();
  if (!flat) return "…";
  return flat.length > JUMP_PREVIEW ? `${flat.slice(0, JUMP_PREVIEW - 1)}…` : flat;
}

type RailWindow = { jumps: Jump[]; focusIndex: number };

/** Every user prompt, and the one being read at the current scroll position. */
function railWindow(el: HTMLElement, messages: ChatMessage[]): RailWindow {
  const users = messages.filter((m) => m.role === "user" && m.content.trim());
  if (users.length === 0) return { jumps: [], focusIndex: 0 };

  const scrollTop = el.scrollTop;
  const rootRect = el.getBoundingClientRect();
  const readY = scrollTop + Math.min(96, el.clientHeight * 0.22);

  const items: { jump: Jump; top: number }[] = [];
  for (const m of users) {
    const node = el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(m.id)}"]`);
    if (!node) continue;
    const rect = node.getBoundingClientRect();
    items.push({
      jump: { id: m.id, preview: previewLine(m.content) },
      top: scrollTop + (rect.top - rootRect.top),
    });
  }

  let focusIndex = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].top <= readY) focusIndex = i;
    else break;
  }
  return { jumps: items.map((x) => x.jump), focusIndex };
}

/** Each slot from the top, the one you're on in the middle; `null` where the chat runs out. */
function railSlots(jumps: Jump[], focus: number): { jump: Jump | null; distance: number }[] {
  return Array.from({ length: RAIL_SIDE * 2 + 1 }, (_, i) => {
    const distance = i - RAIL_SIDE;
    return { jump: jumps[focus + distance] ?? null, distance };
  });
}

/** Widest at the one you're on, narrowing the same way above and below it. */
const DASH_WIDTHS = [16, 12, 9, 7, 5];
const DASH_OPACITY = [1, 0.6, 0.45, 0.35, 0.25];

function railDashStyle(distance: number, hot: boolean) {
  const d = Math.min(Math.abs(distance), DASH_WIDTHS.length - 1);
  return { width: DASH_WIDTHS[d], height: d === 0 ? 3 : 2.5, opacity: hot ? 0.95 : DASH_OPACITY[d] };
}

/** How long the pointer may leave before the list closes, so crossing the gap doesn't flicker it. */
const CLOSE_DELAY = 160;

/**
 * Scroll minimap: horizontal dashes for a sliding window of user prompts.
 * Hovering the dashes (not the page edge) opens the same list beside them.
 */
export function MessageScrollRail({
  containerRef,
  messages,
  atBottom,
  isLoading,
  onScrollToBottom,
}: {
  containerRef: RefObject<HTMLElement | null>;
  messages: ChatMessage[];
  atBottom: boolean;
  isLoading?: boolean;
  onScrollToBottom: () => void;
}) {
  const [windowState, setWindowState] = useState<RailWindow>({ jumps: [], focusIndex: 0 });
  const [open, setOpen] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      setHoverId(null);
    }, CLOSE_DELAY);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setWindowState(railWindow(el, messages));
  }, [containerRef, messages]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [containerRef, measure]);

  const jumpToMessage = (id: string) => {
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (messages.length === 0) return null;

  const { jumps: allJumps, focusIndex } = windowState;
  if (allJumps.length === 0) return null;

  const lastIndex = allJumps.length - 1;
  const focus = atBottom ? lastIndex : Math.min(focusIndex, lastIndex);
  const slots = railSlots(allJumps, focus);
  const railJumps = slots.flatMap((slot) => (slot.jump ? [slot.jump] : []));
  const activeId = allJumps[focus]?.id ?? null;

  return (
    <div className="pointer-events-none absolute inset-y-6 right-1 z-10 flex items-center">
      <div
        className="pointer-events-auto relative"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hide();
        }}
      >
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 4 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              // pr-2 is part of the hover area: it bridges the gap to the dashes.
              className="absolute top-1/2 right-full -translate-y-1/2 pr-2"
            >
              <ul className="flex max-h-72 w-[min(16rem,calc(100vw-5rem))] flex-col gap-0.5 overflow-y-auto rounded-xl border border-border/70 bg-popover/95 p-1.5 shadow-lg backdrop-blur-md">
                {railJumps.map((jump) => {
                  const lit = hoverId === jump.id || activeId === jump.id;
                  return (
                    <li key={jump.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setHoverId(jump.id)}
                        onFocus={() => setHoverId(jump.id)}
                        onClick={() => jumpToMessage(jump.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] leading-snug transition-colors duration-150",
                          lit ? "bg-muted/70 text-foreground" : "text-muted-foreground/80",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{jump.preview}</span>
                        {activeId === jump.id && <span className="h-[3px] w-3 shrink-0 rounded-full bg-foreground" aria-hidden />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        <div role="toolbar" aria-label="Conversation scroll minimap" className="flex flex-col items-center py-1.5 pr-1.5 pl-3">
          {slots.map(({ jump, distance }) => {
            // Where the chat runs out the slot stays empty, so the one you're on stays in the middle.
            if (!jump) return <span key={`empty:${distance}`} className="h-5 w-8 shrink-0" aria-hidden />;
            const on = distance === 0;
            const last = jump.id === allJumps[lastIndex]?.id;
            const follow = last && isLoading && atBottom;
            return (
              <button
                key={jump.id}
                type="button"
                aria-label={jump.preview}
                aria-current={on ? "true" : undefined}
                onMouseEnter={() => setHoverId(jump.id)}
                onClick={() => {
                  if (last && atBottom) onScrollToBottom();
                  else jumpToMessage(jump.id);
                }}
                // A tall target with no gaps between rows, so the pointer never falls off.
                className="relative flex h-5 w-8 shrink-0 items-center justify-center"
              >
                <motion.span
                  className="block rounded-full bg-foreground"
                  animate={railDashStyle(distance, hoverId === jump.id)}
                  transition={{ type: "spring", stiffness: 480, damping: 38 }}
                />
                {follow && (
                  <span className="absolute top-1/2 left-1/2 h-3 w-6 -translate-1/2 rounded-full border border-foreground/20" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
