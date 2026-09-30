import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/animate-ui/primitives/radix/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { skillSlug, type Skill } from "@/features/instructions";
import { applyConnector, McpToolIcon, useInstalledConnectors, useMcpBusy } from "@/features/mcp";
import type { OpencodeState, WorkMode } from "@/features/opencode";
import { CoworkBot } from "@/components/anim/cowork-bot";
import { setOnTeam, setTeamEnabled, useTeam } from "@/features/team";
import { cn } from "@/lib/utils";
import {
  BlocksIcon,
  BrainIcon,
  BriefcaseIcon,
  CheckIcon,
  ChevronRightIcon,
  FolderPlusIcon,
  LoaderIcon,
  PaperclipIcon,
  PlusIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  TerminalIcon,
  UsersIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

type Props = {
  /** Present only while an OpenCode model is selected. */
  opencode?: OpencodeState;
  mode: WorkMode;
  /** The chat already has a bound working folder, so another can join it. */
  canAddFolder: boolean;
  onAddFolder: () => void;
  onAddFiles: () => void;
  skills: Skill[];
  pickedSkills: string[];
  onToggleSkill: (skill: Skill) => void;
  pickedConnectors: string[];
  onToggleConnector: (id: string) => void;
};

const itemClass =
  "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=open]:bg-accent data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50";
const contentClass = "z-50 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg";
const separatorClass = "-mx-1 my-1 h-px bg-border";
const iconClass = "size-4 shrink-0 text-muted-foreground";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

function SubTrigger({ icon, children, count }: { icon: ReactNode; children: ReactNode; count?: number }) {
  return (
    <DropdownMenuSubTrigger className={itemClass}>
      {icon}
      <span className="flex-1">{children}</span>
      {!!count && (
        <span className="rounded-full bg-primary/15 px-1.5 text-[11px] font-medium text-primary tabular-nums">{count}</span>
      )}
      <ChevronRightIcon className="size-4 text-muted-foreground" />
    </DropdownMenuSubTrigger>
  );
}

/** Attach, pick skills and connectors for this prompt — nothing else lives here. */
export function PromptOptionsMenu({
  opencode,
  mode,
  canAddFolder,
  onAddFolder,
  onAddFiles,
  skills,
  pickedSkills,
  onToggleSkill,
  pickedConnectors,
  onToggleConnector,
}: Props) {
  const navigate = useNavigate();
  const connectors = useInstalledConnectors();
  const busy = useMcpBusy();
  const isCowork = mode === "cowork";
  const usable = skills.filter((s) => s.enabled);
  const team = useTeam();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="icon-sm" className="rounded-full" aria-label="Add files, skills or connectors">
          <PlusIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={8} className={cn(contentClass, "w-64")}>
        <DropdownMenuItem className={itemClass} onSelect={onAddFiles}>
          <PaperclipIcon className={iconClass} />
          <span className="flex-1">Add files or photos</span>
          <Kbd className="bg-transparent tracking-wider">{MOD} U</Kbd>
        </DropdownMenuItem>
        {isCowork && canAddFolder && (
          <DropdownMenuItem className={itemClass} onSelect={onAddFolder}>
            <FolderPlusIcon className={iconClass} />
            Add another folder
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator className={separatorClass} />

        <DropdownMenuSub>
          <SubTrigger icon={<ScrollTextIcon className={iconClass} />} count={pickedSkills.length}>
            Skills
          </SubTrigger>
          <DropdownMenuSubContent sideOffset={6} alignOffset={-4} className={cn(contentClass, "w-60")}>
            {usable.length > 0 ? (
              <div className="max-h-72 overflow-y-auto">
                {usable.map((skill) => {
                  const slug = skillSlug(skill);
                  const on = pickedSkills.includes(slug);
                  return (
                    <DropdownMenuItem
                      key={skill.id}
                      className={itemClass}
                      title={skill.description || undefined}
                      onSelect={() => onToggleSkill(skill)}
                    >
                      <ScrollTextIcon className={iconClass} />
                      <span className="min-w-0 flex-1 truncate">{slug}</span>
                      {on && <CheckIcon className="size-4 text-primary" />}
                    </DropdownMenuItem>
                  );
                })}
              </div>
            ) : (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">No skills yet.</p>
            )}
            <DropdownMenuSeparator className={separatorClass} />
            <DropdownMenuItem className={itemClass} onSelect={() => navigate("/settings?tab=skills")}>
              <BriefcaseIcon className={iconClass} />
              Manage skills
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <SubTrigger icon={<BlocksIcon className={iconClass} />} count={pickedConnectors.length}>
            Connectors
          </SubTrigger>
          <DropdownMenuSubContent sideOffset={6} alignOffset={-4} className={cn(contentClass, "w-64")}>
            <DropdownMenuItem className={itemClass} onSelect={() => navigate("/settings?tab=mcp")}>
              <PlusIcon className={iconClass} />
              Add connector
            </DropdownMenuItem>
            <DropdownMenuItem className={itemClass} onSelect={() => navigate("/settings?tab=mcp")}>
              <BriefcaseIcon className={iconClass} />
              Manage connectors
            </DropdownMenuItem>
            {connectors.length > 0 && <DropdownMenuSeparator className={separatorClass} />}
            <div className="max-h-72 overflow-y-auto">
              {connectors.map((c) => {
                const on = pickedConnectors.includes(c.id);
                const working = busy[c.id];
                return (
                  <DropdownMenuItem
                    key={c.id}
                    className={itemClass}
                    title={on ? `Stop using ${c.name} for this message` : `Use ${c.name} for this message`}
                    onSelect={(event) => {
                      event.preventDefault();
                      // Picking a switched-off connector turns it on too.
                      if (!on && !c.enabled) void applyConnector(c.id, { enabled: true }).catch(() => undefined);
                      onToggleConnector(c.id);
                    }}
                  >
                    <span className="flex size-5 items-center justify-center rounded bg-background ring-1 ring-border">
                      <McpToolIcon mcp={c.ref} size={14} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {on && <CheckIcon className="size-4 text-primary" />}
                    {working ? (
                      <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Switch
                        size="sm"
                        checked={c.enabled}
                        aria-label={c.enabled ? `Turn off ${c.name}` : `Turn on ${c.name}`}
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onCheckedChange={(enabled) => void applyConnector(c.id, { enabled }).catch(() => undefined)}
                      />
                    )}
                  </DropdownMenuItem>
                );
              })}
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <SubTrigger
            icon={<UsersIcon className={iconClass} />}
            count={team.enabled ? team.mates.filter((m) => m.onTeam).length : 0}
          >
            Team
          </SubTrigger>
          <DropdownMenuSubContent sideOffset={6} alignOffset={-4} className={cn(contentClass, "w-72")}>
            <ToggleItem
              icon={<UsersIcon className={iconClass} />}
              label="Team mode"
              hint="The chat's model leads: it hands each job to the bot whose duty it is. Needs a model with an API key."
              checked={team.enabled}
              onChange={setTeamEnabled}
            />
            {team.mates.length > 0 && <DropdownMenuSeparator className={separatorClass} />}
            <div className="max-h-72 overflow-y-auto">
              {team.mates.map((mate) => (
                <DropdownMenuItem
                  key={mate.id}
                  className={itemClass}
                  disabled={!team.enabled}
                  title={
                    mate.onTeam
                      ? `${mate.role}\nOn the team: the lead calls ${mate.name} without asking.`
                      : `${mate.role}\nOff the team: the lead asks you before calling ${mate.name}.`
                  }
                  onSelect={(event) => {
                    event.preventDefault();
                    setOnTeam(mate.id, !mate.onTeam);
                  }}
                >
                  <CoworkBot bot={mate.mascot} state="done" size={22} />
                  <span className="min-w-0 flex-1 truncate">{mate.name}</span>
                  {mate.onTeam && <CheckIcon className="size-4 text-primary" />}
                </DropdownMenuItem>
              ))}
            </div>
            <DropdownMenuSeparator className={separatorClass} />
            <DropdownMenuItem className={itemClass} onSelect={() => navigate("/settings?tab=team")}>
              <BriefcaseIcon className={iconClass} />
              {team.mates.length ? "Manage team" : "Make your first bot"}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {opencode && (
          <>
            <DropdownMenuSeparator className={separatorClass} />
            <DropdownMenuSub>
              <SubTrigger icon={<TerminalIcon className={iconClass} />}>OpenCode</SubTrigger>
              <DropdownMenuSubContent sideOffset={6} alignOffset={-4} className={cn(contentClass, "w-72")}>
                <ToggleItem
                  icon={<BrainIcon className={iconClass} />}
                  label="Show thinking"
                  hint="Display the reasoning, don't change how much of it happens"
                  checked={opencode.thinking}
                  onChange={(thinking) => opencode.update({ thinking })}
                />
                {isCowork && (
                  <ToggleItem
                    icon={<ShieldCheckIcon className={iconClass} />}
                    label="Auto-approve actions"
                    hint="Skip permission prompts. Risky commands still ask, and so does every command on a computer without a sandbox."
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
                  <RefreshCwIcon className={cn(iconClass, opencode.loading && "animate-spin")} />
                  Reconnect and reload models
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
