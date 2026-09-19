import { Channel, invoke } from "@tauri-apps/api/core";

export type ToolId = "node" | "git" | "brew" | "winget" | "uv" | "opencode" | "codex" | "gemini" | "cursor";

export type ToolState = {
  id: ToolId;
  name: string;
  installed: boolean;
  path?: string;
  version?: string;
  /** Installed but too old (Node.js < 20). */
  outdated: boolean;
};

export type SetupScan = {
  platform: "macos" | "windows" | "linux";
  /** `MALI_SIMULATE_NEW_USER=1`: nothing is really installed. */
  simulated: boolean;
  tools: ToolState[];
};

export type Recipe = { tool: ToolId; display: string; via: "npm" | "brew" | "winget" | "script" };
export type Blocked = { tool: ToolId; reason: string; helpUrl?: string };
export type SetupPlan = { steps: Recipe[]; blocked: Blocked[] };

export const setupApi = {
  scan: () => invoke<SetupScan>("setup_scan"),
  /** The commands installing `tools` would run; nothing runs yet. */
  plan: (tools: ToolId[]) => invoke<SetupPlan>("setup_plan", { tools }),
  /** Install one tool; `onLog` gets its output line by line. */
  install: (tool: ToolId, onLog: (line: string) => void) => {
    const channel = new Channel<{ event: "log"; line: string }>();
    channel.onmessage = (message) => onLog(message.line);
    return invoke<SetupScan>("setup_install", { tool, onEvent: channel });
  },
  cancel: (tool: ToolId) => invoke<void>("setup_cancel", { tool }),
  codexLogin: () => invoke<{ loggedIn: boolean; account?: string }>("setup_codex_login"),
};

export function isInstalled(scan: SetupScan | undefined, id: ToolId) {
  return !!scan?.tools.find((t) => t.id === id && t.installed && !t.outdated);
}
