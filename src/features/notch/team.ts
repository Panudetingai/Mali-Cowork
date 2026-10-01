/**
 * The team as the notch shows it: the bots on the user's team, to pick one
 * and ask it directly. Read straight from storage (the main window owns the
 * team and writes it there), and again whenever it changes.
 */
import { BOTS, BOT_IDS, type CoworkBotId } from "@/features/cowork-bot";
import type { QuickAction } from "@/features/quick";
import { useSyncExternalStore } from "react";

const KEY = "mali_team";

export type RosterBot = {
  id: string;
  name: string;
  mascot: CoworkBotId;
  color: string;
  /** Its duty in one sentence. */
  role: string;
  instructions: string;
  /** The model it runs on, as the picker spells it; empty for the Quick bar's. */
  modelId: string;
};

let raw: string | null | undefined;
let roster: RosterBot[] = [];

function read(): RosterBot[] {
  let next: string | null = null;
  try {
    next = localStorage.getItem(KEY);
  } catch {
    return roster;
  }
  if (next === raw) return roster;
  raw = next;
  roster = parse(next);
  return roster;
}

function parse(text: string | null): RosterBot[] {
  try {
    const value = text ? JSON.parse(text) : null;
    const mates: unknown[] = Array.isArray(value?.mates) ? value.mates : [];
    return mates.flatMap((m) => {
      const mate = m as Record<string, unknown>;
      if (typeof mate?.id !== "string" || typeof mate.name !== "string" || mate.onTeam === false) return [];
      const mascot = (BOT_IDS as readonly string[]).includes(mate.mascot as string)
        ? (mate.mascot as CoworkBotId)
        : "mochi";
      return [
        {
          id: mate.id,
          name: mate.name,
          mascot,
          color: BOTS.find((b) => b.id === mascot)?.color ?? "#8b8b8b",
          role: typeof mate.role === "string" ? mate.role : "",
          instructions: typeof mate.instructions === "string" ? mate.instructions : "",
          modelId: typeof mate.modelId === "string" ? mate.modelId : "",
        },
      ];
    });
  } catch {
    return [];
  }
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export function useTeamRoster() {
  return useSyncExternalStore(subscribe, read, () => roster);
}

/**
 * Asking one bot directly: it answers as itself, within its duty, on its own
 * model. The notch asks in Chat mode, so the bot's tools, skills and
 * connectors stay with team runs in the app.
 */
export function askAs(bot: RosterBot): { action: QuickAction; modelId?: string } {
  const how = bot.instructions.trim() ? `\n\nHow you work:\n${bot.instructions.trim()}` : "";
  return {
    action: {
      id: `bot:${bot.id}`,
      label: bot.name,
      prompt: `You are ${bot.name}, a bot on the user's Mali team. Your duty: ${bot.role || "help the user"}.${how}\n\nStay within your duty, and answer in the user's language.\n\nThe user asks:\n{input}`,
    },
    modelId: bot.modelId || undefined,
  };
}
