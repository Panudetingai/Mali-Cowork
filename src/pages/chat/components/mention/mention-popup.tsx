"use client";

import { FileIcon, FolderIcon, LoaderIcon } from "lucide-react";
import { useMemo } from "react";
import { PickerRow, PickerShell } from "./picker-shell";
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

function split(rel: string) {
  const at = rel.lastIndexOf("/");
  return at < 0 ? { name: rel, dir: "" } : { name: rel.slice(at + 1), dir: rel.slice(0, at) };
}

/** The `@` picker: file name first, its folder dimmed beside it. */
export function MentionPopup({ query, entries, loading, active, onActiveChange, onSelect }: Props) {
  const matches = useMemo(() => filterMentions(entries, query), [entries, query]);
  const current = matches[active];

  return (
    <PickerShell
      label="Mention a file or folder"
      idPrefix="mention-item"
      active={active}
      detail={current && current.rel.includes("/") ? <span className="font-mono break-all">{current.rel}</span> : undefined}
      footer={
        loading ? (
          <span className="flex items-center gap-1.5">
            <LoaderIcon className="size-3 animate-spin" /> Scanning folder…
          </span>
        ) : matches.length === 0 ? (
          "No matching files"
        ) : undefined
      }
    >
      {matches.map((m, i) => {
        const { name, dir } = split(m.rel);
        return (
          <PickerRow
            key={m.rel}
            id={`mention-item-${i}`}
            active={i === active}
            onHover={() => onActiveChange(i)}
            onPick={() => onSelect(m.rel, m.isDirectory)}
            icon={m.isDirectory ? <FolderIcon className="size-4 text-amber-500" /> : <FileIcon className="size-4" />}
          >
            <span className="shrink-0 truncate">{name}</span>
            {dir && <span className="min-w-0 truncate text-xs text-muted-foreground">{dir}</span>}
          </PickerRow>
        );
      })}
    </PickerShell>
  );
}
