import { BOTS, customIdOf, type BotChoice, type CoworkBotId } from "@/features/cowork-bot/store";
import { presetOf } from "./look";
import { getBotStudio, useBotStudio } from "./store";
import type { CustomBot } from "./types";

export type ResolvedBot = {
  /** The built-in bot it's drawn from (or is). */
  mascot: CoworkBotId;
  name: string;
  color: string;
  /** A Studio bot's design, for the animation; none for a built-in bot. */
  preset?: ReturnType<typeof presetOf>;
};

/** What to draw for a bot choice. A Studio bot that was deleted falls back to Mochi. */
export function resolveBot(choice: BotChoice, bots: CustomBot[]): ResolvedBot {
  const customId = customIdOf(choice);
  if (customId) {
    const bot = bots.find((b) => b.id === customId);
    if (bot) return { mascot: bot.look.base, name: bot.name, color: bot.look.color, preset: presetOf(bot.look, bot.level) };
  }
  const built = BOTS.find((b) => b.id === choice) ?? BOTS[0]!;
  return { mascot: built.id, name: built.name, color: built.color };
}

/** The same, kept current as Studio bots change (a rename shows at once). */
export function useResolvedBot(choice: BotChoice) {
  const { bots } = useBotStudio();
  return resolveBot(choice, bots);
}

/** The same, read once (for a color worked out outside a component). */
export function resolveBotNow(choice: BotChoice) {
  return resolveBot(choice, getBotStudio().bots);
}
