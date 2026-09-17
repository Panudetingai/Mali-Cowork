import { useSyncExternalStore } from "react";

type Updater<T> = T | ((prev: T) => T);

type Options<T> = {
  /** localStorage key; omit for an in-memory store. */
  key?: string;
  /** Clean up a value read back from storage. */
  revive?: (value: T) => T;
  /** Coalesce writes to storage, e.g. while a reply is streaming. */
  throttleMs?: number;
};

/** Tiny external store shared across components, optionally persisted. */
export function createStore<T>(initial: T, { key, revive, throttleMs = 0 }: Options<T> = {}) {
  let state = read();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  function read(): T {
    if (!key) return initial;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return initial;
      const value = JSON.parse(raw) as T;
      return revive ? revive(value) : value;
    } catch {
      return initial;
    }
  }

  function flush() {
    timer = undefined;
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Storage full or unavailable; the data still lives for this session.
    }
  }

  if (key && throttleMs > 0 && typeof window !== "undefined") {
    window.addEventListener("pagehide", () => timer && flush());
  }

  const store = {
    get: () => state,
    set(next: Updater<T>) {
      state = typeof next === "function" ? (next as (prev: T) => T)(state) : next;
      listeners.forEach((listener) => listener());
      if (!key) return;
      if (throttleMs <= 0) flush();
      else timer ??= setTimeout(flush, throttleMs);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    use: () => useSyncExternalStore(store.subscribe, store.get),
  };
  return store;
}
