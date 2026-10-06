/**
 * What the backend reports about plugins (see `src-tauri/src/commands/plugins`).
 * Kept apart so the store, the installer and the pages can all name them.
 */
import type { SkillPackage } from "@/features/skills/types";
import type { UserTemplate } from "@/features/templates";

/** Where a plugin or marketplace lives. */
export type PluginSource =
  | { kind: "github"; owner: string; repo: string; ref?: string; dir: string }
  | { kind: "folder"; path: string };

/** A slash command or an agent: one Markdown file. */
export type PluginDoc = { name: string; path: string; content: string };

/** A connector from the plugin's `.mcp.json`, as written. */
export type PluginMcp = { name: string; config: Record<string, unknown>; skipped?: string };

/** A template, or a file a panel loads. */
export type PluginFile = { name: string; path: string; url: string; bytes: number; skipped?: string };

export type PluginPanel = { id: string; title: string; icon?: string; entry: string };

/** Everything a plugin offers, before anything is installed. */
export type PluginPackage = {
  id: string;
  name: string;
  version?: string;
  description: string;
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords: string[];
  source: PluginSource;
  sourceLabel: string;
  revision?: string;
  skills: SkillPackage[];
  commands: PluginDoc[];
  agents: PluginDoc[];
  mcpServers: PluginMcp[];
  templates: PluginFile[];
  panels: PluginPanel[];
  panelFiles: PluginFile[];
  instructions?: string;
  unsupported: string[];
};

export type MarketplaceEntry = {
  name: string;
  description: string;
  version?: string;
  author?: string;
  category?: string;
  keywords: string[];
  homepage?: string;
  /** Missing when Mali can't install it; `unsupported` says why. */
  source?: PluginSource;
  unsupported?: string;
  /** The entry as written; passed back when installing it. */
  entry?: Record<string, unknown>;
};

export type Marketplace = {
  name: string;
  description: string;
  owner?: string;
  source: PluginSource;
  sourceLabel: string;
  plugins: MarketplaceEntry[];
};

/** A source holds a plugin, a marketplace, or a marketplace of just itself. */
export type PluginFetch = { plugin?: PluginPackage; marketplace?: Marketplace };

export type PluginHead = { name: string; version?: string; revision?: string };

export type InstalledFiles = { templates: UserTemplate[]; panelFiles: string[]; failed: string[] };
