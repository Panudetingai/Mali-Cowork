import { createStore } from "@/lib/local-store";
import { isTauri } from "@tauri-apps/api/core";
import { setNotchScreen, type NotchScreen } from "./bridge";

const ENABLED_KEY = "mali.notch.enabled";

/** Settings → Quick bar: show the pill while the main window is away. */
const enabledStore = createStore<boolean>(true, { key: ENABLED_KEY });

export const useNotchEnabled = enabledStore.use;
export const isNotchEnabled = enabledStore.get;
export const setNotchEnabled = (enabled: boolean) => enabledStore.set(enabled);
export const subscribeToNotchEnabled = enabledStore.subscribe;

const SAVE_KEY = "mali.notch.saveChats";

/**
 * Settings → Quick bar: keep what you ask in the notch as chats. Off for
 * quick questions you don't want in history. The notch window reads it when
 * it sends, so a change in Settings counts from the next question.
 */
const saveStore = createStore<boolean>(true, { key: SAVE_KEY });

export const useNotchSaveChats = saveStore.use;
export const setNotchSaveChats = (save: boolean) => saveStore.set(save);

/** Read fresh from storage: Settings writes it in the other window. */
export function isNotchSaveChats() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw === null ? true : JSON.parse(raw) !== false;
  } catch {
    return saveStore.get();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === SAVE_KEY) saveStore.set(isNotchSaveChats());
  });
}

const MODEL_KEY = "mali.notch.modelId";

/** The model the notch answers with; unset follows the Quick bar's. Picked in the notch itself. */
const modelStore = createStore<string | null>(null, { key: MODEL_KEY });

export const useNotchModelId = modelStore.use;
export const setNotchModelId = (id: string | null) => modelStore.set(id);

const SCREEN_KEY = "mali.notch.screen";

/**
 * Settings → Notch: which screen the pill lives on with more than one — the
 * one the pointer is on (it follows you), the Mac's own display (with the
 * notch), or the main display. Each window tells Rust when it changes.
 */
const screenStore = createStore<NotchScreen>("follow", { key: SCREEN_KEY });

export const useNotchScreen = screenStore.use;
export const getNotchScreen = screenStore.get;

export function setNotchScreenPref(pref: NotchScreen) {
  screenStore.set(pref);
  if (isTauri()) void setNotchScreen(pref).catch(() => undefined);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== SCREEN_KEY || !event.newValue) return;
    try {
      screenStore.set(JSON.parse(event.newValue) as NotchScreen);
    } catch {
      // Not ours to fix; the next change writes it again.
    }
  });
}
