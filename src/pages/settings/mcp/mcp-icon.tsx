import { lobeMcpIcon } from "@/features/mcp/lobe-icons";
import type { CustomMcp, McpDef } from "@/features/mcp";
import { MCP } from "@lobehub/icons";
import { cn } from "@/lib/utils";
import { IconTile } from "../ui";

export function McpIcon({ server, className }: { server: McpDef; className?: string }) {
  const Icon = lobeMcpIcon(server.id);
  return (
    <IconTile className={cn("border-transparent bg-background", className)}>
      <Icon size={22} />
    </IconTile>
  );
}

export function CustomMcpIcon({ className }: { server: CustomMcp; className?: string }) {
  return (
    <IconTile className={cn("border-transparent bg-background", className)}>
      <MCP size={22} />
    </IconTile>
  );
}

/** Settings nav tab — official MCP mark from LobeHub. */
export function McpTabIcon({ className }: { className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center [&_svg]:size-4", className)} aria-hidden>
      <MCP size={16} />
    </span>
  );
}
