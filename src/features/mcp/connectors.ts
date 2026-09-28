import { invoke } from "@tauri-apps/api/core";
import { createStore } from "@/lib/local-store";
import { signInMcpHub, signOutMcpHub, syncMcpHub, syncMcpServers } from "./api";
import { getCustomMcps, removeCustomMcp, saveCustomMcp, type CustomMcp } from "./custom";
import { setConnectorIcon } from "./icon-override";
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

/**
 * Live status comes from Mali's own MCP hub, which is what the agent uses.
 * The CLIs' config files are still written (`syncMcpServers`) until they get
 * their connectors from Mali too.
 */
export async function refreshMcpLive() {
  try {
    const rows = (await syncMcpHub())?.servers ?? [];
    liveStore.set(Object.fromEntries(rows.map((r) => [r.id, r])));
  } catch {
    // Best effort; the list falls back to the saved state.
  }
}

/** Save a connector's settings and (dis)connect it in Mali's hub; rolls back if that fails. */
export async function applyConnector(id: string, patch: Parameters<typeof patchMcpConnection>[1]) {
  const before = getMcpConnections();
  patchMcpConnection(id, patch);
  setBusy(id, patch.enabled === false ? "disconnecting" : "connecting");
  try {
    await syncMcpServers();
    const result = await syncMcpHub([id]);
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
 * Sign in to a remote connector (OAuth) as Mali Cowork. The provider's page
 * opens in the browser and Mali keeps the tokens; the webview and the AI never see them.
 * `fresh` first forgets any earlier (possibly rejected) app registration.
 */
export async function signInConnector(id: string, { fresh = false } = {}) {
  const connector = getCustomMcps().find((c) => c.id === id);
  const limit = oauthLimitFor(connector?.url);
  if (limit) throw new Error(limit.reason);
  setBusy(id, "signing-in");
  try {
    // Mali signs in as "Mali Cowork" and keeps the tokens for its own hub.
    // The backend waits up to 5 minutes for the browser; the user can stop waiting sooner.
    const cancelled = new Promise<never>((_, reject) => pendingSignIns.set(id, reject));
    const status: McpServerStatus = await Promise.race([signInMcpHub(id, fresh), cancelled]);
    mergeMcpLive([status]);
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
  await signOutMcpHub(id);
  mergeMcpLive([{ id, status: "needs_auth", error: null }]);
}

/** Add (or update) a connector and connect it. */
export async function installConnector(connector: CustomMcp, env: Record<string, string>) {
  const isNew = !getCustomMcps().some((c) => c.id === connector.id);
  saveCustomMcp(connector);
  try {
    return await applyConnector(connector.id, { enabled: true, env });
  } catch (error) {
    // The hub refused the connector: don't keep a new one half-installed.
    if (isNew) {
      removeCustomMcp(connector.id);
      removeMcpConnection(connector.id);
    }
    throw error;
  }
}

export async function removeConnector(id: string) {
  removeCustomMcp(id);
  setConnectorIcon(id, null);
  removeMcpConnection(id);
  liveStore.set(({ [id]: _gone, ...rest }) => rest);
  await signOutMcpHub(id).catch(() => undefined);
  await syncMcpServers({ removed: [id] });
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
