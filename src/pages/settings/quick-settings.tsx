"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAntigravity } from "@/features/antigravity";
import { useCursor } from "@/features/cursor";
import { useOpencode } from "@/features/opencode";
import { listConfiguredProviders, useEnvKeys, useProviderConfigs } from "@/features/providers";
import {
  DEFAULT_QUICK_ACTIONS,
  DEFAULT_QUICK_CONFIG,
  isMacPlatform,
  recordShortcut,
  setQuickConfig,
  shortcutKeys,
  useQuickConfig,
  useQuickStatus,
} from "@/features/quick";
import { setNotchEnabled, setNotchSaveChats, useNotchEnabled, useNotchSaveChats } from "@/features/notch";
import { cn } from "@/lib/utils";
import { ModelPicker } from "@/pages/chat/components/model-picker";
import { buildModelCatalog, loadSelectedModelId, OPENCODE_DEFAULT_ID, type AiModel } from "@/pages/chat/models";
import {
  ClipboardIcon,
  ActivityIcon,
  HistoryIcon,
  KeyboardIcon,
  MonitorIcon,
  PowerIcon,
  RotateCcwIcon,
  ScanIcon,
  SparklesIcon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Notice, SectionHeader, SettingRow, SettingsGroup, StatusPill, Steps } from "./ui";

const mac = isMacPlatform();

export function QuickSettings() {
  const config = useQuickConfig();
  const notchEnabled = useNotchEnabled();
  const notchSaveChats = useNotchSaveChats();
  const status = useQuickStatus();
  const opencode = useOpencode();
  const cursor = useCursor();
  const antigravity = useAntigravity();
  const providerConfigs = useProviderConfigs();
  const envKeys = useEnvKeys();

  const catalog = useMemo(
    () =>
      buildModelCatalog(
        opencode.models,
        listConfiguredProviders(providerConfigs, envKeys),
        "chat",
        { models: cursor.models, loggedIn: !!cursor.check?.loggedIn },
        { models: [], loggedIn: false }, // Codex is not used in Quick bar.
        { models: antigravity.models, loggedIn: !!antigravity.check?.loggedIn },
      ),
    [opencode.models, providerConfigs, envKeys, cursor, antigravity],
  );

  // What the Quick bar will really run — not a stand-in the picker would show.
  const followsChat = !config.modelId;
  const effectiveId = config.modelId ?? loadSelectedModelId("chat");
  const effective = catalog.find((m) => m.id === effectiveId);
  const usable = useMemo(() => catalog.filter((m) => !m.issue), [catalog]);
  const shown: AiModel = effective ?? {
    id: effectiveId,
    name: effectiveId === OPENCODE_DEFAULT_ID ? "Auto — OpenCode picks" : effectiveId,
    provider: "opencode",
    source: "opencode",
    group: "OpenCode",
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        title="Quick bar"
        description="A small window you open over any app with a shortcut. It answers in Chat mode, with no access to your files."
      />

      <Steps
        steps={[
          { title: "Copy text", description: "Select anything in any app and copy it (optional)." },
          {
            title: `Press ${shortcutKeys(config.shortcut, mac).join(mac ? "" : "+")}`,
            description: "The Quick bar opens with what you copied.",
          },
          { title: "Ask, then paste", description: "Ask, summarize or translate, and paste the answer back." },
        ]}
      />

      <ShortcutGroup enabled={config.enabled} shortcut={config.shortcut} status={status} />

      <SettingsGroup
        title="Model"
        footer={
          followsChat
            ? "Following the model picked on the Chat page."
            : "The Quick bar has its own model; changing the Chat page's model doesn't affect it."
        }
      >
        <SettingRow
          icon={<SparklesIcon />}
          label="Answer with"
          description="The model the Quick bar uses to reply."
          control={
            <>
              {!followsChat && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Use the Chat page's model"
                  aria-label="Use the Chat page's model"
                  onClick={() => void setQuickConfig({ modelId: undefined })}
                >
                  <RotateCcwIcon />
                </Button>
              )}
              <div className="w-full sm:w-64">
                <ModelPicker
                  appearance="field"
                  models={usable}
                  selected={shown}
                  loading={opencode.loading}
                  onSelect={(model) => void setQuickConfig({ modelId: model.id })}
                />
              </div>
            </>
          }
        >
          {effective?.issue && (
            <Notice tone="warning" title="This model can't answer in the Quick bar">
              {effective.issue}. Pick a paid model or another provider.
            </Notice>
          )}
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Behavior">
        <SettingRow
          icon={<MonitorIcon />}
          htmlFor="quick-tray"
          label={mac ? "Keep running in the menu bar" : "Keep running in the system tray"}
          description="Closing the main window keeps Mali running, so the shortcut still works."
          control={
            <Switch
              id="quick-tray"
              checked={config.trayMode}
              onCheckedChange={(trayMode) => void setQuickConfig({ trayMode })}
            />
          }
        />
        <SettingRow
          icon={<ActivityIcon />}
          htmlFor="notch-enabled"
          label="Show agent status at the top of the screen"
          description="While Mali is in the background, a small pill shows what the agent is doing and lets you Allow or Deny without switching windows."
          control={<Switch id="notch-enabled" checked={notchEnabled} onCheckedChange={setNotchEnabled} />}
        />
        <SettingRow
          icon={<HistoryIcon />}
          htmlFor="notch-save"
          label="Save what you ask in the notch"
          description={`Off for quick questions you don't need to keep. In notch mode (the button at the top of the window), ${mac ? "⌥⌘M" : "the shortcut"} or moving the pointer to the top of the screen opens the notch to ask.`}
          control={<Switch id="notch-save" checked={notchSaveChats} onCheckedChange={setNotchSaveChats} />}
        />
        <SettingRow
          icon={<HistoryIcon />}
          htmlFor="quick-history"
          label="Save chats to history"
          description="Each Quick bar thread becomes a chat you can continue in the main window."
          control={
            <Switch
              id="quick-history"
              checked={config.saveToHistory ?? DEFAULT_QUICK_CONFIG.saveToHistory}
              onCheckedChange={(saveToHistory) => void setQuickConfig({ saveToHistory })}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Good to know">
        <SettingRow
          icon={<ClipboardIcon />}
          label="Uses what you copied"
          description="The clipboard is read once, when you press the shortcut, never in the background."
        />
        <SettingRow
          icon={<ZapIcon />}
          label="One-tap actions"
          description="Run a ready-made action on what you copied."
          control={
            <span className="flex flex-wrap gap-1">
              {DEFAULT_QUICK_ACTIONS.map((action, i) => (
                <span key={action.id} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-foreground">
                  {action.label}{" "}
                  <span className="text-muted-foreground">
                    {mac ? "⌘" : "Ctrl+"}
                    {i + 1}
                  </span>
                </span>
              ))}
            </span>
          }
        />
        <SettingRow
          icon={<ScanIcon />}
          label="Capture screen"
          description={
            mac
              ? "Drag over part of the screen to ask about it. macOS asks for Screen Recording the first time."
              : "Coming to Windows later."
          }
        />
      </SettingsGroup>
    </div>
  );
}

/** The shortcut up front: whether it's on, what to press, and how to change it. */
function ShortcutGroup({
  enabled,
  shortcut,
  status,
}: {
  enabled: boolean;
  shortcut: string;
  status: ReturnType<typeof useQuickStatus>;
}) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string>();
  const live = enabled && status?.registered;

  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(false);
        setHint(undefined);
        return;
      }
      const result = recordShortcut(event, mac);
      if (result.status === "invalid") setHint(result.reason);
      if (result.status === "ok") {
        setRecording(false);
        setHint(undefined);
        void setQuickConfig({ shortcut: result.accelerator, enabled: true });
      }
    };
    // Capture phase, so nothing else on the page reacts to the keys.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording]);

  return (
    <SettingsGroup title="Shortcut">
      <SettingRow
        icon={<PowerIcon />}
        htmlFor="quick-enabled"
        label={
          <span className="flex flex-wrap items-center gap-2">
            Open the Quick bar with a shortcut
            {!enabled ? (
              <StatusPill tone="neutral">Off</StatusPill>
            ) : live ? (
              <StatusPill tone="success">Ready</StatusPill>
            ) : status ? (
              <StatusPill tone="danger">Not working</StatusPill>
            ) : (
              <StatusPill tone="pending">Starting…</StatusPill>
            )}
          </span>
        }
        description="Works from any app, even when Mali is in the background."
        control={
          <Switch
            id="quick-enabled"
            checked={enabled}
            onCheckedChange={(on) => void setQuickConfig({ enabled: on })}
          />
        }
      >
        {enabled && status && !status.registered && status.error && (
          <Notice tone="danger" title="The shortcut isn't active">
            {status.error}. Try a different combination.
          </Notice>
        )}
      </SettingRow>
      <SettingRow
        icon={<KeyboardIcon />}
        label="Keyboard shortcut"
        description={
          recording ? (
            <span className={cn(hint && "text-red-600 dark:text-red-400")}>
              {hint ?? "Press the new key combination… (Esc to cancel)"}
            </span>
          ) : (
            "Click Change, then press the keys you want."
          )
        }
        className={cn(!enabled && "opacity-60")}
        control={
          <>
            {recording ? (
              <span className="flex h-8 items-center rounded-md border border-dashed border-primary/60 px-3 text-xs text-primary">
                Recording…
              </span>
            ) : (
              <span className="flex items-center gap-1" aria-label={`Shortcut ${shortcut}`}>
                {shortcutKeys(shortcut, mac).map((key, i) => (
                  <Keycap key={`${key}-${i}`}>{key}</Keycap>
                ))}
              </span>
            )}
            <Button
              variant={recording ? "secondary" : "outline"}
              size="sm"
              onClick={() => {
                setHint(undefined);
                setRecording((r) => !r);
              }}
            >
              {recording ? "Cancel" : "Change"}
            </Button>
            {shortcut !== DEFAULT_QUICK_CONFIG.shortcut && !recording && (
              <Button
                variant="ghost"
                size="icon-sm"
                title={`Reset to ${shortcutKeys(DEFAULT_QUICK_CONFIG.shortcut, mac).join(mac ? "" : "+")}`}
                aria-label="Reset shortcut"
                onClick={() => void setQuickConfig({ shortcut: DEFAULT_QUICK_CONFIG.shortcut, enabled: true })}
              >
                <RotateCcwIcon />
              </Button>
            )}
          </>
        }
      />
    </SettingsGroup>
  );
}

function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-border/80 border-b-2 bg-background px-1.5 font-sans text-xs font-medium text-foreground">
      {children}
    </kbd>
  );
}
