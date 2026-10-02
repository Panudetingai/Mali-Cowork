"use client";

import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useRef, useState } from "react";

type Rect = { x: number; y: number; w: number; h: number };

function normalize(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x, b.x) - x,
    h: Math.max(a.y, b.y) - y,
  };
}

export function QuickCaptureOverlay() {
  const params = new URLSearchParams(window.location.search);
  const monitorX = Number(params.get("x") || 0);
  const monitorY = Number(params.get("y") || 0);
  const pickNotch = params.get("pick") === "notch";
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ start: { x: number; y: number }; current: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void getCurrentWebviewWindow().close();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    // Keep receiving moves/up even if the pointer leaves the page mid-drag.
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    setDrag({ start: point, current: point });
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!drag) return;
      setDrag({ ...drag, current: { x: event.clientX, y: event.clientY } });
    },
    [drag],
  );

  const onPointerUp = useCallback(async () => {
    if (!drag) return;
    const rect = normalize(drag.start, drag.current);
    setDrag(null);

    if (rect.w < 4 || rect.h < 4) {
      void getCurrentWebviewWindow().close();
      return;
    }

    // The monitor origin is in physical pixels; the drag is in CSS pixels.
    const scale = window.devicePixelRatio || 1;
    try {
      // Rust hides this window, captures, then destroys it.
      await invoke(pickNotch ? "notch_capture_region" : "quick_capture_region", {
        rect: {
          x: Math.round(monitorX + rect.x * scale),
          y: Math.round(monitorY + rect.y * scale),
          width: Math.round(rect.w * scale),
          height: Math.round(rect.h * scale),
        },
      });
    } catch {
      void getCurrentWebviewWindow().close();
    }
  }, [drag, monitorX, monitorY, pickNotch]);

  const onContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    void getCurrentWebviewWindow().close();
  }, []);

  const rect = drag ? normalize(drag.start, drag.current) : null;

  return (
    <div
      ref={containerRef}
      // A light tint before the drag; once dragging, only the outside is
      // dimmed so the picked region shows exactly what will be captured.
      className={cn("fixed inset-0 cursor-crosshair", !rect && "bg-black/10")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
    >
      {rect && rect.w > 0 && rect.h > 0 && (
        <>
          {/* Top */}
          <div
            className="absolute bg-black/35"
            style={{ top: 0, left: 0, right: 0, height: rect.y }}
          />
          {/* Bottom */}
          <div
            className="absolute bg-black/35"
            style={{ left: 0, right: 0, bottom: 0, height: `calc(100% - ${rect.y + rect.h}px)` }}
          />
          {/* Left */}
          <div
            className="absolute bg-black/35"
            style={{ top: rect.y, left: 0, width: rect.x, height: rect.h }}
          />
          {/* Right */}
          <div
            className="absolute bg-black/35"
            style={{
              top: rect.y,
              right: 0,
              width: `calc(100% - ${rect.x + rect.w}px)`,
              height: rect.h,
            }}
          />
          {/* Selection border */}
          <div
            className="pointer-events-none absolute border border-sky-400 shadow-[0_0_0_1px_rgba(56,189,248,0.5)]"
            style={{ top: rect.y, left: rect.x, width: rect.w, height: rect.h }}
          />
          {/* Size label */}
          <span
            className={cn(
              "pointer-events-none absolute rounded-md bg-sky-500 px-1.5 py-0.5 text-[11px] font-medium text-white shadow-sm",
            )}
            style={{ top: rect.y + rect.h + 6, left: rect.x }}
          >
            {Math.round(rect.w * (window.devicePixelRatio || 1))} ×{" "}
            {Math.round(rect.h * (window.devicePixelRatio || 1))}
          </span>
        </>
      )}
    </div>
  );
}
