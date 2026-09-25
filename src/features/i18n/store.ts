import { createStore } from "@/lib/local-store";
import { detectDeviceLanguage } from "./detect";
import { translations, type TranslationKey } from "./translations";
import type { Language, LanguageMode, LanguageSettings } from "./types";

const STORAGE_KEY = "mali-cowork-lang-settings";

export function applyLanguageToDOM(lang: Language) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.documentElement.dataset.lang = lang;
}

function resolveLanguage(mode: LanguageMode): Language {
  if (mode === "th") return "th";
  if (mode === "en") return "en";
  return detectDeviceLanguage();
}

function getInitialSettings(): LanguageSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.mode === "auto" || parsed.mode === "th" || parsed.mode === "en")) {
        const current = resolveLanguage(parsed.mode);
        applyLanguageToDOM(current);
        return { mode: parsed.mode, current };
      }
    }
  } catch {}

  const current = detectDeviceLanguage();
  applyLanguageToDOM(current);
  return { mode: "auto", current };
}

const store = createStore<LanguageSettings>(getInitialSettings(), {
  key: STORAGE_KEY,
  persist: (s) => ({ mode: s.mode }),
});

export const useLanguageSettings = store.use;

export function setLanguageMode(mode: LanguageMode) {
  const current = resolveLanguage(mode);
  applyLanguageToDOM(current);
  store.set({ mode, current });
}

export function setLanguage(lang: Language) {
  setLanguageMode(lang);
}

export function toggleLanguage() {
  const state = store.get();
  const next: Language = state.current === "th" ? "en" : "th";
  setLanguageMode(next);
}

export function getLanguage(): Language {
  return store.get().current;
}

export function t(key: TranslationKey): string {
  const lang = getLanguage();
  return translations[lang]?.[key] ?? translations.en[key] ?? key;
}

export function useTranslation() {
  const settings = useLanguageSettings();
  const lang = settings.current;

  const translate = (key: TranslationKey): string => {
    return translations[lang]?.[key] ?? translations.en[key] ?? key;
  };

  return {
    t: translate,
    lang,
    mode: settings.mode,
    setLanguageMode,
    setLanguage,
    toggleLanguage,
  };
}
