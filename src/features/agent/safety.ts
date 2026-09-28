import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

const SANDBOX_KEY = "agent_sandbox_commands";
const EVENT = "agent-safety";

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
