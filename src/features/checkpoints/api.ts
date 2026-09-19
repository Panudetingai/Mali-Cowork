import { invoke, isTauri } from "@tauri-apps/api/core";
import type { FileDiff, FilePreview, RestoreResult, TurnChanges } from "./types";

type BeginResult = { id: string; files: number; partial: boolean };

/**
 * Snapshot the folders an agent may change, before its turn. Resolves
 * undefined when that isn't possible (folder too large, not in Tauri): the
 * turn then simply runs without undo.
 */
export async function beginCheckpoint(folders: string[]): Promise<string | undefined> {
  if (!isTauri() || folders.length === 0) return undefined;
  try {
    return (await invoke<BeginResult>("checkpoint_begin", { folders })).id;
  } catch (error) {
    console.warn("[checkpoint] turn runs without undo:", error);
    return undefined;
  }
}

/** Add a folder granted during the turn, before the agent writes to it. */
export function addCheckpointFolder(id: string, folder: string) {
  return invoke<void>("checkpoint_add_folder", { id, folder }).catch((error) =>
    console.warn("[checkpoint] folder not covered by undo:", error),
  );
}

/** Snapshot again after the turn; resolves with what changed. */
export async function finishCheckpoint(id: string): Promise<TurnChanges | undefined> {
  try {
    return await invoke<TurnChanges>("checkpoint_finish", { id });
  } catch (error) {
    console.warn("[checkpoint] couldn't list the turn's changes:", error);
    return undefined;
  }
}

/** `before` undoes the turn, `after` redoes it. */
export function restoreCheckpoint(id: string, to: "before" | "after", force = false) {
  return invoke<RestoreResult>("checkpoint_restore", { id, to, force });
}

export function checkpointDiff(id: string, path: string) {
  return invoke<FileDiff>("checkpoint_diff", { id, path });
}

export function checkpointPreview(id: string, path: string) {
  return invoke<FilePreview>("checkpoint_preview", { id, path });
}

/** Open the file in its app, or with `reveal`, show it in Finder/Explorer. */
export function openCheckpointFile(id: string, path: string, reveal = false) {
  return invoke<void>("checkpoint_open", { id, path, reveal });
}
