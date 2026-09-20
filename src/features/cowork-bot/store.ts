import { createStore } from "@/lib/local-store";

export const BOT_IDS = ["mochi", "jelly", "petal", "nori", "sora", "momo"] as const;

export type CoworkBotId = (typeof BOT_IDS)[number];

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
  | "permission";

export const BOTS: { id: CoworkBotId; name: string; color: string; hint: string }[] = [
  { id: "mochi", name: "Mochi", color: "#f5c518", hint: "เหลือง · เด้งคลื่น" },
  { id: "jelly", name: "Jelly", color: "#34c77b", hint: "เขียว · กระโดด" },
  { id: "petal", name: "Petal", color: "#8b5cf6", hint: "ม่วง · หมุนรอบตัว" },
  { id: "nori", name: "Nori", color: "#2a2a33", hint: "ดำ · เลื้อย" },
  { id: "sora", name: "Sora", color: "#3aa3f5", hint: "ฟ้า · กระโดด" },
  { id: "momo", name: "Momo", color: "#f7609f", hint: "ชมพู · หมุนรอบตัว" },
];

function isBotId(value: unknown): value is CoworkBotId {
  return typeof value === "string" && (BOT_IDS as readonly string[]).includes(value);
}

const botStore = createStore<{ bot: CoworkBotId }>(
  { bot: "mochi" },
  {
    key: "mali_cowork_bot",
    revive: (value) => ({ bot: isBotId(value?.bot) ? value.bot : "mochi" }),
  },
);

export const useCoworkBot = () => botStore.use();

export function setCoworkBot(bot: CoworkBotId) {
  if (isBotId(bot)) botStore.set({ bot });
}
