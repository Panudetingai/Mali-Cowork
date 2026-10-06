import { isCliAgentEnabled } from "@/features/cli-agents";
import { createStore } from "@/lib/local-store";
import { useEffect } from "react";
import { antigravityCheck, antigravityListModels } from "./api";
import type { AntigravityCheckResult, AntigravityModel } from "./types";

type Status = {
  check: AntigravityCheckResult | null;
  models: AntigravityModel[];
  loading: boolean;
};

// Shared so the CLI is queried once per app session and a refresh after
// signing in reaches every component.
const statusStore = createStore<Status>({ check: null, models: [], loading: true });
let pending: Promise<void> | null = null;

export function refreshAntigravity(force = true) {
  if (!isCliAgentEnabled("antigravity")) {
    statusStore.set({ check: null, models: [], loading: false });
    pending = null;
    return Promise.resolve();
  }
  if (!force && pending) return pending;
  statusStore.set((prev) => ({ ...prev, loading: true }));
  pending = antigravityCheck()
    .then(async (check) => {
      // Models need an account, so only ask when signed in.
      const models = check.available && check.loggedIn ? await antigravityListModels().catch(() => []) : [];
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

export type AntigravityState = Status & { refresh: () => void };

export function useAntigravity(): AntigravityState {
  const status = statusStore.use();

  useEffect(() => {
    void refreshAntigravity(false);
  }, []);

  return { ...status, refresh: () => void refreshAntigravity(true) };
}
