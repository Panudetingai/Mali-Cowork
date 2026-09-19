import { invoke } from "@tauri-apps/api/core";

/** What `history_load` returns; rows are the JSON each store saved. */
export type HistorySnapshot<Chat = unknown, Project = unknown> = {
  chats: Chat[];
  projects: Project[];
  /** Chats from localStorage (older versions) were already copied in. */
  legacyImported: boolean;
};

let first: Promise<HistorySnapshot> | undefined;

/** The database contents at startup, read once and shared by the stores. */
export function loadHistorySnapshot<Chat, Project>() {
  first ??= invoke<HistorySnapshot>("history_load");
  return first as Promise<HistorySnapshot<Chat, Project>>;
}
