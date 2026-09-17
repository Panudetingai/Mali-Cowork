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
}
