import { invoke } from "@tauri-apps/api/core";
import { buildMcpSyncPayload, type McpSyncResult } from "./sync";
import type { McpState } from "./store";

export type McpBinaryStatus = {
  binary: string;
  found: boolean;
  path?: string | null;
};

export type McpDiagnoseResult = {
  binaries: McpBinaryStatus[];
  microsoftWord: boolean | null;
};

function isTauri() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI__" in window || "__TAURI_INTERNALS__" in window)
  );
}

/** Push enabled MCP servers into OpenCode (config + running server). */
export async function syncMcpServers(
  connections: McpState,
  coworkCwd?: string,
): Promise<McpSyncResult | null> {
  if (!isTauri()) return null;
  const paths = coworkCwd ? [coworkCwd] : undefined;
  const servers = buildMcpSyncPayload(connections, paths);
  return invoke<McpSyncResult>("mcp_sync", {
    servers,
    directory: coworkCwd ?? null,
  });
}

export async function fetchMcpStatus(coworkCwd?: string) {
  if (!isTauri()) return [];
  return invoke<McpSyncResult["servers"]>("mcp_status", {
    directory: coworkCwd ?? null,
  });
}

/** Which launcher binaries (uvx, npx, docker, …) exist on this machine. */
export async function diagnoseMcpBinaries(): Promise<McpDiagnoseResult> {
  if (!isTauri()) {
    return { binaries: [], microsoftWord: null };
  }
  return invoke<McpDiagnoseResult>("mcp_diagnose");
}
