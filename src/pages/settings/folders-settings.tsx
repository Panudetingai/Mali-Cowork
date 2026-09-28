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
import { EmptyState, IconTile, Notice, SectionHeader, SettingRow, SettingsGroup, SettingsList, StatusPill } from "./ui";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function FoldersSettings() {
  const grants = useFolderGrants();

  const addFolder = async () => {
    const folder = await open({ directory: true, multiple: false, title: "Allow a folder" });
    if (typeof folder === "string" && folder) await requestFolderAccess(folder);
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        title="Folder access"
        description="Cowork can only use folders you allow here. Chat never reads your files."
        actions={
          <Button type="button" size="sm" onClick={addFolder} className="gap-1.5">
            <FolderPlusIcon className="size-4" />
            Allow folder
          </Button>
        }
      />

      {grants.length === 0 ? (
        <EmptyState
          icon={<FolderIcon />}
          title="No folders allowed yet"
          description="You’ll be prompted when Cowork first needs access. You can also add one now."
          action={
            <Button type="button" size="sm" variant="outline" onClick={addFolder} className="gap-1.5">
              <FolderPlusIcon className="size-4" />
              Allow folder
            </Button>
          }
        />
      ) : (
        <SettingsList>
          {grants.map((grant) => (
            <li key={grant.path} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <IconTile className="bg-amber-500/10 text-amber-700 dark:text-amber-400">
                  <FolderIcon />
                </IconTile>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{folderName(grant.path)}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground" title={grant.path}>
                    {grant.path}
                  </p>
                  <p className="text-xs text-muted-foreground">Allowed {dateFormat.format(grant.grantedAt)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <Select
                  value={grant.access}
                  onValueChange={(value) => grantFolder(grant.path, value as FolderAccess)}
                >
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
                  onClick={() => revokeFolder(grant.path)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </SettingsList>
      )}

      <CommandSafety />
    </div>
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
    <SettingsGroup
      title="Command safety"
      description="Every command the AI wants to run is checked first, then run the way that's safe for it."
      footer="The sandbox applies to Mali's own agent. OpenCode and other CLI agents get the same risk check before each command."
    >
      {contained === false && (
        <div className="px-4 pt-3.5">
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
        description="Commands can read your files and use the internet, but can only change files in folders you allowed as Read & write. They can't read SSH keys, cloud credentials or the keychain, and don't get your API keys."
        control={<Switch id="command-sandbox" checked={sandbox} disabled={!engine} onCheckedChange={setSandbox} />}
      />
      <RiskRow
        icon={<EyeIcon />}
        tone="text-emerald-600 dark:text-emerald-400"
        label="Looking around runs without asking"
        examples={["ls", "git status", "cat README.md", "rg TODO | head"]}
      >
        Commands that only read, inside the folders you allowed.
      </RiskRow>
      <RiskRow
        icon={<TerminalIcon />}
        tone="text-sky-600 dark:text-sky-400"
        label="Ordinary work asks you first"
        examples={["npm install", "cargo build", "git commit"]}
      >
        {contained === false
          ? "Every time, auto-approve or not, unless you chose “Always” for that program in the chat."
          : "Unless you turned on auto-approve, or chose “Always” for that program in the chat."}
      </RiskRow>
      <RiskRow
        icon={<ShieldAlertIcon />}
        tone="text-amber-600 dark:text-amber-400"
        label="Risky commands always ask"
        examples={["rm -rf dist", "git push --force", "curl -d …", "node -e …", "echo $API_KEY"]}
      >
        Deleting folders, rewriting history, sending data away, or code written into the command. Even with
        auto-approve, and never “Always”. Commands hidden inside <code>bash -c</code>, <code>cmd /c</code> or{" "}
        <code>powershell</code> are checked by what they run.
      </RiskRow>
      <RiskRow
        icon={<BanIcon />}
        tone="text-red-600 dark:text-red-400"
        label="Dangerous commands are blocked"
        examples={["rm -rf ~", "Remove-Item -Recurse C:\\Users", "Format-Volume", "shutdown", "cat ~/.ssh/id_rsa"]}
      >
        Anything that can wreck the computer or leak your keys never runs, whatever is allowed.
      </RiskRow>
    </SettingsGroup>
  );
}

function RiskRow({
  icon,
  tone,
  label,
  examples,
  children,
}: {
  icon: ReactNode;
  tone: string;
  label: string;
  examples: string[];
  children: ReactNode;
}) {
  return (
    <SettingRow icon={<span className={tone}>{icon}</span>} label={label} description={children}>
      <div className="flex flex-wrap gap-1 pl-10">
        {examples.map((example) => (
          <code key={example} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {example}
          </code>
        ))}
      </div>
    </SettingRow>
  );
}
