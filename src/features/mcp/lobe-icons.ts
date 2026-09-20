import type { IconType } from "@lobehub/icons/es/types";
import {
  Brave,
  Browserless,
  Cloudflare,
  Figma,
  Github,
  MCP,
  MetaGPT,
  Microsoft,
  Notion,
  OpenCode,
  Vercel,
} from "@lobehub/icons";

/** LobeHub brand icon per built-in MCP catalog id (https://lobehub.com/icons). */
export const LOBE_MCP_ICON: Record<string, IconType> = {
  notion: Notion,
  vercel: Vercel,
  figma: Figma,
  cloudflare: Cloudflare,
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

/** A user-added `custom-notion` still gets the Notion mark. */
export function lobeMcpIcon(id: string): IconType {
  const slug = id.startsWith("custom-") ? id.slice("custom-".length) : id;
  return LOBE_MCP_ICON[id] ?? LOBE_MCP_ICON[slug] ?? MCP;
}
