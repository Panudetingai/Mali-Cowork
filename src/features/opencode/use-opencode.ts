import { createStore } from "@/lib/local-store";
import { useCallback, useEffect, useState } from "react";
import {
  opencodeCheck,
  opencodeDefaultCwd,
  opencodeListModels,
} from "./api";
import { getMcpConnections, syncMcpServers } from "@/features/mcp";
import { loadOpencodeSettings, saveOpencodeSettings } from "./settings";
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
  const models = await opencodeListModels(cwd).catch(() => null);
  if (Object.values(getMcpConnections()).some((c) => c.enabled)) {
    await syncMcpServers(getMcpConnections(), cwd).catch(() => undefined);
  }
  return { check, models };
}

async function ensureCwd(settings: OpencodeSettings) {
  if (settings.cwd) return settings.cwd;
  const cwd = await opencodeDefaultCwd();
  saveOpencodeSettings({ cwd });
  return cwd;
}

/** Reload OpenCode status and models for every component using them. */
export function refreshOpencode(force = true) {
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

  const update = useCallback((patch: Partial<OpencodeSettings>) => {
    saveOpencodeSettings(patch);
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const refresh = useCallback(() => void refreshOpencode(true), []);

  return { ...settings, ...status, update, refresh };
}
