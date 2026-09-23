import { createStore } from "@/lib/local-store";
import { defaultEffort } from "./levels";

/**
 * The effort picked per model, kept per model because the levels are: "high"
 * on a small model and "high" on a large one are different prices, and a user
 * who turns one down does not mean to turn them all down.
 */
const store = createStore<Record<string, string>>({}, { key: "model_effort" });

export const useEffortChoices = store.use;

/** The chosen level for a model, or where it should start. */
export function effortFor(modelId: string, levels: string[] | undefined): string | undefined {
  const available = levels ?? [];
  if (available.length < 2) return undefined;
  const chosen = store.get()[modelId];
  // A model's levels change when a provider revises them; a stale choice
  // would be rejected by the backend, so it falls back to the default.
  return chosen && available.includes(chosen) ? chosen : defaultEffort(available);
}

/**
 * What was last chosen for a model, without checking it against a level list.
 *
 * For the paths that only have a model id — a retry on a CLI agent, whose
 * levels live with the CLI rather than in the shared model metadata — this is
 * the best that can be known, and it is only ever a level that model offered
 * when it was picked.
 */
export function storedEffortFor(modelId: string): string | undefined {
  return store.get()[modelId];
}

export function setEffortFor(modelId: string, level: string) {
  store.set((prev) => ({ ...prev, [modelId]: level }));
}
