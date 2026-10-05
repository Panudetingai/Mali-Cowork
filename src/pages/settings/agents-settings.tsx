import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CursorLoginDialog, requestCursorLogin, useCursor } from "@/features/cursor";
import { useAntigravity } from "@/features/antigravity";
import { useOpencode } from "@/features/opencode";
import { cn } from "@/lib/utils";
import { checkCli, type CliCheckResult } from "@/pages/chat/api/cli";
import { open } from "@tauri-apps/plugin-dialog";
import { Codex, Cursor, GeminiCLI as AntigravityCLI, OpenCode } from "@lobehub/icons";
import { FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { OnboardingButton } from "@/features/onboarding";
import { CopyCommand, Dot, Field, SectionLabel, Tile, TileBadge, TileGrid } from "./ui";

export function AgentsSettings() {
  const opencode = useOpencode();
  const cursor = useCursor();
  const antigravity = useAntigravity();
  const folderId = useId();
  const [cwdDraft, setCwdDraft] = useState(opencode.cwd);
  const [codex, setCodex] = useState<CliCheckResult | null>(null);

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
          Agents already on this Mac, run on the subscription you signed in with. They show up in the model list next to your API models.
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
