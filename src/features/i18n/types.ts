export type Language = "th" | "en";

export type LanguageMode = "auto" | "th" | "en";

export interface LanguageSettings {
  mode: LanguageMode;
  current: Language;
}
