"use client";

import { cn } from "@/lib/utils";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState, type MouseEvent } from "react";

/** Things that keep their own click, drag or text selection. */
const INTERACTIVE = 'button, a, input, textarea, select, label, pre, code, [role="checkbox"], [role="switch"], [data-no-drag]';

/**
 * Setup has no title bar (the window is frameless): press and drag anywhere
 * that isn't a control to move the window, double-click to maximize.
 */
export function useWindowDrag() {
  return useCallback((e: MouseEvent<HTMLElement>) => {
    if (e.button !== 0 || !isTauri()) return;
    const target = e.target as HTMLElement;
    if (target.closest(INTERACTIVE)) return;
    // A press on a scrollbar scrolls.
    if (target.clientWidth && e.nativeEvent.offsetX >= target.clientWidth) return;
    if (target.clientHeight && e.nativeEvent.offsetY >= target.clientHeight) return;
    const win = getCurrentWindow();
    if (e.detail === 2) void win.toggleMaximize().catch(() => undefined);
    else void win.startDragging().catch(() => undefined);
  }, []);
}

/** Minimize, maximize and close, for the frameless setup window. */
export function WindowControls({ className }: { className?: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    void win.isMaximized().then(setMaximized).catch(() => undefined);
    const unlisten = win.onResized(async () => setMaximized(await win.isMaximized()));
    return () => void unlisten.then((f) => f()).catch(() => undefined);
  }, []);

  if (!isTauri()) return null;
  const win = getCurrentWindow();
  const button =
    "flex size-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-900/[0.06] hover:text-neutral-900";

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-full bg-white/70 p-1 shadow-sm ring-1 ring-neutral-200/80 backdrop-blur-md",
        className,
      )}
    >
      <button type="button" aria-label="Minimize" className={button} onClick={() => void win.minimize()}>
        <MinusIcon className="size-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        className={button}
        onClick={() => void win.toggleMaximize()}
      >
        {maximized ? <CopyIcon className="size-3" strokeWidth={2} /> : <SquareIcon className="size-3" strokeWidth={2} />}
      </button>
      <button
        type="button"
        aria-label="Close"
        className={cn(button, "hover:bg-red-500 hover:text-white")}
        onClick={() => void win.close()}
      >
        <XIcon className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
