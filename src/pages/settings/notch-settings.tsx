/**
 * Settings → Notch: the pill at the top of the screen — when it shows, what
 * it keeps, which screen it lives on, and starting Mali in it at login.
 */
import { CoworkBot } from "@/components/anim/cowork-bot";
import { useCustomClis } from "@/features/custom-cli";
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
import { isMacPlatform, setQuickConfig, shortcutKeys, useQuickConfig, useQuickStatus } from "@/features/quick";
import { isTauri } from "@tauri-apps/api/core";
import { ModelPicker } from "@/pages/chat/components/model-picker";
import { buildModelCatalog, loadSelectedModelId, OPENCODE_DEFAULT_ID, type AiModel } from "@/pages/chat/models";
import { Button } from "@/components/ui/button";
import {
  ActivityIcon,
  CheckIcon,
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
import { Notice, SectionHeader, Segmented, SettingRow, SettingsGroup, SettingsPage } from "./ui";
import { cn } from "@/lib/utils";

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
  const customClis = useCustomClis();

  const catalog = useMemo(
    () =>
      buildModelCatalog(
        opencode.models,
        listConfiguredProviders(providerConfigs, envKeys),
        "chat",
        { models: cursor.models, loggedIn: !!cursor.check?.loggedIn },
        { models: [], loggedIn: false },
        { models: antigravity.models, loggedIn: !!antigravity.check?.loggedIn },
        customClis,
      ),
    [opencode.models, providerConfigs, envKeys, cursor, antigravity, customClis],
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
    <SettingsPage>
      <SectionHeader
        title="Notch"
        description="A small pill at the top of the screen: what the agent is doing, approvals you can answer in place, and a place to ask without opening the app."
      />
      <div className="pb-7">
        <NotchPreview look={look} glassBlur={glassBlur} />
      </div>

      <SettingsGroup title="Showing" description="When the pill appears, and keeping Mali around in the background.">
        <SettingRow
          icon={<ActivityIcon />}
          htmlFor="notch-enabled"
          label="Show agent status at the top of the screen"
          description="While Mali is in the background, the pill shows the agent’s step and lets you Allow or Deny without switching windows."
          control={<Switch id="notch-enabled" checked={enabled} onCheckedChange={setNotchEnabled} />}
        />
        <LoginRow />
        <SettingRow
          icon={<MonitorIcon />}
          htmlFor="notch-tray"
          label={mac ? "Keep running in the menu bar" : "Keep running in the system tray"}
          description="Closing the main window keeps Mali running, so the shortcut still works."
          control={
            <Switch id="notch-tray" checked={quickConfig.trayMode} onCheckedChange={(trayMode) => void setQuickConfig({ trayMode })} />
          }
        />
      </SettingsGroup>

      <GlobalShortcutGroup mac={mac} enabled={quickConfig.enabled} shortcut={quickConfig.shortcut} status={quickStatus} />

      <SettingsGroup title="Look & place" description="Folded up it always stays black; open, it can be light.">
        <div className="flex flex-col gap-3 py-3.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            <PaletteIcon className="size-4 text-muted-foreground" /> Look
          </span>
          <div role="radiogroup" aria-label="Notch look" className="grid max-w-md grid-cols-2 gap-3">
            {LOOKS.map((option) => (
              <LookCard
                key={option.value}
                look={option.value}
                label={option.label}
                on={(look === "glass" ? "black" : look) === option.value}
                onPick={() => setNotchLook(option.value)}
              />
            ))}
          </div>
        </div>
        <SettingRow
          icon={<LaptopIcon />}
          label="Screen"
          description="With more than one screen: follow the pointer, or stay on the Mac’s own display (with the notch) or the main one (with the menu bar)."
          control={<Segmented label="Screen for the notch" value={screen} onChange={setNotchScreenPref} options={SCREENS} />}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Quick asks"
        description={`Press ${shortcutKeys(quickConfig.shortcut, mac).join(mac ? "" : "+")} anywhere, or move the pointer to the top of the screen in notch mode, to ask without opening the app.`}
      >
        <SettingRow
          icon={<SparklesIcon />}
          label="Answer with"
          description={
            followsChat
              ? "Following the model picked on the Chat page."
              : "A fixed model for the notch; changing the Chat page’s model doesn’t affect it."
          }
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
              <div className="w-full sm:w-60">
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
        <SettingRow
          icon={<HistoryIcon />}
          htmlFor="notch-save"
          label="Save what you ask"
          description="Off for quick questions you don’t need to keep; on, each conversation becomes a chat you can continue in the app."
          control={<Switch id="notch-save" checked={save} onCheckedChange={setNotchSaveChats} />}
        />
        <SettingRow
          icon={<MousePointer2Icon />}
          label="Capture a window"
          description="Drag the bot out of the notch onto any window to ask about it, or use the camera button."
        />
      </SettingsGroup>
    </SettingsPage>
  );
}

/** The pill's look, as a small picture of it open. */
function LookCard({ look, label, on, onPick }: { look: NotchLook; label: string; on: boolean; onPick: () => void }) {
  const light = look === "light";
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onPick} className="group flex flex-col gap-2 text-left outline-none">
      <span
        className={cn(
          "relative flex h-20 justify-center overflow-hidden rounded-xl border bg-gradient-to-b from-muted/70 to-card transition-[border-color,box-shadow]",
          on ? "border-violet-500 ring-2 ring-violet-500/30" : "border-border group-hover:border-foreground/30",
        )}
      >
        <span
          className="flex h-12 w-[70%] items-center gap-2 rounded-b-2xl px-3 shadow-[0_10px_24px_-12px_rgba(0,0,0,0.6)]"
          style={{ background: light ? "#fff" : "#000" }}
        >
          <span className="size-5 shrink-0 rounded-full bg-violet-500/80" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="block h-1.5 w-1/2 rounded-full" style={{ background: light ? "#16161b" : "#fff", opacity: 0.8 }} />
            <span className="block h-2.5 w-full rounded-full" style={{ background: light ? "#0001" : "#fff2" }} />
          </span>
        </span>
      </span>
      <span className="flex items-center gap-1.5 px-0.5 text-[13px] font-medium">
        {label}
        {on && <CheckIcon className="ml-auto size-3.5 text-violet-600 dark:text-violet-400" strokeWidth={3} />}
      </span>
    </button>
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
      className="relative flex h-48 justify-center overflow-hidden rounded-2xl border border-border/60"
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
