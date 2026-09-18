import { normalizeFolder } from "@/features/workspace";
import { MCP_SERVERS, type McpDef } from "./catalog";
import type { CustomMcp } from "./custom";
import type { McpConnection, McpState } from "./store";

export type McpServerEntry = {
  id: string;
  enabled: boolean;
  kind: "local" | "remote";
  command: string[];
  /** Alternative argv lists the backend tries in order when the primary fails. */
  fallbacks: string[][];
  environment: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
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

/**
 * Split a command line into argv. Quotes keep spaces together, so paths like
 * `"C:\Program Files\x.exe"` survive. No shell is involved: nothing expands.
 */
export function parseCommand(command: string): string[] {
  const argv: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const ch of command.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || current) argv.push(current);
      current = "";
      started = false;
    } else {
      current += ch;
    }
  }
  if (started || current) argv.push(current);
  return argv;
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

/** Required variables that still have no value. */
export function missingEnv(server: McpDef, conn?: McpConnection) {
  return (server.envVars ?? []).filter((f) => f.required && !conn?.env?.[f.var]?.trim());
}

function buildArgv(server: McpDef, command: string, coworkPaths?: string[]): string[] {
  const argv = parseCommand(command);
  if (server.id === "filesystem" && coworkPaths?.length) {
    return [...argv, ...coworkPaths.map(normalizeFolder)];
  }
  return argv;
}

function cleanEnv(env: Record<string, string> | undefined) {
  return Object.fromEntries(
    Object.entries(env ?? {})
      .map(([k, v]) => [k.trim(), v] as const)
      .filter(([k, v]) => k && v.trim()),
  );
}

function catalogEntry(server: McpDef, conn: McpConnection | undefined, coworkPaths?: string[]): McpServerEntry {
  const enabled = !!conn?.enabled;
  const primary = effectiveCommand(server, conn);
  const fallbacks = conn?.customCommand?.trim()
    ? []
    : (server.variants ?? []).map((v) => v.command).filter((c) => c !== primary);
  const environment = cleanEnv(conn?.env);
  // Word: keep stdout clean for the MCP protocol.
  if (server.id === "word") environment.MCP_TRANSPORT = "stdio";
  return {
    id: server.id,
    enabled,
    kind: "local",
    command: buildArgv(server, primary, enabled ? coworkPaths : undefined),
    fallbacks: enabled ? fallbacks.map((c) => buildArgv(server, c, coworkPaths)) : [],
    environment,
    timeoutMs: server.timeoutMs ?? 60_000,
  };
}

function customEntry(server: CustomMcp, conn: McpConnection | undefined): McpServerEntry {
  return {
    id: server.id,
    enabled: !!conn?.enabled,
    kind: server.kind,
    command: server.kind === "local" ? parseCommand(server.command ?? "") : [],
    fallbacks: [],
    environment: server.kind === "local" ? cleanEnv(conn?.env) : {},
    url: server.kind === "remote" ? server.url?.trim() : undefined,
    headers: server.kind === "remote" ? cleanEnv(server.headers) : undefined,
    timeoutMs: server.timeoutMs ?? 60_000,
  };
}

export function buildMcpSyncPayload(
  connections: McpState,
  custom: CustomMcp[],
  coworkPaths?: string[],
): McpServerEntry[] {
  return [
    ...MCP_SERVERS.map((server) => catalogEntry(server, asConnection(connections[server.id]), coworkPaths)),
    ...custom.map((server) => customEntry(server, asConnection(connections[server.id]))),
  ];
}
