"use client";

// Not the feature index: that pulls in chat history, which the notch window must not load.
import { resolveBot } from "@/features/bot-studio/resolve";
import { useBotStudio } from "@/features/bot-studio/store";
import {
  BOTS,
  setCoworkBot,
  useCoworkBot,
  type BotChoice,
  type BotState,
} from "@/features/cowork-bot";
import { cn } from "@/lib/utils";
import { CheckIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, type RefObject } from "react";

export const EMBED_VERSION = "14";

/**
 * Who the animation draws: a built-in bot by name, or a Studio bot as its
 * design (the same engine, so the same poses).
 */
export function botEmbed(bot: BotChoice, studio: Parameters<typeof resolveBot>[1]) {
  const { mascot, preset } = resolveBot(bot, studio);
  return preset ? designEmbed(preset) : mascot;
}

type Design = NonNullable<ReturnType<typeof resolveBot>["preset"]>;

function designEmbed(design: Design) {
  return `custom&preset=${encodeURIComponent(JSON.stringify(design))}`;
}

export function botFrameSrc(embed: string, state: BotState, theme: "light" | "dark") {
  return `/anim/cowork-bots.html?embed=${embed}&shadow=0&state=${state}&theme=${theme}&v=${EMBED_VERSION}`;
}

/**
 * The selected cowork bot, rendered from public/anim/cowork-bots.html
 * (kept 100% intact, driven through postMessage like BotFace).
 */
export function CoworkBot({
  size = 28,
  bot: botProp,
  state = "idle",
  className,
  title,
  theme: themeProp,
  paused = false,
  design,
  level,
}: {
  /** Pixels, or a CSS length such as "100%" to fill a parent that animates its size. */
  size?: number | string;
  bot?: BotChoice;
  state?: BotState;
  className?: string;
  title?: string;
  /** Draw for this background whatever the app's theme (the notch is always dark). */
  theme?: "light" | "dark";
  /** Stop drawing (a bot kept mounted but hidden): its animation loop rests. */
  paused?: boolean;
  /** Draw this design instead (Bot Studio's preview, before it's saved). */
  design?: Design;
  /** A voice to follow (0–1, read each frame) while listening or speaking; without one the bot makes up its own. */
  level?: RefObject<number>;
}) {
  const { bot: stored } = useCoworkBot();
  const { bots: studio } = useBotStudio();
  const bot = botProp ?? stored;
  // A Studio bot's design (it changes as the bot grows); the frame reloads only when it does.
  const embed = design ? designEmbed(design) : botEmbed(bot, studio);
  const { resolvedTheme } = useTheme();
  const theme = themeProp ?? (resolvedTheme === "dark" ? "dark" : "light");
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ state }, "*");
  }, [state, embed]);
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ paused }, "*");
  }, [paused, embed]);
  // Hand the voice level over each frame it moves, and now and then while it holds
  // (the bot makes up its own rhythm once none has come for a moment).
  useEffect(() => {
    if (!level || paused) return;
    let frame = 0;
    let sent = -1;
    let sentAt = 0;
    const tick = (now: number) => {
      const value = Math.round((level.current ?? 0) * 100) / 100;
      if (value !== sent || now - sentAt > 200) {
        frameRef.current?.contentWindow?.postMessage({ level: value }, "*");
        sent = value;
        sentAt = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [level, paused, embed]);

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        overflow: "hidden",
        background: "transparent",
        // Purely visual: never swallow clicks from a parent button/popover.
        pointerEvents: "none",
      }}
      aria-hidden={title ? undefined : true}
      title={title}
      role={title ? "img" : undefined}
      aria-label={title}
    >
      <iframe
        ref={frameRef}
        data-cowork-bot=""
        key={`${embed}-${theme}`}
        src={botFrameSrc(embed, state, theme)}
        title={title ?? "Cowork bot"}
        scrolling="no"
        tabIndex={-1}
        onLoad={() => frameRef.current?.contentWindow?.postMessage({ state, paused }, "*")}
        style={{
          width: "100%",
          height: "100%",
          border: 0,
          display: "block",
          background: "transparent",
          colorScheme: "normal",
          overflow: "hidden",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/** Bot picker: one live preview per bot, the choice persists in localStorage. Bots made in Bot Studio come after the built-in ones. */
export function CoworkBotPicker({ onPicked }: { onPicked?: () => void }) {
  const { bot } = useCoworkBot();
  const { bots: studio } = useBotStudio();
  const choices: { id: BotChoice; name: string; color: string; level?: number }[] = [
    ...BOTS.map((b) => ({ id: b.id as BotChoice, name: b.name, color: b.color })),
    ...studio.map((b) => ({
      id: `custom:${b.id}` as const,
      name: b.name,
      color: b.look.color,
      level: b.level,
    })),
  ];
  return (
    <div className="flex flex-col gap-3">
      <p className="px-0.5 text-sm font-semibold tracking-tight ">Select a bot</p>
      <div className="grid grid-cols-4 gap-2">
        {choices.map((b) => {
          const active = b.id === bot;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setCoworkBot(b.id);
                onPicked?.();
              }}
              aria-pressed={active}
              aria-label={b.name}
              className={cn(
                "flex flex-col items-center gap-2 rounded-2xl px-1.5 py-2.5 transition-[background-color,box-shadow] duration-300",
                active ? "bg-muted/55 shadow-sm" : "hover:bg-muted/35",
              )}
              style={
                active
                  ? { boxShadow: `0 0 0 2px ${b.color}55, 0 1px 2px rgb(0 0 0 / 0.06)` }
                  : undefined
              }
            >
              <CoworkBot size={48} bot={b.id} state="idle" paused={!active} />
              <span className="flex min-w-0 max-w-full flex-col items-center gap-0.5">
                <span className="flex items-center justify-center gap-1.5 text-xs font-semibold">
                  <span className="size-2 shrink-0 rounded-full ring-1 ring-black/5" style={{ background: b.color }} />
                  <span className="truncate">{b.name}</span>
                  {active && <CheckIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
                </span>
                {b.level != null && (
                  <span className="text-[10px] font-medium tabular-nums text-muted-foreground">Lv{b.level}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
