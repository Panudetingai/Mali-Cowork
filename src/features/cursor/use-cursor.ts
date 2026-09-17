import { createStore } from "@/lib/local-store";
import { useEffect } from "react";
import { cursorCheck, cursorListModels } from "./api";
import type { CursorCheckResult, CursorModel } from "./types";

type Status = {
  check: CursorCheckResult | null;
  models: CursorModel[];
  loading: boolean;
};

// Shared so the CLI is queried once per app session and a refresh after
// signing in reaches every component.
const statusStore = createStore<Status>({ check: null, models: [], loading: true });
let pending: Promise<void> | null = null;

export function refreshCursor(force = true) {
  if (!force && pending) return pending;
  statusStore.set((prev) => ({ ...prev, loading: true }));
  pending = cursorCheck()
    .then(async (check) => {
      // Models need an account, so only ask when signed in.
      const models = check.available && check.loggedIn ? await cursorListModels().catch(() => []) : [];
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

export type CursorState = Status & { refresh: () => void };

export function useCursor(): CursorState {
  const status = statusStore.use();

  useEffect(() => {
    void refreshCursor(false);
  }, []);

  return { ...status, refresh: () => void refreshCursor(true) };
}
