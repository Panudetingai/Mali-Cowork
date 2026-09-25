/**
 * Arena rounds. Each contender is an ordinary chat (hidden from the history
 * list by `arenaId`) that runs through `sendTurn`, so streaming, usage,
 * stopping and — in Cowork — Files changed all work as in any chat.
 *
 * Cowork contenders each work in their own git worktree (see arena.rs): the
 * user's folder only changes when they pick a winner, and then through a
 * checkpoint, so Undo works like after any Cowork turn.
 */
import {
  clearAgentSessions,
  createChat,
  deleteChat,
  getChat,
  getRun,
  updateChat,
  updateChatMessages,
} from "@/features/chat-history";
import { beginCheckpoint, finishCheckpoint, type TurnFiles } from "@/features/checkpoints";
import { findGrant, grantFolder, requestFolderAccess, revokeFolder } from "@/features/workspace";
import { createStore } from "@/lib/local-store";
import { turnInputFor } from "@/pages/chat/hooks/use-chat";
import { contextBudgetFor, type AiModel } from "@/pages/chat/models";
import { sendTurn, stopRun } from "@/pages/chat/turn";
import { arenaApply, arenaCleanup, arenaCleanupStale, arenaPrepare } from "./api";
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

const patchRound = (id: string, fn: (round: ArenaRound) => ArenaRound) =>
  rounds.set((prev) => prev.map((r) => (r.id === id ? fn(r) : r)));

/**
 * Send one prompt to every model at once, each in its own hidden chat —
 * in Cowork, each in its own copy of `folder`. Resolves once all have
 * started; answers stream in. Throws with a readable message when a Cowork
 * round can't start (no write access, not a Git repository…).
 */
export async function startArena(
  prompt: string,
  models: AiModel[],
  mode: "chat" | "cowork" = "chat",
  folder?: string,
): Promise<ArenaRound> {
  const picked = models.slice(0, MAX_CONTENDERS);
  const id = crypto.randomUUID();
  let folders: (string | undefined)[] = picked.map(() => undefined);
  let roots: string[] | undefined;

  if (mode === "cowork") {
    if (!folder) throw new Error("Pick a folder for the agents to work on.");
    const grant = await requestFolderAccess(folder);
    if (!grant) throw new Error("Mali needs access to the folder first.");
    if (findGrant(folder)?.access !== "write") {
      throw new Error("The Arena applies the winner's changes, so it needs Read & write access to this folder.");
    }
    const prepared = await arenaPrepare(id, folder, picked.length);
    // Access to the same folder the user granted, inside each copy — not the
    // whole copy: only changes there can be applied (arena.rs) and undone.
    // It ends with the round.
    for (const granted of prepared.folders) grantFolder(granted, "write");
    folders = prepared.folders;
    roots = prepared.folders;
  }

  const contenders: ArenaContender[] = picked.map((model, i) => {
    const chat = createChat(prompt, { mode, cwd: folders[i] });
    updateChat(chat.id, (s) => ({ ...s, arenaId: id, title: `${s.title} · ${model.name}` }));
    return { chatId: chat.id, folder: folders[i], modelId: model.id, modelName: model.name, provider: model.provider };
  });
  const round: ArenaRound = { id, prompt, mode, folder, roots, createdAt: Date.now(), contenders };
  rounds.set((prev) => [round, ...prev].slice(0, KEEP));

  picked.forEach((model, i) => {
    const input = turnInputFor({ prompt, model, budget: contextBudgetFor(model) });
    void sendTurn({ chatId: contenders[i].chatId, newChatMode: mode }, input).catch((error) =>
      console.warn("[arena] contender failed to start", error),
    );
  });
  return round;
}

/** Stop one contender (its answer so far stays on the card). */
export function stopContender(chatId: string) {
  return stopRun(chatId).catch((error) => console.warn("[arena] stop failed", error));
}

async function stopAll(round: ArenaRound, except?: string) {
  for (const c of round.contenders) {
    if (c.chatId !== except && getRun(c.chatId)) await stopRun(c.chatId).catch(() => undefined);
  }
}

async function releaseCopies(round: ArenaRound) {
  if (round.mode !== "cowork") return;
  for (const root of round.roots ?? []) revokeFolder(root);
  await arenaCleanup(round.id).catch((error) => console.warn("[arena] cleanup failed", error));
}

/** Rounds a pick is running for: a second Keep must not apply another patch. */
const picking = new Set<string>();

/**
 * Keep one contender: its chat joins the history as a normal chat, the
 * others are stopped and deleted. In Cowork, its changes are applied to the
 * real folder first (under a checkpoint, so Undo works); if they no longer
 * fit, this throws and nothing changes. Resolves with the winner's chat id.
 */
export async function pickWinner(roundId: string, chatId: string) {
  const round = rounds.get().find((r) => r.id === roundId);
  const index = round?.contenders.findIndex((c) => c.chatId === chatId) ?? -1;
  if (!round || index < 0 || round.winnerChatId || picking.has(roundId)) return undefined;
  picking.add(roundId);
  try {
    return await pick(round, index);
  } finally {
    picking.delete(roundId);
  }
}

async function pick(round: ArenaRound, index: number) {
  const roundId = round.id;
  const winner = round.contenders[index];
  const chatId = winner.chatId;
  await stopAll(round);

  let appliedFiles: number | undefined;
  if (round.mode === "cowork" && round.folder) {
    const checkpointId = await beginCheckpoint([round.folder]);
    let applied: { files: number };
    try {
      applied = await arenaApply(round.id, index);
    } catch (error) {
      if (checkpointId) await finishCheckpoint(checkpointId);
      throw error;
    }
    appliedFiles = applied.files;
    const changes = checkpointId ? await finishCheckpoint(checkpointId) : undefined;
    // The winner's chat now describes the real folder: its Files changed
    // point at the applied files, and its agent starts a fresh session there
    // (the old one was in the copy), hearing the chat so far as a handoff.
    updateChat(chatId, (s) => ({ ...s, cwd: round.folder }));
    clearAgentSessions(chatId);
    if (changes?.changes.length) {
      const turn: TurnFiles = {
        checkpointId: changes.id,
        changes: changes.changes,
        partial: changes.partial || undefined,
        state: "applied",
      };
      const turnMessageId = [...(getChat(chatId)?.messages ?? [])].reverse().find((m) => m.turn || m.role === "assistant")?.id;
      if (turnMessageId) {
        updateChatMessages(chatId, (prev) => prev.map((m) => (m.id === turnMessageId ? { ...m, turn } : m)));
      }
    }
  }

  for (const c of round.contenders) if (c.chatId !== chatId) deleteChat(c.chatId);
  updateChat(chatId, (s) => ({
    ...s,
    arenaId: undefined,
    title: round.prompt.replace(/\s+/g, " ").trim().slice(0, 60) || s.title,
  }));
  patchRound(roundId, (r) => ({ ...r, winnerChatId: chatId, appliedFiles }));
  wins.set((prev) => ({ ...prev, [winner.modelId]: (prev[winner.modelId] ?? 0) + 1 }));
  await releaseCopies(round);
  return chatId;
}

/** Throw a round away without keeping any answer (a kept chat stays in history). */
export async function discardArena(roundId: string) {
  const round = rounds.get().find((r) => r.id === roundId);
  if (round && !round.winnerChatId) {
    await stopAll(round);
    for (const c of round.contenders) if (getChat(c.chatId)?.arenaId) deleteChat(c.chatId);
    await releaseCopies(round);
  }
  rounds.set((prev) => prev.filter((r) => r.id !== roundId));
}

/**
 * Main window, once at startup: remove leftover copies of rounds that are
 * gone or decided (a crash or quit mid-round), keeping undecided ones so the
 * user can still pick.
 */
export function startArenaHousekeeping() {
  const waiting = rounds.get().filter((r) => r.mode === "cowork" && !r.winnerChatId).map((r) => r.id);
  void arenaCleanupStale(waiting).catch(() => undefined);
}
