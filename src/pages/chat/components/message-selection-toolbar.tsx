"use client";

import { requestCompose } from "@/features/command-palette";
import { useTranslation } from "@/features/i18n";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

type Anchor = { x: number; y: number; text: string };

function readSelection(container: HTMLElement): Anchor | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (text.length < 2) return null;

  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const ancestor =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (ancestor?.closest("textarea, input, button, [data-skip-selection-toolbar]")) return null;

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  return {
    text,
    x: rect.left + rect.width / 2,
    y: rect.top - 8,
  };
}

/** Floating actions when the user highlights text in the chat transcript. */
export function MessageSelectionToolbar({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const sync = useCallback(() => {
    const root = containerRef.current;
    if (!root) {
      setAnchor(null);
      return;
    }
    setAnchor(readSelection(root));
  }, [containerRef]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const onSelectionChange = () => sync();
    const onScroll = () => setAnchor(null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (toolbarRef.current?.contains(target)) return;
      if (!root.contains(target)) setAnchor(null);
    };

    document.addEventListener("selectionchange", onSelectionChange);
    root.addEventListener("scroll", onScroll, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      root.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [containerRef, sync]);

  const act = (mode: "reply" | "ask") => {
    if (!anchor) return;
    requestCompose({
      replyExcerpt: anchor.text,
      text: mode === "ask" ? t("selectionAskDefault") : "",
    });
    window.getSelection()?.removeAllRanges();
    setAnchor(null);
  };

  if (!anchor) return null;

  const top = Math.max(12, anchor.y - (toolbarRef.current?.offsetHeight ?? 40));

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={t("selectionToolbar")}
      className={cn(
        "pointer-events-auto fixed z-50 flex -translate-x-1/2 items-stretch overflow-hidden rounded-full border border-border/80",
        "bg-popover/95 text-popover-foreground shadow-lg backdrop-blur-md",
      )}
      style={{ left: anchor.x, top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <ToolbarButton onClick={() => act("ask")}>{t("selectionAskMali")}</ToolbarButton>
      <span className="w-px shrink-0 bg-border/80" aria-hidden />
      <ToolbarButton onClick={() => act("reply")}>{t("selectionReply")}</ToolbarButton>
    </div>
  );
}

function ToolbarButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="px-3.5 py-2 text-[13px] font-medium transition-colors hover:bg-muted/80"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
