import { invoke } from "@tauri-apps/api/core";
import { getCustomMcps } from "./custom";
import { getMcpConnections } from "./store";
import { buildMcpSyncPayload, type McpSyncResult } from "./sync";
import { whenVaultReady } from "@/features/secrets";

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
  /** Custom connectors the user deleted, so their old entries elsewhere go too. */
  removed?: string[];
};

/**
 * Hand the saved connectors to Mali's MCP hub. The CLI agents reach them
 * through Mali's `mali` gateway, only while they run inside Mali, so nothing
 * is written into their config files — and what Mali wrote there before is
 * taken back out. Resolves with no statuses: those come from `syncMcpHub`.
 */
export async function syncMcpServers({ removed }: McpSyncOptions = {}): Promise<McpSyncResult | null> {
  if (!isTauri()) return null;
  // Tokens come from the keychain; syncing before they load would drop them.
  await whenVaultReady();
  const servers = buildMcpSyncPayload(getMcpConnections(), getCustomMcps());
  await invoke("mcp_hub_set_servers", { servers });
  const ids = [...servers.map((s) => s.id), ...(removed ?? [])];
  await invoke("mcp_release_other_apps", { ids }).catch(() => undefined);
  return { servers: [] };
}

/** True when at least one MCP server is switched on. */
export function hasEnabledMcp() {
  return Object.values(getMcpConnections()).some((c) => c.enabled);
}

/** Built-ins that only exist for OpenCode; Mali's agent has its own file and shell tools. */
const NOT_FOR_HUB = new Set(["filesystem", "exec"]);

/** True when a connector Mali's own agent would use is switched on. */
export function hasHubMcp() {
  return Object.entries(getMcpConnections()).some(([id, c]) => c.enabled && !NOT_FOR_HUB.has(id));
}

/** Which launcher binaries (uvx, npx, docker, …) exist on this machine. */
export async function diagnoseMcpBinaries(): Promise<McpDiagnoseResult> {
  if (!isTauri()) return { binaries: [], platform: null };
  return invoke<McpDiagnoseResult>("mcp_diagnose");
}

/**
 * The connectors as Mali's own MCP hub reaches them: the ones that are on,
 * with their secrets from the keychain. Sent to Mali's agent with each run.
 */
export async function hubMcpServers(cwd?: string) {
  await whenVaultReady();
  return buildMcpSyncPayload(getMcpConnections(), getCustomMcps(), cwd ? [cwd] : undefined).filter((s) => s.enabled);
}

/** Connect what's on and close what's off in Mali's hub; the live status of each. */
export async function syncMcpHub(targets?: string[]): Promise<McpSyncResult | null> {
  if (!isTauri()) return null;
  await whenVaultReady();
  const servers = buildMcpSyncPayload(getMcpConnections(), getCustomMcps());
  return invoke<McpSyncResult>("mcp_hub_sync", { servers, targets: targets ?? null });
}

/** Sign in to a remote connector as Mali Cowork; Mali keeps the tokens. */
export async function signInMcpHub(id: string, fresh: boolean) {
  await whenVaultReady();
  const server = buildMcpSyncPayload(getMcpConnections(), getCustomMcps()).find((s) => s.id === id);
  if (!server) throw new Error("This connector isn't installed.");
  return invoke<McpSyncResult["servers"][number]>("mcp_hub_sign_in", { server: { ...server, enabled: true }, fresh });
}

export function signOutMcpHub(id: string) {
  return invoke("mcp_hub_sign_out", { id });
}
