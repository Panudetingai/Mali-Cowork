import { BOT_IDS, customIdOf, getCoworkBot, type CoworkBotId } from "@/features/cowork-bot/store";
import { createStore } from "@/lib/local-store";
import { absorbKnowledge } from "./knowledge";
import { announceLevelUp } from "./level-up";
import { lookFrom, reviveLook } from "./look";
import {
  levelFromXp,
  MAX_LEVEL,
  XP_PER_CHAT_TURN,
  XP_PER_COWORK_TURN,
  XP_PER_INBOX_TASK,
} from "./constants";
import type { BotKnowledge, CustomBot, CustomBotDraft } from "./types";

type StudioState = {
  bots: CustomBot[];
  /** Which custom bot earns XP from chat/cowork (optional). */
  activeBotId?: string;
};

const EMPTY: StudioState = { bots: [] };

function reviveBot(raw: Partial<CustomBot>): CustomBot | null {
  if (!raw || typeof raw.name !== "string" || !raw.name.trim()) return null;
  const xp = typeof raw.xp === "number" ? Math.max(0, raw.xp) : 0;
  const level = Math.min(MAX_LEVEL, levelFromXp(xp));
  const mascot = (BOT_IDS as readonly string[]).includes(raw.mascot ?? "") ? (raw.mascot as CoworkBotId) : "mochi";
  const color = typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : "#f5c518";
  return {
    id: typeof raw.id === "string" ? raw.id : `bot_${crypto.randomUUID().slice(0, 10)}`,
    name: raw.name.trim(),
    color,
    mascot,
    // Bots made before the designer start from their character in their color.
    look: reviveLook(raw.look, lookFrom(mascot, color)),
    role: typeof raw.role === "string" ? raw.role : "",
    styleNotes: typeof raw.styleNotes === "string" ? raw.styleNotes : "",
    xp,
    level,
    workTurns: typeof raw.workTurns === "number" ? raw.workTurns : 0,
    knowledge: Array.isArray(raw.knowledge)
      ? raw.knowledge.filter((k): k is BotKnowledge => k && typeof k.title === "string" && typeof k.body === "string")
      : [],
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}

const STORE_KEY = "mali_bot_studio";

function reviveState(value: Partial<StudioState> | undefined): StudioState {
  return {
    bots: Array.isArray(value?.bots) ? value.bots.map(reviveBot).filter((b): b is CustomBot => !!b) : [],
    activeBotId: typeof value?.activeBotId === "string" ? value.activeBotId : undefined,
  };
}

const store = createStore<StudioState>(EMPTY, { key: STORE_KEY, revive: reviveState });

// The notch and the Quick bar draw the bot too: a bot redesigned or grown in
// the main window changes there as well.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORE_KEY || !event.newValue) return;
    // Only a real change, so windows don't write back and forth.
    if (event.newValue === JSON.stringify(store.get())) return;
    try {
      store.set(reviveState(JSON.parse(event.newValue)));
    } catch {
      // Unreadable: keep what we have.
    }
  });
}

export const useBotStudio = store.use;
export const getBotStudio = store.get;

function withLevel(bot: CustomBot): CustomBot {
  return { ...bot, level: Math.min(MAX_LEVEL, levelFromXp(bot.xp)) };
}

export function setActiveBot(id: string | undefined) {
  store.set((s) => ({ ...s, activeBotId: id }));
}

export function saveCustomBot(draft: CustomBotDraft): CustomBot {
  const now = Date.now();
  let saved!: CustomBot;
  store.set((s) => {
    const existing = draft.id ? s.bots.find((b) => b.id === draft.id) : undefined;
    const bot = withLevel({
      id: existing?.id ?? `bot_${crypto.randomUUID().slice(0, 10)}`,
      name: draft.name.trim(),
      color: draft.look?.color ?? draft.color,
      mascot: draft.look?.base ?? draft.mascot,
      look: draft.look ?? existing?.look ?? lookFrom(draft.mascot, draft.color),
      role: draft.role.trim(),
      styleNotes: draft.styleNotes.trim(),
      xp: draft.xp ?? existing?.xp ?? 0,
      level: existing?.level ?? 1,
      workTurns: draft.workTurns ?? existing?.workTurns ?? 0,
      knowledge: draft.knowledge ?? existing?.knowledge ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    saved = bot;
    const bots = existing ? s.bots.map((b) => (b.id === bot.id ? bot : b)) : [...s.bots, bot];
    const activeBotId = s.activeBotId ?? bot.id;
    return { bots, activeBotId };
  });
  return saved;
}

export function removeCustomBot(id: string) {
  store.set((s) => ({
    bots: s.bots.filter((b) => b.id !== id),
    activeBotId: s.activeBotId === id ? s.bots.find((b) => b.id !== id)?.id : s.activeBotId,
  }));
}

export function patchBot(id: string, fn: (bot: CustomBot) => CustomBot) {
  store.set((s) => ({
    ...s,
    bots: s.bots.map((b) => (b.id === id ? withLevel(fn(b)) : b)),
  }));
}

export function getCustomBot(id: string) {
  return store.get().bots.find((b) => b.id === id);
}

/** Give a bot XP; says which level it was on and which it's on now. */
export function addBotXp(id: string, amount: number) {
  const from = getCustomBot(id)?.level ?? 1;
  if (amount <= 0) return { from, to: from };
  patchBot(id, (b) => {
    const xp = b.xp + amount;
    return { ...b, xp, level: levelFromXp(xp), workTurns: b.workTurns + 1, updatedAt: Date.now() };
  });
  return { from, to: getCustomBot(id)?.level ?? from };
}

export function learnOnBot(id: string, draft: Omit<BotKnowledge, "id" | "updatedAt">) {
  const bot = getBotStudio().bots.find((b) => b.id === id);
  if (!bot) return null;
  const result = absorbKnowledge(bot, draft);
  patchBot(id, () => result.bot);
  return result;
}

/**
 * A reply finished: the bot the user works with — their Cowork bot, when it's
 * one from the Studio — grows a little. Only XP: what was said isn't kept,
 * since nothing would read it back.
 */
export function recordWorkForActiveBot(input: { mode: "chat" | "cowork" | "code" | string; fromInbox?: boolean }) {
  const id = customIdOf(getCoworkBot());
  const bot = id ? getCustomBot(id) : undefined;
  if (!bot) return;
  const xp = input.fromInbox ? XP_PER_INBOX_TASK : input.mode === "cowork" ? XP_PER_COWORK_TURN : XP_PER_CHAT_TURN;
  const { from, to } = addBotXp(bot.id, xp);
  if (to > from) announceLevelUp(bot.name, from, to);
}

/** Spawn a new bot from exported knowledge (new id). */
export function importBotBundle(bundle: {
  name: string;
  color: string;
  mascot: CoworkBotId;
  look?: unknown;
  role: string;
  styleNotes: string;
  xp: number;
  knowledge: BotKnowledge[];
}) {
  const now = Date.now();
  const bot = withLevel({
    id: `bot_${crypto.randomUUID().slice(0, 10)}`,
    name: bundle.name,
    color: bundle.color,
    mascot: bundle.mascot,
    look: reviveLook(bundle.look, lookFrom(bundle.mascot, bundle.color)),
    role: bundle.role,
    styleNotes: bundle.styleNotes,
    xp: Math.min(bundle.xp, 999_999),
    level: 1,
    workTurns: 0,
    knowledge: bundle.knowledge.map((k) => ({ ...k, id: `kn_${crypto.randomUUID().slice(0, 10)}`, updatedAt: now })),
    createdAt: now,
    updatedAt: now,
  });
  store.set((s) => ({ bots: [...s.bots, bot], activeBotId: bot.id }));
  return bot;
}
