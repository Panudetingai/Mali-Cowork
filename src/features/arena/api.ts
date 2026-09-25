import { invoke } from "@tauri-apps/api/core";

export type ArenaPrepared = {
  /** Where each contender works (its worktree, at the picked subfolder). */
  folders: string[];
  /** Worktree roots, granted for the round and revoked after. */
  roots: string[];
};

/** Make one git worktree per contender; fails for a folder outside a Git repo. */
export function arenaPrepare(id: string, folder: string, count: number) {
  return invoke<ArenaPrepared>("arena_prepare", { id, folder, count });
}

/** Apply contender `index`'s changes to the real folder, as one patch. */
export function arenaApply(id: string, index: number) {
  return invoke<{ files: number }>("arena_apply", { id, index });
}

export function arenaCleanup(id: string) {
  return invoke<void>("arena_cleanup", { id });
}

/** Startup: drop worktrees of rounds that are no longer waiting for a pick. */
export function arenaCleanupStale(keep: string[]) {
  return invoke<number>("arena_cleanup_stale", { keep });
}
