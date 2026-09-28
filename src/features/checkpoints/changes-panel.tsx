import { CodeDiff } from "@/components/diff/code-diff";
import { FilePath } from "@/components/diff/diff-card";
import { DiffLayoutToggle, DiffStat, DiffView, useDiffLayout } from "@/components/diff/diff-view";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  ExternalLinkIcon,
  FileMinusIcon,
  FilePenIcon,
  FilePlusIcon,
  FolderOpenIcon,
  GitCompareArrowsIcon,
  LoaderIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { checkpointDiff, openCheckpointFile } from "./api";
import { revealLabel } from "./file-preview-dialog";
import type { FileChange, FileChangeKind, FileDiff, TurnFiles } from "./types";

const KIND: Record<FileChangeKind, { icon: typeof FilePlusIcon; label: string; tone: string; badge: string }> = {
  added: {
    icon: FilePlusIcon,
    label: "Created",
    tone: "text-emerald-600 dark:text-emerald-400",
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  modified: {
    icon: FilePenIcon,
    label: "Edited",
    tone: "text-amber-600 dark:text-amber-400",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  deleted: {
    icon: FileMinusIcon,
    label: "Deleted",
    tone: "text-red-600 dark:text-red-400",
    badge: "bg-red-500/10 text-red-700 dark:text-red-400",
  },
};

type Props = {
  turn: TurnFiles;
  /** The file to jump to; `null` keeps the panel closed. */
  focus: string | null;
  onClose: () => void;
};

/**
 * The files one reply changed, like a pull request's "Files changed" tab:
 * a file list on the left, every diff on the right. Its own panel, apart from
 * the Git tab: it shows what the agent did in this turn, not the repository.
 */
export function ChangesPanel({ turn, focus, onClose }: Props) {
  const [layout, setLayout] = useDiffLayout();
  const [diffs, setDiffs] = useState<Record<string, FileDiff | string>>({});
  const [active, setActive] = useState<string>();
  const scroller = useRef<HTMLDivElement>(null);
  const open = focus !== null;

  const additions = turn.changes.reduce((sum, c) => sum + (c.additions ?? 0), 0);
  const deletions = turn.changes.reduce((sum, c) => sum + (c.deletions ?? 0), 0);

  // Each file's diff, fetched once the panel opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    for (const change of turn.changes) {
      if (diffs[change.path]) continue;
      checkpointDiff(turn.checkpointId, change.path)
        .then((d) => !cancelled && setDiffs((prev) => ({ ...prev, [change.path]: d })))
        .catch((e) => !cancelled && setDiffs((prev) => ({ ...prev, [change.path]: String(e) })));
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, turn.checkpointId, turn.changes]);

  const jump = (path: string) => {
    setActive(path);
    const target = scroller.current?.querySelector<HTMLElement>(`[data-file="${CSS.escape(path)}"]`);
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  // Opened from a file row: land on that file.
  useEffect(() => {
    if (!focus) return;
    setActive(focus);
    const id = requestAnimationFrame(() => {
      scroller.current
        ?.querySelector<HTMLElement>(`[data-file="${CSS.escape(focus)}"]`)
        ?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [focus]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[min(1100px,94vw)]"
      >
        <header className="flex items-center gap-3 border-b px-4 py-3 pr-14">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <GitCompareArrowsIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-sm font-semibold">Changes in this reply</SheetTitle>
            <SheetDescription className="flex items-center gap-2 text-xs">
              {turn.changes.length} {turn.changes.length === 1 ? "file" : "files"}
              <DiffStat additions={additions} deletions={deletions} />
              {turn.state === "undone" && <span className="rounded-full bg-muted px-1.5 text-[10px]">Undone</span>}
            </SheetDescription>
          </div>
          <DiffLayoutToggle layout={layout} onChange={setLayout} />
        </header>

        <div className="flex min-h-0 flex-1">
          <nav aria-label="Changed files" className="hidden w-60 shrink-0 overflow-y-auto border-r p-2 md:block">
            {turn.changes.map((change) => (
              <FileLink key={change.path} change={change} active={active === change.path} onClick={() => jump(change.path)} />
            ))}
          </nav>

          <div ref={scroller} className="min-w-0 flex-1 space-y-4 overflow-y-auto bg-muted/20 p-4">
            {turn.changes.map((change) => (
              <FileSection
                key={change.path}
                change={change}
                diff={diffs[change.path]}
                layout={layout}
                onOpen={(reveal) => void openCheckpointFile(turn.checkpointId, change.path, reveal)}
              />
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FileLink({ change, active, onClick }: { change: FileChange; active: boolean; onClick: () => void }) {
  const kind = KIND[change.kind];
  const Icon = kind.icon;
  const name = change.relative.split(/[\\/]/).pop();
  return (
    <button
      type="button"
      onClick={onClick}
      title={change.relative}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", kind.tone)} />
      <span className={cn("min-w-0 flex-1 truncate", change.kind === "deleted" && "line-through")}>{name}</span>
      <DiffStat additions={change.additions} deletions={change.deletions} className="text-[10px]" />
    </button>
  );
}

function FileSection({
  change,
  diff,
  layout,
  onOpen,
}: {
  change: FileChange;
  diff: FileDiff | string | undefined;
  layout: "unified" | "split";
  onOpen: (reveal: boolean) => void;
}) {
  const kind = KIND[change.kind];
  return (
    <section data-file={change.path} className="scroll-mt-4 overflow-hidden rounded-xl border bg-card">
      <div className="sticky top-0 z-10 flex min-w-0 items-center gap-2 border-b bg-card/95 px-3 py-2 backdrop-blur">
        <FilePath path={change.relative} />
        <span className={cn("shrink-0 rounded px-1.5 py-px text-[10px] font-medium", kind.badge)}>{kind.label}</span>
        <DiffStat additions={change.additions} deletions={change.deletions} className="ml-auto" />
        <div className="flex shrink-0 items-center">
          {change.kind !== "deleted" && (
            <IconButton label="Open" onClick={() => onOpen(false)}>
              <ExternalLinkIcon className="size-3.5" />
            </IconButton>
          )}
          <IconButton label={revealLabel} onClick={() => onOpen(true)}>
            <FolderOpenIcon className="size-3.5" />
          </IconButton>
        </div>
      </div>
      {diff === undefined ? (
        <div className="flex justify-center py-8 text-muted-foreground">
          <LoaderIcon className="size-4 animate-spin" />
        </div>
      ) : typeof diff === "string" ? (
        <p className="px-4 py-6 text-center text-xs text-red-600 dark:text-red-400">{diff}</p>
      ) : layout === "split" && diff.kind === "text" ? (
        <div className="p-2">
          <DiffView diff={diff} layout="split" />
        </div>
      ) : (
        <CodeDiff diff={diff} path={change.relative} />
      )}
    </section>
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
