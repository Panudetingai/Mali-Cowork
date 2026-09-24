"use client";

import { FileTypeIcon } from "@/features/code/file-icon";
import type { TurnFiles } from "@/features/checkpoints";
import { cn } from "@/lib/utils";
import { createContext, useContext } from "react";

/**
 * Set by Code mode: the chat sits next to an editor, so a turn's files are
 * a one-line summary that opens them there (review has Keep / Undo).
 */
export const CodeChatContext = createContext<{ openFile: (path: string) => void } | null>(null);

export const useCodeChat = () => useContext(CodeChatContext);

const SHOWN = 3;

export function TurnFilesLine({ turn, onOpen }: { turn: TurnFiles; onOpen: (path: string) => void }) {
  const additions = turn.changes.reduce((n, c) => n + (c.additions ?? 0), 0);
  const deletions = turn.changes.reduce((n, c) => n + (c.deletions ?? 0), 0);
  const undone = turn.state === "undone";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground",
        undone && "opacity-60",
      )}
    >
      <span className="mr-0.5 shrink-0 tabular-nums">
        {turn.changes.length} file{turn.changes.length > 1 ? "s" : ""}
        {!undone && (
          <>
            {" "}
            <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>{" "}
            <span className="text-destructive">−{deletions}</span>
          </>
        )}
        {undone && " · undone"}
      </span>
      {turn.changes.slice(0, SHOWN).map((change) => (
        <button
          key={change.path}
          type="button"
          disabled={change.kind === "deleted" || undone}
          onClick={() => onOpen(change.path)}
          title={change.relative}
          className={cn(
            "flex min-w-0 max-w-40 items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-foreground/80 transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none",
            change.kind === "deleted" && "line-through",
          )}
        >
          <FileTypeIcon name={change.relative} className="size-3.5" />
          <span className="truncate">{change.relative.split(/[\\/]/).pop()}</span>
        </button>
      ))}
      {turn.changes.length > SHOWN && <span className="shrink-0">+{turn.changes.length - SHOWN} more</span>}
    </div>
  );
}
