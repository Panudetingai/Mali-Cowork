"use client";

import { cn } from "@/lib/utils";
import { FileIcon, FolderIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { WorkspaceEntry } from "./use-workspace-files";

type Props = {
  /** What the user typed after `@` (may be empty). */
  query: string;
  entries: WorkspaceEntry[];
  loading: boolean;
  active: number;
  onActiveChange: (index: number) => void;
  onSelect: (rel: string, isDirectory: boolean) => void;
};

const MAX_SHOWN = 8;

export function filterMentions(entries: WorkspaceEntry[], query: string): WorkspaceEntry[] {
  const q = query.toLowerCase();
  const scored = entries.map((e) => {
    const rel = e.rel.toLowerCase();
    const name = e.rel.split("/").pop() ?? "";
    let score = -1;
    if (!q) score = e.isDirectory ? 1 : 0;
    else if (rel === q) score = 100;
    else if (name.toLowerCase() === q) score = 90;
    else if (rel.startsWith(q)) score = 80;
    else if (name.toLowerCase().startsWith(q)) score = 70;
    else if (rel.includes(q)) score = 50;
    return { e, score };
  });
  return scored
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score || Number(a.e.isDirectory) - Number(b.e.isDirectory) || a.e.rel.localeCompare(b.e.rel))
    .slice(0, MAX_SHOWN)
    .map((s) => s.e);
}

/** Presentational list; the composer owns keyboard navigation. */
export function MentionPopup({ query, entries, loading, active, onActiveChange, onSelect }: Props) {
  const matches = useMemo(() => filterMentions(entries, query), [entries, query]);

  useEffect(() => {
    if (matches.length === 0) return;
    document.getElementById(`mention-item-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, matches.length]);

  return (
    <div
      role="listbox"
      aria-label="Mention a file or folder"
      className="absolute right-0 bottom-full left-0 z-20 mb-2 overflow-hidden rounded-xl border bg-popover shadow-lg"
    >
      <p className="border-b px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
        {loading ? "Scanning workspace…" : matches.length > 0 ? "Files & folders — Tab/Enter to insert" : "No matches"}
      </p>
      <ul className="max-h-56 overflow-auto p-1">
        {matches.map((m, i) => {
          const Icon = m.isDirectory ? FolderIcon : FileIcon;
          return (
            <li key={m.rel}>
              <button
                id={`mention-item-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  // Select before the textarea loses focus.
                  e.preventDefault();
                  onSelect(m.rel, m.isDirectory);
                }}
                onMouseEnter={() => onActiveChange(i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                  i === active ? "bg-accent text-accent-foreground" : "text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{m.rel}</span>
                {m.isDirectory && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">folder</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
