/**
 * Which built-in and custom CLI agents are active. Turned-off agents are not
 * checked at startup, do not appear in the model picker, and do not spawn
 * background servers (OpenCode).
 */
import { createStore } from "@/lib/local-store";
import { invoke } from "@tauri-apps/api/core";
import { useMemo } from "react";

export const BUILTIN_CLI_AGENTS = ["opencode", "cursor", "codex", "antigravity"] as const;
export type BuiltinCliAgentId = (typeof BUILTIN_CLI_AGENTS)[number];

type Prefs = { disabled: string[] };

const store = createStore<Prefs>(
  { disabled: [] },
  {
    key: "mali.cli-agents.disabled",
    revive: (raw) =>
      raw && typeof raw === "object" && Array.isArray((raw as Prefs).disabled)
        ? { disabled: [...new Set((raw as Prefs).disabled.filter((id) => typeof id === "string"))] }
        : { disabled: [] },
  },
);

export function isCliAgentEnabled(id: string): boolean {
  return !store.get().disabled.includes(id);
}

export function setCliAgentEnabled(id: string, enabled: boolean) {
  const wasEnabled = isCliAgentEnabled(id);
  store.set((prefs) => {
    const disabled = new Set(prefs.disabled);
    if (enabled) disabled.delete(id);
    else disabled.add(id);
    return { disabled: [...disabled] };
  });
  if (wasEnabled && !enabled && id === "opencode") {
    void invoke("opencode_shutdown").catch(() => {});
  }
}

export function useCliAgentEnabled(id: string): [boolean, (on: boolean) => void] {
  const { disabled } = store.use();
  const enabled = !disabled.includes(id);
  return [enabled, (on) => setCliAgentEnabled(id, on)];
}

function filterFor(disabled: string[]) {
  const off = new Set(disabled);
  return {
    opencode: !off.has("opencode"),
    cursor: !off.has("cursor"),
    codex: !off.has("codex"),
    antigravity: !off.has("antigravity"),
    customEnabled: (cliId: string) => !off.has(cliId),
  };
}

/** For `buildModelCatalog`: which CLI groups to include. */
export function cliAgentsFilter() {
  return filterFor(store.get().disabled);
}

/**
 * The same, stable until a switch changes: the model catalog is memoised on
 * it, and a fresh object each render rebuilt every model on every keystroke.
 */
export function useCliAgentsFilter() {
  const prefs = store.use();
  return useMemo(() => filterFor(prefs.disabled), [prefs]);
}
