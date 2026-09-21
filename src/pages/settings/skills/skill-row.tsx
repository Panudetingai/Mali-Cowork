import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SmitheryIcon } from "@/components/app/smithery-icon";
import type { Skill } from "@/features/instructions";
import { cn } from "@/lib/utils";
import {
  BookOpenIcon,
  ClipboardCopyIcon,
  DownloadIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";

export const menuItemClass =
  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";
export const menuClass =
  "z-50 min-w-48 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg";

export type SkillRowActions = {
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  onExport: () => void;
  onCopy: () => void;
  /** Reveal the skill's folder; absent when it isn't on disk yet. */
  onReveal?: () => void;
};

/**
 * One skill in the library.
 *
 * The middle column says how the AI gets at it: a skill on disk is opened
 * when a task matches, so the row shows what its folder holds.
 */
export function SkillRow({ skill, actions }: { skill: Skill; actions: SkillRowActions }) {
  const files = skill.install?.files.length ?? 0;
  const stop = (fn: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    fn();
  };

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={actions.onEdit}
      onKeyDown={(e) => e.key === "Enter" && actions.onEdit()}
      className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border-b border-border/40 px-3 py-2.5 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
    >
      <span className="flex min-w-0 items-center gap-3">
        {skill.via === "smithery" ? (
          <SmitheryIcon size={28} title="From Smithery" />
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <BookOpenIcon className="size-3.5" />
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{skill.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {skill.description ? `Use when: ${skill.description}` : "No “Use when” yet"}
          </span>
        </span>
      </span>

      <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
        {skill.install ? (
          <>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">On disk</span>
            {files > 0 && <span>{files} file{files === 1 ? "" : "s"}</span>}
          </>
        ) : (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]">In the prompt</span>
        )}
      </span>

      <span className="flex items-center justify-end gap-1">
        <Switch
          checked={skill.enabled}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(enabled) => actions.onToggle(enabled)}
          aria-label={`Use ${skill.name}`}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${skill.name}`}
          onClick={stop(actions.onEdit)}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <PencilIcon className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`More for ${skill.name}`}
              onClick={(e) => e.stopPropagation()}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontalIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className={menuClass}
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem className={menuItemClass} onSelect={actions.onEdit}>
              <PencilIcon className="size-4 text-muted-foreground" />
              Edit
            </DropdownMenuItem>
            {actions.onReveal && (
              <DropdownMenuItem className={menuItemClass} onSelect={actions.onReveal}>
                <FolderOpenIcon className="size-4 text-muted-foreground" />
                Show the folder
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className={menuItemClass} onSelect={actions.onExport}>
              <DownloadIcon className="size-4 text-muted-foreground" />
              Export SKILL.md…
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItemClass} onSelect={actions.onCopy}>
              <ClipboardCopyIcon className="size-4 text-muted-foreground" />
              Copy as SKILL.md
            </DropdownMenuItem>
            <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
            <DropdownMenuItem
              className={cn(menuItemClass, "text-destructive data-highlighted:text-destructive")}
              onSelect={actions.onDelete}
            >
              <Trash2Icon className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </li>
  );
}
