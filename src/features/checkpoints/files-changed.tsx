import { Button } from "@/components/ui/button";
import { updateChatMessages, useChatRuns } from "@/features/chat-history";
import { cn } from "@/lib/utils";
import {
    ChevronDownIcon,
    ExternalLinkIcon,
    FileMinusIcon,
    FilePenIcon,
    FilePlusIcon,
    FolderOpenIcon,
    GitCompareArrowsIcon,
    LoaderIcon,
    Redo2Icon,
    TriangleAlertIcon,
    Undo2Icon,
} from "lucide-react";
import { useState } from "react";
import { openCheckpointFile, restoreCheckpoint } from "./api";
import { ChangesPanel } from "./changes-panel";
import { revealLabel } from "./file-preview-dialog";
import type { FileChange, FileChangeKind, TurnFiles } from "./types";

const MAX_VISIBLE = 8;

const KIND: Record<FileChangeKind, { icon: typeof FilePlusIcon; className: string; label: string }> = {
  added: { icon: FilePlusIcon, className: "text-emerald-600 dark:text-emerald-400", label: "Added" },
  modified: { icon: FilePenIcon, className: "text-amber-600 dark:text-amber-400", label: "Modified" },
  deleted: { icon: FileMinusIcon, className: "text-red-600 dark:text-red-400", label: "Deleted" },
};

type Props = {
  chatId: string;
  messageId: string;
  turn: TurnFiles;
};

/** The files a Cowork turn changed, with preview, undo and redo. */
export function FilesChanged({ chatId, messageId, turn }: Props) {
  const running = !!useChatRuns()[chatId];
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [note, setNote] = useState<string>();
  /** The file the review panel opens on; `null` while it's closed. */
  const [reviewing, setReviewing] = useState<string | null>(null);

  const undone = turn.state === "undone";
  const visible = expanded ? turn.changes : turn.changes.slice(0, MAX_VISIBLE);
  const additions = turn.changes.reduce((sum, c) => sum + (c.additions ?? 0), 0);
  const deletions = turn.changes.reduce((sum, c) => sum + (c.deletions ?? 0), 0);
  const unrestorable = turn.changes.filter((c) => !c.restorable).length;

  const restore = async (force = false) => {
    const to = undone ? "after" : "before";
    setBusy(true);
    setNote(undefined);
    try {
      const result = await restoreCheckpoint(turn.checkpointId, to, force);
      if (result.conflicts.length && !force) {
        setConflicts(result.conflicts);
        return;
      }
      setConflicts([]);
      updateChatMessages(chatId, (prev) =>
        prev.map((m) =>
          m.id === messageId && m.turn ? { ...m, turn: { ...m.turn, state: to === "before" ? "undone" : "applied" } } : m,
        ),
      );
      if (result.errors.length) setNote(`Couldn't restore ${result.errors.length} file(s): ${result.errors[0]}`);
      else if (result.skipped.length) setNote(`${result.skipped.length} file(s) weren't saved, so they stayed as they are.`);
    } catch (error) {
      setNote(String(error));
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (path: string) =>
    turn.changes.find((c) => c.path === path)?.relative ?? path.split(/[\\/]/).pop() ?? path;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-card">
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5">
        <GitCompareArrowsIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">
          {turn.changes.length} {turn.changes.length === 1 ? "file" : "files"} changed
        </span>
        {(additions > 0 || deletions > 0) && (
          <span className="text-[11px] tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>{" "}
            <span className="text-red-600 dark:text-red-400">−{deletions}</span>
          </span>
        )}
        {undone && (
          <span className="rounded-full bg-background px-2 py-0.5 text-[10px] text-muted-foreground">Undone</span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1.5 text-xs"
          onClick={() => setReviewing(turn.changes[0]?.path ?? "")}
        >
          <GitCompareArrowsIcon className="size-3.5" />
          Review changes
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={busy || running}
          title={running ? "Wait for the agent to finish" : undefined}
          onClick={() => void restore()}
        >
          {busy ? (
            <LoaderIcon className="size-3.5 animate-spin" />
          ) : undone ? (
            <Redo2Icon className="size-3.5" />
          ) : (
            <Undo2Icon className="size-3.5" />
          )}
          {undone ? "Redo" : "Undo"}
        </Button>
      </div>

      {conflicts.length > 0 && (
        <div className="mx-3.5 mb-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p>
                {conflicts.length === 1 ? "This file was" : `${conflicts.length} files were`} changed after this
                turn: <span className="font-medium">{conflicts.slice(0, 3).map(nameOf).join(", ")}</span>
                {conflicts.length > 3 && ` and ${conflicts.length - 3} more`}. {undone ? "Redo" : "Undo"} anyway
                replaces those changes too.
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" className="h-6 text-xs" disabled={busy} onClick={() => void restore(true)}>
                  {undone ? "Redo anyway" : "Undo anyway"}
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setConflicts([])}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ul className="flex flex-col p-1.5">
        {visible.map((change) => (
          <FileRow
            key={change.path}
            change={change}
            dimmed={undone}
            onSelect={() => setReviewing(change.path)}
            onOpen={(reveal) =>
              openCheckpointFile(turn.checkpointId, change.path, reveal).catch((e) => setNote(String(e)))
            }
          />
        ))}
      </ul>

      {turn.changes.length > MAX_VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1 border-t border-border/60 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Show less" : `Show all ${turn.changes.length}`}
          <ChevronDownIcon className={cn("size-3 transition-transform", expanded && "rotate-180")} />
        </button>
      )}

      {(note || unrestorable > 0 || undone) && (
        <div className="space-y-0.5 border-t border-border/60 px-3.5 py-1.5 text-[11px] text-muted-foreground">
          {note && <p className="text-red-600 dark:text-red-400">{note}</p>}
          {unrestorable > 0 && (
            <p>
              {unrestorable} {unrestorable === 1 ? "file is" : "files are"} too large or private to save, so undo
              leaves {unrestorable === 1 ? "it" : "them"} as {unrestorable === 1 ? "it is" : "they are"}.
            </p>
          )}
          {undone && <p>The agent doesn't know about the undo; mention it if you continue this task.</p>}
        </div>
      )}

      <ChangesPanel turn={turn} focus={reviewing} onClose={() => setReviewing(null)} />
    </div>
  );
}

function FileRow({
  change,
  dimmed,
  onSelect,
  onOpen,
}: {
  change: FileChange;
  dimmed: boolean;
  onSelect: () => void;
  onOpen: (reveal: boolean) => void;
}) {
  const kind = KIND[change.kind];
  const Icon = kind.icon;
  const parts = change.relative.split(/[\\/]/);
  const name = parts.pop();
  const dir = parts.join("/");
  return (
    <li className="group/file flex items-center rounded-lg hover:bg-muted/60">
      <button
        type="button"
        onClick={onSelect}
        title={`${kind.label}: ${change.path}`}
        className={cn("flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-sm", dimmed && "opacity-60")}
      >
        <Icon className={cn("size-3.5 shrink-0", kind.className)} />
        <span className={cn("truncate", change.kind === "deleted" && "line-through decoration-muted-foreground/50")}>
          {name}
        </span>
        {dir && <span className="truncate text-xs text-muted-foreground">{dir}</span>}
        {!change.restorable && <TriangleAlertIcon className="size-3 shrink-0 text-amber-500" aria-label="Can't be undone" />}
        {(change.additions != null || change.deletions != null) && (
          <span className="ml-auto shrink-0 pl-2 text-[11px] tabular-nums">
            {!!change.additions && <span className="text-emerald-600 dark:text-emerald-400">+{change.additions}</span>}{" "}
            {!!change.deletions && <span className="text-red-600 dark:text-red-400">−{change.deletions}</span>}
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity group-hover/file:opacity-100 focus-within:opacity-100">
        {change.kind !== "deleted" && (
          <IconButton label="Open" onClick={() => onOpen(false)}>
            <ExternalLinkIcon className="size-3.5" />
          </IconButton>
        )}
        <IconButton label={revealLabel} onClick={() => onOpen(true)}>
          <FolderOpenIcon className="size-3.5" />
        </IconButton>
      </div>
    </li>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
