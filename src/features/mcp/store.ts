import { bindSecrets, stripSecrets } from "@/features/secrets";
import { createStore } from "@/lib/local-store";
import { catalogServer } from "./catalog";

export type McpConnection = {
  enabled: boolean;
  /** An installed MCP begins UNKNOWN; provenance never grants extra rights. */
  trustLevel?: "UNKNOWN" | "VERIFIED" | "TRUSTED";
  env?: Record<string, string>;
  /** Selected launch variant id (see McpDef.variants). Defaults to the stock command. */
  variantId?: string;
  /** Manual command override (space-separated argv). Wins over variantId. */
  customCommand?: string;
};

export type McpState = Record<string, McpConnection | boolean | undefined>;

function normalizeState(raw: McpState): Record<string, McpConnection> {
  const out: Record<string, McpConnection> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value === "boolean") {
      out[id] = { enabled: value };
    } else if (value && typeof value === "object") {
      out[id] = {
        enabled: !!value.enabled,
        trustLevel: value.trustLevel,
        env: value.env,
        variantId: value.variantId,
        customCommand: value.customCommand,
      };
    }
    const conn = out[id];
    const server = catalogServer(id);
    // Launch methods removed from the catalog (e.g. the old word-mcp-live) fall back to the default.
    if (conn && server && conn.variantId && !server.variants?.some((v) => v.id === conn.variantId)) {
      conn.variantId = undefined;
    }
    if (conn && id === "word" && conn.customCommand && /word[-_]mcp[-_]live/.test(conn.customCommand)) {
      conn.customCommand = undefined;
    }
  }
  return out;
}

type Connections = Record<string, McpConnection>;

// Variables often hold tokens (GitHub, Slack, Brave…), so they live in the
// OS keychain as JSON; localStorage keeps the rest of the connection.
const envSecrets = {
  read: (state: Connections) =>
    Object.fromEntries(
      Object.entries(state).map(([id, conn]) => {
        const env = Object.entries(conn.env ?? {}).filter(([, v]) => v.trim());
        return [id, env.length ? JSON.stringify(Object.fromEntries(env)) : ""];
      }),
    ),
  write: (state: Connections, secrets: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(state).map(([id, conn]) => {
        if (!(id in secrets)) return [id, conn];
        return [id, { ...conn, env: secrets[id] ? parseEnv(secrets[id]) : undefined }];
      }),
    ),
};

function parseEnv(json: string): Record<string, string> | undefined {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
}

const store = createStore<Connections>({}, {
  key: "mcp_connections",
  revive: (value) => normalizeState(value as McpState),
  persist: (state) => stripSecrets(state, envSecrets),
});
bindSecrets(store, { prefix: "mcp-env:", ...envSecrets });

export function useMcpConnections() {
  return store.use();
}

export function getMcpConnections() {
  return store.get();
}

export function isMcpConnected(id: string) {
  return !!store.get()[id]?.enabled;
}

export function setMcpConnections(next: Record<string, McpConnection>) {
  store.set(next);
}

export function patchMcpConnection(id: string, patch: Partial<McpConnection>) {
  store.set((prev) => {
    const cur = prev[id];
    const base: McpConnection =
      cur && typeof cur === "object" ? cur : { enabled: false };
    return { ...prev, [id]: { ...base, ...patch } };
  });
}

export function setMcpConnected(id: string, connected: boolean) {
  patchMcpConnection(id, { enabled: connected });
}

export function setMcpEnv(id: string, env: Record<string, string>) {
  store.set((prev) => {
    const cur = prev[id];
    const base: McpConnection =
      cur && typeof cur === "object" ? cur : { enabled: false };
    return { ...prev, [id]: { ...base, env: { ...base.env, ...env } } };
  });
}

export function toggleMcpConnected(id: string) {
  store.set((prev) => {
    const cur = prev[id];
    const base: McpConnection =
      cur && typeof cur === "object" ? cur : { enabled: false };
    return { ...prev, [id]: { ...base, enabled: !base.enabled } };
  });
}

export function connectedMcpCount() {
  return Object.values(store.get()).filter((c) => c.enabled).length;
}

export function removeMcpConnection(id: string) {
  store.set(({ [id]: _removed, ...rest }) => rest);
}
