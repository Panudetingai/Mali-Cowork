import { invoke } from "@tauri-apps/api/core";
import { getCustomMcps } from "./custom";
import { getMcpConnections } from "./store";
import { buildMcpSyncPayload, type McpSyncResult } from "./sync";

export type McpBinaryStatus = {
  binary: string;
  found: boolean;
  path?: string | null;
};

export type McpDiagnoseResult = {
  binaries: McpBinaryStatus[];
  platform: "windows" | "macos" | "linux" | null;
};

function isTauri() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
  );
}

export type McpSyncOptions = {
  /** Cowork folder: the Filesystem server gets it, and servers run there. */
  cwd?: string;
  /** Only (re)connect these ids; everything is still written to the config. */
  targets?: string[];
  /** Custom servers the user deleted. */
  removed?: string[];
  /**
   * `chat`: connect in Chat mode's session instead of `cwd`. The Filesystem
   * server is left out there, since Chat has no file access.
   */
  mode?: "chat";
  /**
   * OpenCode live connect. Default true. Use false before Codex/Gemini runs —
   * still writes OpenCode JSON + Codex TOML without starting MCP processes.
   */
  liveConnect?: boolean;
};

/** Push the saved MCP servers into OpenCode (config + running server). */
export async function syncMcpServers({
  cwd,
  targets,
  removed,
  mode,
  liveConnect,
}: McpSyncOptions = {}): Promise<McpSyncResult | null> {
  if (!isTauri()) return null;
  const servers = buildMcpSyncPayload(getMcpConnections(), getCustomMcps(), cwd ? [cwd] : undefined);
  const chatTargets = mode === "chat" ? servers.map((s) => s.id).filter((id) => id !== "filesystem") : undefined;
  return invoke<McpSyncResult>("mcp_sync", {
    servers,
    directory: mode === "chat" ? null : (cwd ?? null),
    options: {
      targets: targets ?? chatTargets ?? null,
      removed: removed ?? [],
      mode: mode ?? null,
      liveConnect: liveConnect ?? null,
    },
  });
}

/** True when at least one MCP server is switched on. */
export function hasEnabledMcp() {
  return Object.values(getMcpConnections()).some((c) => c.enabled);
}

export async function fetchMcpStatus(coworkCwd?: string) {
  if (!isTauri()) return [];
  return invoke<McpSyncResult["servers"]>("mcp_status", {
    directory: coworkCwd ?? null,
  });
}

/** Which launcher binaries (uvx, npx, docker, …) exist on this machine. */
export async function diagnoseMcpBinaries(): Promise<McpDiagnoseResult> {
  if (!isTauri()) return { binaries: [], platform: null };
  return invoke<McpDiagnoseResult>("mcp_diagnose");
}
