"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LoaderIcon,
  MoreHorizontalIcon,
  Undo2Icon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { FileTypeIcon } from "./file-icon";
import type { TurnReview } from "./use-turn-review";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";

function BarSep() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-border/80" aria-hidden />;
}

function BarBtn({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap transition-colors",
        "text-foreground/90 hover:bg-muted disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

function DiffStat({ additions, deletions }: { additions?: number; deletions?: number }) {
  const add = additions ?? 0;
  const del = deletions ?? 0;
  if (add === 0 && del === 0) return null;
  return (
    <span className="shrink-0 font-mono text-[10px] tabular-nums leading-none">
      {add > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{add}</span>}
      {add > 0 && del > 0 && <span className="text-muted-foreground/35"> · </span>}
      {del > 0 && <span className="text-red-600 dark:text-red-400">−{del}</span>}
    </span>
  );
}

/**
 * Floating bar over the editor for reviewing the agent's last turn:
 * Undo / Keep this file, move between files, or settle all of them at once.
 *
 * Keys: ⌘⇧↵ keep file · ⌘⇧⌫ undo file · ⌥] / ⌥[ next / previous file.
 */
export function ReviewBar({ review }: { review: TurnReview }) {
  const reviewRef = useRef(review);
  reviewRef.current = review;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const r = reviewRef.current;
      if (!r.active || r.busy) return;
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (cmd && e.shiftKey && e.key === "Enter" && r.current) {
        e.preventDefault();
        void r.keep();
      } else if (cmd && e.shiftKey && e.key === "Backspace" && r.current) {
        e.preventDefault();
        void r.undo();
      } else if (e.altKey && !cmd && (e.code === "BracketRight" || e.code === "BracketLeft")) {
        e.preventDefault();
        if (e.code === "BracketRight") r.next();
        else r.prev();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const { files, pending, current } = review;
  const done = review.active && pending.length === 0;
  // "All reviewed" shows for a moment after the last file, then gets out of the way.
  const [justDone, setJustDone] = useState(false);
  const wasPending = useRef(pending.length);
  useEffect(() => {
    const finished = wasPending.current > 0 && pending.length === 0;
    wasPending.current = pending.length;
    if (!finished) return;
    setJustDone(true);
    const id = window.setTimeout(() => setJustDone(false), 3000);
    return () => window.clearTimeout(id);
  }, [pending.length]);

  const visible = review.active && !(done && !justDone && !review.error);
  const position = current ? pending.findIndex((f) => f.path === current.path) + 1 : 0;

  return (
    <AnimatePresence>
    {visible && (
    <motion.div
      key="review"
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex flex-col items-center gap-2 px-3"
    >
      {review.conflict && (
        <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-xs shadow-md">
          <span className="text-amber-700 dark:text-amber-300">
            This file changed after the agent's turn. Undo would drop those edits too.
          </span>
          <Button size="xs" variant="destructive" onClick={() => void review.forceUndo()}>
            Undo anyway
          </Button>
          <Button size="xs" variant="ghost" onClick={review.dismissConflict}>
            Cancel
          </Button>
        </div>
      )}
      {review.error && (
        <div className="pointer-events-auto max-w-xl rounded-lg border bg-background px-3 py-1.5 text-xs text-destructive shadow-md">
          {review.error}
        </div>
      )}

      <div
        className={cn(
          "pointer-events-auto inline-flex max-w-[min(100%,28rem)] items-center gap-0.5 rounded-full border bg-background/95 py-0.5 pr-1 pl-0.5 text-[11px] shadow-lg backdrop-blur",
        )}
      >
        {done ? (
          <span className="flex items-center gap-1 px-2.5 py-1 text-emerald-600 dark:text-emerald-400">
            <CheckIcon className="size-3.5" />
            All {files.length} file{files.length > 1 ? "s" : ""} reviewed
          </span>
        ) : (
          <>
            <div className="flex shrink-0 items-center">
              <BarBtn onClick={review.prev} title="Previous file (⌥[)" className="size-6 px-0 text-muted-foreground">
                <ChevronUpIcon className="size-3.5" />
              </BarBtn>
              <span className="w-7 shrink-0 text-center tabular-nums text-muted-foreground">
                {position ? `${position}/${pending.length}` : pending.length}
              </span>
              <BarBtn onClick={review.next} title="Next file (⌥])" className="size-6 px-0 text-muted-foreground">
                <ChevronDownIcon className="size-3.5" />
              </BarBtn>
            </div>

            {current ? (
              <>
                <BarSep />
                <div
                  className="flex min-w-0 max-w-[10.5rem] items-center gap-1 overflow-hidden pr-0.5 sm:max-w-[13rem]"
                  title={current.rel}
                >
                  <FileTypeIcon name={current.rel} className="size-3.5 shrink-0" />
                  <span className="truncate font-mono">{current.rel.split("/").pop()}</span>
                  <DiffStat additions={current.additions} deletions={current.deletions} />
                </div>
                <BarSep />
                <BarBtn
                  disabled={review.busy || !current.restorable}
                  onClick={() => void review.undo()}
                  title={current.restorable ? `Undo this file (${mod}⇧⌫)` : "This file's old content wasn't saved"}
                >
                  <Undo2Icon className="size-3" />
                  Undo
                </BarBtn>
                <BarBtn
                  disabled={review.busy}
                  onClick={() => void review.keep()}
                  title={`Keep this file (${mod}⇧↵)`}
                  className="bg-amber-400 text-amber-950 hover:bg-amber-300 dark:bg-amber-300 dark:text-amber-950 dark:hover:bg-amber-200"
                >
                  <CheckIcon className="size-3" />
                  Keep
                </BarBtn>
              </>
            ) : (
              <BarBtn onClick={review.next} className="mx-0.5 border border-border">
                Review
              </BarBtn>
            )}

            <BarSep />
            <div className="hidden items-center gap-0.5 sm:flex">
              <BarBtn disabled={review.busy} onClick={() => void review.undoAll()} title="Undo every file not reviewed yet">
                {review.busy ? <LoaderIcon className="size-3 animate-spin" /> : null}
                Undo all
              </BarBtn>
              <BarBtn
                disabled={review.busy}
                onClick={review.keepAll}
                title="Keep every file not reviewed yet"
                className="border border-border"
              >
                Keep all
              </BarBtn>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <BarBtn className="size-6 px-0 sm:hidden" title="More review actions" aria-label="More review actions">
                  <MoreHorizontalIcon className="size-3.5" />
                </BarBtn>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" sideOffset={6} className="min-w-40 rounded-xl p-1 text-xs">
                <DropdownMenuItem
                  className="rounded-lg px-2 py-1.5"
                  disabled={review.busy}
                  onSelect={() => void review.undoAll()}
                >
                  Undo all
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="rounded-lg px-2 py-1.5"
                  disabled={review.busy}
                  onSelect={review.keepAll}
                >
                  Keep all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </motion.div>
    )}
    </AnimatePresence>
  );
}
