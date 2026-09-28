import { invoke, isTauri } from "@tauri-apps/api/core";
import type { OutputItem, OutputStat } from "./types";

/**
 * Whether each output is still on disk (C.3: a moved or deleted file shows
 * "not found" instead of vanishing). The backend only answers for a path the
 * named checkpoint recorded; anything else comes back `exists: false`.
 */
export async function statOutputs(items: Pick<OutputItem, "path" | "checkpointId">[]): Promise<OutputStat[]> {
  if (items.length === 0) return [];
  // Outside Tauri (plain `vite` dev) there is no disk to ask.
  if (!isTauri()) return items.map(({ path }) => ({ path, exists: true }));
  return invoke<OutputStat[]>("outputs_stat", {
    items: items.map(({ path, checkpointId }) => ({ path, checkpointId })),
  });
}

export type TrashResult = { path: string; ok: boolean; error?: string | null };

/**
 * Move outputs to the Trash. The backend only does it for a file its
 * checkpoint says the agent created; an edited file is refused.
 */
export async function trashOutputs(items: Pick<OutputItem, "path" | "checkpointId">[]): Promise<TrashResult[]> {
  if (items.length === 0) return [];
  if (!isTauri()) return items.map(({ path }) => ({ path, ok: false, error: "Only in the desktop app" }));
  return invoke<TrashResult[]>("outputs_trash", {
    items: items.map(({ path, checkpointId }) => ({ path, checkpointId })),
  });
}
