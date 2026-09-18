import { createStore } from "@/lib/local-store";
import { MCP_SERVERS } from "./catalog";

/** An MCP server the user added by hand in Settings → MCP. */
export type CustomMcp = {
  /** Always starts with `custom-`, so it never collides with the catalog. */
  id: string;
  name: string;
  description?: string;
  /** `local` spawns `command`; `remote` connects to `url`. */
  kind: "local" | "remote";
  command?: string;
  url?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  createdAt: number;
};

export const CUSTOM_PREFIX = "custom-";

function revive(value: unknown): CustomMcp[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is CustomMcp =>
      !!v &&
      typeof v === "object" &&
      typeof v.id === "string" &&
      v.id.startsWith(CUSTOM_PREFIX) &&
      typeof v.name === "string" &&
      (v.kind === "local" || v.kind === "remote"),
  );
}

const store = createStore<CustomMcp[]>([], { key: "mcp_custom_servers", revive });

export const useCustomMcps = store.use;
export const getCustomMcps = store.get;

/** A stable, backend-safe id from a display name. */
export function customMcpId(name: string, taken: string[] = store.get().map((s) => s.id)) {
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "server";
  const reserved = new Set([...taken, ...MCP_SERVERS.map((s) => s.id)]);
  let id = `${CUSTOM_PREFIX}${slug}`;
  for (let n = 2; reserved.has(id); n++) id = `${CUSTOM_PREFIX}${slug}-${n}`;
  return id;
}

export function saveCustomMcp(server: CustomMcp) {
  store.set((prev) => {
    const index = prev.findIndex((s) => s.id === server.id);
    if (index === -1) return [...prev, server];
    const next = [...prev];
    next[index] = server;
    return next;
  });
}

export function removeCustomMcp(id: string) {
  store.set((prev) => prev.filter((s) => s.id !== id));
}

export function isCustomMcpId(id: string) {
  return id.startsWith(CUSTOM_PREFIX);
}
