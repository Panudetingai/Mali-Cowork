import { normalizeFolder } from "@/features/workspace";
import { MCP_SERVERS, type McpDef } from "./catalog";
import type { McpConnection, McpState } from "./store";

export type McpServerEntry = {
  id: string;
  enabled: boolean;
  command: string[];
  /** Alternative argv lists the backend tries in order when the primary fails. */
  fallbacks: string[][];
  environment: Record<string, string>;
  timeoutMs: number;
};

export type McpServerStatus = {
  id: string;
  status: string;
  error?: string | null;
};

export type McpSyncResult = {
  servers: McpServerStatus[];
};

export function parseCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

/** Normalize legacy boolean entries to connection objects. */
export function asConnection(value: McpState[string]): McpConnection | undefined {
  if (typeof value === "boolean") return { enabled: value };
  return value;
}

/** Effective launch command: manual override wins, then the chosen variant, then stock. */
export function effectiveCommand(server: McpDef, conn?: McpConnection): string {
  const custom = conn?.customCommand?.trim();
  if (custom) return custom;
  if (conn?.variantId && server.variants) {
    const variant = server.variants.find((v) => v.id === conn.variantId);
    if (variant) return variant.command;
  }
  return server.command;
}

function buildArgv(server: McpDef, command: string, coworkPaths?: string[]): string[] {
  const argv = parseCommand(command);
  if (server.id === "filesystem" && coworkPaths?.length) {
    return [...argv, ...coworkPaths.map(normalizeFolder)];
  }
  return argv;
}

export function buildMcpSyncPayload(
  connections: McpState,
  coworkPaths?: string[],
): McpServerEntry[] {
  return MCP_SERVERS.map((server) => {
    const conn = asConnection(connections[server.id]);
    const enabled = !!conn?.enabled;
    const primary = effectiveCommand(server, conn);
    const fallbacks = (server.variants ?? [])
      .map((v) => v.command)
      .filter((c) => c !== primary);
    return {
      id: server.id,
      enabled,
      command: buildArgv(server, primary, enabled ? coworkPaths : undefined),
      fallbacks: enabled
        ? fallbacks.map((c) => buildArgv(server, c, coworkPaths))
        : [],
      environment: { ...(conn?.env ?? {}) },
      timeoutMs: server.timeoutMs ?? 60_000,
    };
  });
}

export function connectionForServer(
  connections: McpState,
  server: McpDef,
): McpConnection | undefined {
  return asConnection(connections[server.id]);
}
