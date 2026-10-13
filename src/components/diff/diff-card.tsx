import { MALI_EASE } from "@/lib/motion-presets";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, FileMinusIcon, FilePenIcon, FilePlusIcon, Maximize2Icon, Minimize2Icon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CodeDiff } from "./code-diff";
import { DiffStat } from "./diff-view";
import type { FileDiff } from "./types";

export type DiffCardKind = "added" | "modified" | "deleted";

const KIND: Record<DiffCardKind, { icon: typeof FilePlusIcon; label: string; className: string }> = {
  added: { icon: FilePlusIcon, label: "Created", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  modified: { icon: FilePenIcon, label: "Edited", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  deleted: { icon: FileMinusIcon, label: "Deleted", className: "bg-red-500/10 text-red-700 dark:text-red-400" },
};

/** Past this many lines the card opens folded to a short, scrollable window. */
const TALL = 14;
/** The folded window's height in px (Tailwind's `max-h-72`). */
const FOLDED = 288;

/** `src/features/a.ts` → folder (muted) and name (bold), like a PR's file header. */
export function FilePath({ path, className }: { path: string; className?: string }) {
  const parts = path.split(/[\\/]/);
  const name = parts.pop();
  const dir = parts.join("/");
  return (
    <span className={cn("flex min-w-0 items-baseline font-mono text-[12px]", className)} title={path}>
      {dir && <span className="min-w-0 truncate text-muted-foreground">{dir}/</span>}
      <span className="shrink-0 font-medium text-foreground">{name}</span>
    </span>
  );
}

/**
 * One file's change, drawn like a pull request file: path, what happened,
 * `+a −d`, and the highlighted lines. Opens to a short window; expand for all.
 */
export function DiffCard({
  path,
  diff,
  kind = "modified",
  defaultOpen = true,
  actions,
  className,
}: {
  path: string;
  diff: FileDiff;
  kind?: DiffCardKind;
  defaultOpen?: boolean;
  /** Buttons on the right of the header (open, review…). */
  actions?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // The highlighted lines stay mounted once shown, so opening again is only a slide.
  const [shown, setShown] = useState(defaultOpen);
  const [full, setFull] = useState(false);
  const reduced = useReducedMotion();
  const ease = { duration: reduced ? 0 : 0.32, ease: MALI_EASE };
  const meta = KIND[kind];
  const Icon = meta.icon;
  const lines = diff.hunks.reduce((sum, h) => sum + h.lines.length, 0);
  const tall = lines > TALL;
  // Folded, the window is never taller than the lines themselves.
  const body = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState<number>();
  useLayoutEffect(() => {
    if (shown && body.current) setBodyHeight(body.current.scrollHeight);
  }, [shown, diff]);
  const folded = Math.min(FOLDED, bodyHeight ?? FOLDED);

  return (
    <div className={cn("not-prose overflow-hidden rounded-xl border border-border/70 bg-card", className)}>
      <div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => {
            setShown(true);
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDownIcon
            className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-300 ease-out", !open && "-rotate-90")}
          />
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <FilePath path={path} />
          <span className={cn("shrink-0 rounded px-1.5 py-px text-[10px] font-medium", meta.className)}>{meta.label}</span>
          <DiffStat additions={diff.additions} deletions={diff.deletions} className="ml-auto pl-1" />
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {open && tall && (
            <button
              type="button"
              onClick={() => setFull((v) => !v)}
              title={full ? "Show less" : "Show all lines"}
              aria-label={full ? "Show less" : "Show all lines"}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {full ? <Minimize2Icon className="size-3.5" /> : <Maximize2Icon className="size-3.5" />}
            </button>
          )}
          {actions}
        </div>
      </div>
      {shown && (
        <motion.div
          initial={false}
          animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
          transition={ease}
          className="overflow-hidden"
          aria-hidden={!open}
        >
          <div className="border-t border-border/60">
            <motion.div
              initial={false}
              animate={{ height: tall && !full ? folded : "auto" }}
              transition={ease}
              className={cn(tall && !full ? "overflow-y-auto" : "overflow-hidden")}
            >
              <div ref={body}>
                <CodeDiff diff={diff} path={path} />
              </div>
            </motion.div>
            <AnimatePresence initial={false}>
              {!full && tall && (
                <motion.button
                  key="all"
                  type="button"
                  onClick={() => setFull(true)}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={ease}
                  className="w-full overflow-hidden border-t border-border/60 text-center text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                >
                  <span className="block py-1">Show all {lines} lines</span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </div>
  );
}
