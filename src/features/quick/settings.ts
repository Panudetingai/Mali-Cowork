import { createStore } from "@/lib/local-store";
import { configureQuick } from "./api";
import type { QuickConfig, QuickStatus } from "./types";

export const DEFAULT_QUICK_CONFIG: QuickConfig = {
  enabled: true,
  shortcut: "CommandOrControl+Alt+M",
  trayMode: false,
  saveToHistory: true,
};

// localStorage is shared by the main window and the Quick bar (same origin).
const configStore = createStore<QuickConfig>(DEFAULT_QUICK_CONFIG, {
  key: "mali.quick.config",
  revive: (saved) => ({ ...DEFAULT_QUICK_CONFIG, ...saved }),
});
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
