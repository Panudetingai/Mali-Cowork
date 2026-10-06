import { createStore } from "@/lib/local-store";
import { useCallback, useEffect, useState } from "react";
import {
  opencodeCheck,
  opencodeDefaultCwd,
  opencodeListModels,
} from "./api";
import { isCliAgentEnabled } from "@/features/cli-agents";
import { syncCliProviders } from "@/features/providers";
import { loadOpencodeSettings, saveOpencodeSettings, SETTINGS_EVENT } from "./settings";
import type {
  OpencodeCheckResult,
  OpencodeModelsResult,
  OpencodeSettings,
} from "./types";

type Status = {
  check: OpencodeCheckResult | null;
  models: OpencodeModelsResult | null;
  loading: boolean;
};

// Shared across components so the backend is queried once per app session
// and a refresh (e.g. after saving a key) reaches every consumer.
const statusStore = createStore<Status>({ check: null, models: null, loading: true });
let statusPromise: Promise<void> | null = null;

async function fetchStatus(cwd: string) {
  const check = await opencodeCheck();
  if (!check.available) return { check, models: null };
  // Ollama / OpenRouter from Settings → Models, before listing models.
  await syncCliProviders().catch((e) => console.warn("[opencode] provider sync failed", e));
  const models = await opencodeListModels(cwd).catch(() => null);
  return { check, models };
}

async function ensureCwd(settings: OpencodeSettings) {
  if (settings.cwd) return settings.cwd;
  const cwd = await opencodeDefaultCwd();
  saveOpencodeSettings({ cwd });
  return cwd;
}

const DISABLED: OpencodeCheckResult = {
  available: false,
  version: undefined,
  path: undefined,
  error: "Turned off in Settings → Models → CLI agents.",
};

/** Reload OpenCode status and models for every component using them. */
export function refreshOpencode(force = true) {
  if (!isCliAgentEnabled("opencode")) {
    statusStore.set({ check: DISABLED, models: null, loading: false });
    statusPromise = null;
    return Promise.resolve();
  }
  if (!force && statusPromise) return statusPromise;
  statusStore.set((prev) => ({ ...prev, loading: true }));
  statusPromise = ensureCwd(loadOpencodeSettings())
    .then(fetchStatus)
    .then((status) => statusStore.set({ ...status, loading: false }))
    .catch((error) => {
      statusPromise = null;
      statusStore.set({
        check: { available: false, error: String(error) },
        models: null,
        loading: false,
      });
    });
  return statusPromise;
}

export function getOpencodeModels() {
  return statusStore.get().models;
}

let listOnly: Promise<OpencodeModelsResult | null> | null = null;

/**
 * The model list alone, read-only — for a window that skips `refreshOpencode`
 * (the Quick bar opens instantly and doesn't sync providers or MCP servers).
 * Fills the shared store, so routing that reads `getOpencodeModels()` (e.g. a
 * picture sent to an API model going through OpenCode) works the same there.
 */
export function ensureOpencodeModels(cwd?: string): Promise<OpencodeModelsResult | null> {
  if (!isCliAgentEnabled("opencode")) return Promise.resolve(null);
  const known = statusStore.get().models;
  if (known) return Promise.resolve(known);
  listOnly ??= opencodeListModels(cwd)
    .then((models) => {
      if (models && !statusStore.get().models) statusStore.set((prev) => ({ ...prev, models }));
      return models;
    })
    .catch(() => {
      listOnly = null;
      return null;
    });
  return listOnly;
}

export type OpencodeState = OpencodeSettings &
  Status & {
    update: (patch: Partial<OpencodeSettings>) => void;
    refresh: () => void;
  };

export function useOpencode(): OpencodeState {
  const [settings, setSettings] = useState(loadOpencodeSettings);
  const status = statusStore.use();

  useEffect(() => {
    void refreshOpencode(false).then(() => setSettings(loadOpencodeSettings()));
  }, []);

  // Stay in step when the settings change elsewhere (e.g. Code mode picks a folder).
  useEffect(() => {
    const sync = () => setSettings(loadOpencodeSettings());
    window.addEventListener(SETTINGS_EVENT, sync);
    return () => window.removeEventListener(SETTINGS_EVENT, sync);
  }, []);

  const update = useCallback((patch: Partial<OpencodeSettings>) => {
    saveOpencodeSettings(patch);
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const refresh = useCallback(() => void refreshOpencode(true), []);

  return { ...settings, ...status, update, refresh };
}
