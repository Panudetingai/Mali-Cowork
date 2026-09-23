import { invoke, isTauri } from "@tauri-apps/api/core";

/** What `history_load` returns; rows are the JSON each store saved. */
export type HistorySnapshot<Chat = unknown, Project = unknown> = {
  chats: Chat[];
  projects: Project[];
  /** Chats from localStorage (older versions) were already copied in. */
  legacyImported: boolean;
};

let first: Promise<HistorySnapshot> | undefined;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

/** The database contents at startup, read once and shared by the stores. */
export function loadHistorySnapshot<Chat, Project>() {
  first ??= (async () => {
    if (!isTauri()) {
      throw new Error("SQLite history is only available in the desktop app");
    }
    return withTimeout(invoke<HistorySnapshot>("history_load"), 15_000, "history_load");
  })();
  return first as Promise<HistorySnapshot<Chat, Project>>;
}
