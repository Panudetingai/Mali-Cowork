"use client";

import {
  BOTS,
  setCoworkBot,
  useCoworkBot,
  type BotState,
  type CoworkBotId,
} from "@/features/cowork-bot";
import { cn } from "@/lib/utils";
import { CheckIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";

const EMBED_VERSION = "10";

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
}: {
  /** Pixels, or a CSS length such as "100%" to fill a parent that animates its size. */
  size?: number | string;
  bot?: CoworkBotId;
  state?: BotState;
  className?: string;
  title?: string;
  /** Draw for this background whatever the app's theme (the notch is always dark). */
  theme?: "light" | "dark";
  /** Stop drawing (a bot kept mounted but hidden): its animation loop rests. */
  paused?: boolean;
}) {
  const { bot: stored } = useCoworkBot();
  const bot = botProp ?? stored;
  const { resolvedTheme } = useTheme();
  const theme = themeProp ?? (resolvedTheme === "dark" ? "dark" : "light");
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ state }, "*");
  }, [state, bot]);
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ paused }, "*");
  }, [paused, bot]);

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
        key={`${bot}-${theme}`}
        src={`/anim/cowork-bots.html?embed=${bot}&shadow=0&state=${state}&theme=${theme}&v=${EMBED_VERSION}`}
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

/** Bot picker: one live preview per bot, the choice persists in localStorage. */
export function CoworkBotPicker({ onPicked }: { onPicked?: () => void }) {
  const { bot } = useCoworkBot();
  return (
    <div className="flex flex-col gap-1">
      <p className="px-1 text-xs font-medium text-muted-foreground">เลือกน้อง bot</p>
      <div className="grid grid-cols-4 gap-1">
        {BOTS.map((b) => {
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
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border p-2 transition-colors hover:bg-accent",
                active ? "border-foreground/30 bg-accent" : "border-transparent",
              )}
            >
              <CoworkBot size={44} bot={b.id} state="idle" />
              <span className="flex items-center gap-1 text-xs font-medium">
                <span className="size-2 rounded-full" style={{ background: b.color }} />
                {b.name}
                {active && <CheckIcon className="size-3 text-muted-foreground" />}
              </span>
              <span className="text-[10px] text-muted-foreground">{b.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
