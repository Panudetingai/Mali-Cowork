import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  folderName,
  grantFolder,
  requestFolderAccess,
  revokeFolder,
  useFolderGrants,
  type FolderAccess,
} from "@/features/workspace";
import { Switch } from "@/components/ui/switch";
import { sandboxEngine, useCommandSandbox } from "@/features/agent";
import { open } from "@tauri-apps/plugin-dialog";
import {
  BanIcon,
  BoxIcon,
  EyeIcon,
  FolderIcon,
  FolderPlusIcon,
  ShieldAlertIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Notice, SectionHeader, SettingRow, SettingsGroup, SettingsPage, StatusPill } from "./ui";
import { cn } from "@/lib/utils";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function FoldersSettings() {
  const grants = useFolderGrants();

  const addFolder = async () => {
    const folder = await open({ directory: true, multiple: false, title: "Allow a folder" });
    if (typeof folder === "string" && folder) await requestFolderAccess(folder);
  };

  return (
    <SettingsPage>
      <SectionHeader
        title="Folder access"
        description="Cowork can only use folders you allow here. Chat never reads your files."
        actions={
          <Button type="button" size="sm" onClick={addFolder} className="h-9 gap-1.5">
            <FolderPlusIcon className="size-4" />
            Allow folder
          </Button>
        }
      />

      <SettingsGroup
        wide
        title={`Allowed folders${grants.length ? ` · ${grants.length}` : ""}`}
        description="Read only lets the AI look; Read & write lets it change files there too."
      >
        {grants.length === 0 ? (
          <button
            type="button"
            onClick={addFolder}
            className="mt-2 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center transition-colors hover:border-foreground/30 hover:bg-muted/30"
          >
            <span className="flex size-11 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <FolderPlusIcon className="size-5" />
            </span>
            <span className="text-sm font-medium">No folders allowed yet</span>
            <span className="max-w-sm text-[13px] text-muted-foreground">
              You’ll be asked when Cowork first needs one. Click to allow a folder now.
            </span>
          </button>
        ) : (
          <ul className="mt-1 flex flex-col divide-y divide-border/60">
            {grants.map((grant) => (
              <li key={grant.path} className="group flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3.5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <FolderIcon className="size-[18px]" />
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold">
                      {folderName(grant.path)}
                      <span
                        className={cn(
                          "rounded px-1.5 py-px text-[10px] font-bold tracking-wide uppercase",
                          grant.access === "write"
                            ? "bg-violet-500/10 text-violet-700 dark:text-violet-300"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {grant.access === "write" ? "Read & write" : "Read only"}
                      </span>
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground" title={grant.path}>
                      {grant.path}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <span className="hidden text-xs text-muted-foreground md:inline">Since {dateFormat.format(grant.grantedAt)}</span>
                  <Select value={grant.access} onValueChange={(value) => grantFolder(grant.path, value as FolderAccess)}>
                    <SelectTrigger size="sm" aria-label={`Access for ${folderName(grant.path)}`} className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="read">Read only</SelectItem>
                      <SelectItem value="write">Read & write</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Revoke ${folderName(grant.path)}`}
                    title="Revoke access"
                    onClick={() => revokeFolder(grant.path)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsGroup>

      <CommandSafety />
    </SettingsPage>
  );
}

/** How commands the AI runs are checked and contained. */
function CommandSafety() {
  const [sandbox, setSandbox] = useCommandSandbox();
  const [engine, setEngine] = useState<string | null>();
  useEffect(() => {
    sandboxEngine().then(setEngine, () => setEngine(null));
  }, []);
  // Unknown until the engine check answers.
  const contained = engine === undefined ? undefined : !!engine && sandbox;

  return (
    <>
      <SettingsGroup
        title="Command safety"
        description="Every command the AI wants to run is checked first, then run the way that’s safe for it."
        footer="The sandbox applies to Mali’s own agent. OpenCode and other CLI agents get the same risk check before each command."
      >
        {contained === false && (
          <div className="py-3.5">
            <Notice tone="warning" title="Auto-approve doesn't cover commands here">
              {engine
                ? "With the sandbox off, nothing contains a command, so every one that does more than read asks you first, even with auto-approve on. File edits can still be auto-approved."
                : "This computer has no sandbox, so every command that does more than read asks you first, even with auto-approve on. File edits can still be auto-approved."}
            </Notice>
          </div>
        )}
        <SettingRow
          icon={<BoxIcon />}
          htmlFor="command-sandbox"
          label={
            <span className="flex flex-wrap items-center gap-2">
              Run commands in a sandbox
              {engine === undefined ? null : engine ? (
                <StatusPill tone={sandbox ? "success" : "neutral"}>{sandbox ? engine : "Off"}</StatusPill>
              ) : (
                <StatusPill tone="warning">Not available on this computer</StatusPill>
              )}
            </span>
          }
          description="Commands can read your files and use the internet, but only change files in folders allowed as Read & write. They can’t read SSH keys, cloud credentials or the keychain, and don’t get your API keys."
          control={<Switch id="command-sandbox" checked={sandbox} disabled={!engine} onCheckedChange={setSandbox} />}
        />
      </SettingsGroup>

      <SettingsGroup wide title="What asks first" description="From harmless to never allowed — how each kind of command is treated.">
        <ol className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
          <RiskRow
            level={1}
            icon={<EyeIcon />}
            tone="emerald"
            label="Looking around runs without asking"
            examples={["ls", "git status", "cat README.md", "rg TODO | head"]}
          >
            Commands that only read, inside the folders you allowed.
          </RiskRow>
          <RiskRow
            level={2}
            icon={<TerminalIcon />}
            tone="sky"
            label="Ordinary work asks you first"
            examples={["npm install", "cargo build", "git commit"]}
          >
            {contained === false
              ? "Every time, auto-approve or not, unless you chose “Always” for that program in the chat."
              : "Unless you turned on auto-approve, or chose “Always” for that program in the chat."}
          </RiskRow>
          <RiskRow
            level={3}
            icon={<ShieldAlertIcon />}
            tone="amber"
            label="Risky commands always ask"
            examples={["rm -rf dist", "git push --force", "curl -d …", "node -e …", "echo $API_KEY"]}
          >
            Deleting folders, rewriting history, sending data away, or code written into the command — even with
            auto-approve. Commands inside <code>bash -c</code>, <code>cmd /c</code> or <code>powershell</code> are checked
            by what they run.
          </RiskRow>
          <RiskRow
            level={4}
            icon={<BanIcon />}
            tone="red"
            label="Dangerous commands are blocked"
            examples={["rm -rf ~", "Remove-Item -Recurse C:\\Users", "Format-Volume", "shutdown", "cat ~/.ssh/id_rsa"]}
          >
            Anything that can wreck the computer or leak your keys never runs, whatever is allowed.
          </RiskRow>
        </ol>
      </SettingsGroup>
    </>
  );
}

const TONES = {
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
} as const;

function RiskRow({
  level,
  icon,
  tone,
  label,
  examples,
  children,
}: {
  level: number;
  icon: ReactNode;
  tone: keyof typeof TONES;
  label: string;
  examples: string[];
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3.5 rounded-xl border border-border/70 p-4">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4", TONES[tone])}>{icon}</span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {label}
          <span className="ml-auto shrink-0 text-[11px] font-normal text-muted-foreground tabular-nums">{level}/4</span>
        </p>
        <p className="text-[13px] leading-relaxed text-muted-foreground [&_code]:font-mono [&_code]:text-xs">{children}</p>
        <div className="flex flex-wrap gap-1 pt-0.5">
          {examples.map((example) => (
            <code key={example} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {example}
            </code>
          ))}
        </div>
      </div>
    </li>
  );
}
