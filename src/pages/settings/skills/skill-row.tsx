import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { SmitheryIcon } from "@/components/app/smithery-icon";
import type { Skill } from "@/features/instructions";
import { cn } from "@/lib/utils";
import { Tile, TileBadge } from "../ui";
import {
  ClipboardCopyIcon,
  DownloadIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  Package,
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
 * One skill in the library, as a tile: click to edit, switch to use it.
 *
 * The bottom line says how the AI gets at it: a skill on disk is opened
 * when a task matches, so it shows what its folder holds.
 */
export function SkillTile({ skill, actions }: { skill: Skill; actions: SkillRowActions }) {
  const files = skill.install?.files.length ?? 0;
  return (
    <Tile
      className={cn(!skill.enabled && "bg-muted/20")}
      icon={
        skill.via === "smithery" ? (
          <SmitheryIcon size={28} title="From Smithery" />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Package style={{ width: 16, height: 16 }} />
          </span>
        )
      }
      title={skill.name}
      badge={!skill.enabled ? <TileBadge tone="muted">Off</TileBadge> : undefined}
      description={skill.description || "No “Use when” yet — open it to say when the AI should use it."}
      meta={
        <span className="truncate">
          {skill.install ? `On disk${files > 0 ? ` · ${files} file${files === 1 ? "" : "s"}` : ""}` : "In the prompt"}
          {skill.install && <span className="font-mono"> · /{skill.install.slug}</span>}
        </span>
      }
      onOpen={actions.onEdit}
      openLabel={`Edit ${skill.name}`}
      action={
        <>
          <Switch checked={skill.enabled} onCheckedChange={(enabled) => actions.onToggle(enabled)} aria-label={`Use ${skill.name}`} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`More for ${skill.name}`}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted"
              >
                <MoreHorizontalIcon className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className={menuClass}>
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
        </>
      }
    />
  );
}
