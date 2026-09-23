import { SmitheryIcon } from "@/components/app/smithery-icon";
import { useConnectorIcon, useRegistryIcon, type CustomMcp, type McpDef } from "@/features/mcp";
import { lobeMcpIcon } from "@/features/mcp/lobe-icons";
import { isSmitheryInstall } from "@/features/smithery";
import { cn } from "@/lib/utils";
import { MCP } from "@lobehub/icons";

const TILE = "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-background";

/**
 * A registry icon (fetched by the backend); failing that, the mark of
 * wherever it came from, and failing that the MCP mark.
 */
export function RegistryIcon({
  icons,
  size = 28,
  className,
  fallback,
}: {
  icons?: string[];
  size?: number;
  className?: string;
  /** Shown when the server brought no icon of its own. */
  fallback?: "smithery";
}) {
  const src = useRegistryIcon(icons);
  if (!src && fallback === "smithery") {
    return <SmitheryIcon size={size} className={className} />;
  }
  return (
    <span className={cn(TILE, className)} style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt="" className="size-full object-contain p-[3px]" draggable={false} />
      ) : (
        <MCP size={Math.round(size * 0.6)} />
      )}
    </span>
  );
}

/** A picture in the same tile the brand marks use. */
export function PictureTile({ src, size = 28, className }: { src: string; size?: number; className?: string }) {
  return (
    <span className={cn(TILE, className)} style={{ width: size, height: size }}>
      <img src={src} alt="" className="size-full object-contain p-[3px]" draggable={false} />
    </span>
  );
}

export function ConnectorIcon({
  server,
  custom,
  size = 28,
  className,
}: {
  server?: McpDef;
  custom?: CustomMcp;
  size?: number;
  className?: string;
}) {
  const own = useConnectorIcon(custom?.id ?? server?.id);
  if (own) return <PictureTile src={own} size={size} className={className} />;
  if (custom) {
    return (
      <RegistryIcon
        icons={custom.registry?.icons}
        size={size}
        className={className}
        fallback={isSmitheryInstall(custom) ? "smithery" : undefined}
      />
    );
  }
  const Icon = lobeMcpIcon(server?.id ?? "");
  return (
    <span className={cn(TILE, className)} style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.62)} />
    </span>
  );
}
