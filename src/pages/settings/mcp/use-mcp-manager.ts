import {
  applyConnector,
  patchMcpConnection,
  refreshMcpLive,
  removeConnector,
  signInConnector,
  signOutConnector,
  useCustomMcps,
  useMcpBusy,
  useMcpConnections,
  useMcpLive,
  type McpConnection,
  type McpServerStatus,
} from "@/features/mcp";
import { toastFailure } from "@/components/ui/sonner";
import { useOpencode } from "@/features/opencode";
import { useCallback, useEffect } from "react";

/** Saved connector choices plus live status from Mali's hub (shared with the chat's install cards). */
export function useMcpManager() {
  const opencode = useOpencode();
  const connections = useMcpConnections();
  const custom = useCustomMcps();
  const live = useMcpLive();
  const busyMap = useMcpBusy();
  const available = !!opencode.check?.available;
  const hub =
    typeof window !== "undefined" &&
    ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

  useEffect(() => {
    if (hub) void refreshMcpLive();
  }, [hub, opencode.cwd]);

  const run = useCallback(async (work: () => Promise<unknown>) => {
    try {
      await work();
      return true;
    } catch (e) {
      toastFailure("Couldn't save or connect", e);
      return false;
    }
  }, []);

  /** Save `patch` for one connector and apply it in Mali's hub; rolls back if the hub refuses. */
  const apply = useCallback(
    (id: string, patch: Partial<McpConnection>) =>
      hub ? run(() => applyConnector(id, patch)) : run(async () => patchMcpConnection(id, patch)),
    [hub, run],
  );

  return {
    opencode,
    available,
    connections,
    custom,
    live,
    busy: new Set(Object.keys(busyMap)) as ReadonlySet<string>,
    busyMap,
    apply,
    removeCustom: (id: string) => run(() => removeConnector(id)).then(() => undefined),
    // Cancelling the browser sign-in isn't an error worth showing.
    signIn: (id: string) =>
      run(() => signInConnector(id).catch((e) => (String(e).includes("cancelled") ? undefined : Promise.reject(e)))),
    signOut: (id: string) => run(() => signOutConnector(id)),
    refreshLive: refreshMcpLive,
  };
}

export type McpManager = ReturnType<typeof useMcpManager>;

export type CardState = {
  tone: "success" | "warning" | "danger" | "neutral" | "pending";
  label: string;
};

export function cardState({
  enabled,
  busy,
  live,
  available,
  needsSetup,
}: {
  enabled: boolean;
  busy: boolean;
  live?: McpServerStatus;
  available: boolean;
  needsSetup: boolean;
}): CardState {
  if (busy) return { tone: "pending", label: enabled ? "Connecting…" : "Disconnecting…" };
  if (!enabled) return needsSetup ? { tone: "neutral", label: "Needs setup" } : { tone: "neutral", label: "Connect" };
  if (!available) return { tone: "neutral", label: "Enabled" };
  switch (live?.status) {
    case "connected":
      return { tone: "success", label: "Connected" };
    case "failed":
      return { tone: "danger", label: "Failed" };
    case "needs_auth":
    case "needs_client_registration":
      return { tone: "warning", label: "Needs sign-in" };
    default:
      // Not started in this folder yet; it connects with the next Cowork prompt.
      return { tone: "neutral", label: "Enabled" };
  }
}
