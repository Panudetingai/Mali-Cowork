/**
 * Settings → Notch: the pill at the top of the screen — when it shows, what
 * it keeps, which screen it lives on, and starting Mali in it at login.
 */
import { CoworkBot } from "@/components/anim/cowork-bot";
import { Switch } from "@/components/ui/switch";
import { BOTS, useCoworkBot } from "@/features/cowork-bot";
import {
  getNotchLoginItem,
  setNotchEnabled,
  setNotchLoginItem,
  glassBlurVisuals,
  setNotchGlassBlur,
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
import { isMacPlatform } from "@/features/quick";
import { isTauri } from "@tauri-apps/api/core";
import {
  ActivityIcon,
  DropletsIcon,
  HistoryIcon,
  KeyboardIcon,
  LaptopIcon,
  LogInIcon,
  MousePointer2Icon,
  PaletteIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { SectionHeader, Segmented, SettingRow, SettingsGroup } from "./ui";

const mac = isMacPlatform();

const LOOKS: { value: NotchLook; label: string }[] = [
  { value: "black", label: "Black" },
  { value: "glass", label: "Glass" },
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
  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        title="Notch"
        description="A small pill at the top of the screen: what the agent is doing, approvals you can answer in place, and a place to ask without opening the app."
      />
      <NotchPreview look={look} glassBlur={glassBlur} />

      <SettingsGroup title="Showing">
        <SettingRow
          icon={<ActivityIcon />}
          htmlFor="notch-enabled"
          label="Show agent status at the top of the screen"
          description="While Mali is in the background, the pill shows the step the agent is on and lets you Allow or Deny without switching windows."
          control={<Switch id="notch-enabled" checked={enabled} onCheckedChange={setNotchEnabled} />}
        />
        <SettingRow
          icon={<LaptopIcon />}
          label="Screen"
          description="With more than one screen: follow the pointer to the one you're working on, or stay on the Mac's own display (with the notch) or the main one (with the menu bar)."
          control={
            <Segmented label="Screen for the notch" value={screen} onChange={setNotchScreenPref} options={SCREENS} />
          }
        />
        <SettingRow
          icon={<PaletteIcon />}
          label="Look"
          description={`How the pill looks when it opens: the notch's own black, frosted glass${mac ? " that blurs what's behind it" : ""}, or light. Folded up, it stays black — part of the notch.`}
          control={<Segmented label="Notch look" value={look} onChange={setNotchLook} options={LOOKS} />}
        />
        {look === "glass" && (
          <SettingRow
            icon={<DropletsIcon />}
            htmlFor="notch-glass-blur"
            label="Glass blur"
            description="How strongly the pill frosts what's behind it when open. Turn it down if the desktop feels too soft; up for a heavier glass look."
            control={
              <div className="flex w-full min-w-[11rem] max-w-xs flex-col gap-1.5 sm:items-end">
                <input
                  id="notch-glass-blur"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={glassBlur}
                  onChange={(e) => setNotchGlassBlur(Number(e.target.value))}
                  className="h-2 w-full cursor-pointer accent-foreground"
                  aria-valuetext={`${glassBlur}% blur`}
                />
                <span className="text-xs tabular-nums text-muted-foreground">{glassBlur}%</span>
              </div>
            }
          />
        )}
        <LoginRow />
      </SettingsGroup>

      <SettingsGroup
        title="Asking in the notch"
        footer={`Open it with ${mac ? "⌥⌘M" : "the Quick bar shortcut"} in notch mode, or move the pointer to the top of the screen. The button at the top of the main window puts Mali into notch mode.`}
      >
        <SettingRow
          icon={<HistoryIcon />}
          htmlFor="notch-save"
          label="Save what you ask"
          description="Off for quick questions you don't need to keep; on, each conversation becomes a chat you can continue in the app."
          control={<Switch id="notch-save" checked={save} onCheckedChange={setNotchSaveChats} />}
        />
        <SettingRow
          icon={<KeyboardIcon />}
          label="Open the ask box"
          description="In notch mode the Quick bar's shortcut opens the notch instead, ready to type."
          control={
            <kbd className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
              {mac ? "⌥ ⌘ M" : "Alt Ctrl M"}
            </kbd>
          }
        />
        <SettingRow
          icon={<MousePointer2Icon />}
          label="Capture a window"
          description="Drag the bot out of the notch onto any window to ask about it, or use the camera button."
        />
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
      control={<Switch id="notch-login" checked={!!on} disabled={on === undefined} onCheckedChange={change} />}
    />
  );
}

/** The pill as it looks: hanging from the top edge, opening now and then to show it's there to ask. */
function NotchPreview({ look, glassBlur }: { look: NotchLook; glassBlur: number }) {
  const { bot } = useCoworkBot();
  const color = BOTS.find((b) => b.id === bot)?.color ?? "#3aa3f5";
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
                  background: "linear-gradient(#000 22px, rgba(250,250,252,0.86) 44px)",
                  color: "#16161b",
                  ["--color-white" as string]: "#16161b",
                }
        }
        initial={false}
        animate={
          open
            ? { width: 300, height: 104, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 }
            : { width: 168, height: 24, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 }
        }
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      >
        <motion.div
          className="absolute"
          initial={false}
          animate={open ? { x: 18, y: 34, width: 56, height: 56 } : { x: 6, y: 2, width: 20, height: 20 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        >
          <CoworkBot size="100%" bot={bot} state={open ? "welcome" : "idle"} theme="dark" />
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
