import {
  fetchMcpStatus,
  getMcpConnections,
  patchMcpConnection,
  removeCustomMcp,
  removeMcpConnection,
  setMcpConnections,
  syncMcpServers,
  useCustomMcps,
  useMcpConnections,
  type McpConnection,
  type McpServerStatus,
} from "@/features/mcp";
import { useOpencode } from "@/features/opencode";
import { useCallback, useEffect, useState } from "react";

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Saved MCP choices plus live status from OpenCode, with safe apply/rollback. */
export function useMcpManager() {
  const opencode = useOpencode();
  const connections = useMcpConnections();
  const custom = useCustomMcps();
  const [live, setLive] = useState<Record<string, McpServerStatus>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const available = !!opencode.check?.available;
  const cwd = opencode.cwd || undefined;

  const mergeLive = (rows: McpServerStatus[]) =>
    setLive((prev) => ({ ...prev, ...Object.fromEntries(rows.map((r) => [r.id, r])) }));

  const refreshLive = useCallback(async () => {
    if (!available) return;
    try {
      const rows = await fetchMcpStatus(cwd);
      setLive(Object.fromEntries(rows.map((r) => [r.id, r])));
    } catch {
      // Status is best effort; the cards fall back to the saved state.
    }
  }, [available, cwd]);

  useEffect(() => {
    void refreshLive();
  }, [refreshLive]);

  const setBusyFor = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Save `patch` for one server and apply it; rolls back if OpenCode refuses. */
  const apply = useCallback(
    async (id: string, patch: Partial<McpConnection>) => {
      const before = getMcpConnections();
      patchMcpConnection(id, patch);
      // Without OpenCode just keep the choice; it syncs when OpenCode starts.
      if (!available) return true;
      setBusyFor(id, true);
      setError(null);
      try {
        const result = await syncMcpServers({ cwd, targets: [id] });
        if (result) mergeLive(result.servers);
        return true;
      } catch (e) {
        setMcpConnections(before);
        setError(message(e));
        return false;
      } finally {
        setBusyFor(id, false);
      }
    },
    [available, cwd],
  );

  const removeCustom = useCallback(
    async (id: string) => {
      removeCustomMcp(id);
      removeMcpConnection(id);
      setLive(({ [id]: _gone, ...rest }) => rest);
      if (!available) return;
      try {
        await syncMcpServers({ cwd, targets: [], removed: [id] });
      } catch (e) {
        setError(message(e));
      }
    },
    [available, cwd],
  );

  return {
    opencode,
    available,
    connections,
    custom,
    live,
    busy,
    error,
    clearError: () => setError(null),
    apply,
    removeCustom,
    refreshLive,
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
