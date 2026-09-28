import { invoke } from "@tauri-apps/api/core";

/** Which table a synced store saves into (see `commands/storage/history.rs`). */
type Table = "chats" | "projects";

type Row = { id: string };

type Store<T extends Row> = {
  get: () => T[];
  subscribe: (listener: () => void) => () => void;
};

const DELETED = Symbol("deleted");

/**
 * Save a list store to SQLite as it changes. State is immutable, so a row
 * whose object is unchanged since the last save is skipped: streaming a reply
 * rewrites only that one chat, not the whole history.
 */
export function syncToDatabase<T extends Row>(
  store: Store<T>,
  table: Table,
  { throttleMs = 500, skip }: { throttleMs?: number; skip?: (row: T) => boolean } = {},
) {
  let saved = new Map<string, T | typeof DELETED>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();
  let started = false;

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    // Rows `skip` rejects are never written (and so never need deleting).
    const current = skip ? store.get().filter((row) => !skip(row)) : store.get();
    const ids = new Set(current.map((row) => row.id));
    const upserts = current.filter((row) => saved.get(row.id) !== row);
    const deletes = [...saved.keys()].filter((id) => !ids.has(id));
    if (upserts.length === 0 && deletes.length === 0) return queue;

    for (const row of upserts) saved.set(row.id, row);
    for (const id of deletes) saved.delete(id);
    const changes =
      table === "chats"
        ? { chats: upserts, deletedChats: deletes }
        : { projects: upserts, deletedProjects: deletes };

    queue = queue
      .then(async () => {
        await invoke("history_save", { changes });
      })
      .catch((error) => {
        console.error(`[history] could not save ${table}`, error);
        // Forget what failed so the next change retries it.
        for (const row of upserts) if (saved.get(row.id) === row) saved.delete(row.id);
        for (const id of deletes) if (!saved.has(id)) saved.set(id, DELETED);
      });
    return queue;
  }

  return {
    /** Rows just loaded from the database don't need saving again. */
    start(loaded: T[]) {
      saved = new Map(loaded.map((row) => [row.id, row]));
      if (started) return;
      started = true;
      store.subscribe(() => {
        timer ??= setTimeout(flush, throttleMs);
      });
      window.addEventListener("pagehide", () => void flush());
    },
    flush,
  };
}
