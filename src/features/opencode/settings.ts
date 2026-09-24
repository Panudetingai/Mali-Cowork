import { useEffect, useState } from "react";
import type { OpencodeSettings } from "./types";

const KEYS = {
  cwd: "opencode_cwd",
  thinking: "opencode_thinking",
  autoApprove: "opencode_auto_approve",
} as const;

export function loadOpencodeSettings(): OpencodeSettings {
  try {
    return {
      cwd: localStorage.getItem(KEYS.cwd) ?? "",
      thinking: localStorage.getItem(KEYS.thinking) === "true",
      autoApprove: localStorage.getItem(KEYS.autoApprove) === "true",
    };
  } catch {
    return { cwd: "", thinking: false, autoApprove: false };
  }
}

export function saveOpencodeSettings(patch: Partial<OpencodeSettings>) {
  try {
    for (const [key, value] of Object.entries(patch)) {
      localStorage.setItem(KEYS[key as keyof OpencodeSettings], String(value));
    }
  } catch {
    // Storage can be unavailable; settings then last for this session only.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SETTINGS_EVENT));
}

/** Fired after the settings change, e.g. the Cowork folder picked in the composer. */
export const SETTINGS_EVENT = "opencode-settings";

/** The default Cowork folder, kept current. */
export function useDefaultCwd() {
  const [cwd, setCwd] = useState(() => loadOpencodeSettings().cwd);
  useEffect(() => {
    const sync = () => setCwd(loadOpencodeSettings().cwd);
    window.addEventListener(SETTINGS_EVENT, sync);
    return () => window.removeEventListener(SETTINGS_EVENT, sync);
  }, []);
  return cwd;
}
