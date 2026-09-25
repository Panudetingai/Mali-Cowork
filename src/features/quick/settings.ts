import { createStore } from "@/lib/local-store";
import { configureQuick } from "./api";
import type { QuickConfig, QuickStatus } from "./types";

export const DEFAULT_QUICK_CONFIG: QuickConfig = {
  enabled: true,
  shortcut: "CommandOrControl+Alt+M",
  trayMode: false,
  saveToHistory: true,
};

const CONFIG_KEY = "mali.quick.config";

// localStorage is shared by the main window and the Quick bar (same origin).
const configStore = createStore<QuickConfig>(DEFAULT_QUICK_CONFIG, {
  key: CONFIG_KEY,
  revive: (saved) => ({ ...DEFAULT_QUICK_CONFIG, ...saved }),
});

/**
 * Pick up changes made in the other window. The store reads storage only at
 * load, and the Quick bar stays loaded (it's hidden, not closed), so without
 * this a model picked in Settings never reached it. Only a real change is
 * applied, so the two windows don't write back and forth.
 */
export function reloadQuickConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const next: QuickConfig = { ...DEFAULT_QUICK_CONFIG, ...(raw ? JSON.parse(raw) : {}) };
    if (JSON.stringify(next) !== JSON.stringify(configStore.get())) configStore.set(next);
  } catch {
    // Unreadable: keep what we have.
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === CONFIG_KEY) reloadQuickConfig();
  });
}
const statusStore = createStore<QuickStatus | undefined>(undefined);

export const useQuickConfig = configStore.use;
export const getQuickConfig = configStore.get;
export const useQuickStatus = statusStore.use;

/** Save and apply; resolves with whether the shortcut is live. */
export async function setQuickConfig(patch: Partial<QuickConfig>) {
  configStore.set((prev) => ({ ...prev, ...patch }));
  return applyQuickConfig();
}

/** Main window, once at startup: register the saved shortcut and tray mode. */
export async function applyQuickConfig() {
  try {
    const status = await configureQuick(configStore.get());
    statusStore.set(status);
    return status;
  } catch (error) {
    const status: QuickStatus = { registered: false, shortcut: configStore.get().shortcut, error: String(error) };
    statusStore.set(status);
    return status;
  }
}
