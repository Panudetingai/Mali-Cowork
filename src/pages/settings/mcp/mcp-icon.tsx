import type { CustomMcp, McpDef } from "@/features/mcp";
import { cn } from "@/lib/utils";
import {
  BrainIcon,
  DatabaseIcon,
  FileTextIcon,
  FolderIcon,
  GitBranchIcon,
  GlobeIcon,
  MessageSquareIcon,
  MonitorPlayIcon,
  PlugIcon,
  SearchIcon,
  SquareTerminalIcon,
  WorkflowIcon,
} from "lucide-react";
import { IconTile } from "../ui";

const ICONS: Record<string, typeof FileTextIcon> = {
  word: FileTextIcon,
  exec: SquareTerminalIcon,
  filesystem: FolderIcon,
  github: GitBranchIcon,
  fetch: GlobeIcon,
  playwright: MonitorPlayIcon,
  sqlite: DatabaseIcon,
  postgres: DatabaseIcon,
  memory: BrainIcon,
  thinking: WorkflowIcon,
  search: SearchIcon,
  slack: MessageSquareIcon,
};

export function McpIcon({ server, className }: { server: McpDef; className?: string }) {
  const Icon = ICONS[server.icon] ?? PlugIcon;
  return (
    <IconTile className={cn("border-transparent", server.tile, className)}>
      <Icon />
    </IconTile>
  );
}

export function CustomMcpIcon({ server, className }: { server: CustomMcp; className?: string }) {
  const Icon = server.kind === "remote" ? GlobeIcon : SquareTerminalIcon;
  return (
    <IconTile className={cn("bg-muted text-foreground", className)}>
      <Icon />
    </IconTile>
  );
}
