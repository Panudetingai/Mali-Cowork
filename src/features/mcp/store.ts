import { createStore } from "@/lib/local-store";

export type McpConnection = {
  enabled: boolean;
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
        env: value.env,
        variantId: value.variantId,
        customCommand: value.customCommand,
      };
    }
  }
  return out;
}

const store = createStore<Record<string, McpConnection>>({}, {
  key: "mcp_connections",
  revive: (value) => normalizeState(value as McpState),
});

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
