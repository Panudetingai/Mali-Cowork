import { createStore } from "@/lib/local-store";
import { isTauri } from "@tauri-apps/api/core";
import { setNotchScreen, type NotchScreen } from "./bridge";
import { DEFAULT_RATES } from "./recap";
import type { NotchLook, NotchRates } from "./types";

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

const LOOK_KEY = "mali.notch.look";

/**
 * Settings → Notch: how the open pill looks — the notch's own black, frosted
 * glass, or light. Collapsed stays black; open light is white through the top row.
 */
const lookStore = createStore<NotchLook>("black", { key: LOOK_KEY });

export const useNotchLook = lookStore.use;
export const setNotchLook = (look: NotchLook) => lookStore.set(look);

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== LOOK_KEY || !event.newValue) return;
    try {
      lookStore.set(JSON.parse(event.newValue) as NotchLook);
    } catch {
      // Not ours to fix; the next change writes it again.
    }
  });
}

const GLASS_BLUR_KEY = "mali.notch.glassBlur";
const GLASS_BLUR_DEFAULT = 55;

/** Settings → Notch → Glass: 0 = softer tint, 100 = strongest frosted blur. */
const glassBlurStore = createStore<number>(GLASS_BLUR_DEFAULT, { key: GLASS_BLUR_KEY });

export const useNotchGlassBlur = glassBlurStore.use;

export function setNotchGlassBlur(amount: number) {
  glassBlurStore.set(Math.round(Math.min(100, Math.max(0, amount))));
}

/** Fresh read for the notch window when Settings writes in another webview. */
export function getNotchGlassBlur() {
  try {
    const raw = localStorage.getItem(GLASS_BLUR_KEY);
    if (raw === null) return GLASS_BLUR_DEFAULT;
    const n = JSON.parse(raw) as number;
    return Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) : GLASS_BLUR_DEFAULT;
  } catch {
    return glassBlurStore.get();
  }
}

/** Maps the slider to CSS blur and tint strength for the glass shell. */
export function glassBlurVisuals(amount: number) {
  const t = Math.min(1, Math.max(0, amount / 100));
  return {
    blurPx: Math.round(6 + t * 34),
    tintAlpha: 0.4 - t * 0.24,
    hoodAlpha: 0.5 - t * 0.3,
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== GLASS_BLUR_KEY) return;
    glassBlurStore.set(getNotchGlassBlur());
  });
}

const RATES_KEY = "mali.notch.rates";

/**
 * The weekly recap's time-saved estimate: minutes a person would take per
 * task, new file, edited file and command. Adjusted from the recap itself.
 */
const ratesStore = createStore<NotchRates>(DEFAULT_RATES, {
  key: RATES_KEY,
  revive: (rates) => ({ ...DEFAULT_RATES, ...rates }),
});

export const useNotchRates = ratesStore.use;
export function setNotchRates(rates: NotchRates) {
  const clean = (n: number) => Math.round(Math.min(240, Math.max(0, Number.isFinite(n) ? n : 0)) * 10) / 10;
  ratesStore.set({ task: clean(rates.task), created: clean(rates.created), edited: clean(rates.edited), command: clean(rates.command) });
}
