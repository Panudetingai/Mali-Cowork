/**
 * Settings → Notch: the pill at the top of the screen — when it shows, what
 * it keeps, which screen it lives on, and starting Mali in it at login.
 */
import { CoworkBot } from "@/components/anim/cowork-bot";
import { useResolvedBot } from "@/features/bot-studio/resolve";
import { Switch } from "@/components/ui/switch";
import { useCoworkBot } from "@/features/cowork-bot";
import {
  getNotchLoginItem,
  glassBlurVisuals,
  setNotchEnabled,
  setNotchLoginItem,
  setNotchLook,
  setNotchSaveChats,
  setNotchScreenPref,
  useNotchEnabled,
  useNotchGlassBlur,
  useNotchLook,
  useNotchSaveChats,
  useNotchScreen,
  type NotchLook,
  type NotchScreen,
} from "@/features/notch";
import { useAntigravity } from "@/features/antigravity";
import { useCursor } from "@/features/cursor";
import { useOpencode } from "@/features/opencode";
import { listConfiguredProviders, useEnvKeys, useProviderConfigs } from "@/features/providers";
import { isMacPlatform, setQuickConfig, useQuickConfig, useQuickStatus } from "@/features/quick";
import { isTauri } from "@tauri-apps/api/core";
import { ModelPicker } from "@/pages/chat/components/model-picker";
import { buildModelCatalog, loadSelectedModelId, OPENCODE_DEFAULT_ID, type AiModel } from "@/pages/chat/models";
import { Button } from "@/components/ui/button";
import {
  ActivityIcon,
  HistoryIcon,
  LaptopIcon,
  LogInIcon,
  MonitorIcon,
  MousePointer2Icon,
  PaletteIcon,
  RotateCcwIcon,
  SparklesIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { GlobalShortcutGroup } from "./global-shortcut-group";
import { Notice, SectionHeader, Segmented, SettingRow, SettingsGroup } from "./ui";

const mac = isMacPlatform();

const LOOKS: { value: NotchLook; label: string }[] = [
  { value: "black", label: "Black" },
  { value: "light", label: "Light" },
];

const SCREENS: { value: NotchScreen; label: string }[] = [
  { value: "follow", label: "Follow pointer" },
  { value: "builtin", label: mac ? "Mac display" : "Built-in" },
  { value: "main", label: "Main display" },
];

export function NotchSettings() {
  const enabled = useNotchEnabled();
  const save = useNotchSaveChats();
  const screen = useNotchScreen();
  const look = useNotchLook();
  const glassBlur = useNotchGlassBlur();
  const quickConfig = useQuickConfig();
  const quickStatus = useQuickStatus();
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
        { models: [], loggedIn: false },
        { models: antigravity.models, loggedIn: !!antigravity.check?.loggedIn },
      ),
    [opencode.models, providerConfigs, envKeys, cursor, antigravity],
  );

  const followsChat = !quickConfig.modelId;
  const effectiveId = quickConfig.modelId ?? loadSelectedModelId("chat");
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
        title="Notch"
        description="A small pill at the top of the screen: what the agent is doing, approvals you can answer in place, and a place to ask without opening the app."
      />
      <GlobalShortcutGroup
        mac={mac}
        enabled={quickConfig.enabled}
        shortcut={quickConfig.shortcut}
        status={quickStatus}
      />
      <NotchPreview look={look} glassBlur={glassBlur} />

      <SettingsGroup title="Showing">
        <SettingRow
          icon={<ActivityIcon />}
          htmlFor="notch-enabled"
          label="Show agent status at the top of the screen"
          description="While Mali is in the background, the pill shows the step the agent is on and lets you Allow or Deny without switching windows."
          control={
            <Switch
              id="notch-enabled"
              checked={enabled}
              onCheckedChange={setNotchEnabled}
            />
          }
        />
        <SettingRow
          icon={<LaptopIcon />}
          label="Screen"
          description="With more than one screen: follow the pointer to the one you're working on, or stay on the Mac's own display (with the notch) or the main one (with the menu bar)."
          control={
            <Segmented
              label="Screen for the notch"
              value={screen}
              onChange={setNotchScreenPref}
              options={SCREENS}
            />
          }
        />
        <SettingRow
          icon={<PaletteIcon />}
          label="Look"
          description="How the pill looks when it opens: black, or light — the same layout with the colors reversed. Folded up, it stays black."
          control={
            <Segmented
              label="Notch look"
              value={look === "glass" ? "black" : look}
              onChange={setNotchLook}
              options={LOOKS}
            />
          }
        />
        <LoginRow />
      </SettingsGroup>

      <SettingsGroup
        title="Asking in the notch"
        footer={`Press ${mac ? "⌥⌘M" : "Ctrl+Alt+M"} from anywhere to open the ask box, or move the pointer to the top of the screen in notch mode. The button at the top of the main window puts Mali into notch mode.`}
      >
        <SettingRow
          icon={<HistoryIcon />}
          htmlFor="notch-save"
          label="Save what you ask"
          description="Off for quick questions you don't need to keep; on, each conversation becomes a chat you can continue in the app."
          control={
            <Switch
              id="notch-save"
              checked={save}
              onCheckedChange={setNotchSaveChats}
            />
          }
        />
        <SettingRow
          icon={<MonitorIcon />}
          htmlFor="notch-tray"
          label={mac ? "Keep running in the menu bar" : "Keep running in the system tray"}
          description="Closing the main window keeps Mali running, so the shortcut still works."
          control={
            <Switch
              id="notch-tray"
              checked={quickConfig.trayMode}
              onCheckedChange={(trayMode) => void setQuickConfig({ trayMode })}
            />
          }
        />
        <SettingRow
          icon={<MousePointer2Icon />}
          label="Capture a window"
          description="Drag the bot out of the notch onto any window to ask about it, or use the camera button."
        />
      </SettingsGroup>

      <SettingsGroup
        title="Model for quick asks"
        footer={
          followsChat
            ? "Following the model picked on the Chat page."
            : "A fixed model for questions in the notch; changing the Chat page's model doesn't affect it."
        }
      >
        <SettingRow
          icon={<SparklesIcon />}
          label="Answer with"
          description="The model used when you ask from the notch (Chat mode, no files on disk)."
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
            <Notice tone="warning" title="This model can't answer from the notch">
              {effective.issue}. Pick a paid model or another provider.
            </Notice>
          )}
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}

/** Mali starts with the computer, in the notch; the app opens only when asked for. */
function LoginRow() {
  const [on, setOn] = useState<boolean>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!isTauri()) return;
    void getNotchLoginItem()
      .then(setOn)
      .catch(() => setOn(false));
  }, []);
  const change = (next: boolean) => {
    setOn(next);
    setError(undefined);
    void setNotchLoginItem(next).catch((e) => {
      setOn(!next);
      setError(String(e));
    });
  };
  return (
    <SettingRow
      icon={<LogInIcon />}
      htmlFor="notch-login"
      label="Start at login, in the notch"
      description={
        error ??
        "Mali starts with your computer and waits in the notch. Open the app only when you want it — it drops out of the notch into the middle of the screen."
      }
      control={
        <Switch
          id="notch-login"
          checked={!!on}
          disabled={on === undefined}
          onCheckedChange={change}
        />
      }
    />
  );
}

/** The pill as it looks: hanging from the top edge, opening now and then to show it's there to ask. */
function NotchPreview({
  look,
  glassBlur,
}: {
  look: NotchLook;
  glassBlur: number;
}) {
  const { bot } = useCoworkBot();
  const color = useResolvedBot(bot).color;
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const glass = look === "glass" ? glassBlurVisuals(glassBlur) : undefined;
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setOpen((o) => !o), 2600);
    return () => clearInterval(timer);
  }, [reduced]);
  return (
    <div
      aria-hidden
      className="relative flex h-44 justify-center overflow-hidden rounded-xl border border-border/70"
      style={{
        background: `radial-gradient(120% 90% at 50% 0%, ${color}22, transparent 60%), linear-gradient(180deg, color-mix(in srgb, var(--muted) 70%, transparent), var(--card))`,
      }}
    >
      {/* The menu bar the pill hangs from. */}
      <div className="absolute inset-x-0 top-0 h-6 bg-foreground/[0.04]" />
      <motion.div
        className="relative mt-0 flex overflow-hidden shadow-[0_18px_40px_-14px_rgba(0,0,0,0.7)]"
        style={
          look === "black" || !open
            ? { background: "#000", color: "#fff" }
            : look === "glass"
              ? {
                  background: `linear-gradient(rgba(8,8,12,${glass!.hoodAlpha}) 22px, rgba(12,12,16,${glass!.tintAlpha}) 44px)`,
                  color: "#fff",
                  backdropFilter: `blur(${glass!.blurPx}px) saturate(150%)`,
                  WebkitBackdropFilter: `blur(${glass!.blurPx}px) saturate(150%)`,
                }
              : {
                  background: "#ffffff",
                  color: "#16161b",
                  ["--color-white" as string]: "#16161b",
                  ["--color-black" as string]: "#ffffff",
                }
        }
        initial={false}
        animate={
          open
            ? {
                width: 300,
                height: 104,
                borderBottomLeftRadius: 24,
                borderBottomRightRadius: 24,
              }
            : {
                width: 168,
                height: 24,
                borderBottomLeftRadius: 10,
                borderBottomRightRadius: 10,
              }
        }
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      >
        <motion.div
          className="absolute"
          initial={false}
          animate={
            open
              ? { x: 18, y: 34, width: 56, height: 56 }
              : { x: 6, y: 2, width: 20, height: 20 }
          }
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        >
          <CoworkBot
            size="100%"
            bot={bot}
            state={open ? "welcome" : "idle"}
            theme="dark"
          />
        </motion.div>
        <motion.div
          className="absolute top-9 right-5 left-[92px] flex flex-col gap-1.5"
          initial={false}
          animate={{ opacity: open ? 1 : 0, y: open ? 0 : -6 }}
          transition={{ duration: 0.25, delay: open ? 0.12 : 0 }}
        >
          <span className="text-[13px] font-semibold">Ask Mali</span>
          <span className="h-6 rounded-full bg-white/[0.08] px-3 text-[11px] leading-6 text-white/45">
            Ask anything, or drop a file…
          </span>
        </motion.div>
        <motion.span
          className="absolute top-[9px] right-2.5 size-1.5 rounded-full"
          style={{ background: color }}
          initial={false}
          animate={{ opacity: open ? 0 : 1 }}
        />
      </motion.div>
    </div>
  );
}
