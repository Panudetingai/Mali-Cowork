import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { OpencodeState, WorkMode } from "@/features/opencode";
import { folderName } from "@/features/workspace";
import { cn } from "@/lib/utils";
import {
  BrainIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  PaperclipIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  /** Present only while an OpenCode model is selected. */
  opencode?: OpencodeState;
  mode: WorkMode;
  /** The chat already has a bound working folder. */
  canAddFolder: boolean;
  onPickWorkingFolder: () => void;
  onAddFolder: () => void;
  onAddFiles: () => void;
};

const itemClass =
  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50";
const labelClass =
  "px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase";
const separatorClass = "-mx-1 my-1 h-px bg-border";

/** Everything secondary to typing lives behind the plus button. */
export function PromptOptionsMenu({
  opencode,
  mode,
  canAddFolder,
  onPickWorkingFolder,
  onAddFolder,
  onAddFiles,
}: Props) {
  const isCowork = mode === "cowork";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="rounded-full"
          aria-label="More options"
        >
          <PlusIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className="z-50 w-72 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
      >
        <DropdownMenuItem className={itemClass} onSelect={onAddFiles}>
          <PaperclipIcon className="size-4 text-muted-foreground" />
          Add files or photos
        </DropdownMenuItem>

        {isCowork && (
          <>
            <DropdownMenuItem className={itemClass} onSelect={onPickWorkingFolder}>
              <FolderOpenIcon className="size-4 text-muted-foreground" />
              <span className="flex flex-1 flex-col">
                {canAddFolder ? "Change working folder" : "Working folder"}
                {canAddFolder && (
                  <span className="text-xs text-muted-foreground">Starts a new chat</span>
                )}
              </span>
              {opencode && (
                <span className="max-w-28 truncate text-xs text-muted-foreground" title={opencode.cwd}>
                  {folderName(opencode.cwd)}
                </span>
              )}
            </DropdownMenuItem>
            {canAddFolder && (
              <DropdownMenuItem className={itemClass} onSelect={onAddFolder}>
                <FolderPlusIcon className="size-4 text-muted-foreground" />
                <span className="flex-1">Add another folder</span>
              </DropdownMenuItem>
            )}
          </>
        )}

        {opencode && (
          <>
            <DropdownMenuSeparator className={separatorClass} />
            <DropdownMenuLabel className={labelClass}>OpenCode</DropdownMenuLabel>
            <ToggleItem
              icon={<BrainIcon className="size-4 text-muted-foreground" />}
              label="Show thinking"
              checked={opencode.thinking}
              onChange={(thinking) => opencode.update({ thinking })}
            />
            {isCowork && (
              <ToggleItem
                icon={<ShieldCheckIcon className="size-4 text-muted-foreground" />}
                label="Auto-approve actions"
                hint="Skip permission prompts"
                checked={opencode.autoApprove}
                onChange={(autoApprove) => opencode.update({ autoApprove })}
              />
            )}
            <DropdownMenuItem
              className={itemClass}
              disabled={opencode.loading}
              onSelect={(event) => {
                event.preventDefault();
                opencode.refresh();
              }}
            >
              <RefreshCwIcon
                className={cn("size-4 text-muted-foreground", opencode.loading && "animate-spin")}
              />
              Reconnect and reload models
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ToggleItem({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <DropdownMenuItem
      className={itemClass}
      onSelect={(event) => {
        event.preventDefault();
        onChange(!checked);
      }}
    >
      {icon}
      <span className="flex flex-1 flex-col">
        {label}
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch size="sm" checked={checked} tabIndex={-1} className="pointer-events-none" />
    </DropdownMenuItem>
  );
}
