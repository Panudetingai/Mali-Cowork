import { lobeMcpIcon } from "@/features/mcp/lobe-icons";
import { useConnectorIcon, useRegistryIcon, type CustomMcp, type McpDef } from "@/features/mcp";
import { MCP } from "@lobehub/icons";
import { cn } from "@/lib/utils";
import { IconTile } from "../ui";

const PICTURE = "size-full rounded-[inherit] object-contain p-1.5";

/** `plain` skips an icon the user picked — the icon picker shows that itself. */
export function McpIcon({ server, className, plain }: { server: McpDef; className?: string; plain?: boolean }) {
  const picked = useConnectorIcon(server.id);
  const own = plain ? undefined : picked;
  const Icon = lobeMcpIcon(server.id);
  return (
    <IconTile className={cn("border-transparent bg-background", className)}>
      {own ? <img src={own} alt="" draggable={false} className={PICTURE} /> : <Icon size={22} />}
    </IconTile>
  );
}

export function CustomMcpIcon({ server, className, plain }: { server: CustomMcp; className?: string; plain?: boolean }) {
  const picked = useConnectorIcon(server.id);
  const own = plain ? undefined : picked;
  const registry = useRegistryIcon(own ? undefined : server.registry?.icons);
  const src = own ?? registry;
  return (
    <IconTile className={cn("border-transparent bg-background", className)}>
      {src ? <img src={src} alt="" draggable={false} className={PICTURE} /> : <MCP size={22} />}
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
