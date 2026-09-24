"use client";

import { TextShimmer } from "@/components/ui/text-shimmer";
import { cn } from "@/lib/utils";
import { ArrowUpIcon, SparklesIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { InlineAnchor } from "./code-editor";
import { FileTypeIcon } from "./file-icon";

type Props = {
  rel: string;
  anchor: InlineAnchor;
  /** Height of the box the popup lives in, to keep it on screen. */
  containerHeight: number;
  /** The agent is working on this edit. */
  busy: boolean;
  /** The agent is busy with something else: can't take the edit now. */
  blocked: boolean;
  onSubmit: (instruction: string) => void;
  onStop: () => void;
  onClose: () => void;
};

const POPUP_HEIGHT = 132;

/**
 * ⌘K: a prompt right under the lines being edited. The agent makes the
 * change; it then shows up inline for Keep / Undo like any other turn.
 */
export function InlineEdit({ rel, anchor, containerHeight, busy, blocked, onSubmit, onStop, onClose }: Props) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  // Below the lines when there's room, otherwise above them.
  const below = anchor.bottom + 6;
  const top = below + POPUP_HEIGHT < containerHeight ? below : Math.max(8, anchor.top - POPUP_HEIGHT - 6);
  const lines = anchor.from === anchor.to ? `line ${anchor.from}` : `lines ${anchor.from}–${anchor.to}`;

  const submit = () => {
    const instruction = text.trim();
    if (!instruction || busy || blocked) return;
    onSubmit(instruction);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!busy) onClose();
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 520, damping: 34 }}
      style={{ top }}
      className="absolute right-4 left-12 z-30 max-w-2xl rounded-xl border bg-popover text-popover-foreground shadow-xl ring-1 ring-black/5"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <SparklesIcon className="size-3.5 text-primary" />
        <span>Edit</span>
        <span className="flex min-w-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/80">
          <FileTypeIcon name={rel} className="size-3.5" />
          <span className="truncate">{rel.split("/").pop()}</span>
          <span className="shrink-0 text-muted-foreground">· {lines}</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="ml-auto rounded p-0.5 hover:bg-muted hover:text-foreground disabled:opacity-40"
          aria-label="Close"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      {busy ? (
        <div className="flex items-center gap-3 px-3 py-3 text-sm">
          <TextShimmer className="text-sm">Editing {lines}…</TextShimmer>
          <button
            type="button"
            onClick={onStop}
            className="ml-auto rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Stop
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2 px-3 py-2">
          <textarea
            ref={inputRef}
            value={text}
            rows={2}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={blocked ? "The agent is busy — wait for it to finish" : "Describe the change… e.g. “add error handling”"}
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() || blocked}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity",
              (!text.trim() || blocked) && "opacity-40",
            )}
            aria-label="Apply edit"
          >
            <ArrowUpIcon className="size-4" />
          </button>
        </div>
      )}
      {!busy && (
        <div className="flex gap-3 border-t px-3 py-1 text-[11px] text-muted-foreground/80">
          <span>↵ apply</span>
          <span>⇧↵ new line</span>
          <span>esc close</span>
          <span className="ml-auto">Review the result with Keep / Undo</span>
        </div>
      )}
    </motion.div>
  );
}
