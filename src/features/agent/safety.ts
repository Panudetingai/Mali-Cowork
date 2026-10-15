import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

const SANDBOX_KEY = "agent_sandbox_commands";
const ALWAYS_KEY = "agent_always_commands";
const EVENT = "agent-safety";

/** Longest program name the list takes. */
const MAX_PROGRAM = 64;

/**
 * A program name for the "always allow" list: one word, nothing a shell would
 * read as more than one command. `null` when it can't be used.
 */
export function cleanProgram(raw: string): string | null {
  const name = raw.trim();
  if (!name || name.length > MAX_PROGRAM) return null;
  return /^[A-Za-z0-9._+-]+$/.test(name) ? name : null;
}

/** Programs whose commands run without asking, in every chat. */
export function loadAlwaysCommands(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(ALWAYS_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((v): v is string => typeof v === "string").map(cleanProgram).filter((v): v is string => !!v))];
  } catch {
    return [];
  }
}

export function saveAlwaysCommands(programs: string[]) {
  try {
    localStorage.setItem(ALWAYS_KEY, JSON.stringify(programs));
  } catch {
    // Storage can be unavailable; the list then lasts for this session only.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useAlwaysCommands() {
  const [programs, setPrograms] = useState(loadAlwaysCommands);
  useEffect(() => {
    const sync = () => setPrograms(loadAlwaysCommands());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return [programs, saveAlwaysCommands] as const;
}

/** Run the agent's shell commands inside the OS sandbox. On unless turned off. */
export function loadCommandSandbox(): boolean {
  try {
    return localStorage.getItem(SANDBOX_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveCommandSandbox(on: boolean) {
  try {
    localStorage.setItem(SANDBOX_KEY, String(on));
  } catch {
    // Storage can be unavailable; the default (on) then applies.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useCommandSandbox() {
  const [on, setOn] = useState(loadCommandSandbox);
  useEffect(() => {
    const sync = () => setOn(loadCommandSandbox());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return [on, saveCommandSandbox] as const;
}

/** The sandbox this machine has (e.g. "macOS Seatbelt"), or null. */
export function sandboxEngine() {
  return invoke<string | null>("sandbox_engine");
}
