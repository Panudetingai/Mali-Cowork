import { createStore } from "@/lib/local-store";
import { useEffect } from "react";
import { geminiCheck, geminiListModels } from "./api";
import type { GeminiCheckResult, GeminiModel } from "./types";

type Status = {
  check: GeminiCheckResult | null;
  models: GeminiModel[];
  loading: boolean;
};

// Shared so the CLI is queried once per app session and a refresh after
// signing in reaches every component.
const statusStore = createStore<Status>({ check: null, models: [], loading: true });
let pending: Promise<void> | null = null;

export function refreshGemini(force = true) {
  if (!force && pending) return pending;
  statusStore.set((prev) => ({ ...prev, loading: true }));
  pending = geminiCheck()
    .then(async (check) => {
      // Models need an account, so only ask when signed in.
      const models = check.available && check.loggedIn ? await geminiListModels().catch(() => []) : [];
      statusStore.set({ check, models, loading: false });
    })
    .catch((error) => {
      pending = null;
      statusStore.set({
        check: { available: false, loggedIn: false, error: String(error) },
        models: [],
        loading: false,
      });
    });
  return pending;
}

export type GeminiState = Status & { refresh: () => void };

export function useGemini(): GeminiState {
  const status = statusStore.use();

  useEffect(() => {
    void refreshGemini(false);
  }, []);

  return { ...status, refresh: () => void refreshGemini(true) };
}
