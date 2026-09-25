/**
 * Outputs the user took off the list. The file itself is untouched (or was
 * moved to the Trash separately); the chat that made it keeps its record.
 */
import { createStore } from "@/lib/local-store";

const MAX_HIDDEN = 5000;

const store = createStore<string[]>([], {
  key: "mali_outputs_hidden",
  revive: (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []),
});

export const useHiddenOutputs = store.use;

export function hideOutputs(paths: string[]) {
  if (paths.length === 0) return;
  store.set((prev) => [...new Set([...prev, ...paths])].slice(-MAX_HIDDEN));
}

export function unhideOutputs(paths: string[]) {
  const drop = new Set(paths);
  store.set((prev) => prev.filter((p) => !drop.has(p)));
}
