import { createStore } from "@/lib/local-store";

export const BOT_IDS = ["mochi", "jelly", "petal", "nori", "sora", "momo", "mikan", "ichigo"] as const;

export type CoworkBotId = (typeof BOT_IDS)[number];

/** The app's bot: a built-in one, or one designed in Bot Studio (`custom:<id>`). */
export type BotChoice = CoworkBotId | `custom:${string}`;

export function customIdOf(choice: BotChoice | undefined) {
  return choice?.startsWith("custom:") ? choice.slice(7) : undefined;
}

/**
 * Poses the bot animation understands (public/anim/cowork-bots.html).
 * `done` plays its celebration and falls back to `idle` on its own.
 */
export type BotState =
  | "idle"
  | "thinking"
  | "working"
  | "done"
  | "alert"
  | "welcome"
  | "tool"
  | "connection"
  | "permission"
  | "question"
  // Voice chat: ears up while you talk; a mouth that moves with Mali's voice.
  | "listening"
  | "speaking";

export const BOTS: { id: CoworkBotId; name: string; color: string; hint: string }[] = [
  { id: "mochi", name: "Mochi", color: "#f5c518", hint: "ลูกเจี๊ยบ · เด้งคลื่น" },
  { id: "jelly", name: "Jelly", color: "#34c77b", hint: "ต้นอ่อน · กระโดด" },
  { id: "petal", name: "Petal", color: "#8b5cf6", hint: "กระต่าย · หมุนรอบตัว" },
  { id: "nori", name: "Nori", color: "#2a2a33", hint: "แมวดำ · เลื้อย" },
  { id: "sora", name: "Sora", color: "#3aa3f5", hint: "หมี · กระโดด" },
  { id: "momo", name: "Momo", color: "#f7609f", hint: "แมวชมพู · หมุนรอบตัว" },
  { id: "mikan", name: "Mikan", color: "#ff9a2e", hint: "จิ้งจอก · เด้งคลื่น" },
  { id: "ichigo", name: "Ichigo", color: "#f0443a", hint: "แพนด้าแดง · หมุนรอบตัว" },
];

export function isBotId(value: unknown): value is CoworkBotId {
  return typeof value === "string" && (BOT_IDS as readonly string[]).includes(value);
}

function isBotChoice(value: unknown): value is BotChoice {
  return isBotId(value) || (typeof value === "string" && /^custom:[\w-]{1,40}$/.test(value));
}

const botStore = createStore<{ bot: BotChoice }>(
  { bot: "mochi" },
  {
    key: "mali_cowork_bot",
    revive: (value) => ({ bot: isBotChoice(value?.bot) ? value.bot : "mochi" }),
  },
);

export const useCoworkBot = () => botStore.use();
export const getCoworkBot = () => botStore.get().bot;

export function setCoworkBot(bot: BotChoice) {
  if (isBotChoice(bot)) botStore.set({ bot });
}

// Other windows (the notch pill, the Quick bar) stay loaded while the bot is
// picked in the main window: follow the pick there too. Only a real change is
// applied, so windows don't write back and forth.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== "mali_cowork_bot" || !event.newValue) return;
    try {
      const bot = (JSON.parse(event.newValue) as { bot?: unknown })?.bot;
      if (isBotChoice(bot) && bot !== botStore.get().bot) botStore.set({ bot });
    } catch {
      // Unreadable: keep the bot we have.
    }
  });
}
