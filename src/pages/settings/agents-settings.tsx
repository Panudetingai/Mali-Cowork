import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CursorLoginDialog, requestCursorLogin, useCursor } from "@/features/cursor";
import { useAntigravity } from "@/features/antigravity";
import { useOpencode } from "@/features/opencode";
import {
  PROVIDERS,
  ProviderLogo,
  useEnvKeys,
  useProviderConfigs,
  type ProviderDef,
} from "@/features/providers";
import { cn } from "@/lib/utils";
import { checkCli, type CliCheckResult } from "@/pages/chat/api/cli";
import { open } from "@tauri-apps/plugin-dialog";
import { Codex, Cursor, GeminiCLI as AntigravityCLI, OpenCode } from "@lobehub/icons";
import { FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ProviderDialog, providerStatus } from "./provider-dialog";
import { OnboardingButton } from "@/features/onboarding";
import {
  CardGrid,
  CopyCommand,
  Field,
  GroupLabel,
  IconTile,
  IntegrationCard,
  SectionHeader,
  SettingsSection,
  StatusPill,
} from "./ui";

export function AgentsSettings() {
  const opencode = useOpencode();
  const cursor = useCursor();
  const antigravity = useAntigravity();
  const configs = useProviderConfigs();
  const envKeys = useEnvKeys();
  const folderId = useId();
  const [cwdDraft, setCwdDraft] = useState(opencode.cwd);
  const [codex, setCodex] = useState<CliCheckResult | null>(null);
  const [provider, setProvider] = useState<ProviderDef | null>(null);

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
    <div className="flex flex-col gap-10">
      <SectionHeader
        title="Agents"
        description="Local agents for Cowork. Pick a model from the chat box."
        actions={
          <div className="flex items-center gap-2">
            <OnboardingButton className="h-8 text-xs" />
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={refreshing} className="gap-1.5">
              <RefreshCwIcon className={cn("size-3.5", refreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        }
      />

      <CardGrid className="lg:grid-cols-3 2xl:grid-cols-3">
        <IntegrationCard
          icon={
            <IconTile>
              <OpenCode size={24} />
            </IconTile>
          }
          title="OpenCode"
          badge={<StatusPill tone="neutral">Recommended</StatusPill>}
          description={
            oc?.available
              ? `${oc.version ? `v${oc.version} · ` : ""}${ocModels} models · asks before changing files`
              : oc?.error || "Cowork’s main agent. Supports MCP, OpenRouter and Ollama."
          }
          status={
            !oc ? (
              <StatusPill tone="pending">Checking…</StatusPill>
            ) : oc.available ? (
              <StatusPill tone="success">Ready</StatusPill>
            ) : (
              <StatusPill tone="danger">Not installed</StatusPill>
            )
          }
        />
        <IntegrationCard
          icon={
            <IconTile>
              <Cursor size={24} />
            </IconTile>
          }
          title="Cursor Agent"
          description={
            cursor.check?.account ||
            (cursor.models.length ? `${cursor.models.length} models · uses your subscription` : "Uses your Cursor subscription")
          }
          status={
            cursor.loading ? (
              <StatusPill tone="pending">Checking…</StatusPill>
            ) : cursorReady ? (
              <StatusPill tone="success">Signed in</StatusPill>
            ) : cursor.check?.available ? (
              <StatusPill tone="warning">Not signed in</StatusPill>
            ) : (
              <StatusPill tone="neutral">Not installed</StatusPill>
            )
          }
          control={
            !cursor.loading && !cursorReady ? (
              <Button type="button" size="sm" variant="outline" onClick={() => requestCursorLogin()}>
                {cursor.check?.available ? "Sign in" : "How to install"}
              </Button>
            ) : undefined
          }
        />
        <IntegrationCard
          icon={
            <IconTile>
              <Codex size={24} />
            </IconTile>
          }
          title="Codex"
          description={codex?.available ? codex.version || codex.path || "Ready" : "OpenAI Codex CLI"}
          status={
            !codex ? (
              <StatusPill tone="pending">Checking…</StatusPill>
            ) : codex.available ? (
              <StatusPill tone="success">Ready</StatusPill>
            ) : (
              <StatusPill tone="neutral">Not installed</StatusPill>
            )
          }
        />
        <IntegrationCard
          icon={
            <IconTile>
              <AntigravityCLI size={24} />
            </IconTile>
          }
          title="Antigravity CLI"
          description={
            antigravity.check?.account ||
            (antigravity.models.length ? `${antigravity.models.length} models · uses your Google account` : "Uses your Google account")
          }
          status={
            antigravity.loading ? (
              <StatusPill tone="pending">Checking…</StatusPill>
            ) : antigravityReady ? (
              <StatusPill tone="success">Signed in</StatusPill>
            ) : antigravity.check?.available ? (
              <StatusPill tone="warning">Not signed in</StatusPill>
            ) : (
              <StatusPill tone="neutral">Not installed</StatusPill>
            )
          }
        />
      </CardGrid>

      {antigravity.check && !antigravity.check.available && (
        <div className="flex max-w-xl flex-col gap-2">
          <p className="text-sm text-muted-foreground">Install Antigravity CLI, then restart the app (or set ANTIGRAVITY_BIN):</p>
          <CopyCommand command="npm i -g antigravity-cli" />
        </div>
      )}

      {oc && !oc.available && (
        <div className="flex max-w-xl flex-col gap-2">
          <p className="text-sm text-muted-foreground">Install OpenCode, then restart the app (or set OPENCODE_BIN):</p>
          <CopyCommand command="npm i -g opencode-ai" />
        </div>
      )}

      <SettingsSection>
        <GroupLabel>Default working folder</GroupLabel>
        <div className="rounded-2xl border border-border/60 bg-card p-4">
          <Field
            label="OpenCode folder"
            htmlFor={folderId}
            hint="Used when a Cowork chat has no folder yet. Access follows the Folders tab."
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
      </SettingsSection>

      <SettingsSection>
        <div className="flex flex-col gap-1">
          <GroupLabel>Agent models</GroupLabel>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Set once for Chat and Cowork. Keys stay on this device.
          </p>
        </div>
        <CardGrid className="lg:grid-cols-3 2xl:grid-cols-3">
          {PROVIDERS.map((p) => {
            const status = providerStatus(p, configs[p.id], envKeys);
            const inAgent = opencode.models?.providers.find((x) => x.id === p.id)?.connected;
            return (
              <IntegrationCard
                key={p.id}
                icon={
                  <IconTile>
                    <ProviderLogo logo={p.logo} name={p.name} className="size-6" />
                  </IconTile>
                }
                title={p.name}
                description={p.description}
                onOpen={() => setProvider(p)}
                openLabel={`Set up ${p.name}`}
                highlight={inAgent ? "success" : undefined}
                status={
                  inAgent ? (
                    <StatusPill tone="success">Connected</StatusPill>
                  ) : status.tone === "success" ? (
                    <StatusPill tone="warning">Chat only</StatusPill>
                  ) : (
                    <StatusPill tone="neutral">Not connected</StatusPill>
                  )
                }
                control={
                  <Button type="button" variant="outline" size="sm" onClick={() => setProvider(p)}>
                    {status.tone === "success" ? "Manage" : "Set up"}
                  </Button>
                }
              />
            );
          })}
        </CardGrid>
      </SettingsSection>

      <ProviderDialog provider={provider} onClose={() => setProvider(null)} />
      <CursorLoginDialog />
    </div>
  );
}
