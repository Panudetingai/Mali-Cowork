import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CursorLoginDialog, requestCursorLogin, useCursor } from "@/features/cursor";
import { useAntigravity } from "@/features/antigravity";
import { useOpencode } from "@/features/opencode";
import { cn } from "@/lib/utils";
import { checkCli, type CliCheckResult } from "@/pages/chat/api/cli";
import { open } from "@tauri-apps/plugin-dialog";
import { Codex, Cursor, GeminiCLI as AntigravityCLI, OpenCode } from "@lobehub/icons";
import { ChevronRightIcon, FolderOpenIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { checkCustomCli, cliModels, useCustomClis, type CliCheck, type CustomCli } from "@/features/custom-cli";
import { ProviderLogo } from "@/features/providers";
import { useEffect, useId, useState } from "react";
import { OnboardingButton } from "@/features/onboarding";
import { CopyCommand, Dot, Field, SectionLabel, Tile, TileBadge, TileButton, TileGrid } from "./ui";

export function AgentsSettings({ onOpenCli }: { onOpenCli: (id: string) => void }) {
  const opencode = useOpencode();
  const cursor = useCursor();
  const antigravity = useAntigravity();
  const folderId = useId();
  const [cwdDraft, setCwdDraft] = useState(opencode.cwd);
  const [codex, setCodex] = useState<CliCheckResult | null>(null);
  const customClis = useCustomClis();
  const [round, setRound] = useState(0);

  useEffect(() => setCwdDraft(opencode.cwd), [opencode.cwd]);

  const loadCodex = () => {
    setCodex(null);
    checkCli("codex")
      .then(setCodex)
      .catch(() => setCodex({ available: false, error: "check failed" }));
  };
  useEffect(loadCodex, []);

  function refreshAll() {
    opencode.refresh();
    cursor.refresh();
    antigravity.refresh();
    loadCodex();
    setRound((n) => n + 1);
  }

  async function pickFolder() {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath: opencode.cwd || undefined,
      title: "Choose OpenCode’s working folder",
    });
    if (typeof selected === "string" && selected) opencode.update({ cwd: selected });
  }

  const oc = opencode.loading ? null : opencode.check;
  const ocModels = opencode.models?.models.length ?? 0;
  const cursorReady = !!cursor.check?.available && !!cursor.check.loggedIn;
  const antigravityReady = !!antigravity.check?.available && !!antigravity.check.loggedIn;
  const refreshing = opencode.loading || cursor.loading || antigravity.loading;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <SectionLabel
          action={
            <>
              <OnboardingButton className="h-7 text-xs" />
              <Button variant="ghost" size="sm" onClick={refreshAll} disabled={refreshing} className="h-7 gap-1.5 px-2 text-xs text-muted-foreground">
                <RefreshCwIcon className={cn("size-3.5", refreshing && "animate-spin")} />
                Refresh
              </Button>
            </>
          }
        >
          CLI agents
        </SectionLabel>
        <p className="-mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          Agents already on this computer, run on the subscription you signed in with. They show up in the model list next to your API models.
          Installed another one? Add it with <span className="font-medium text-foreground">Add CLI</span>.
        </p>
      </div>

      <TileGrid>
        <Tile
          icon={<OpenCode size={28} />}
          title="OpenCode"
          badge={<TileBadge>Recommended</TileBadge>}
          description={
            oc?.available
              ? `${oc.version ? `v${oc.version} · ` : ""}${ocModels} models · asks before changing files`
              : oc?.error || "Cowork’s main agent. Supports MCP, OpenRouter and Ollama."
          }
          meta={
            !oc ? <Dot tone="neutral">Checking…</Dot> : oc.available ? <Dot tone="success">Ready</Dot> : <Dot tone="warning">Not installed</Dot>
          }
        />
        <Tile
          icon={<Cursor size={28} />}
          title="Cursor Agent"
          description={
            cursor.check?.account ||
            (cursor.models.length ? `${cursor.models.length} models · uses your subscription` : "Uses your Cursor subscription")
          }
          meta={
            cursor.loading ? (
              <Dot tone="neutral">Checking…</Dot>
            ) : cursorReady ? (
              <Dot tone="success">Signed in</Dot>
            ) : cursor.check?.available ? (
              <Dot tone="warning">Not signed in</Dot>
            ) : (
              <Dot tone="neutral">Not installed</Dot>
            )
          }
          action={
            !cursor.loading && !cursorReady ? (
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => requestCursorLogin()}>
                {cursor.check?.available ? "Sign in" : "How to install"}
              </Button>
            ) : undefined
          }
        />
        <Tile
          icon={<Codex size={28} />}
          title="Codex"
          description={codex?.available ? codex.version || codex.path || "Ready" : "OpenAI Codex CLI"}
          meta={
            !codex ? <Dot tone="neutral">Checking…</Dot> : codex.available ? <Dot tone="success">Ready</Dot> : <Dot tone="neutral">Not installed</Dot>
          }
        />
        <Tile
          icon={<AntigravityCLI size={28} />}
          title="Antigravity CLI"
          description={
            antigravity.check?.account ||
            (antigravity.models.length ? `${antigravity.models.length} models · uses your Google account` : "Uses your Google account")
          }
          meta={
            antigravity.loading ? (
              <Dot tone="neutral">Checking…</Dot>
            ) : antigravityReady ? (
              <Dot tone="success">Signed in</Dot>
            ) : antigravity.check?.available ? (
              <Dot tone="warning">Not signed in</Dot>
            ) : (
              <Dot tone="neutral">Not installed</Dot>
            )
          }
        />
        {customClis.map((cli) => (
          <CustomCliTile key={`${cli.id}:${round}`} cli={cli} onOpen={() => onOpenCli(cli.id)} />
        ))}
        <Tile
          icon={<PlusIcon className="size-6 text-muted-foreground" />}
          title="Add CLI"
          description="Claude Code, Gemini CLI, Qwen Code, Aider — or any program that takes a prompt and prints an answer."
          onOpen={() => onOpenCli("new")}
          openLabel="Add a CLI agent"
          className="border-dashed"
          action={
            <TileButton label="Add a CLI agent" onClick={() => onOpenCli("new")}>
              <PlusIcon />
            </TileButton>
          }
        />
      </TileGrid>

      {antigravity.check && !antigravity.check.available && (
        <div className="flex max-w-xl flex-col gap-2">
          <p className="text-sm text-muted-foreground">Install Antigravity CLI, then restart the app (or set AGY_BIN):</p>
          <CopyCommand command="curl -fsSL https://antigravity.google/cli/install.sh | bash" />
        </div>
      )}

      {oc && !oc.available && (
        <div className="flex max-w-xl flex-col gap-2">
          <p className="text-sm text-muted-foreground">Install OpenCode, then restart the app (or set OPENCODE_BIN):</p>
          <CopyCommand command="npm i -g opencode-ai" />
        </div>
      )}

      <div className="max-w-xl">
        <Field
          label="Default working folder"
          htmlFor={folderId}
          hint="OpenCode works here when a Cowork chat has no folder yet. Access follows the Folders tab."
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={folderId}
              value={cwdDraft}
              onChange={(e) => setCwdDraft(e.target.value)}
              onBlur={() => cwdDraft.trim() !== opencode.cwd && opencode.update({ cwd: cwdDraft.trim() })}
              placeholder="e.g. ~/Public"
              spellCheck={false}
              className="font-mono text-xs"
            />
            <Button type="button" variant="outline" onClick={pickFolder} className="gap-1.5">
              <FolderOpenIcon className="size-4" />
              Choose…
            </Button>
          </div>
        </Field>
      </div>

      <CursorLoginDialog />
    </div>
  );
}

/** A CLI the user added: found on this computer or not, and how many models it offers. */
function CustomCliTile({ cli, onOpen }: { cli: CustomCli; onOpen: () => void }) {
  const [check, setCheck] = useState<CliCheck | null>(null);
  useEffect(() => {
    let live = true;
    checkCustomCli(cli.command)
      .then((result) => live && setCheck(result))
      .catch(() => live && setCheck({ available: false, error: "check failed" }));
    return () => {
      live = false;
    };
  }, [cli.command]);
  const models = cliModels(cli).length;
  return (
    <Tile
      icon={<ProviderLogo logo="terminal" name={cli.name} size={28} />}
      title={cli.name}
      badge={<TileBadge tone="muted">Yours</TileBadge>}
      description={`${check?.version || cli.command}${models ? ` · ${models} model${models === 1 ? "" : "s"}` : ""}`}
      meta={!check ? <Dot tone="neutral">Checking…</Dot> : check.available ? <Dot tone="success">Ready</Dot> : <Dot tone="warning">Not found</Dot>}
      onOpen={onOpen}
      openLabel={`Edit ${cli.name}`}
      action={
        <TileButton label={`Edit ${cli.name}`} onClick={onOpen}>
          <ChevronRightIcon />
        </TileButton>
      }
    />
  );
}
