import type { Language } from "./types";

/**
 * Detects the device / system language.
 * Returns "th" if the system language is Thai (e.g. "th", "th-TH"),
 * otherwise defaults to "en" for any other language.
 */
export function detectDeviceLanguage(): Language {
  if (typeof navigator === "undefined") return "en";

  const languages = navigator.languages && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language || ""];

  for (const lang of languages) {
    if (lang && lang.trim().toLowerCase().startsWith("th")) {
      return "th";
    }
  }

  return "en";
}
