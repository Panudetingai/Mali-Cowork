import { createStore } from "@/lib/local-store";
import { detectDeviceLanguage } from "./detect";
import { translations, type TranslationKey } from "./translations";
import type { Language, LanguageMode, LanguageSettings } from "./types";

const STORAGE_KEY = "mali-cowork-lang-settings";

export type TranslationParams = Record<string, string | number>;

export function applyLanguageToDOM(lang: Language) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.documentElement.dataset.lang = lang;
}

function resolveLanguage(mode: LanguageMode): Language {
  if (mode === "th" || mode === "en") return mode;
  return detectDeviceLanguage();
}

function isMode(value: unknown): value is LanguageMode {
  return value === "auto" || value === "th" || value === "en";
}

function settingsFor(mode: LanguageMode): LanguageSettings {
  return { mode, current: resolveLanguage(mode) };
}

// Only `mode` is persisted; `current` is always re-derived so "auto" follows
// the device and a stale or hand-edited value can't leave `current` undefined.
const store = createStore<LanguageSettings>(settingsFor("auto"), {
  key: STORAGE_KEY,
  persist: (s) => ({ mode: s.mode }),
  revive: (saved) => settingsFor(isMode(saved?.mode) ? saved.mode : "auto"),
});

applyLanguageToDOM(store.get().current);

if (typeof window !== "undefined") {
  // Follow the OS language live while in auto mode.
  window.addEventListener("languagechange", () => {
    const { mode, current } = store.get();
    if (mode !== "auto") return;
    const next = detectDeviceLanguage();
    if (next === current) return;
    applyLanguageToDOM(next);
    store.set({ mode, current: next });
  });
}

export const useLanguageSettings = store.use;

export function setLanguageMode(mode: LanguageMode) {
  const next = settingsFor(mode);
  applyLanguageToDOM(next.current);
  store.set(next);
}

export function setLanguage(lang: Language) {
  setLanguageMode(lang);
}

export function toggleLanguage() {
  setLanguageMode(store.get().current === "th" ? "en" : "th");
}

export function getLanguage(): Language {
  return store.get().current;
}

function translate(lang: Language, key: TranslationKey, params?: TranslationParams): string {
  const text: string = translations[lang]?.[key] ?? translations.en[key] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function t(key: TranslationKey, params?: TranslationParams): string {
  return translate(getLanguage(), key, params);
}

export function useTranslation() {
  const settings = useLanguageSettings();
  const lang = settings.current;

  return {
    t: (key: TranslationKey, params?: TranslationParams) => translate(lang, key, params),
    lang,
    mode: settings.mode,
    setLanguageMode,
    setLanguage,
    toggleLanguage,
  };
}
