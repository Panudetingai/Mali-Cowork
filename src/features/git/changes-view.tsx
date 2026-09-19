import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { cn } from "@/lib/utils";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CheckCircle2Icon, CheckIcon, FolderOpenIcon, MinusIcon, MoreHorizontalIcon, PlusIcon, Undo2Icon } from "lucide-react";
import { useCallback } from "react";
import { gitApi } from "./api";
import { FileDiffList, type DiffFile } from "./file-diff-list";
import { useGit } from "./git-context";
import type { ChangedFile } from "./types";

export const menuClass = "z-50 min-w-44 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg";
export const menuItemClass =
  "flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-muted";

/** Working-folder changes against the last commit, one file after another. */
export function ChangesView() {
  const { folder, status, changes, act, confirm, version } = useGit();

  const loadDiff = useCallback(
    (file: DiffFile) => {
      const change = changes.find((c) => c.path === file.path);
      return gitApi.diff(folder, {
        kind: "worktree",
        path: file.path,
        origPath: file.origPath,
        area: change?.untracked ? "untracked" : "head",
      });
    },
    [folder, changes],
  );

  if (changes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
        <CheckCircle2Icon className="size-8 text-emerald-500" />
        <p className="text-sm font-medium">Working tree clean</p>
        <p className="text-xs text-muted-foreground">Nothing to commit — everything matches the last commit.</p>
      </div>
    );
  }

  const stagedCount = changes.filter((c) => c.staged === true).length;
  const allState = stagedCount === changes.length ? true : stagedCount === 0 && !changes.some((c) => c.staged === null) ? false : null;
  const byPath = new Map(changes.map((c) => [c.path, c]));

  const discard = (change: ChangedFile) =>
    confirm({
      title: `Discard changes to ${change.path.split("/").pop()}?`,
      description: change.untracked
        ? "This new file will be deleted. This can't be undone."
        : "Unstaged edits to this file will be lost. Staged changes stay. This can't be undone.",
      confirmLabel: "Discard",
      destructive: true,
      onConfirm: () => void act("Discarding…", () => gitApi.discard(folder, [change.path])),
    });

  return (
    <>
      {status?.operation && (
        <p className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          A {status.operation} is in progress. Resolve the conflicts, stage each file, then finish it in a terminal.
        </p>
      )}
      <FileDiffList
        files={changes.map((c) => ({
          key: c.path,
          path: c.path,
          origPath: c.origPath,
          kind: c.kind,
          additions: c.additions,
          deletions: c.deletions,
        }))}
        loadDiff={loadDiff}
        reloadKey={version}
        summaryActions={
          <StageBox
            state={allState}
            label={allState === true ? "Unstage all" : "Stage all"}
            onToggle={() =>
              void (allState === true
                ? act("Unstaging…", () => gitApi.unstage(folder, changes.map((c) => c.path)))
                : act("Staging…", () => gitApi.stageAll(folder)))
            }
          />
        }
        actions={(file) => {
          const change = byPath.get(file.path);
          if (!change) return null;
          return (
            <>
              <StageBox
                state={change.staged}
                label={change.staged === true ? "Staged — click to unstage" : "Stage for the next commit"}
                onToggle={() =>
                  void (change.staged === true
                    ? act("Unstaging…", () => gitApi.unstage(folder, [change.path]))
                    : act("Staging…", () => gitApi.stage(folder, [change.path])))
                }
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="More actions"
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <MoreHorizontalIcon className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={4} className={menuClass}>
                  {change.staged !== true && (
                    <DropdownMenuItem className={menuItemClass} onSelect={() => void act("Staging…", () => gitApi.stage(folder, [change.path]))}>
                      <PlusIcon className="size-4 text-muted-foreground" />
                      Stage
                    </DropdownMenuItem>
                  )}
                  {change.staged !== false && (
                    <DropdownMenuItem className={menuItemClass} onSelect={() => void act("Unstaging…", () => gitApi.unstage(folder, [change.path]))}>
                      <MinusIcon className="size-4 text-muted-foreground" />
                      Unstage
                    </DropdownMenuItem>
                  )}
                  {change.kind !== "deleted" && status?.root && (
                    <DropdownMenuItem
                      className={menuItemClass}
                      onSelect={() => void revealItemInDir(`${status.root}/${change.path}`).catch(() => undefined)}
                    >
                      <FolderOpenIcon className="size-4 text-muted-foreground" />
                      Show in folder
                    </DropdownMenuItem>
                  )}
                  {change.staged !== true && (
                    <>
                      <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
                      <DropdownMenuItem className={cn(menuItemClass, "text-red-600 dark:text-red-400")} onSelect={() => discard(change)}>
                        <Undo2Icon className="size-4" />
                        Discard changes
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          );
        }}
      />
    </>
  );
}

/** Whether a file goes into the next commit: checked, partly (some hunks), or not. */
function StageBox({ state, label, onToggle }: { state: boolean | null; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === null ? "mixed" : state}
      title={label}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
        state === false ? "border-muted-foreground/40 bg-muted/40 hover:border-foreground/60" : "border-primary bg-primary text-primary-foreground",
      )}
    >
      {state === true && <CheckIcon className="size-3" strokeWidth={3} />}
      {state === null && <MinusIcon className="size-3" strokeWidth={3} />}
    </button>
  );
}
