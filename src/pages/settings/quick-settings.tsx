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
import { cn } from "@/lib/utils";
import { ModelPicker } from "@/pages/chat/components/model-picker";
import { buildModelCatalog, loadSelectedModelId, OPENCODE_DEFAULT_ID, type AiModel } from "@/pages/chat/models";
import {
  ClipboardIcon,
  HistoryIcon,
  KeyboardIcon,
  MonitorIcon,
  RotateCcwIcon,
  ScanIcon,
  SparklesIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { GroupLabel, IconTile, Notice, SectionHeader, SettingsSection, StatusPill } from "./ui";

const mac = isMacPlatform();

export function QuickSettings() {
  const config = useQuickConfig();
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
    <div className="flex flex-col gap-10">
      <SectionHeader
        title="Quick bar"
        description="A small window you can open over any app with a shortcut — ask, summarize or translate what you copied, then paste the answer back. It answers in Chat mode: no file access."
      />

      <ShortcutHero enabled={config.enabled} shortcut={config.shortcut} status={status} />

      <SettingsSection>
        <GroupLabel>Model</GroupLabel>
        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card p-4">
          <ModelPicker
            appearance="field"
            models={usable}
            selected={shown}
            loading={opencode.loading}
            onSelect={(model) => void setQuickConfig({ modelId: model.id })}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {followsChat
                ? "Following the model picked on the Chat page."
                : "Quick bar has its own model — the Chat page's choice doesn't change it."}
            </span>
            {!followsChat && (
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void setQuickConfig({ modelId: undefined })}>
                <RotateCcwIcon className="size-3.5" />
                Use the Chat page's model
              </Button>
            )}
          </div>
          {effective?.issue && (
            <Notice tone="warning" title="This model can't answer in the Quick bar">
              {effective.issue}. Pick a paid model or another provider above.
            </Notice>
          )}
        </div>
      </SettingsSection>

      <SettingsSection>
        <GroupLabel>Behavior</GroupLabel>
        <ul className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
          <ToggleRow
            icon={<MonitorIcon />}
            title={mac ? "Keep running in the menu bar" : "Keep running in the system tray"}
            description="Closing the main window keeps Mali running, so the shortcut still works. Quit from the tray icon."
            checked={config.trayMode}
            onChange={(trayMode) => void setQuickConfig({ trayMode })}
          />
          <ToggleRow
            icon={<HistoryIcon />}
            title="Save Quick bar chats to history"
            description="Each thread becomes a chat you can continue in the main window."
            checked={config.saveToHistory ?? DEFAULT_QUICK_CONFIG.saveToHistory}
            onChange={(saveToHistory) => void setQuickConfig({ saveToHistory })}
          />
        </ul>
      </SettingsSection>

      <SettingsSection>
        <GroupLabel>In the Quick bar</GroupLabel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <InfoTile icon={<ClipboardIcon />} title="Uses what you copied">
            The clipboard is read once, when you press the shortcut — never in the background.
          </InfoTile>
          <InfoTile icon={<SparklesIcon />} title="One-tap actions">
            <span className="flex flex-wrap gap-1 pt-0.5">
              {DEFAULT_QUICK_ACTIONS.map((action, i) => (
                <span key={action.id} className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-foreground">
                  {action.label} <span className="text-muted-foreground">{mac ? "⌘" : "Ctrl+"}{i + 1}</span>
                </span>
              ))}
            </span>
          </InfoTile>
          <InfoTile icon={<ScanIcon />} title="Capture screen">
            {mac
              ? "Drag over part of the screen to ask about it. macOS asks for Screen Recording the first time."
              : "Coming to Windows later."}
          </InfoTile>
        </div>
      </SettingsSection>
    </div>
  );
}

/** The shortcut up front: what to press, whether it works, and how to change it. */
function ShortcutHero({
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
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5",
        !enabled && "opacity-80",
      )}
    >
      <div className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-amber-400/10 blur-3xl" aria-hidden />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <IconTile className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <KeyboardIcon className="size-5 shrink-0" aria-hidden />
          </IconTile>
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Global shortcut</span>
              {!enabled ? (
                <StatusPill tone="neutral">Off</StatusPill>
              ) : live ? (
                <StatusPill tone="success">Ready</StatusPill>
              ) : status ? (
                <StatusPill tone="danger">Not working</StatusPill>
              ) : (
                <StatusPill tone="pending">Starting…</StatusPill>
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {enabled ? "Press it from any app to open the Quick bar." : "Turn it on to open the Quick bar from any app."}
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(on) => void setQuickConfig({ enabled: on })}
          aria-label="Enable the Quick bar shortcut"
        />
      </div>

      <div className="relative mt-5 flex flex-col items-center gap-4 rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-6">
        {recording ? (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyboardIcon className="size-4 animate-pulse text-amber-500" />
              Press the new shortcut…
            </div>
            <p className={cn("text-xs", hint ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
              {hint ?? "Esc to cancel"}
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-1.5" aria-label={`Shortcut ${shortcut}`}>
            {shortcutKeys(shortcut, mac).map((key, i) => (
              <Keycap key={`${key}-${i}`}>{key}</Keycap>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            variant={recording ? "secondary" : "outline"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => {
              setHint(undefined);
              setRecording((r) => !r);
            }}
          >
            <KeyboardIcon className="size-3.5" />
            {recording ? "Cancel" : "Change shortcut"}
          </Button>
          {shortcut !== DEFAULT_QUICK_CONFIG.shortcut && !recording && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-muted-foreground"
              onClick={() => void setQuickConfig({ shortcut: DEFAULT_QUICK_CONFIG.shortcut, enabled: true })}
            >
              <RotateCcwIcon className="size-3.5" />
              Reset to {shortcutKeys(DEFAULT_QUICK_CONFIG.shortcut, mac).join(mac ? "" : "+")}
            </Button>
          )}
        </div>
      </div>

      {enabled && status && !status.registered && status.error && (
        <div className="relative mt-4">
          <Notice tone="danger" title="The shortcut isn't active">
            {status.error}. Try a different combination.
          </Notice>
        </div>
      )}
    </div>
  );
}

function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-11 min-w-11 items-center justify-center rounded-xl border border-border/80 border-b-[3px] bg-background px-3 font-sans text-lg font-medium text-foreground shadow-xs">
      {children}
    </kbd>
  );
}

function ToggleRow({
  icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 p-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
        </span>
        <Switch checked={checked} onCheckedChange={onChange} />
      </label>
    </li>
  );
}

function InfoTile({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-card p-4">
      <span className="flex size-8 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground [&_svg]:size-4">
        {icon}
      </span>
      <span className="text-sm font-medium">{title}</span>
      <div className="text-xs leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}
