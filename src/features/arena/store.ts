/**
 * Arena rounds. Each contender is an ordinary chat (hidden from the history
 * list by `arenaId`) that runs through `sendTurn`, so streaming, usage,
 * stopping and — in Cowork — Files changed all work as in any chat.
 */
import { createChat, deleteChat, getChat, getRun, updateChat } from "@/features/chat-history";
import { createStore } from "@/lib/local-store";
import { turnInputFor } from "@/pages/chat/hooks/use-chat";
import { contextBudgetFor, type AiModel } from "@/pages/chat/models";
import { sendTurn, stopRun } from "@/pages/chat/turn";
import type { ArenaContender, ArenaRound } from "./types";

export const MIN_CONTENDERS = 2;
export const MAX_CONTENDERS = 3;
/** Older rounds are dropped from the Arena page (a winner's chat stays in history). */
const KEEP = 20;

const rounds = createStore<ArenaRound[]>([], {
  key: "mali.arena.rounds.v1",
  revive: (saved) => (Array.isArray(saved) ? saved : []),
});
/** Wins per model id, on this device only (PRD D-FR6). */
const wins = createStore<Record<string, number>>({}, { key: "mali.arena.wins.v1" });

export const useArenaRounds = rounds.use;
export const useArenaWins = wins.use;

/**
 * Send one prompt to every model at once, each in its own hidden chat.
 * Resolves with the round as soon as all have started; answers stream in.
 */
export function startArena(prompt: string, models: AiModel[]): ArenaRound {
  const id = crypto.randomUUID();
  const contenders: ArenaContender[] = models.slice(0, MAX_CONTENDERS).map((model) => {
    const chat = createChat(prompt, { mode: "chat" });
    updateChat(chat.id, (s) => ({ ...s, arenaId: id, title: `${s.title} · ${model.name}` }));
    return { chatId: chat.id, modelId: model.id, modelName: model.name, provider: model.provider };
  });
  const round: ArenaRound = { id, prompt, mode: "chat", createdAt: Date.now(), contenders };
  rounds.set((prev) => [round, ...prev].slice(0, KEEP));

  models.slice(0, MAX_CONTENDERS).forEach((model, i) => {
    const input = turnInputFor({ prompt, model, budget: contextBudgetFor(model) });
    void sendTurn({ chatId: contenders[i].chatId, newChatMode: "chat" }, input).catch((error) =>
      console.warn("[arena] contender failed to start", error),
    );
  });
  return round;
}

/** Stop one contender (its answer so far stays on the card). */
export function stopContender(chatId: string) {
  return stopRun(chatId).catch((error) => console.warn("[arena] stop failed", error));
}

/**
 * Keep one answer: its chat joins the history as a normal chat, the others
 * are stopped and deleted. Resolves with the winner's chat id.
 */
export async function pickWinner(roundId: string, chatId: string) {
  const round = rounds.get().find((r) => r.id === roundId);
  if (!round) return undefined;
  const winner = round.contenders.find((c) => c.chatId === chatId);
  if (!winner) return undefined;
  for (const c of round.contenders) {
    if (c.chatId === chatId) continue;
    if (getRun(c.chatId)) await stopRun(c.chatId).catch(() => undefined);
    deleteChat(c.chatId);
  }
  // The chat keeps the prompt as its title, like any other.
  updateChat(chatId, (s) => ({ ...s, arenaId: undefined, title: round.prompt.replace(/\s+/g, " ").trim().slice(0, 60) || s.title }));
  rounds.set((prev) => prev.map((r) => (r.id === roundId ? { ...r, winnerChatId: chatId } : r)));
  wins.set((prev) => ({ ...prev, [winner.modelId]: (prev[winner.modelId] ?? 0) + 1 }));
  return chatId;
}

/** Throw a round away without keeping any answer. */
export async function discardArena(roundId: string) {
  const round = rounds.get().find((r) => r.id === roundId);
  if (round && !round.winnerChatId) {
    for (const c of round.contenders) {
      if (getRun(c.chatId)) await stopRun(c.chatId).catch(() => undefined);
      if (getChat(c.chatId)?.arenaId) deleteChat(c.chatId);
    }
  }
  rounds.set((prev) => prev.filter((r) => r.id !== roundId));
}
