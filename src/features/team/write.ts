/**
 * A bot from the user's own words: the coach (or any model the user picks)
 * writes its name, duty, instructions, file access and connectors, and the
 * user looks it over before it's added. From Settings › Team, or by typing
 * `/bot <what it should do>` in the chat box.
 */
import { createStore } from "@/lib/local-store";
import { invoke } from "@tauri-apps/api/core";
import type { TeammateProposal } from "./store";
import { connectorList } from "./notebook";
import { modelCall } from "./payload";
import { getTeam } from "./store";

/** Write a bot for `need` on `modelId` (an API model or a CLI agent). */
export async function writeBot(need: string, modelId: string): Promise<TeammateProposal> {
  const model = modelCall(modelId, { cli: true });
  if (!model) throw new Error("Pick a model to write the bot with.");
  const state = getTeam();
  return invoke<TeammateProposal>("team_write_bot", {
    request: {
      model,
      need,
      team: state.mates.map((m) => ({ id: m.id, name: m.name, role: m.role, mcp: m.connectors.map((id) => ({ id, enabled: true })) })),
      connectors: connectorList(),
    },
  });
}

/** `/bot <words>` (or `/newbot`, `/สร้างบอท`) typed in the chat box: what the bot should do. */
export function botWordsIn(prompt: string): string | undefined {
  const match = /^\s*\/(?:bot|new-?bot|สร้างบอท)(?:\s+([\s\S]*))?$/i.exec(prompt);
  if (!match) return undefined;
  return (match[1] ?? "").trim();
}

/** Words waiting for Settings › Team to write a bot from them. */
const pending = createStore<{ words: string; at: number } | null>(null);
export const usePendingBotWords = pending.use;
export const subscribeToBotWords = pending.subscribe;
export const getPendingBotWords = pending.get;
export function clearPendingBotWords() {
  pending.set(null);
}

/** Handles `/bot …` from the chat box; true when it was one (nothing is sent to the model). */
export function tryBotFromPrompt(prompt: string): boolean {
  const words = botWordsIn(prompt);
  if (words === undefined) return false;
  pending.set({ words, at: Date.now() });
  return true;
}
