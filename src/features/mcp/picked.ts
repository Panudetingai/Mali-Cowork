import { useMemo } from "react";
import { catalogServer } from "./catalog";
import { getCustomMcps, useCustomMcps } from "./custom";
import { getMcpConnections, useMcpConnections } from "./store";
import type { McpToolRef } from "./tool-label";

/** A connector the user has set up, as the composer lists it. */
export type InstalledConnector = {
  id: string;
  name: string;
  enabled: boolean;
  /** For `McpToolIcon`. */
  ref: McpToolRef;
};

function refFor(id: string, custom = getCustomMcps()): McpToolRef | undefined {
  const own = custom.find((c) => c.id === id);
  const def = catalogServer(id);
  if (!own && !def) return undefined;
  return { serverId: id, serverName: own?.name ?? def?.name ?? id, tool: "", custom: own, def };
}

/** Added by hand or from the catalog, connected or not; A→Z. */
export function useInstalledConnectors(): InstalledConnector[] {
  const connections = useMcpConnections();
  const custom = useCustomMcps();
  return useMemo(() => {
    const ids = new Set([...custom.map((c) => c.id), ...Object.keys(connections)]);
    const out: InstalledConnector[] = [];
    for (const id of ids) {
      const ref = refFor(id, custom);
      if (ref) out.push({ id, name: ref.serverName, enabled: !!connections[id]?.enabled, ref });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [connections, custom]);
}

/**
 * Connectors the user picked for one prompt: the agent is told to reach for
 * their tools first. Ids that are gone or switched off are left out.
 */
export function pickedConnectorInstructions(ids: string[] = []) {
  const connections = getMcpConnections();
  const names = ids
    .filter((id) => connections[id]?.enabled)
    .map((id) => refFor(id))
    .filter((ref): ref is McpToolRef => !!ref)
    .map((ref) => `- ${ref.serverName} (tools named \`${ref.serverId}_…\`)`);
  if (!names.length) return "";
  return `The user picked these connectors for this request. Use their tools to answer it, rather than guessing or using other tools:\n${names.join("\n")}`;
}
