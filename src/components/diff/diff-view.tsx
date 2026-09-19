import { cn } from "@/lib/utils";
import { Columns2Icon, Rows3Icon } from "lucide-react";
import { useMemo, useState } from "react";
import type { DiffHunk, DiffLayout, DiffLine, FileDiff } from "./types";

const EMPTY_NOTE: Record<Exclude<FileDiff["kind"], "text">, string> = {
  binary: "This file isn't text, so there are no lines to compare.",
  "too-large": "This file is too large to compare line by line.",
  unavailable: "This change can't be shown (the content wasn't saved).",
};

const LAYOUT_KEY = "mali_diff_layout";

function loadLayout(): DiffLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

/** `+12 −3` in the diff colors. */
export function DiffStat({ additions, deletions, className }: { additions?: number; deletions?: number; className?: string }) {
  if (!additions && !deletions) return null;
  return (
    <span className={cn("shrink-0 font-mono text-[11px] tabular-nums", className)}>
      {!!additions && <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>}
      {!!additions && !!deletions && " "}
      {!!deletions && <span className="text-red-600 dark:text-red-400">−{deletions}</span>}
    </span>
  );
}

/** Unified / Split switch; the choice is remembered. */
export function useDiffLayout() {
  const [layout, setLayout] = useState<DiffLayout>(loadLayout);
  const change = (next: DiffLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Not remembered; fine.
    }
  };
  return [layout, change] as const;
}

export function DiffLayoutToggle({ layout, onChange }: { layout: DiffLayout; onChange: (layout: DiffLayout) => void }) {
  return (
    <div className="flex items-center rounded-md border p-0.5">
      {(
        [
          ["unified", Rows3Icon, "Unified"],
          ["split", Columns2Icon, "Split"],
        ] as const
      ).map(([value, Icon, label]) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-pressed={layout === value}
          onClick={() => onChange(value)}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors",
            layout === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3" />
          {label}
        </button>
      ))}
    </div>
  );
}

/** Line-by-line changes, grouped into hunks with a little context. */
export function DiffView({ diff, layout = "unified" }: { diff: FileDiff; layout?: DiffLayout }) {
  if (diff.kind !== "text") {
    return <p className="px-1 py-8 text-center text-sm text-muted-foreground">{EMPTY_NOTE[diff.kind]}</p>;
  }
  if (diff.hunks.length === 0) {
    return <p className="px-1 py-8 text-center text-sm text-muted-foreground">No line changes (only permissions or an empty file).</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-background font-mono text-[12px] leading-5">
      {diff.hunks.map((hunk, index) => (
        <div key={index} className={cn(index > 0 && "border-t")}>
          <div className="truncate bg-sky-50/70 px-3 py-0.5 text-[11px] text-sky-700 dark:bg-sky-950/30 dark:text-sky-300">
            {hunk.header}
          </div>
          {layout === "split" ? <SplitHunk hunk={hunk} /> : <UnifiedHunk hunk={hunk} />}
        </div>
      ))}
    </div>
  );
}

const ROW_TONE = {
  add: "bg-emerald-50 dark:bg-emerald-950/35",
  del: "bg-red-50 dark:bg-red-950/35",
  ctx: "",
} as const;

const GUTTER_TONE = {
  add: "bg-emerald-100/80 text-emerald-700/70 dark:bg-emerald-900/40 dark:text-emerald-300/60",
  del: "bg-red-100/80 text-red-700/70 dark:bg-red-900/40 dark:text-red-300/60",
  ctx: "text-muted-foreground/50",
} as const;

const SIGN = { add: "+", del: "−", ctx: " " } as const;

function Gutter({ value, tag }: { value?: number; tag: DiffLine["tag"] }) {
  return (
    <span className={cn("w-11 shrink-0 select-none px-1.5 text-right tabular-nums", GUTTER_TONE[tag])}>
      {value ?? ""}
    </span>
  );
}

function Code({ line }: { line: DiffLine }) {
  return (
    <>
      <span
        className={cn(
          "w-5 shrink-0 select-none text-center",
          line.tag === "add" && "text-emerald-600 dark:text-emerald-400",
          line.tag === "del" && "text-red-600 dark:text-red-400",
        )}
      >
        {SIGN[line.tag]}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-3">{line.text || " "}</span>
    </>
  );
}

function UnifiedHunk({ hunk }: { hunk: DiffHunk }) {
  return (
    <>
      {hunk.lines.map((line, i) => (
        <div key={i} className={cn("flex min-w-0", ROW_TONE[line.tag])}>
          <Gutter value={line.oldLine} tag={line.tag} />
          <Gutter value={line.newLine} tag={line.tag} />
          <Code line={line} />
        </div>
      ))}
    </>
  );
}

type SplitRow = { left?: DiffLine; right?: DiffLine };

/** Pair removed lines with the added lines that replaced them. */
function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].tag === "ctx") {
      rows.push({ left: lines[i], right: lines[i] });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].tag === "del") dels.push(lines[i++]);
    while (i < lines.length && lines[i].tag === "add") adds.push(lines[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push({ left: dels[k], right: adds[k] });
  }
  return rows;
}

function Half({ line, side }: { line?: DiffLine; side: "left" | "right" }) {
  if (!line) return <div className="flex min-w-0 flex-1 bg-muted/40" />;
  return (
    <div className={cn("flex min-w-0 flex-1", ROW_TONE[line.tag])}>
      <Gutter value={side === "left" ? line.oldLine : line.newLine} tag={line.tag} />
      <Code line={line} />
    </div>
  );
}

function SplitHunk({ hunk }: { hunk: DiffHunk }) {
  const rows = useMemo(() => splitRows(hunk.lines), [hunk]);
  return (
    <>
      {rows.map((row, i) => (
        <div key={i} className="flex min-w-0 divide-x">
          <Half line={row.left} side="left" />
          <Half line={row.right} side="right" />
        </div>
      ))}
    </>
  );
}
