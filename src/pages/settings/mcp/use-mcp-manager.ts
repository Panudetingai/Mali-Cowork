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
import { useOpencode } from "@/features/opencode";
import { useCallback, useEffect, useState } from "react";

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Saved connector choices plus live status from OpenCode (shared with the chat's install cards). */
export function useMcpManager() {
  const opencode = useOpencode();
  const connections = useMcpConnections();
  const custom = useCustomMcps();
  const live = useMcpLive();
  const busyMap = useMcpBusy();
  const [error, setError] = useState<string | null>(null);
  const available = !!opencode.check?.available;

  useEffect(() => {
    if (available) void refreshMcpLive();
  }, [available, opencode.cwd]);

  const run = useCallback(async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    }
  }, []);

  /** Save `patch` for one connector and apply it; rolls back if OpenCode refuses. */
  const apply = useCallback(
    (id: string, patch: Partial<McpConnection>) =>
      // Without OpenCode the choice is kept and syncs once it starts.
      available ? run(() => applyConnector(id, patch)) : run(async () => patchMcpConnection(id, patch)),
    [available, run],
  );

  return {
    opencode,
    available,
    connections,
    custom,
    live,
    busy: new Set(Object.keys(busyMap)) as ReadonlySet<string>,
    busyMap,
    error,
    clearError: () => setError(null),
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
