import type { IconType } from "@lobehub/icons/es/types";
import { Brave, Browserless, Github, MCP, MetaGPT, Microsoft, OpenCode } from "@lobehub/icons";

/** LobeHub brand icon per built-in MCP catalog id (https://lobehub.com/icons). */
export const LOBE_MCP_ICON: Record<string, IconType> = {
  word: Microsoft,
  exec: OpenCode,
  filesystem: MCP,
  github: Github,
  fetch: Browserless,
  playwright: Browserless,
  sqlite: MCP,
  postgres: MCP,
  memory: MCP,
  "sequential-thinking": MetaGPT,
  "brave-search": Brave,
  slack: MCP,
};

export function lobeMcpIcon(id: string): IconType {
  return LOBE_MCP_ICON[id] ?? MCP;
}
