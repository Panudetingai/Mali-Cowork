import { invoke } from "@tauri-apps/api/core";
import { createStore } from "@/lib/local-store";
import { loadOpencodeSettings } from "@/features/opencode/settings";
import { fetchMcpStatus, syncMcpServers } from "./api";
import { getCustomMcps, removeCustomMcp, saveCustomMcp, type CustomMcp } from "./custom";
import { oauthLimitFor } from "./oauth-limits";
import type { RegistryServer } from "./registry";
import { getMcpConnections, patchMcpConnection, removeMcpConnection, setMcpConnections } from "./store";
import type { McpServerStatus } from "./sync";

/**
 * Connect, sign in and install, shared by Settings → Connectors and the
 * install card the AI shows in chat. Live status is kept in one store so
 * both see the same thing.
 */

const liveStore = createStore<Record<string, McpServerStatus>>({});
const busyStore = createStore<Record<string, "connecting" | "disconnecting" | "signing-in">>({});

export const useMcpLive = liveStore.use;
export const useMcpBusy = busyStore.use;

export function mergeMcpLive(rows: McpServerStatus[]) {
  if (rows.length) liveStore.set((prev) => ({ ...prev, ...Object.fromEntries(rows.map((r) => [r.id, r])) }));
}

function setBusy(id: string, state?: "connecting" | "disconnecting" | "signing-in") {
  busyStore.set(({ [id]: _old, ...rest }) => (state ? { ...rest, [id]: state } : rest));
}

/** Connectors run in the default Cowork folder's OpenCode instance. */
function folder() {
  return loadOpencodeSettings().cwd || undefined;
}

export async function refreshMcpLive() {
  try {
    const rows = await fetchMcpStatus(folder());
    liveStore.set(Object.fromEntries(rows.map((r) => [r.id, r])));
  } catch {
    // Best effort; the list falls back to the saved state.
  }
}

/** Save a connector's settings and (dis)connect it; rolls back if OpenCode refuses. */
export async function applyConnector(id: string, patch: Parameters<typeof patchMcpConnection>[1]) {
  const before = getMcpConnections();
  patchMcpConnection(id, patch);
  setBusy(id, patch.enabled === false ? "disconnecting" : "connecting");
  try {
    const result = await syncMcpServers({ cwd: folder(), targets: [id] });
    if (result) mergeMcpLive(result.servers);
    return result?.servers.find((s) => s.id === id);
  } catch (error) {
    setMcpConnections(before);
    throw error;
  } finally {
    setBusy(id);
  }
}

const pendingSignIns = new Map<string, (error: Error) => void>();

/**
 * Sign in to a remote connector (OAuth). OpenCode opens the provider's page
 * in the browser and keeps the tokens itself; the app and the AI never see them.
 * `fresh` first forgets any earlier (possibly rejected) app registration.
 */
export async function signInConnector(id: string, { fresh = false } = {}) {
  const connector = getCustomMcps().find((c) => c.id === id);
  const limit = oauthLimitFor(connector?.url);
  if (limit) throw new Error(limit.reason);
  setBusy(id, "signing-in");
  try {
    if (fresh) {
      await invoke("mcp_auth_remove", { id, directory: folder() ?? null, mode: null }).catch(() => undefined);
    }
    // Register "Mali Cowork" as the app asking for access (instead of OpenCode),
    // then reconnect so OpenCode uses that client. Servers without app
    // registration keep OpenCode's own sign-in.
    if (connector?.kind === "remote" && connector.url) {
      const branded = await invoke<boolean>("mcp_oauth_prepare", { id, url: connector.url, fresh }).catch(() => false);
      if (branded) await syncMcpServers({ cwd: folder(), targets: [id] }).catch(() => undefined);
    }
    // The backend waits up to 5 minutes for the browser; the user can stop waiting sooner.
    const cancelled = new Promise<never>((_, reject) => pendingSignIns.set(id, reject));
    const status = await Promise.race([
      invoke<McpServerStatus>("mcp_auth", { id, directory: folder() ?? null, mode: null }),
      cancelled,
    ]);
    mergeMcpLive([status]);
    // Chat mode has its own OpenCode instance; reconnect there with the new tokens.
    void syncMcpServers({ mode: "chat", targets: [id] }).catch(() => undefined);
    return status;
  } finally {
    pendingSignIns.delete(id);
    setBusy(id);
  }
}

/** Stop waiting for a sign-in (e.g. the provider's page showed an error). */
export function cancelSignIn(id: string) {
  // Frees the loopback callback too, so the next attempt can start right away.
  void invoke("mcp_auth_cancel", { id }).catch(() => undefined);
  pendingSignIns.get(id)?.(new Error("Sign-in cancelled"));
}

export async function signOutConnector(id: string) {
  await invoke("mcp_auth_remove", { id, directory: folder() ?? null, mode: null });
  mergeMcpLive([{ id, status: "needs_auth", error: null }]);
}

/** Add (or update) a connector and connect it. */
export async function installConnector(connector: CustomMcp, env: Record<string, string>) {
  const isNew = !getCustomMcps().some((c) => c.id === connector.id);
  saveCustomMcp(connector);
  try {
    return await applyConnector(connector.id, { enabled: true, env });
  } catch (error) {
    // OpenCode refused the config: don't keep a new connector half-installed.
    if (isNew) {
      removeCustomMcp(connector.id);
      removeMcpConnection(connector.id);
    }
    throw error;
  }
}

export async function removeConnector(id: string) {
  removeCustomMcp(id);
  removeMcpConnection(id);
  liveStore.set(({ [id]: _gone, ...rest }) => rest);
  await syncMcpServers({ cwd: folder(), targets: [], removed: [id] });
}

/** The installed connector for a registry entry, if any. */
export function installedFromRegistry(name: string, custom: CustomMcp[] = getCustomMcps()) {
  return custom.find((c) => c.registry?.name === name);
}

// ---------------------------------------------------------------- Install requests

export type InstallRequest = {
  /** A server picked from the registry. */
  server?: RegistryServer;
  /** Or: find it (from the AI's `connector` card). */
  query?: string;
  /** Asked for by the AI in chat: the dialog says so. */
  fromChat?: boolean;
};

const requestStore = createStore<InstallRequest | null>(null);
export const useInstallRequest = requestStore.use;

/** Open the install dialog (mounted once in the app layout). */
export function requestConnectorInstall(request: InstallRequest) {
  requestStore.set(request);
}

export function closeInstallRequest() {
  requestStore.set(null);
}
