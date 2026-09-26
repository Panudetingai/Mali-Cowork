import { catalogServer } from "./catalog";
import { CUSTOM_PREFIX, getCustomMcps, type CustomMcp } from "./custom";
import type { McpDef } from "./catalog";

export type McpToolRef = {
  /** The MCP server the tool belongs to, e.g. `custom-notion`. */
  serverId: string;
  /** What to call it on screen, e.g. `Notion`. */
  serverName: string;
  /** The tool without its server prefix, e.g. `search`. */
  tool: string;
  custom?: CustomMcp;
  def?: McpDef;
};

/** `custom-notion` → `notion`, so `notion-search` can shed the repeat. */
function slugOf(serverId: string) {
  return serverId.startsWith(CUSTOM_PREFIX) ? serverId.slice(CUSTOM_PREFIX.length) : serverId;
}

/** MCP servers name their tools `notion-search`; the server is already shown. */
function shortTool(tool: string, serverId: string) {
  const slug = slugOf(serverId).toLowerCase();
  const lower = tool.toLowerCase();
  for (const sep of ["-", "_", "."]) {
    const prefix = `${slug}${sep}`;
    if (lower.startsWith(prefix) && tool.length > prefix.length) return tool.slice(prefix.length);
  }
  return tool;
}

/**
 * Read an agent step title like `custom-notion_notion-search` as the MCP
 * server and tool behind it. Returns undefined for the agent's own tools
 * (`bash`, `read`, …), so only real MCP calls get a brand icon.
 */
export function mcpToolOf(title: string): McpToolRef | undefined {
  // CLI agents reach the connectors through Mali's `mali` gateway, and name
  // the tools after it: `mali_custom-notion_notion-search`.
  if (title.startsWith("mali_")) title = title.slice("mali_".length);
  const at = title.indexOf("_");
  if (at <= 0 || at === title.length - 1) return undefined;
  const serverId = title.slice(0, at);
  const custom = getCustomMcps().find((server) => server.id === serverId);
  const def = catalogServer(serverId);
  // An underscore alone proves nothing — only a known server does.
  if (!custom && !def) return undefined;
  return {
    serverId,
    serverName: custom?.name ?? def?.name ?? slugOf(serverId),
    tool: shortTool(title.slice(at + 1), serverId),
    custom,
    def,
  };
}
