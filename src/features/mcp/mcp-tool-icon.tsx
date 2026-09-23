import { cn } from "@/lib/utils";
import { useConnectorIcon } from "./icon-override";
import { lobeMcpIcon } from "./lobe-icons";
import { useRegistryIcon } from "./registry";
import type { McpToolRef } from "./tool-label";

/**
 * The MCP server's own mark, sized to sit inline with the Lucide step icons:
 * a registry icon when the server came with one, else its LobeHub brand icon.
 */
export function McpToolIcon({
  mcp,
  className,
  size = 14,
}: {
  mcp: McpToolRef;
  className?: string;
  size?: number;
}) {
  const own = useConnectorIcon(mcp.serverId);
  const registry = useRegistryIcon(own ? undefined : mcp.custom?.registry?.icons);
  const src = own ?? registry;
  if (src) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        style={{ width: size, height: size }}
        className={cn("shrink-0 rounded-[3px] object-contain", className)}
      />
    );
  }
  const Icon = lobeMcpIcon(mcp.serverId);
  return (
    <span className={cn("flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <Icon size={size} />
    </span>
  );
}
