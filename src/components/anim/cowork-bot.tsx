"use client";

import { useChatRuns, useChatSessions } from "@/features/chat-history";
import {
  BOTS,
  setCoworkBot,
  useCoworkBot,
  type BotState,
  type CoworkBotId,
} from "@/features/cowork-bot";
import { cn } from "@/lib/utils";
import { CheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * The selected cowork bot, rendered from public/anim/cowork-bots.html
 * (kept 100% intact, driven through postMessage like BotFace).
 */
export function CoworkBot({
  size = 28,
  bot: botProp,
  state: stateProp,
  className,
  title,
}: {
  size?: number;
  bot?: CoworkBotId;
  /** Defaults to the global agent state (titlebar); pass explicitly in messages. */
  state?: BotState;
  className?: string;
  title?: string;
}) {
  const { bot: stored } = useCoworkBot();
  const globalState = useGlobalAgentState();
  const bot = botProp ?? stored;
  const state = stateProp ?? globalState;
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ state }, "*");
  }, [state, bot]);

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
        key={bot}
        src={`/anim/cowork-bots.html?embed=${bot}&shadow=0&state=${state}`}
        title={title ?? "Cowork bot"}
        loading="lazy"
        scrolling="no"
        tabIndex={-1}
        onLoad={() => frameRef.current?.contentWindow?.postMessage({ state }, "*")}
        style={{ width: "100%", height: "100%", border: 0, display: "block", background: "transparent", overflow: "hidden", pointerEvents: "none" }}
      />
    </div>
  );
}

/**
 * Follows the agent across every chat: no run → idle, streaming text →
 * thinking, tool steps running → working, and a short "done" celebration
 * when the last run finishes.
 */
export function useGlobalAgentState(): BotState {
  const runs = useChatRuns();
  const sessions = useChatSessions();
  const runIds = Object.keys(runs);
  const [, setTick] = useState(0);
  const finishing = useRef<{ timer?: ReturnType<typeof setTimeout>; hadRun: boolean }>({ hadRun: false });

  // A run just ended → celebrate, then settle back to idle.
  useEffect(() => {
    if (runIds.length > 0) {
      finishing.current.hadRun = true;
      if (finishing.current.timer) {
        clearTimeout(finishing.current.timer);
        finishing.current.timer = undefined;
      }
      return;
    }
    if (!finishing.current.hadRun) return;
    finishing.current.hadRun = false;
    finishing.current.timer = setTimeout(() => {
      finishing.current.timer = undefined;
      // Trigger a re-render so idle is returned below.
      window.dispatchEvent(new CustomEvent("cowork-bot-settled"));
    }, 2300);
    return () => {
      if (finishing.current.timer) {
        clearTimeout(finishing.current.timer);
        finishing.current.timer = undefined;
      }
    };
  }, [runIds.length]);

  // Re-render when the celebration window closes.
  useEffect(() => {
    const onSettled = () => setTick((t) => t + 1);
    window.addEventListener("cowork-bot-settled", onSettled);
    return () => window.removeEventListener("cowork-bot-settled", onSettled);
  }, []);

  if (runIds.length === 0) {
    return finishing.current.timer ? "done" : "idle";
  }
  const session = sessions.find((s) => s.id === runIds[0]);
  const lastAssistant = [...(session?.messages ?? [])].reverse().find((m) => m.role === "assistant");
  const busyTool = lastAssistant?.activities?.some((a) => !a.done);
  return busyTool ? "working" : "thinking";
}

/** Bot picker: four live previews, the choice persists in localStorage. */
export function CoworkBotPicker({ onPicked }: { onPicked?: () => void }) {
  const { bot } = useCoworkBot();
  return (
    <div className="flex flex-col gap-1">
      <p className="px-1 text-xs font-medium text-muted-foreground">เลือกน้อง bot</p>
      <div className="grid grid-cols-2 gap-1">
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
              <CoworkBot size={56} bot={b.id} state="idle" />
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
